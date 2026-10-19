<?php

return [
    // Server configuration only, resolved when Laravel builds its config cache.
    // Unknown values fail closed to the compatible v2 format; no request override.
    'seal_format' => match (env('INKGROOVE_SEAL_FORMAT')) {
        3, '3' => 3,
        default => 2,
    },
    'capture' => [
        'seconds' => 1.0, 'sessions' => 128, 'images' => 100, 'events' => 10000,
        'rows' => 1024, 'data_bytes' => 2 * 1024 * 1024, 'row_bytes' => 1024 * 1024,
        'memory_bytes' => 8 * 1024 * 1024, 'manifest_bytes' => 256 * 1024,
    ],
    'verification' => [
        'seconds' => (float) env('VERITAS_VERIFY_SECONDS', 3),
        'events' => (int) env('VERITAS_VERIFY_EVENTS', 10000),
        'data_bytes' => (int) env('VERITAS_VERIFY_DATA_BYTES', 32 * 1024 * 1024),
        'image_bytes' => (int) env('VERITAS_VERIFY_IMAGE_BYTES', 16 * 1024 * 1024),
        'memory_bytes' => (int) env('VERITAS_VERIFY_MEMORY_BYTES', 32 * 1024 * 1024),
        'row_bytes' => (int) env('VERITAS_VERIFY_ROW_BYTES', 1024 * 1024),
        'manifest_bytes' => (int) env('VERITAS_VERIFY_MANIFEST_BYTES', 256 * 1024),
        'image_file_bytes' => (int) env('VERITAS_VERIFY_IMAGE_FILE_BYTES', 8 * 1024 * 1024),
        'sessions' => (int) env('VERITAS_VERIFY_SESSIONS', 128),
        'images' => (int) env('VERITAS_VERIFY_IMAGES', 100),
        'rows' => 24000,
        'per_minute' => (int) env('VERITAS_VERIFY_PER_MINUTE', 6),
    ],
    'public_origin' => env('INKGROOVE_PUBLIC_ORIGIN'),
    'public_path' => env('INKGROOVE_PUBLIC_PATH'),
    'signing_key' => env('VERITAS_SIGNING_KEY') ?: env('APP_KEY'),
    'max_document_bytes' => 500_000,
    'max_event_batch' => 250,
    'max_event_data_bytes' => 100_000,
    'media_path' => env('VERITAS_MEDIA_PATH', storage_path('app/private/images')),
];
