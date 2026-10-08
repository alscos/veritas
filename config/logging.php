<?php

use Monolog\Handler\StreamHandler;

return [
    'default' => env('LOG_CHANNEL', 'stderr'),
    'deprecations' => ['channel' => null, 'trace' => false],
    'channels' => [
        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'warning'),
            'days' => (int) env('LOG_DAYS', 14),
        ],
        'stderr' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'warning'),
            'handler' => StreamHandler::class,
            'with' => ['stream' => 'php://stderr'],
        ],
        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'warning'),
        ],
    ],
];
