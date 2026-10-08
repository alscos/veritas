<?php

declare(strict_types=1);

namespace InkGroove\Deploy;

use RuntimeException;

final class GitHubRelease
{
    public function __construct(private readonly array $config, private readonly ?\Closure $transport = null) {}

    public static function headers(string $url, string $token, string $accept): array
    {
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || parse_url($url, PHP_URL_USER) !== null || parse_url($url, PHP_URL_PASS) !== null) throw new RuntimeException('Solo se permiten descargas HTTPS.');
        $headers = ['User-Agent: InkGroove-Updater/1', 'Accept: '.$accept];
        if (strtolower((string) parse_url($url, PHP_URL_HOST)) === 'api.github.com') {
            $headers[] = 'Authorization: Bearer '.$token;
            $headers[] = 'X-GitHub-Api-Version: 2026-03-10';
        }
        return $headers;
    }

    private function get(string $url, string $accept = 'application/vnd.github+json', ?string $target = null): string
    {
        for ($redirect = 0; $redirect < 6; $redirect++) {
            $headers = self::headers($url, $this->config['token'], $accept);
            if ($this->transport) {
                [$status, $responseHeaders, $body] = ($this->transport)($url, $headers);
                $stream = null;
            } else {
                $context = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'timeout' => 60, 'ignore_errors' => true, 'follow_location' => 0], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
                $stream = @fopen($url, 'rb', false, $context);
                $responseHeaders = $http_response_header ?? [];
                $status = UpdateSupport::status($responseHeaders);
                $body = '';
            }
            if (in_array($status, [301, 302, 303, 307, 308], true)) {
                if ($stream) fclose($stream);
                $location = null;
                foreach ($responseHeaders as $header) if (stripos($header, 'Location:') === 0) $location = trim(substr($header, 9));
                if (!$location || parse_url($location, PHP_URL_SCHEME) !== 'https') throw new RuntimeException('Redirección de descarga inválida.');
                $url = $location;
                continue; // Rebuild headers: never forward GitHub's token to storage hosts.
            }
            if ($status !== 200) {
                if ($stream) fclose($stream);
                throw new RuntimeException('GitHub devuelve HTTP '.$status.'. Revise el repositorio, el token y su permiso Contents: read.');
            }
            if ($target === null) {
                if ($stream) { $body = stream_get_contents($stream, 4_000_001); fclose($stream); }
                if (strlen($body) > 4_000_000) throw new RuntimeException('Respuesta de GitHub demasiado grande.');
                return $body;
            }
            $output = fopen($target, 'wb');
            try {
                $count = $stream ? stream_copy_to_stream($stream, $output, 150_000_001) : fwrite($output, $body);
            } finally {
                if ($stream) fclose($stream);
                fclose($output);
                chmod($target, 0600);
            }
            if ($count === false || $count > 150_000_000) { unlink($target); throw new RuntimeException('Descarga incompleta o demasiado grande.'); }
            return $target;
        }
        throw new RuntimeException('Demasiadas redirecciones.');
    }

    public function release(?string $tag = null): array
    {
        if ($tag === '') $tag = null;
        $repo = $this->config['repository'] ?? '';
        if (!preg_match('~^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$~', $repo) || empty($this->config['token']) || preg_match('/[\r\n]/', $this->config['token'])) throw new RuntimeException('Configuración GitHub inválida.');
        if ($tag !== null && !preg_match('/^build-[a-f0-9]{12}$/', $tag)) throw new RuntimeException('Use una versión build-SHA12 publicada por el workflow.');
        $base = 'https://api.github.com/repos/'.$repo.'/releases';
        $values = json_decode($this->get($tag ? $base.'/tags/'.$tag : $base.'?per_page=100'), true, flags: JSON_THROW_ON_ERROR);
        $values = $tag ? [$values] : $values;
        $values = array_filter($values, fn ($r) => !($r['draft'] ?? true) && preg_match('/^build-[a-f0-9]{12}$/', $r['tag_name'] ?? ''));
        usort($values, fn ($a, $b) => strcmp($b['published_at'] ?? '', $a['published_at'] ?? ''));
        if (!$values) throw new RuntimeException('Todavía no hay una versión validada y publicada por GitHub Actions.');
        return $values[0];
    }

    public function download(array $release, string $profile, string $directory): array
    {
        if (!in_array($profile, ['siteground', 'alpine'], true)) throw new RuntimeException('Perfil desconocido.');
        $short = substr($release['tag_name'], 6);
        $name = 'inkgroove-'.$profile.'-'.$short.'.zip';
        $assets = array_column($release['assets'] ?? [], null, 'name');
        foreach ([$name, $name.'.sha256'] as $file) {
            if (!isset($assets[$file]['id']) || ($assets[$file]['state'] ?? '') !== 'uploaded') throw new RuntimeException('La versión no tiene ambos paquetes completos.');
        }
        UpdateSupport::privateDirectory($directory);
        $base = 'https://api.github.com/repos/'.$this->config['repository'].'/releases/assets/';
        $checksum = $this->get($base.$assets[$name.'.sha256']['id'], 'application/octet-stream');
        if (!preg_match('/^([a-f0-9]{64})  '.preg_quote($name, '/').'\s*$/D', $checksum, $match)) throw new RuntimeException('Checksum de la versión inválido.');
        $digest = $assets[$name]['digest'] ?? null;
        if ($digest !== null && $digest !== 'sha256:'.$match[1]) throw new RuntimeException('El digest de GitHub no coincide con el checksum.');
        $path = $directory.'/'.$name;
        if (!is_file($path) || hash_file('sha256', $path) !== $match[1]) $this->get($base.$assets[$name]['id'], 'application/octet-stream', $path);
        if (!hash_equals($match[1], hash_file('sha256', $path))) throw new RuntimeException('La descarga no coincide con su SHA256.');
        return ['archive' => $path, 'sha256' => $match[1], 'short_revision' => $short, 'tag' => $release['tag_name']];
    }
}
