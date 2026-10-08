<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class HostingPreflight extends Command
{
    protected $signature = 'inkgroove:preflight {--skip-database : Do not connect to the database} {--allow-http : Allow HTTP for a local rehearsal only}';
    protected $description = 'Comprueba el perfil de hosting sin mostrar claves ni contraseñas';

    public function handle(): int
    {
        $failed = false;
        $check = function (bool $ok, string $label) use (&$failed): void {
            $failed = $failed || !$ok;
            $this->line(($ok ? 'OK: ' : 'FALLO: ').$label);
        };

        $check(version_compare(PHP_VERSION, '8.3.0', '>='), 'PHP CLI >= 8.3 ('.PHP_VERSION.')');
        $extensions = ['ctype', 'curl', 'dom', 'fileinfo', 'filter', 'hash', 'intl', 'mbstring', 'openssl', 'pcre', 'PDO', 'session', 'tokenizer', 'xml', 'zip'];
        if (config('database.default') === 'mysql') $extensions[] = 'pdo_mysql';
        foreach ($extensions as $extension) $check(extension_loaded($extension), 'extensión '.$extension);

        $check(app()->environment('production'), 'APP_ENV=production');
        $check(config('app.debug') === false, 'APP_DEBUG=false');
        $key = (string) config('app.key');
        $decoded = str_starts_with($key, 'base64:') ? base64_decode(substr($key, 7), true) : $key;
        $check(is_string($decoded) && strlen($decoded) === 32, 'APP_KEY configurada para AES-256');
        $signingKey = (string) config('veritas.signing_key');
        $check(strlen($signingKey) >= 32 && $signingKey !== $key, 'clave de sellado independiente configurada');
        $url = parse_url((string) config('app.url'));
        $host = strtolower($url['host'] ?? '');
        $check(in_array($url['scheme'] ?? '', ['http', 'https'], true) && $host !== '' && !in_array($host, ['your.domain', 'example.com'], true) && empty($url['user']) && empty($url['pass']) && empty($url['query']) && empty($url['fragment']) && in_array($url['path'] ?? '', ['', '/'], true), 'APP_URL apunta al dominio real, en la raíz');
        if (!$this->option('allow-http')) {
            $check(($url['scheme'] ?? '') === 'https', 'APP_URL usa HTTPS');
            $check(config('session.secure') === true, 'cookie de sesión segura');
        }

        $base = realpath(base_path());
        $public = realpath(public_path());
        $check($public !== false && $base !== false && $base !== $public && !str_starts_with($base.'/', $public.'/'), 'núcleo de Laravel fuera de la carpeta pública');
        foreach (['storage/app/private/images', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs', 'bootstrap/cache'] as $directory) {
            $check(is_dir(base_path($directory)) && is_writable(base_path($directory)), $directory.' existe y permite escritura');
        }
        $manifest = public_path('build/manifest.json');
        $assetsReady = false;
        if (is_file($manifest)) {
            $assets = json_decode(file_get_contents($manifest), true);
            $entry = $assets['resources/js/main.tsx'] ?? [];
            $files = array_merge([$entry['file'] ?? ''], $entry['css'] ?? []);
            $assetsReady = !empty($entry['css']) && count($files) > 1;
            foreach ($files as $file) {
                $assetsReady = $assetsReady && is_string($file) && preg_match('/^[\w\/.-]+$/', $file) && !str_contains($file, '..') && is_file(public_path('build/'.$file));
            }
        }
        $check((bool) $assetsReady, 'editor compilado y manifiesto de recursos válido');
        $check(!is_file(public_path('hot')), 'sin conexión a un servidor Vite de desarrollo');

        if ($this->option('skip-database')) {
            $this->warn('Base de datos: comprobación omitida; aún no valida una instalación real.');
        } else {
            $check(config('database.default') === 'mysql', 'base de datos MySQL/MariaDB');
            try {
                $db = DB::selectOne('SELECT VERSION() AS version, @@character_set_connection AS charset');
                $version = preg_replace('/[^0-9.].*$/', '', $db->version);
                $isMariaDb = stripos($db->version, 'mariadb') !== false;
                if ($isMariaDb && preg_match('/(\d+\.\d+\.\d+)-MariaDB/i', $db->version, $matches)) $version = $matches[1];
                $minimum = $isMariaDb ? '10.11.0' : '8.0.13';
                $check(version_compare($version, $minimum, '>='), 'servidor MySQL/MariaDB compatible');
                $check($db->charset === 'utf8mb4', 'conexión UTF-8 completa (utf8mb4)');
                $size = DB::selectOne('SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()');
                $this->line('Tamaño estimado de la base de datos: '.round($size->bytes / 1_000_000, 1).' MB.');
                if ($size->bytes >= 750_000_000) $this->warn('Revisar capacidad: GrowBig publica un límite de 1000 MB por base de datos.');
            } catch (\Throwable) {
                $check(false, 'conexión y diagnóstico MySQL; revisar los datos privados de .env');
            }
        }

        $this->line('Verificar también la versión y extensiones del PHP web en Site Tools.');
        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
