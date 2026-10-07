<?php

return [
    'signing_key' => env('VERITAS_SIGNING_KEY') ?: env('APP_KEY'),
    'max_document_bytes' => 500_000,
    'max_event_batch' => 250,
    'max_event_data_bytes' => 100_000,
    'media_path' => env('VERITAS_MEDIA_PATH', storage_path('app/private/images')),
];
