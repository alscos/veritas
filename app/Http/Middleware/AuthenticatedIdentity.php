<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticatedIdentity
{
    public function handle(Request $request, Closure $next): Response
    {
        $userId = (string) $request->user()->id;
        // Refuse delayed writes issued by an earlier browser identity.
        if ($request->hasHeader('X-InkGroove-User')) abort_unless($userId === $request->header('X-InkGroove-User'), 401);
        $response = $next($request);
        $response->headers->set('X-InkGroove-User', $userId);
        return $response;
    }
}
