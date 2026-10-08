<?php

declare(strict_types=1);

namespace InkGroove\Deploy;

use RuntimeException;
use ZipArchive;

/** Standalone CLI utilities: do not boot or expose the application's secrets. */
final class UpdateSupport
{
    public static function privateDirectory(string $path): void
    {
        if (is_link($path) || (!is_dir($path) && !mkdir($path, 0700, true))) {
            throw new RuntimeException('No se puede crear el directorio privado.');
        }
        chmod($path, 0700);
    }

    public static function json(string $path): array
    {
        $value = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($value)) throw new RuntimeException('JSON inválido.');
        return $value;
    }

    public static function write(string $path, string $contents, int $mode = 0600): void
    {
        if (is_link($path)) throw new RuntimeException('No se sobrescriben enlaces simbólicos.');
        if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0750, true)) throw new RuntimeException('No se pudo crear el directorio del archivo.');
        $temporary = $path.'.tmp-'.bin2hex(random_bytes(5));
        if (file_put_contents($temporary, $contents) === false) throw new RuntimeException('No se pudo escribir un archivo.');
        chmod($temporary, $mode);
        if (!rename($temporary, $path)) throw new RuntimeException('No se pudo activar un archivo.');
    }

    public static function writeJson(string $path, array $value): void
    {
        self::write($path, json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
    }

    public static function copyTree(string $source, string $target, bool $public = false): void
    {
        if (is_link($source) || is_link($target)) throw new RuntimeException('No se copian enlaces simbólicos.');
        if (is_dir($source)) {
            if (!is_dir($target) && !mkdir($target, $public ? 0755 : 0750, true)) throw new RuntimeException('No se pudo crear un directorio.');
            if ($public) chmod($target, 0755);
            foreach (new \DirectoryIterator($source) as $entry) {
                if (!$entry->isDot()) self::copyTree($entry->getPathname(), $target.'/'.$entry->getFilename(), $public);
            }
        } else {
            self::write($target, (string) file_get_contents($source), $public ? 0644 : fileperms($source) & 0777);
        }
    }

    public static function removeTree(string $path): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach (new \DirectoryIterator($path) as $entry) {
                if (!$entry->isDot()) self::removeTree($entry->getPathname());
            }
            rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            unlink($path);
        }
    }

    public static function safePath(string $path): bool
    {
        return $path !== '' && !str_starts_with($path, '/') && !str_contains($path, '\\')
            && !preg_match('~[\x00-\x1f\x7f]|(^|/)(\.\.?)(/|$)|^[A-Za-z]:~', $path);
    }

    public static function allowedFile(string $path, string $profile): bool
    {
        if (!self::safePath($path)) return false;
        if (preg_match('~(^|/)(\.git|node_modules)(/|$)|\.(sql|sqlite(?:-.*)?|log)$~', $path)
            || str_starts_with($path, 'data/') || str_starts_with($path, 'inkgroove/data/')) return false;
        if (preg_match('~(^|/)\.env[^/]*$~', $path) && $path !== '.env.example') return false;
        if ($profile === 'siteground') {
            return str_starts_with($path, 'inkgroove/')
                || str_starts_with($path, 'public_html/build/')
                || in_array($path, ['public_html/index.php', 'public_html/.htaccess', 'public_html/favicon.svg', 'BUILD-INFO.json', 'FILES.sha256', 'INSTALL-SITEGROUND.md'], true);
        }
        return $profile === 'alpine' && !str_starts_with($path, 'vendor/') && !str_starts_with($path, 'public/build/');
    }

    /** Extract entries individually, after inspecting all paths/types/size limits. */
    public static function extract(string $archive, string $sha256, string $target, string $profile): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $sha256) || !is_file($archive)
            || filesize($archive) > 150_000_000 || !hash_equals($sha256, hash_file('sha256', $archive))) {
            throw new RuntimeException('El SHA256 del paquete no coincide. No se ha modificado la instalación.');
        }
        if (file_exists($target)) throw new RuntimeException('El directorio de ensayo debe ser nuevo.');
        $zip = new ZipArchive();
        if ($zip->open($archive) !== true) throw new RuntimeException('El paquete no es un ZIP válido.');
        try {
            if ($zip->numFiles > 30_000) throw new RuntimeException('Demasiados archivos en el paquete.');
            $entries = [];
            $sizes = [];
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                $name = $stat['name'];
                $directory = str_ends_with($name, '/');
                $path = rtrim($name, '/');
                $zip->getExternalAttributesIndex($i, $system, $attributes);
                $type = ($attributes >> 16) & 0170000;
                if (!self::safePath($path) || isset($entries[$path]) || !in_array($type, [0, 0100000, 0040000], true)
                    || (!$directory && !self::allowedFile($path, $profile))) {
                    throw new RuntimeException('Ruta o tipo de archivo no permitido en el paquete.');
                }
                $total += $stat['size'];
                if ($total > 500_000_000) throw new RuntimeException('El paquete descomprimido excede el límite.');
                $entries[$path] = $directory;
                $sizes[$path] = $stat['size'];
            }
            self::privateDirectory($target);
            foreach ($entries as $path => $directory) {
                $destination = $target.'/'.$path;
                if ($directory) {
                    if (!is_dir($destination)) mkdir($destination, 0750, true);
                    continue;
                }
                if (!is_dir(dirname($destination))) mkdir(dirname($destination), 0750, true);
                $input = $zip->getStream($path);
                $output = fopen($destination, 'xb');
                if (!$input || !$output || stream_copy_to_stream($input, $output, $sizes[$path] + 1) !== $sizes[$path]) throw new RuntimeException('No se pudo extraer el paquete completo.');
                fclose($input);
                fclose($output);
                chmod($destination, 0644);
            }
            $info = self::json($target.'/BUILD-INFO.json');
            if (($info['profile'] ?? '') !== $profile || ($info['candidate'] ?? true)
                || !preg_match('/^[a-f0-9]{40}$/', $info['revision'] ?? '')) {
                throw new RuntimeException('El perfil o la revisión del paquete no es válido.');
            }
            $listed = [];
            foreach (file($target.'/FILES.sha256', FILE_IGNORE_NEW_LINES) as $line) {
                if (!preg_match('/^([a-f0-9]{64})  (.+)$/', $line, $match)) throw new RuntimeException('Inventario SHA256 inválido.');
                $path = $match[2];
                if ($path === 'FILES.sha256' || !self::allowedFile($path, $profile) || isset($listed[$path])
                    || !is_file($target.'/'.$path) || !hash_equals($match[1], hash_file('sha256', $target.'/'.$path))) {
                    throw new RuntimeException('El inventario del paquete no coincide.');
                }
                $listed[$path] = true;
            }
            foreach ($entries as $path => $directory) {
                if (!$directory && $path !== 'FILES.sha256' && !isset($listed[$path])) throw new RuntimeException('Archivo fuera del inventario.');
            }
            return $info;
        } catch (\Throwable $error) {
            self::removeTree($target);
            throw $error;
        } finally {
            $zip->close();
        }
    }

    /** Replace only InkGroove's block; keep hosting authentication and HTTPS rules. */
    public static function mergeHtaccess(string $current, string $next, string $legacy): string
    {
        $current = str_replace("\r\n", "\n", $current);
        $next = str_replace("\r\n", "\n", $next);
        $pattern = '~^# BEGIN INKGROOVE\n.*?^# END INKGROOVE\n?~ms';
        if (!preg_match($pattern, $next, $newBlock)) throw new RuntimeException('El paquete no delimita las reglas de InkGroove.');
        $begin = substr_count($current, '# BEGIN INKGROOVE');
        $end = substr_count($current, '# END INKGROOVE');
        if ($begin || $end) {
            if ($begin !== 1 || $end !== 1 || preg_match_all($pattern, $current) !== 1) throw new RuntimeException('Bloque .htaccess ambiguo.');
            return preg_replace_callback($pattern, fn () => $newBlock[0], $current);
        }
        $legacy = trim(str_replace("\r\n", "\n", $legacy));
        if (substr_count($current, $legacy) !== 1) throw new RuntimeException('No se reconocen las reglas antiguas. Conservar la protección y delimitar el bloque InkGroove antes de actualizar.');
        return str_replace($legacy, rtrim($newBlock[0]), $current);
    }

    public static function run(array $command, string $cwd, string $log): void
    {
        $process = proc_open($command, [0 => ['file', '/dev/null', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, $cwd);
        if (!is_resource($process) || proc_close($process) !== 0) {
            throw new RuntimeException('Falló un paso del despliegue. Consulte el registro privado: '.$log);
        }
        chmod($log, 0600);
    }

    public static function health(string $url, array $config): void
    {
        if (parse_url($url, PHP_URL_SCHEME) !== 'https') throw new RuntimeException('El diagnóstico de SiteGround requiere HTTPS.');
        $headers = ['Cache-Control: no-cache'];
        if (($config['health_username'] ?? '') !== '') {
            $headers[] = 'Authorization: Basic '.base64_encode($config['health_username'].':'.($config['health_password'] ?? ''));
        }
        $context = stream_context_create(['http' => ['method' => 'GET', 'header' => implode("\r\n", $headers), 'timeout' => 20, 'ignore_errors' => true, 'follow_location' => 0], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $response = @fopen($url, 'rb', false, $context);
        if ($response) fclose($response);
        $status = self::status($http_response_header ?? []);
        if ($status !== 200) throw new RuntimeException('La comprobación /up devuelve HTTP '.$status.'. Revise HTTPS y las credenciales del muro en la configuración privada.');
    }

    public static function status(array $headers): int
    {
        return preg_match('~^HTTP/\S+ (\d{3})~', $headers[0] ?? '', $match) ? (int) $match[1] : 0;
    }

    public static function configure(string $file, string $profile): void
    {
        self::privateDirectory(dirname($file));
        $existing = is_file($file) ? self::json($file) : [];
        $prompt = static function (string $label, string $default = '', bool $secret = false): string {
            fwrite(STDOUT, $label.($default !== '' && !$secret ? ' ['.$default.']' : '').': ');
            $hidden = $secret && stream_isatty(STDIN);
            $echo = static function (bool $enabled): void {
                $process = proc_open(['stty', $enabled ? 'echo' : '-echo'], [0 => STDIN, 1 => STDOUT, 2 => STDERR], $pipes);
                if (!is_resource($process) || proc_close($process) !== 0) throw new RuntimeException('No se puede ocultar la entrada; configure el JSON privado con un editor.');
            };
            if ($hidden) $echo(false);
            try { $value = trim((string) fgets(STDIN)); }
            finally { if ($hidden) { $echo(true); fwrite(STDOUT, "\n"); } }
            return $value !== '' ? $value : $default;
        };
        $config = ['repository' => $prompt('Repositorio', $existing['repository'] ?? 'alscos/veritas'), 'token' => $prompt('Token GitHub de solo lectura (no se muestra)', $existing['token'] ?? '', true)];
        if ($profile === 'siteground') {
            $config['health_url'] = $prompt('URL HTTPS de diagnóstico', $existing['health_url'] ?? 'https://inkgroove.com/up');
            $config['health_username'] = $prompt('Usuario de URLs protegidas (vacío si no hay muro)', $existing['health_username'] ?? '');
            $config['health_password'] = $config['health_username'] !== '' ? $prompt('Contraseña de URLs protegidas (no se muestra)', $existing['health_password'] ?? '', true) : '';
        }
        if (!preg_match('~^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$~', $config['repository']) || $config['token'] === '' || preg_match('/[\r\n]/', $config['token'])) throw new RuntimeException('Repositorio o token inválido.');
        self::writeJson($file, $config);
        echo "Configuración privada guardada. No se añade a GitHub.\n";
    }
}
