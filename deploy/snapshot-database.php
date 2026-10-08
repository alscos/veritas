<?php

declare(strict_types=1);

// Separate process: read the live Laravel connection without printing credentials.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
$core = $argv[1] ?? '';
$output = $argv[2] ?? '';
$defaults = '';
try {
    require $core.'/vendor/autoload.php';
    $app = require $core.'/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $connection = $app['db']->connection();
    if ($connection->getDriverName() !== 'mysql') throw new RuntimeException('El backup de SiteGround requiere MySQL/MariaDB.');
    $config = $connection->getConfig();
    $defaults = dirname($output).'/.mysql-client-'.bin2hex(random_bytes(6));
    $quote = static fn ($value) => '"'.str_replace(['\\', '"', "\n", "\r"], ['\\\\', '\\"', '\\n', '\\r'], (string) $value).'"';
    $settings = "[client]\n";
    foreach (['host' => 'host', 'port' => 'port', 'username' => 'user', 'password' => 'password', 'unix_socket' => 'socket'] as $key => $name) {
        if (isset($config[$key]) && $config[$key] !== '') $settings .= $name.'='.$quote($config[$key])."\n";
    }
    if (file_put_contents($defaults, $settings) === false) throw new RuntimeException('No se pudo crear la configuración privada del backup.');
    chmod($defaults, 0600);
    $client = null;
    foreach (explode(PATH_SEPARATOR, getenv('PATH') ?: '') as $directory) {
        foreach (['mysqldump', 'mariadb-dump'] as $name) if (is_executable($directory.'/'.$name)) { $client = $directory.'/'.$name; break 2; }
    }
    if (!$client) throw new RuntimeException('No se encuentra mysqldump ni mariadb-dump; no se actualiza sin copia SQL.');
    $versionProcess = proc_open([$client, '--version'], [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'a']], $pipes);
    $version = stream_get_contents($pipes[1]); fclose($pipes[1]); proc_close($versionProcess);
    $command = [$client, '--defaults-extra-file='.$defaults, '--single-transaction', '--quick', '--hex-blob', '--no-tablespaces', '--default-character-set=utf8mb4'];
    if (stripos($version, 'mariadb') === false) $command[] = '--set-gtid-purged=OFF';
    $command[] = $config['database'];
    $process = proc_open($command, [0 => ['file', '/dev/null', 'r'], 1 => ['file', $output, 'w'], 2 => STDERR], $pipes);
    if (!is_resource($process) || proc_close($process) !== 0 || !is_file($output) || filesize($output) === 0) throw new RuntimeException('Falló la copia SQL; se cancela la actualización.');
    chmod($output, 0600);
    echo "Copia SQL completada.\n";
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    $failed = true;
} finally { if ($defaults !== '' && is_file($defaults)) unlink($defaults); }
exit(isset($failed) ? 1 : 0);
