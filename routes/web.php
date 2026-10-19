<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\SealController;
use App\Http\Controllers\SubmissionController;
use App\Http\Controllers\FolderController;
use App\Http\Controllers\ImageController;
use Illuminate\Support\Facades\Route;

Route::prefix('api')->middleware('throttle:60,1')->group(function (): void {
    Route::get('/csrf-token', [AuthController::class, 'csrf']);
    Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:8,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:8,1');
    Route::get('/verify/{code}', [SealController::class, 'verify']);

    Route::middleware(['auth', \App\Http\Middleware\AuthenticatedIdentity::class])->group(function (): void {
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/folders', [FolderController::class, 'index']);
        Route::post('/folders', [FolderController::class, 'store']);
        Route::patch('/folders/{folder}', [FolderController::class, 'update']);
        Route::delete('/folders/{folder}', [FolderController::class, 'destroy']);
        Route::get('/documents', [DocumentController::class, 'index']);
        Route::post('/documents', [DocumentController::class, 'store']);
        Route::get('/documents/{document}', [DocumentController::class, 'show']);
        Route::patch('/documents/{document}', [DocumentController::class, 'update']);
        Route::delete('/documents/{document}', [DocumentController::class, 'destroy']);
        Route::post('/documents/{document}/images', [ImageController::class, 'store'])->middleware('throttle:20,1,uploads');
        Route::post('/documents/{document}/events', [EventController::class, 'store']);
        Route::get('/documents/{document}/timeline', [EventController::class, 'timeline'])->withoutMiddleware('throttle:60,1')->middleware(['throttle:120,1,history', \App\Http\Middleware\CompressTimeline::class]);
        Route::get('/documents/{document}/versions/{version}', [\App\Http\Controllers\VersionController::class, 'show']);
        Route::get('/documents/{document}/versions/{version}/pdf-source', [\App\Http\Controllers\VersionPdfController::class, 'source'])->middleware('throttle:12,1,pdf');
        Route::post('/documents/{document}/versions/{version}/verification', [\App\Http\Controllers\VersionController::class, 'verify'])->middleware('throttle:version-verification');
        Route::post('/documents/{document}/seal', [SealController::class, 'store']);
        Route::get('/submissions', [SubmissionController::class, 'index']);
        Route::get('/submissions/{submission}', [SubmissionController::class, 'show']);
        Route::post('/submissions', [SubmissionController::class, 'store']);
    });
});

Route::get('/api/documents/{document}/images/{image}', [ImageController::class, 'show'])->middleware(['auth', 'throttle:240,1,media']);

Route::get('/verify/{code}', [SealController::class, 'publicPage'])->middleware('throttle:60,1');

// Summary headers wrap the web pipeline globally, including CSRF failures.
Route::group([], function () {
    Route::get('/process-summary', [\App\Http\Controllers\VersionSummaryCapabilityController::class,'shell'])->middleware('throttle:30,1,summary-shell');
    Route::post('/process-summary/query', [\App\Http\Controllers\VersionSummaryCapabilityController::class,'redeem'])->middleware('throttle:12,1,summary-query');
    Route::middleware(['auth','throttle:12,1,summary-owner'])->group(function () {
        Route::get('/process-summary/manage/{document}/{version}', [\App\Http\Controllers\VersionSummaryCapabilityController::class,'owner']);
        Route::get('/api/summary-grants/{document}/{version}', [\App\Http\Controllers\VersionSummaryCapabilityController::class,'listing']);
        Route::post('/api/summary-grants/{document}/{version}', [\App\Http\Controllers\VersionSummaryCapabilityController::class,'issue']);
        Route::post('/api/summary-grants/{document}/{version}/{grant}/revoke', [\App\Http\Controllers\VersionSummaryCapabilityController::class,'revoke']);
    });
});

// Unified sealed-version sharing; keep before the SPA catch-all.
require __DIR__.'/version-shares.php';

Route::view('/{path?}', 'app')->where('path', '^(?!api|build|up|verify).*$');
