<?php
namespace App\Http\Controllers;

use App\Support\{VersionShares, VersionShareGate, VersionSummaryCapabilities};
use Illuminate\Http\Request;

final class VersionSharesController
{
    private function safe(callable $action) {
        try { return $action(); }
        catch (\Throwable $e) {
            $status=$e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface ? $e->getStatusCode() :
                ($e instanceof \Illuminate\Validation\ValidationException ? 422 : 404);
            return response()->json(['message'=>'Unavailable / No disponible'],$status);
        }
    }
    public function shell() { return response()->view('version-share'); }
    public function owner(Request $r, string $document, string $version, VersionShares $s) {
        return $this->safe(function () use ($r,$document,$version,$s) {
            $s->listing($r->user(),$document,$version);
            return response()->view('version-share',['document'=>$document,'version'=>$version]);
        });
    }
    public function listing(Request $r, string $document, string $version, VersionShares $s) {
        return $this->safe(fn()=>response()->json(['grants'=>$s->listing($r->user(),$document,$version),
            'recipients'=>$s->recipients($r->user(),$document,$version)]));
    }
    public function issue(Request $r, string $document, string $version, VersionShares $s) {
        return $this->safe(function () use ($r,$document,$version,$s) {
            abort_unless($r->isJson() && $r->query->count()===0,404);
            $v=$r->validate(['level'=>['required','integer','in:1,2,3'],'days'=>['required','integer','min:1','max:30'],
                'label'=>['nullable','string','max:120'],'audience_mode'=>['sometimes','in:restricted,signed_in_link'],
                'recipient_ids'=>['sometimes','array','max:100'],'recipient_ids.*'=>['integer','min:1'],
                'forwardable_accepted'=>['sometimes','boolean']]);
            $v['level']=(int)$v['level'];$v['days']=(int)$v['days'];
            // Reject numeric strings for recipient identity; the UI emits integer account IDs.
            foreach($v['recipient_ids'] ?? [] as $id) abort_unless(is_int($id),422);
            return response()->json($s->issue($r->user(),$document,$version,$v),201);
        });
    }
    public function revoke(Request $r,string $document,string $version,string $grant,VersionSummaryCapabilities $s) {
        return $this->safe(function () use ($r,$document,$version,$grant,$s) {
            $s->revoke($r->user(),$document,$version,$grant);return response()->noContent();
        });
    }
    public function accesses(Request $r,string $document,string $version,string $grant,VersionShareGate $g) {
        return $this->safe(function () use ($r,$document,$version,$grant,$g) {
            $after=$r->query('after','0');abort_unless(is_string($after) && ctype_digit($after) && strlen($after)<12,404);
            return response()->json($g->accesses($r->user(),$document,$version,$grant,(int)$after));
        });
    }
    public function card(Request $r,VersionShareGate $g) {
        return $this->safe(function () use ($r,$g) {
            abort_unless($r->isJson() && $r->query->count()===0,404);
            $secret=$r->json('capability');$after=$r->json('after',0);
            abort_unless(is_string($secret) && is_int($after) && $after>=0,404);
            return $g->cardResponse($r,$secret,$after);
        });
    }
}
