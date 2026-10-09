<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $request->query('lang');
        if (!in_array($locale, ['es', 'en'], true)) {
            $cookie = $request->cookie('inkgroove_locale');
            $locale = $request->is('api/*') && $request->hasHeader('Accept-Language')
                ? $request->getPreferredLanguage(['es', 'en'])
                : (in_array($cookie, ['es', 'en'], true) ? $cookie : $request->getPreferredLanguage(['es', 'en']));
        }
        app()->setLocale($locale ?? 'es');

        return $next($request);
    }
}
