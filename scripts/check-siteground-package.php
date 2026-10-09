<?php

// Audit the actual release layout before compressing it; never load a user's .env.
$root = rtrim($argv[1] ?? '', '/');
if ($root === '' || !is_dir($root)) {
    fwrite(STDERR, "Uso: php scripts/check-siteground-package.php DIRECTORIO\n");
    exit(1);
}
$fail = static function (string $reason): never {
    fwrite(STDERR, 'Paquete rechazado: '.$reason.PHP_EOL);
    exit(1);
};
foreach (['inkgroove/artisan', 'inkgroove/vendor/autoload.php', 'inkgroove/deploy/siteground/env.example', 'public_html/index.php', 'public_html/.htaccess', 'public_html/build/manifest.json', 'public_html/build/OFL.txt', 'BUILD-INFO.json', 'INSTALL-SITEGROUND.md'] as $file) {
    if (!is_file($root.'/'.$file)) $fail('falta '.$file);
}
foreach (['es/inkgroove.php', 'es/validation.php', 'en/inkgroove.php'] as $file) {
    if (!is_file($root.'/inkgroove/lang/'.$file)) $fail('faltan traducciones: '.$file);
}
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
$files = [];
foreach ($iterator as $file) {
    $relative = substr($file->getPathname(), strlen($root) + 1);
    if ($relative === 'FILES.sha256') continue;
    if ($file->isLink()) $fail('enlace simbólico: '.$relative);
    if (preg_match('~(^|/)(\.env(?:\..*)?|\.git|node_modules)(/|$)|\.(sqlite(?:-.*)?|sql|log)$~', $relative)) $fail('archivo privado o de desarrollo: '.$relative);
    if (in_array($relative, ['inkgroove/bootstrap/cache/config.php', 'inkgroove/vendor/bin/phpunit'], true) || str_starts_with($relative, 'inkgroove/bootstrap/cache/routes-')) $fail('caché local o dependencias de pruebas: '.$relative);
    if (str_starts_with($relative, 'public_html/') && !str_starts_with($relative, 'public_html/build/') && !in_array($relative, ['public_html/index.php', 'public_html/.htaccess', 'public_html/favicon.svg'], true)) $fail('archivo inesperado en la carpeta pública: '.$relative);
    $files[$relative] = hash_file('sha256', $file->getPathname());
}
$installed = json_decode(file_get_contents($root.'/inkgroove/vendor/composer/installed.json'), true, flags: JSON_THROW_ON_ERROR);
if ($installed['dev'] ?? true) $fail('Composer no está instalado en modo --no-dev');
$manifest = json_decode(file_get_contents($root.'/public_html/build/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
$entry = $manifest['resources/js/main.tsx'] ?? null;
if (!$entry || empty($entry['css']) || !preg_match('/app-[\w-]+\.js$/', $entry['file'])) $fail('entrada de Vite sin versionar');
foreach ($manifest as $asset) {
    foreach (array_merge([$asset['file']], $asset['css'] ?? [], $asset['assets'] ?? []) as $path) {
        if (!isset($files['public_html/build/'.$path])) $fail('recurso de Vite ausente: '.$path);
    }
}
ksort($files);
$lines = [];
foreach ($files as $file => $hash) $lines[] = $hash.'  '.$file;
file_put_contents($root.'/FILES.sha256', implode(PHP_EOL, $lines).PHP_EOL);
echo 'Paquete verificado: '.count($files).' archivos; sin .env, datos, cachés locales ni dependencias de pruebas.'.PHP_EOL;
