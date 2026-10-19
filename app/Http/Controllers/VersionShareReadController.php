<?php
namespace App\Http\Controllers;

use App\Support\VersionShareGate;
use Illuminate\Http\Request;

/** Secondary reads for the ordinary sealed-version sharing collection.
 * Must be behind the web/CSRF/session pipeline, SummaryCapabilityHeaders and throttle.
 * JSON evidence is rendered by the inert SealedReading component, never the live editor.
 */
final class VersionShareReadController
{
    private function safe(callable $read)
    {
        try { return $read(); }
        catch (\Throwable $e) {
            $status = $e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface ? $e->getStatusCode() : 404;
            return response()->json(['message'=>'Unavailable / No disponible'], $status);
        }
    }

    private function body(Request $request): array
    {
        abort_unless($request->isMethod('POST') && $request->isJson() && $request->query->count() === 0, 404);
        $body=$request->json()->all();
        abort_unless(is_string($body['capability'] ?? null), 404);
        return $body;
    }

    public function page(Request $request, VersionShareGate $gate)
    {
        return $this->safe(function () use ($request, $gate) {
            $body=$this->body($request);$after=$body['after'] ?? 0;
            abort_unless(is_int($after) && $after >= 0, 404);
            return $gate->pageResponse($request, $body['capability'], $after);
        });
    }

    public function event(Request $request, VersionShareGate $gate)
    {
        return $this->safe(function () use ($request, $gate) {
            $body=$this->body($request);$event=$body['event'] ?? null;
            abort_unless(is_int($event) && $event > 0, 404);
            return $gate->eventResponse($request, $body['capability'], $event);
        });
    }

    public function image(Request $request, VersionShareGate $gate)
    {
        return $this->safe(function () use ($request, $gate) {
            $body=$this->body($request);$image=$body['image'] ?? null;$event=$body['event'] ?? null;
            abort_unless(is_string($image) && ($event === null || (is_int($event) && $event > 0)), 404);
            return $gate->imageResponse($request, $body['capability'], $image, $event);
        });
    }
}
