<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
final class SummaryCapabilityHeaders
{
    public static function apply(Response $response): Response
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('X-Robots-Tag', 'noindex, nofollow');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
        // Candidate shell alone needs verified blob images and the existing local PDF Worker.
        if (request()->is('process-summary/share', 'process-summary/share/*')) {
            $csp .= "; img-src blob:; worker-src 'self'";
        }
        $response->headers->set('Content-Security-Policy', $csp);
        return $response;
    }
    /** PublicCertificate uses this server setting for public PDF/QR URLs too.
     * Only an optional root slash is removed; no Host/proxy fallback, aliases,
     * case folding or implicit port equivalence is accepted.
     */
    private static function publicOrigin(): ?string
    {
        $origin = config('veritas.public_origin');
        if (!is_string($origin) || strlen($origin) > 300
            || preg_match('/[\\x00-\\x20\\\\\\\\]/', $origin)
            || !filter_var($origin, FILTER_VALIDATE_URL)) return null;
        $parts = parse_url($origin);
        if (!$parts || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
            || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])
            || !in_array($parts['path'] ?? '', ['', '/'], true)
            || (isset($parts['port']) && ($parts['port'] < 1 || $parts['port'] > 65535))) return null;
        $host = $parts['host'];
        $ip = str_starts_with($host, '[') && str_ends_with($host, ']') ? substr($host, 1, -1) : $host;
        if (!filter_var($ip, FILTER_VALIDATE_IP)
            && !filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) return null;
        return rtrim($origin, '/');
    }
    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->is('process-summary', 'process-summary/*', 'api/summary-grants/*')) return $next($request);
        try {
            if ($request->is('process-summary/share', 'process-summary/share/*')) {
                $expected = self::publicOrigin();
                abort_unless($expected !== null, 403);
                $parts = parse_url($expected);
                $authority = $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');
                // Raw Host is mandatory. Forwarding headers can never supply missing
                // authority or override it, even when the global proxy list trusts '*'.
                abort_unless($request->headers->get('Host') === $authority, 403);
                foreach (['X-Forwarded-Host'=>$authority, 'X-Forwarded-Proto'=>$parts['scheme'],
                    'X-Forwarded-Port'=>(string)($parts['port'] ?? ($parts['scheme'] === 'https' ? 443 : 80))] as $header=>$value) {
                    abort_unless(!$request->headers->has($header) || $request->headers->get($header) === $value, 403);
                }
                // RFC 7239 forwarding is not used by this collection. Reject rather
                // than interpret an additional visitor-controlled authority channel.
                abort_if($request->headers->has('Forwarded') || $request->headers->has('X-Forwarded-Prefix'), 403);
            }
            if (!$request->isMethod('GET') && !$request->isMethod('HEAD')) {
                $origin = $request->header('Origin');
                // Compare against configured trusted origin, never Host/X-Forwarded-Host.
                $expected = self::publicOrigin();
                abort_unless($expected !== null && is_string($origin) && $origin === $expected
                    && in_array($request->header('Sec-Fetch-Site'), [null,'same-origin'], true), 403);
            }
            $response = $next($request);
            if ($response->getStatusCode() >= 400) {
                // Framework CSRF/auth/throttle failures also have a fixed, non-reflective body.
                $headers = $response->headers->has('Retry-After') ? ['Retry-After'=>$response->headers->get('Retry-After')] : [];
                $response = response()->json(['message'=>'Unavailable / No disponible'], $response->getStatusCode(), $headers);
            }
            return self::apply($response);
        } catch (\Throwable $e) {
            // Own origin check; downstream framework exceptions may already be rendered by its pipeline.
            $status = $e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface ? $e->getStatusCode() :
                ($e instanceof \Illuminate\Validation\ValidationException ? 422 :
                ($e instanceof \Illuminate\Auth\AuthenticationException ? 401 :
                ($e instanceof \Illuminate\Session\TokenMismatchException ? 419 : 404)));
            return self::apply(response()->json(['message'=>'Unavailable / No disponible'], $status));
        }
    }
}
