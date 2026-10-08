<?php

declare(strict_types=1);

require dirname(__DIR__).'/deploy/lib/UpdateSupport.php';
use InkGroove\Deploy\UpdateSupport;

$stage = $argv[1] ?? '';
$output = $argv[2] ?? '';
if (!is_dir($stage) || $output === '' || file_exists($output)) throw new RuntimeException('Uso: php scripts/make-release-zip.php DIRECTORIO NUEVO.zip');
$info = UpdateSupport::json($stage.'/BUILD-INFO.json');
$profile = $info['profile'];
$paths = [];
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($stage, FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $entry) {
    $relative = substr($entry->getPathname(), strlen($stage) + 1);
    if ($entry->isLink() || !UpdateSupport::allowedFile($relative, $profile)) throw new RuntimeException('Archivo no permitido en la entrega: '.$relative);
    if ($relative !== 'FILES.sha256') $paths[$relative] = hash_file('sha256', $entry->getPathname());
}
ksort($paths);
$lines = [];
foreach ($paths as $path => $hash) $lines[] = $hash.'  '.$path;
file_put_contents($stage.'/FILES.sha256', implode("\n", $lines)."\n");
$zip = new ZipArchive();
if ($zip->open($output, ZipArchive::CREATE | ZipArchive::EXCL) !== true) throw new RuntimeException('No se puede crear el ZIP.');
foreach ([...array_keys($paths), 'FILES.sha256'] as $path) {
    if (!$zip->addFile($stage.'/'.$path, $path)) throw new RuntimeException('No se puede incluir un archivo.');
    $zip->setExternalAttributesName($path, ZipArchive::OPSYS_UNIX, 0100644 << 16);
}
if (!$zip->close()) throw new RuntimeException('No se pudo cerrar el ZIP.');
file_put_contents($output.'.sha256', hash_file('sha256', $output).'  '.basename($output)."\n");
echo 'ZIP: '.$output."\n";
