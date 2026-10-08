<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        if ($path = config('veritas.public_path')) {
            $this->app->usePublicPath($path);
        }
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(60)->by((string) ($request->user()?->id ?? $request->ip())));
    }
}
