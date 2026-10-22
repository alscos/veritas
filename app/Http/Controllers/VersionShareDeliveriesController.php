<?php
namespace App\Http\Controllers;

use App\Support\{VersionShareDeliveries, VersionShareGate};
use Illuminate\Http\Request;

/** Nominal references are authorized exclusively by VersionShareGate on every read. */
final class VersionShareDeliveriesController
{
    private function safe(callable $action)
    {
        try { return $action(); }
        catch (\Throwable $e) {
            $status=$e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface ? $e->getStatusCode() : 404;
            return response()->json(['message'=>'Unavailable / No disponible'],$status);
        }
    }

    public function index(Request $r, string $box, VersionShareDeliveries $deliveries)
    {
        return $this->safe(function () use ($r,$box,$deliveries) {
            abort_unless(count(array_diff(array_keys($r->query()),['cursor']))===0,404);
            $cursor=$r->query('cursor');abort_unless($cursor===null || is_string($cursor),404);
            return response()->json($deliveries->page($r->user(),$box,$cursor));
        });
    }

    public function read(Request $r, string $grant, string $resource, VersionShareGate $gate)
    {
        return $this->safe(function () use ($r,$grant,$resource,$gate) {
            abort_unless($r->isJson() && $r->query->count()===0,404);
            $body=$r->json()->all();
            abort_unless(count(array_diff(array_keys($body),['after','event','image']))===0,404);
            $after=$body['after'] ?? 0;$event=$body['event'] ?? null;$image=$body['image'] ?? null;
            abort_unless(is_int($after) && $after>=0 && ($event===null || (is_int($event) && $event>0))
                && ($image===null || is_string($image)),404);
            abort_unless(in_array($resource,['page','event','image','pdf'],true),404);
            abort_unless($resource!=='event' || $event!==null,404);
            return $gate->deliveryResponse($r,$grant,$resource==='event'?'page':$resource,$after,$image,$event);
        });
    }
}
