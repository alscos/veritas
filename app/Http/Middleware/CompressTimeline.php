<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\AcceptHeader;
use Symfony\Component\HttpFoundation\Response;

/** Compress only the read-only history transport; stored events stay untouched. */
class CompressTimeline
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if (!$response->isSuccessful() || $response->headers->has('Content-Encoding')) return $response;

        $response->setVary('Accept-Encoding', false);
        $response->headers->set('Cache-Control', 'private, no-store');
        $gzip = AcceptHeader::fromString($request->header('Accept-Encoding', ''))->get('gzip');
        $body = $response->getContent();
        if (!$gzip || $gzip->getQuality() <= 0 || $body === false || strlen($body) < 4096 || !function_exists('gzencode')) return $response;

        // Level 1 keeps CPU cost small on shared hosting. Browsers decode gzip
        // before response.json(), so all event fields and metrics are identical.
        $compressed = gzencode($body, 1);
        if ($compressed === false || strlen($compressed) >= strlen($body)) return $response;
        // Send the compressed bytes as an ordinary HTTP response.
        $headers = $response->headers->all();
        unset($headers['content-length']);
        $headers['content-encoding'] = ['gzip'];
        return new Response($compressed, $response->getStatusCode(), $headers);
    }
}
