<?php
namespace App\Support;

use App\Models\{Document, DocumentVersion, User};
use Illuminate\Support\Facades\DB;

/** Internal owner-only entry point. No routes, public codes or recipient expansion. */
final class HistoricalVersionSummary
{
    public function summarize(User $owner, string $documentId, string $versionId): array
    {
        $connection = DB::connection();
        // Own the MySQL isolation contract; an unknown caller transaction may be READ COMMITTED.
        if (!in_array($connection->getDriverName(), ['mysql','sqlite'], true)) throw new \LogicException('Unsupported summary database');
        if ($connection->getDriverName() === 'mysql') {
            if ($connection->transactionLevel() !== 0) throw new \LogicException('Summary requires its own consistent transaction');
            $connection->statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        }
        return $connection->transaction(function () use ($owner, $documentId, $versionId) {
            abort_unless($owner->exists && Document::query()->whereKey($documentId)->where('owner_id', $owner->getKey())->exists(), 404);
            $v = DocumentVersion::query()->select(['id','version_number','sealed_at'])->where('document_id', $documentId)->findOrFail($versionId);
            $unavailable = fn ($reason, $unit) => ['state'=>'unavailable','value'=>null,'unit'=>$unit,'source'=>null,'reason'=>$reason];
            try { $verification = (new VersionVerifier)->verify($versionId); }
            catch (\Throwable) { $verification = ['status'=>'error','format_version'=>null,'complete'=>false,'scope'=>[], 'checks'=>[], 'reason_codes'=>['verification_error']]; }
            $counts = $unavailable('verification_not_sufficient', 'words');
            if (in_array($verification['status'], ['verified','limited'], true)
                && in_array($verification['format_version'], [2,3], true)
                && ($verification['checks']['relationship'] ?? null) === 'passed'
                && ($verification['checks']['snapshot'] ?? null) === 'passed'
                && ($verification['checks']['chains'] ?? null) === 'passed'
                && ($verification['checks']['payload_signature'] ?? null) === 'passed') {
                try {
                    $html = DB::table('document_versions')->where('id', $versionId)->value('snapshot_html');
                    $counts = ['state'=>$verification['status'] === 'verified' ? 'verified' : 'limited', 'value'=>HistoricalWordCounts::analyze($html), 'unit'=>'words', 'source'=>'sealed_snapshot_html', 'reason'=>$verification['status'] === 'verified' ? null : 'v2_session_set_not_independently_proven'];
                } catch (\DomainException $e) { $counts = $unavailable($e->getMessage(), 'words'); }
            }
            return ['schema'=>'inkgroove-historical-summary-1',
                'version'=>['id'=>$v->id,'number'=>$v->version_number,'sealed_at'=>$v->sealed_at?->toIso8601String()],
                'verification'=>$verification, 'counts'=>$counts,
                'times'=>$unavailable('session_timing_semantics_not_accredited', 'ms'),
                'ppm'=>$unavailable('authenticated_global_chronology_unavailable', 'words/min'),
                'last_ppm'=>$unavailable('authenticated_global_chronology_unavailable', 'words/min'),
                'pauses'=>$unavailable('session_timing_semantics_not_accredited', 'ms'),
                'coverage'=>['snapshot'=>'exact_sealed_version','history'=>'verifier_declared_prefixes_only','draft_used'=>false],
                'limitations'=>['recorded_provenance_is_not_human_authorship','server_received_at_not_authenticated','html_parser_conservative_subset','no_measured_thinking_time']];
        });
    }
}
