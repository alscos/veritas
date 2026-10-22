<?php
namespace App\Support;

use App\Models\User;
use Illuminate\Auth\SessionGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Auth, DB};

/** Shared authorization adapter for the ordinary sealed-version sharing routes.
 * The visitor is resolved from Laravel's web session, never from an argument or payload.
 * All secondary reads go through this class; the owner's identity stays internal.
 */
final class VersionShareGate
{
    private function fresh(): void
    {
        abort_unless(DB::transactionLevel() === 0
            && in_array(DB::connection()->getDriverName(), ['mysql', 'sqlite'], true), 503);
    }

    private function visitor(Request $request): ?int
    {
        $guard = Auth::guard('web');
        if (!$guard instanceof SessionGuard || !$request->hasSession()) return null;
        $identity = $request->session()->get($guard->getName());
        // A resolver, header, remember cookie or actingAs model alone is insufficient.
        if ((!is_int($identity) && !is_string($identity)) || !ctype_digit((string) $identity)
            || (int) $identity <= 0 || (string) $guard->id() !== (string) $identity) return null;
        return (int) $identity;
    }

    private function active(Request $request, string $digest, int $level, bool $lock = false): object
    {
        abort_unless(in_array($level, [1, 2, 3], true), 404);
        $q = DB::table('version_summary_grants as g')
            ->join('documents as d', fn ($j) => $j->on('d.id', '=', 'g.document_id')->on('d.owner_id', '=', 'g.owner_id'))
            ->join('document_versions as v', fn ($j) => $j->on('v.id', '=', 'g.version_id')->on('v.document_id', '=', 'g.document_id'))
            ->join('users as owner', 'owner.id', '=', 'g.owner_id')
            ->where('g.digest', $digest)->where('g.level', $level)->whereNull('g.revoked_at')
            ->whereNotNull('v.sealed_at');
        $visitor = null;
        if ($level === 3) {
            $visitor = $this->visitor($request);
            abort_unless($visitor !== null, 401);
            $q->join('users as visitor', fn ($j) => $j->where('visitor.id', $visitor))
                ->where(function ($q) use ($visitor) {
                    $q->where('g.audience_mode', 'signed_in_link')->orWhere(function ($q) use ($visitor) {
                        $q->where('g.audience_mode', 'restricted')->whereExists(function ($q) use ($visitor) {
                            $q->selectRaw('1')->from('version_share_recipients as r')
                                ->whereColumn('r.grant_id', 'g.id')->where('r.user_id', $visitor)
                                ->where(function ($q) {
                                    $q->where(function ($q) {
                                        $q->whereNull('g.share_operation_key')->whereExists(function ($q) {
                                            $q->selectRaw('1')->from('submissions as s')->whereColumn('s.recipient_user_id','r.user_id')
                                                ->whereColumn('s.document_version_id','g.version_id')->whereColumn('s.sender_id','g.owner_id');
                                        });
                                    })->orWhere(function ($q) {
                                        $q->whereNotNull('g.share_operation_key')->whereExists(function ($q) {
                                            $q->selectRaw('1')->from('version_share_deliveries as delivery')
                                                ->whereColumn('delivery.grant_id','g.id')->whereColumn('delivery.user_id','r.user_id');
                                        });
                                    });
                                });
                        });
                    });
                });
        }
        if ($lock) $q->lockForUpdate();
        $row = $q->first(['g.id', 'g.owner_id', 'g.document_id', 'g.version_id', 'g.level',
            'g.audience_mode', 'g.created_at', 'g.expires_at', 'g.time_basis', 'g.created_at_epoch', 'g.expires_at_epoch','g.never_expires','g.display_title_at_issue']);
        abort_unless($row && GrantTime::active($row), 404);
        $row->visitor_id = $visitor;
        return $row;
    }

    /** No caller-supplied owner/document/version and no generic callback exposed to controllers. */
    private function read(Request $request, #[\SensitiveParameter] string $secret, int $level, callable $read): mixed
    {
        $this->fresh();
        abort_unless(preg_match('/^[A-Za-z0-9_-]{43}$/D', $secret) === 1, 404);
        return $this->readDigest($request, hash('sha256', $secret), $level, $read);
    }

    private function readDigest(Request $request, string $digest, int $level, callable $read): mixed
    {
        $this->fresh();
        $before = $this->active($request, $digest, $level);
        $owner = User::query()->select(['id'])->findOrFail($before->owner_id);
        $result = $read($owner, $before->document_id, $before->version_id, $before);
        $this->fresh();
        if ($level !== 3) {
            abort_unless($before == $this->active($request, $digest, $level), 404);
            return $result;
        }
        // Final current read and aggregate are one transaction. A failed authorization
        // or failed aggregate returns no response. Already authorized bytes cannot be recalled.
        return DB::transaction(function () use ($request, $digest, $level, $before, $result) {
            abort_unless($before == $this->active($request, $digest, $level, true), 404);
            $key = ['grant_id' => $before->id, 'user_id' => $before->visitor_id];
            $existing = DB::table('version_share_accesses')->where($key)->lockForUpdate()->first();
            if ($existing) {
                DB::table('version_share_accesses')->where($key)->update([
                    'last_seen' => now(), 'access_count' => DB::raw('access_count + 1'),
                ]);
            } else {
                DB::table('version_share_accesses')->insert($key + [
                    'first_seen' => now(), 'last_seen' => now(), 'access_count' => 1,
                ]);
            }
            return $result;
        });
    }

    /** Nominal receipt is an identity-bound reference, never a bearer capability.
     * No legacy submission is created and VersionAccess remains unchanged.
     */
    public function deliveryResponse(Request $request, string $grant, string $resource = 'page', int $after = 0, ?string $image = null, ?int $event = null): mixed
    {
        $this->fresh();
        $visitor = $this->visitor($request);
        abort_unless($visitor !== null, 401);
        $row = DB::table('version_summary_grants as g')->join('version_share_deliveries as d','d.grant_id','=','g.id')
            ->where('g.id',$grant)->where('d.user_id',$visitor)->where('g.level',3)
            ->where('g.audience_mode','restricted')->whereNotNull('g.share_operation_key')->first(['g.digest']);
        abort_unless($row,404);
        return $this->readDigest($request,$row->digest,3,function ($owner,$document,$version) use ($resource,$after,$image,$event) {
            if ($resource === 'image') {
                abort_unless(is_string($image),404);
                $verified=app(SealedVersionReader::class)->image($owner,$document,$version,$image,$event);
                return response($verified['bytes'],200,['Content-Type'=>$verified['mime']]);
            }
            if ($resource === 'pdf') return app(\App\Http\Controllers\VersionPdfController::class)->ownedSource($owner,$document,$version);
            abort_unless($resource === 'page',404);
            return response()->json(app(SealedVersionReader::class)->page($owner,$document,$version,$after,$event));
        });
    }

    /** Same card for all fixed levels. The client cannot request an elevation. */
    public function cardResponse(Request $request, #[\SensitiveParameter] string $secret, int $after = 0): \Illuminate\Http\JsonResponse
    {
        $this->fresh();
        abort_unless(preg_match('/^[A-Za-z0-9_-]{43}$/D', $secret) === 1, 404);
        $level = DB::table('version_summary_grants')->where('digest', hash('sha256', $secret))->value('level');
        abort_unless(in_array((int)$level, [1,2,3], true), 404);
        return $this->read($request, $secret, (int)$level, function ($owner, $document, $version, $grant) use ($level, $after) {
            $c = \App\Models\Certificate::where('document_version_id', $version)->firstOrFail();
            abort_unless(PublicCertificate::valid($c), 409);
            $result = ['expires_at'=>GrantTime::iso($grant,'expires_at'), 'level'=>(int)$level, 'seal'=>PublicCertificate::summary($c) + ['version_number'=>$c->signed_payload['version'] ?? null]];
            if ((int)$level >= 2) $result['summary'] = VersionSummaryCapabilities::project(
                app(HistoricalVersionSummary::class)->summarize($owner, $document, $version));
            if ((int)$level === 3) $result['reading'] = app(SealedVersionReader::class)->page($owner, $document, $version, $after);
            return response()->json($result);
        });
    }

    /** Build the HTTP response before the final authorization/audit cut, including JSON encoding.
     * Never stream/reopen a verified image after this point.
     */
    public function pageResponse(Request $request, #[\SensitiveParameter] string $secret, int $after = 0): \Illuminate\Http\JsonResponse
    {
        return $this->read($request, $secret, 3, fn ($owner, $document, $version) =>
            response()->json(app(SealedVersionReader::class)->page($owner, $document, $version, $after)));
    }

    public function eventResponse(Request $request, #[\SensitiveParameter] string $secret, int $event): \Illuminate\Http\JsonResponse
    {
        return $this->read($request, $secret, 3, fn ($owner, $document, $version) =>
            response()->json(app(SealedVersionReader::class)->page($owner, $document, $version, 0, $event)));
    }

    public function imageResponse(Request $request, #[\SensitiveParameter] string $secret, string $image, ?int $event = null): \Illuminate\Http\Response
    {
        return $this->read($request, $secret, 3, function ($owner, $document, $version) use ($image, $event) {
            $verified = app(SealedVersionReader::class)->image($owner, $document, $version, $image, $event);
            return response($verified['bytes'], 200, ['Content-Type'=>$verified['mime'],
                'Content-Length'=>(string) strlen($verified['bytes'])]);
        });
    }

    /** Owner-only paginated aggregates; expired/revoked grants remain auditable.
     * No token/digest, IP, UA, read duration or claim of human reading.
     */
    public function accesses(User $owner, string $document, string $version, string $grant, int $after = 0): array
    {
        $this->fresh();
        abort_unless($after >= 0 && $owner->exists, 404);
        $ownedQuery = DB::table('version_summary_grants as g')
            ->join('documents as d', fn ($j) => $j->on('d.id', '=', 'g.document_id')->on('d.owner_id', '=', 'g.owner_id'))
            ->join('document_versions as v', fn ($j) => $j->on('v.id', '=', 'g.version_id')->on('v.document_id', '=', 'g.document_id'))
            ->join('users as owner', 'owner.id', '=', 'g.owner_id')
            ->where('g.id', $grant)->where('g.owner_id', $owner->getKey())->where('g.document_id', $document)
            ->where('g.version_id', $version)->where('g.level', 3)->whereNotNull('v.sealed_at');
        abort_unless((clone $ownedQuery)->exists(), 404);
        $rows = DB::table('version_share_accesses as a')->join('users as u', 'u.id', '=', 'a.user_id')
            ->where('a.grant_id', $grant)->where('a.user_id', '>', $after)->orderBy('a.user_id')->limit(101)
            ->get(['a.user_id', 'u.name', 'u.email', 'a.first_seen', 'a.last_seen', 'a.access_count']);
        $more = $rows->count() > 100;
        $rows = $rows->take(100)->map(fn ($r) => ['user_id'=>(int) $r->user_id, 'name'=>$r->name,
            'email'=>$r->email, 'first_seen'=>$r->first_seen, 'last_seen'=>$r->last_seen,
            'access_count'=>(int) $r->access_count])->values()->all();
        // Recheck the owner in a fresh cut before returning identity metadata too.
        abort_unless((clone $ownedQuery)->exists(), 404);
        return ['accounts'=>$rows, 'next_after'=>$more ? $rows[array_key_last($rows)]['user_id'] : null];
    }

    /** Compatibility projection for the existing level 2 endpoint, no new disclosure. */
    public function summary(Request $request, #[\SensitiveParameter] string $secret): array
    {
        return $this->read($request, $secret, 2, fn ($owner, $document, $version) =>
            VersionSummaryCapabilities::project(app(HistoricalVersionSummary::class)->summarize($owner, $document, $version)));
    }

    public function page(Request $request, #[\SensitiveParameter] string $secret, int $after = 0): array
    {
        return $this->read($request, $secret, 3, fn ($owner, $document, $version) =>
            app(SealedVersionReader::class)->page($owner, $document, $version, $after));
    }

    public function event(Request $request, #[\SensitiveParameter] string $secret, int $event): array
    {
        return $this->read($request, $secret, 3, fn ($owner, $document, $version) =>
            app(SealedVersionReader::class)->page($owner, $document, $version, 0, $event));
    }

    public function image(Request $request, #[\SensitiveParameter] string $secret, string $image, ?int $event = null): array
    {
        return $this->read($request, $secret, 3, fn ($owner, $document, $version) =>
            app(SealedVersionReader::class)->image($owner, $document, $version, $image, $event));
    }
}
