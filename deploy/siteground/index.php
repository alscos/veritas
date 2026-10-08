<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Upload ONLY this public directory to public_html; keep the core as its sibling.
$core = dirname(__DIR__).'/inkgroove';

if (file_exists($maintenance = $core.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $core.'/vendor/autoload.php';

$app = require_once $core.'/bootstrap/app.php';
$app->usePublicPath(__DIR__);
$app->handleRequest(Request::capture());
