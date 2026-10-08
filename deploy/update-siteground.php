<?php

declare(strict_types=1);

// Run only over SSH. This file belongs outside public_html.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
require __DIR__.'/lib/UpdateSupport.php';
require __DIR__.'/lib/GitHubRelease.php';
require __DIR__.'/lib/SiteGroundUpdater.php';

use InkGroove\Deploy\UpdateSupport;
use InkGroove\Deploy\GitHubRelease;
use InkGroove\Deploy\SiteGroundUpdater;

try {
    $root = getenv('INKGROOVE_SITE_ROOT') ?: dirname(__DIR__, 2);
    $configFile = $root.'/.inkgroove-updates/config.json';
    $command = $argv[1] ?? 'help';
    if ($command === 'configure') { UpdateSupport::configure($configFile, 'siteground'); exit; }
    if ($command === 'help') {
        echo "Uso: php deploy/update-siteground.php configure | check | update [build-SHA12] | install ARCHIVO.zip SHA256\n";
        exit;
    }
    if (!is_file($configFile)) throw new RuntimeException('Primero ejecute: php deploy/update-siteground.php configure');
    $config = UpdateSupport::json($configFile);
    if ($command === 'install') {
        echo (new SiteGroundUpdater($root, $config))->install($argv[2] ?? '', $argv[3] ?? '')."\n";
        exit;
    }
    if (!in_array($command, ['check', 'update'], true)) throw new RuntimeException('Comando desconocido.');
    $github = new GitHubRelease($config);
    $release = $github->release($argv[2] ?? null);
    if ($command === 'check') {
        echo 'Disponible: '.$release['tag_name']."\n";
        $state = $root.'/.inkgroove-updates/installed.json';
        if (is_file($state)) echo 'Instalada: '.substr(UpdateSupport::json($state)['revision'], 0, 12)."\n";
        exit;
    }
    // Each invocation downloads into a unique directory; the installer owns the deployment lock.
    $download = $root.'/.inkgroove-updates/download-'.bin2hex(random_bytes(6));
    try {
        $package = $github->download($release, 'siteground', $download);
        echo (new SiteGroundUpdater($root, $config))->install($package['archive'], $package['sha256'], $package['short_revision'])."\n";
    } finally { UpdateSupport::removeTree($download); }
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
