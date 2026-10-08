<?php

declare(strict_types=1);

namespace InkGroove\Deploy;

use RuntimeException;

final class SiteGroundUpdater
{
    private string $core;
    private string $public;
    private string $private;
    private \Closure $runner;
    private \Closure $health;

    public function __construct(private readonly string $root, private readonly array $config, ?\Closure $runner = null, ?\Closure $health = null)
    {
        $this->core = $root.'/inkgroove';
        $this->public = $root.'/public_html';
        $this->private = $root.'/.inkgroove-updates';
        $this->runner = $runner ?? UpdateSupport::run(...);
        $this->health = $health ?? UpdateSupport::health(...);
    }

    public function install(string $archive, string $hash, ?string $expectedShort = null): string
    {
        if (!is_file($this->core.'/.env') || !is_file($this->core.'/artisan') || !is_dir($this->public)) throw new RuntimeException('No se reconoce la instalación existente de SiteGround.');
        UpdateSupport::privateDirectory($this->private);
        $lock = fopen($this->private.'/lock', 'c');
        chmod($this->private.'/lock', 0600);
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('Ya hay otra actualización en curso.');
        $work = $this->private.'/work-'.bin2hex(random_bytes(6));
        $backup = $this->private.'/backups/'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(3));
        $log = $backup.'/deployment.log';
        $maintenance = false;
        $activated = false;
        $migrationStarted = false;
        $artisan = fn (string $base, array $arguments) => ($this->runner)([PHP_BINARY, $base.'/artisan', ...$arguments], $base, $log);
        try {
            $info = UpdateSupport::extract($archive, $hash, $work, 'siteground');
            if ($expectedShort !== null && substr($info['revision'], 0, 12) !== $expectedShort) throw new RuntimeException('La revisión del paquete no coincide con la release.');
            $stateFile = $this->private.'/installed.json';
            if (is_file($stateFile) && (UpdateSupport::json($stateFile)['revision'] ?? '') === $info['revision']) return 'Esta revisión ya está instalada.';
            foreach (['artisan', 'vendor/autoload.php', 'deploy/siteground/htaccess-v1.txt'] as $file) {
                if (!is_file($work.'/inkgroove/'.$file)) throw new RuntimeException('El paquete no contiene el núcleo completo.');
            }
            $htaccess = UpdateSupport::mergeHtaccess(
                (string) file_get_contents($this->public.'/.htaccess'),
                (string) file_get_contents($work.'/public_html/.htaccess'),
                (string) file_get_contents($work.'/inkgroove/deploy/siteground/htaccess-v1.txt'),
            );
            ($this->health)($this->config['health_url'] ?? '', $this->config);
            if (is_file($this->core.'/storage/framework/down')) throw new RuntimeException('La aplicación ya está en mantenimiento. Revisar la instalación antes de continuar.');
            UpdateSupport::privateDirectory($backup);
            UpdateSupport::writeJson($backup.'/update.json', $info);
            $artisan($this->core, ['down', '--retry=60']);
            $maintenance = true;
            // Allow short in-flight requests to finish before snapshotting persistent data.
            if ($this->config['drain_seconds'] ?? true) usleep(2_000_000);
            ($this->runner)([PHP_BINARY, dirname(__DIR__).'/snapshot-database.php', $this->core, $backup.'/database.sql'], $this->core, $log);
            if (!is_file($backup.'/database.sql') || filesize($backup.'/database.sql') === 0) throw new RuntimeException('No se ha obtenido una copia SQL.');
            UpdateSupport::copyTree($this->core.'/.env', $work.'/inkgroove/.env');
            chmod($work.'/inkgroove/.env', 0600);
            UpdateSupport::removeTree($work.'/inkgroove/storage');
            UpdateSupport::copyTree($this->core.'/storage', $work.'/inkgroove/storage');
            foreach (['index.php', '.htaccess', 'favicon.svg', 'build'] as $path) {
                if (file_exists($this->public.'/'.$path)) UpdateSupport::copyTree($this->public.'/'.$path, $backup.'/public_html/'.$path);
            }
            // The old core becomes the full private backup, including .env and storage.
            if (!rename($this->core, $backup.'/inkgroove')) throw new RuntimeException('No se pudo guardar el núcleo anterior.');
            if (!rename($work.'/inkgroove', $this->core)) {
                rename($backup.'/inkgroove', $this->core);
                throw new RuntimeException('No se pudo activar el nuevo núcleo.');
            }
            $activated = true;
            UpdateSupport::copyTree($work.'/public_html/build', $this->public.'/build', true); // Keep previous hashed chunks.
            foreach (['index.php', 'favicon.svg'] as $file) UpdateSupport::copyTree($work.'/public_html/'.$file, $this->public.'/'.$file, true);
            UpdateSupport::write($this->public.'/.htaccess', $htaccess, 0644);
            $migrationStarted = true;
            $artisan($this->core, ['migrate', '--force']);
            foreach (['config:cache', 'route:cache', 'view:cache', 'inkgroove:preflight'] as $command) $artisan($this->core, [$command]);
            ($this->health)($this->config['health_url'], $this->config); // /up is excluded from Laravel's maintenance mode.
            $artisan($this->core, ['up']);
            $maintenance = false;
            ($this->health)($this->config['health_url'], $this->config);
            UpdateSupport::writeJson($stateFile, ['revision' => $info['revision'], 'profile' => 'siteground', 'installed_at_utc' => gmdate(DATE_ATOM), 'backup' => $backup]);
            return 'Instalada '.substr($info['revision'], 0, 12).'. Copia privada: '.$backup;
        } catch (\Throwable $error) {
            if ($maintenance && !$migrationStarted) {
                try {
                    if ($activated) {
                        UpdateSupport::removeTree($this->core);
                        rename($backup.'/inkgroove', $this->core);
                        foreach (['index.php', '.htaccess', 'favicon.svg', 'build'] as $path) {
                            if (file_exists($backup.'/public_html/'.$path)) UpdateSupport::copyTree($backup.'/public_html/'.$path, $this->public.'/'.$path);
                        }
                    }
                    $artisan($this->core, ['up']);
                    $maintenance = false;
                } catch (\Throwable) { /* Preserve the backup and maintenance for manual recovery. */ }
            } elseif ($activated && !$maintenance) {
                // A post-activation check failed: close the application again.
                try { $artisan($this->core, ['down', '--retry=60']); $maintenance = true; } catch (\Throwable) {}
            }
            throw new RuntimeException($error->getMessage().($maintenance ? "\nLa aplicación sigue en mantenimiento. No se revierte la base de datos automáticamente. Copia: ".$backup : ''), previous: $error);
        } finally {
            UpdateSupport::removeTree($work);
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
