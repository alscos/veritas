<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\SealController;
use App\Http\Controllers\SubmissionController;
use Illuminate\Support\Facades\Route;

Route::prefix('api')->middleware('throttle:60,1')->group(function (): void {
    Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:8,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:8,1');
    Route::get('/verify/{code}', [SealController::class, 'verify'])->where('code', 'VRT-[A-Z0-9]+');

    Route::middleware('auth')->group(function (): void {
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/documents', [DocumentController::class, 'index']);
        Route::post('/documents', [DocumentController::class, 'store']);
        Route::get('/documents/{document}', [DocumentController::class, 'show']);
        Route::patch('/documents/{document}', [DocumentController::class, 'update']);
        Route::post('/documents/{document}/events', [EventController::class, 'store']);
        Route::get('/documents/{document}/timeline', [EventController::class, 'timeline']);
        Route::post('/documents/{document}/seal', [SealController::class, 'store']);
        Route::get('/submissions', [SubmissionController::class, 'index']);
        Route::post('/submissions', [SubmissionController::class, 'store']);
    });
});

Route::view('/{path?}', 'app')->where('path', '^(?!api|build|up).*$');
