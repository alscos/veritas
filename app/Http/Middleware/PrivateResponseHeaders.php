<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class PrivateResponseHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        return self::apply($next($request));
    }

    public static function apply(Response $response): Response
    {
        // HTML contains a CSRF token and may contain the signed-in user's data.
        // This also covers API errors: a shared cache must never keep a session response.
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }
}
