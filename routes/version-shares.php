<?php
use App\Http\Controllers\{VersionSharesController, VersionShareReadController};
use Illuminate\Support\Facades\Route;

// Registered by web.php under the web/CSRF/session pipeline.
// SummaryCapabilityHeaders checks raw authority and Origin before these routes.
Route::prefix('process-summary/share')->group(function () {
    Route::get('/', [VersionSharesController::class,'shell'])->middleware('throttle:30,1,share-shell');
    Route::post('/query', [VersionSharesController::class,'card'])->middleware('throttle:60,1,share-read');
    Route::middleware(['auth','throttle:120,1,share-media'])->group(function () {
        Route::post('/event', [VersionShareReadController::class,'event']);
        Route::post('/image', [VersionShareReadController::class,'image']);
    });
    Route::prefix('manage/{document}/{version}')->middleware(['auth','throttle:30,1,share-owner'])->group(function () {
        Route::get('/', [VersionSharesController::class,'owner']);
        Route::get('/grants', [VersionSharesController::class,'listing']);
        Route::post('/grants', [VersionSharesController::class,'issue']);
        Route::post('/grants/{grant}/revoke', [VersionSharesController::class,'revoke']);
        Route::get('/grants/{grant}/accesses', [VersionSharesController::class,'accesses']);
    });
});
