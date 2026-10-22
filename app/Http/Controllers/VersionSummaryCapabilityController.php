<?php
namespace App\Http\Controllers;
use App\Support\VersionSummaryCapabilities;
use Illuminate\Http\Request;
final class VersionSummaryCapabilityController
{
    /** Catch before Laravel's routing pipeline reports/renders exception traces. */
    private function safe(callable $action) {
        try { return $action(); }
        catch (\Throwable $e) {
            $status = $e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface ? $e->getStatusCode() :
                ($e instanceof \Illuminate\Validation\ValidationException ? 422 : 404);
            return response()->json(['message'=>'Unavailable / No disponible'], $status);
        }
    }
    public function shell() { return $this->safe(fn () => response()->view('summary-capability')); }
    public function owner(Request $r, string $document, string $version, VersionSummaryCapabilities $s) {
        return $this->safe(function () use ($r, $document, $version, $s) {
            $s->listing($r->user(), $document, $version);
            return response()->view('summary-capability-owner');
        });
    }
    public function issue(Request $r, string $document, string $version, VersionSummaryCapabilities $s) {
        return $this->safe(function () use ($r, $document, $version, $s) {
            $v = $r->validate(['days'=>['sometimes','integer','min:1','max:30'],
                // Unified sharing is not enabled: never silently issue a level 2 link for a level 3 request.
                'level'=>['sometimes','integer','in:2'], 'audience_mode'=>['prohibited'], 'recipient_ids'=>['prohibited']]);
            $result = $s->issue($r->user(), $document, $version, (int) ($v['days'] ?? 7));
            // Relative fragment URL; never use an untrusted Host to publish an origin.
            $secret = $result['secret']; unset($result['secret']);
            $result['url'] = '/process-summary#token='.$secret;
            return response()->json($result, 201);
        });
    }
    public function listing(Request $r, string $document, string $version, VersionSummaryCapabilities $s) {
        return $this->safe(fn () => response()->json(['grants'=>$s->listing($r->user(), $document, $version)]));
    }
    public function revoke(Request $r, string $document, string $version, string $grant, VersionSummaryCapabilities $s) {
        return $this->safe(function () use ($r, $document, $version, $grant, $s) {
            $s->revoke($r->user(), $document, $version, $grant); return response()->noContent();
        });
    }
    public function redeem(Request $r, VersionSummaryCapabilities $s) {
        return $this->safe(function () use ($r, $s) {
            // Never redeem a credential from query/form parameters or cookies.
            abort_unless($r->isJson() && $r->query->count() === 0, 404);
            $secret = $r->json('capability'); abort_unless(is_string($secret), 404);
            return response()->json($s->redeem($secret));
        });
    }
}
