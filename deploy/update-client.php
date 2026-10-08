<?php

declare(strict_types=1);

// Used inside the existing PHP container; Alpine itself needs no PHP, Node or jq.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
require __DIR__.'/lib/UpdateSupport.php';
require __DIR__.'/lib/GitHubRelease.php';

use InkGroove\Deploy\UpdateSupport;
use InkGroove\Deploy\GitHubRelease;

try {
    $command = $argv[1] ?? '';
    $root = getenv('INKGROOVE_WORKSPACE') ?: '/workspace';
    $private = $root.'/data/app/update';
    $configFile = $private.'/config.json';
    if ($command === 'configure') { UpdateSupport::configure($configFile, 'alpine'); exit; }
    if ($command === 'check' || $command === 'fetch') {
        if (!is_file($configFile)) throw new RuntimeException('Primero ejecute: sh scripts/update-alpine.sh configure');
        $github = new GitHubRelease(UpdateSupport::json($configFile));
        $release = $github->release($argv[2] ?? null);
        if ($command === 'check') { echo 'Disponible: '.$release['tag_name']."\n"; exit; }
        $package = $github->download($release, 'alpine', $private.'/work/download');
        $info = UpdateSupport::extract($package['archive'], $package['sha256'], $private.'/work/source', 'alpine');
        if (substr($info['revision'], 0, 12) !== $package['short_revision']) throw new RuntimeException('La revisión no coincide con la release.');
        echo $info['revision']."\n";
        exit;
    }
    if ($command === 'extract') {
        $info = UpdateSupport::extract($argv[2] ?? '', $argv[3] ?? '', $private.'/work/source', 'alpine');
        echo $info['revision']."\n";
        exit;
    }
    if ($command === 'apply') {
        $stage = $private.'/work/source';
        $files = static function (string $manifest): array {
            $paths = [];
            foreach (file($manifest, FILE_IGNORE_NEW_LINES) as $line) {
                if (!preg_match('/^[a-f0-9]{64}  (.+)$/', $line, $match) || !UpdateSupport::allowedFile($match[1], 'alpine')) throw new RuntimeException('Inventario de código inválido.');
                $paths[] = $match[1];
            }
            return $paths;
        };
        $next = $files($stage.'/FILES.sha256');
        $previous = is_file($root.'/FILES.sha256') ? $files($root.'/FILES.sha256') : [];
        foreach (array_diff($previous, $next) as $path) {
            if (is_file($root.'/'.$path) && !is_link($root.'/'.$path)) unlink($root.'/'.$path);
        }
        UpdateSupport::copyTree($stage, $root);
        exit;
    }
    throw new RuntimeException('Comando desconocido.');
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
