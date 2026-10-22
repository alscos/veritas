<?php
namespace App\Support;

use App\Models\{User, Document, DocumentVersion};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Version-scoped level 2; MariaDB authorization boundary validated independently. */
final class VersionSummaryCapabilities
{
    private function fresh(): void
    {
        // Neither engine may inherit a caller snapshot for authorization/revocation.
        abort_unless(DB::transactionLevel() === 0 && in_array(DB::connection()->getDriverName(), ['mysql','sqlite'], true), 503);
    }

    private function own(User $owner, string $document, string $version): void
    {
        abort_unless($owner->exists && Document::whereKey($document)->where('owner_id', $owner->getKey())->exists()
            && DocumentVersion::whereKey($version)->where('document_id', $document)->whereNotNull('sealed_at')->exists(), 404);
    }

    public function issue(User $owner, string $document, string $version, int $days = 7): array
    {
        $this->fresh();
        abort_unless($days >= 1 && $days <= 30, 422);
        $this->own($owner, $document, $version);
        // No caller transaction around the historical service's consistent snapshot.
        $summary = app(HistoricalVersionSummary::class)->summarize($owner, $document, $version);
        abort_unless(in_array($summary['verification']['status'], ['verified','limited'], true)
            && in_array($summary['verification']['format_version'], [2,3], true), 409);
        $secret = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        return DB::transaction(function () use ($owner, $document, $version, $days, $secret) {
            // Lock current relationships for issuance; no content is read here.
            Document::whereKey($document)->where('owner_id', $owner->getKey())->lockForUpdate()->firstOrFail(['id']);
            DocumentVersion::whereKey($version)->where('document_id', $document)->lockForUpdate()->firstOrFail(['id']);
            $row = ['id'=>(string) Str::uuid(), 'owner_id'=>$owner->getKey(), 'document_id'=>$document,
                'version_id'=>$version, 'level'=>2, 'digest'=>hash('sha256', $secret), 'revoked_at'=>null] + GrantTime::issuance($days);
            DB::table('version_summary_grants')->insert($row);
            return ['grant'=>$this->metadata((object) $row), 'secret'=>$secret];
        });
    }

    public function listing(User $owner, string $document, string $version): array
    {
        $this->fresh();
        $this->own($owner, $document, $version);
        return DB::table('version_summary_grants')->where('owner_id', $owner->getKey())
            ->where('document_id', $document)->where('version_id', $version)
            ->orderByDesc('created_at')->get(['id','created_at','expires_at','revoked_at','time_basis','created_at_epoch','expires_at_epoch','never_expires'])
            ->map(fn ($r) => $this->metadata($r))->all();
    }

    public function revoke(User $owner, string $document, string $version, string $id): void
    {
        $this->fresh();
        $this->own($owner, $document, $version);
        DB::transaction(function () use ($owner, $document, $version, $id) {
            $r = DB::table('version_summary_grants')->where('id', $id)->where('owner_id', $owner->getKey())
                ->where('document_id', $document)->where('version_id', $version)->lockForUpdate()->first();
            abort_unless($r, 404);
            if ($r->revoked_at === null) DB::table('version_summary_grants')->where('id', $id)->update(['revoked_at'=>now()]);
        });
    }

    public function redeem(#[\SensitiveParameter] string $secret): array
    {
        return app(VersionShareGate::class)->summary(request(), $secret);
    }

    public static function project(array $s): array
    {
        $v = $s['verification'];
        $valid = in_array($v['status'], ['verified','limited'], true) && in_array($v['format_version'], [2,3], true);
        foreach (['relationship','payload_signature','snapshot','chains'] as $check) $valid = $valid && ($v['checks'][$check] ?? null) === 'passed';
        $counts = null;
        if ($valid && in_array($s['counts']['state'], ['verified','limited'], true) && is_array($s['counts']['value'])) {
            $candidate = [];
            foreach (['direct','pasted','edited','total'] as $key) {
                $n = $s['counts']['value'][$key] ?? null;
                if (!is_int($n) || $n < 0) { $candidate = []; break; }
                $candidate[$key] = $n;
            }
            if (count($candidate) === 4 && $candidate['total'] === $candidate['direct'] + $candidate['pasted'] + $candidate['edited']) $counts = $candidate;
        }
        // Explicit allowlist: no IDs, raw checks/reasons, budget, timestamps or content.
        return ['schema'=>'inkgroove-shared-summary-1',
            'version'=>['number'=>$valid ? $s['version']['number'] : null, 'sealed_at'=>$valid ? $s['version']['sealed_at'] : null],
            'coverage'=>['status'=>in_array($v['status'], ['verified','limited','mismatch','incomplete','unsupported'], true) ? $v['status'] : 'unavailable',
                'complete'=>$valid && $v['format_version'] === 3 && $v['status'] === 'verified' && $v['complete'] === true,
                'format_version'=>in_array($v['format_version'], [2,3], true) ? $v['format_version'] : null],
            'counts'=>['state'=>$counts === null ? 'unavailable' : ($v['format_version'] === 2 ? 'limited' : $s['counts']['state']), 'value'=>$counts],
            'times'=>['state'=>'unavailable','value'=>null], 'pauses'=>['state'=>'unavailable','value'=>null],
            'ppm'=>['state'=>'unavailable','value'=>null], 'last_ppm'=>['state'=>'unavailable','value'=>null]];
    }

    private function metadata(object $r): array
    {
        return ['id'=>$r->id, 'created_at'=>GrantTime::iso($r, 'created_at'), 'expires_at'=>GrantTime::iso($r, 'expires_at'),
            'revoked_at'=>$r->revoked_at === null ? null : GrantTime::iso($r, 'revoked_at'),
            'state'=>$r->revoked_at !== null ? 'revoked' : (GrantTime::active($r) ? 'active' : 'expired')];
    }
}
