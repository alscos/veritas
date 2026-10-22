<?php
namespace App\Support;

use App\Models\{Certificate, DocumentImage, DocumentVersion};
use Illuminate\Support\Facades\DB;

/** Read-only verifier of the commitments actually present in historical/v2 seals. */
final class VersionVerifier
{
    private VerificationBudget $budget;
    private array $checks;
    private array $reasons;
    private array $imageCache;
    private ?int $format;
    private bool $v3Complete = false;

    public function verify(string $versionId): array
    {
        $this->budget = new VerificationBudget(config('veritas.verification'));
        $this->checks = array_fill_keys(['relationship', 'payload_signature', 'snapshot', 'chains', 'images'], 'pending');
        $this->reasons = []; $this->imageCache = []; $this->format = null; $this->v3Complete = false;
        $connection = DB::connection();
        // Per-transaction isolation, never a global/session change. No FOR UPDATE.
        if ($connection->getDriverName() === 'mysql' && $connection->transactionLevel() === 0) $connection->statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        return $connection->transaction(function () use ($versionId): array {
            try {
                $this->read($versionId);
                $this->budget->guard();
            } catch (VerificationBudgetExceeded) {
                $this->reasons['budget_exceeded'] = 'incomplete';
            }
            $states = array_values($this->reasons);
            $status = in_array('mismatch', $states, true) ? 'mismatch' : (in_array('incomplete', $states, true) ? 'incomplete' : (in_array('unsupported', $states, true) ? 'unsupported' : ($this->v3Complete ? 'verified' : 'limited')));
            return [
                'status' => $status, 'format_version' => $this->format, 'complete' => $status === 'verified',
                'scope' => [
                    'commitments' => $this->format === 3 ? 'original_manifest_snapshot_all_session_prefixes_and_image_bytes' : ($this->format === 2 ? 'signed_snapshot_and_declared_session_prefixes' : ($this->format === 1 ? 'historical_present_commitments' : 'none_for_unsupported_format')),
                    'session_set_completeness' => $this->format === 3 ? 'relative_to_preserved_original_manifest' : 'not_independently_proven',
                    'historical_image_bytes' => $this->format === 3 ? 'committed_in_original_manifest' : 'unsigned_unless_snapshot_committed',
                    'snapshot_text_word_count_dates' => 'not_authenticated_by_content_hash',
                    'event_integer_json_types' => 'exact_candidates_for_supported_ingestion_serialization',
                    'event_dates_request_hash' => 'not_authenticated_by_event_hmac',
                    'key' => 'current_configured_key_without_historical_key_identifier',
                    'read' => 'consistent_database_cut_files_read_at_query_time',
                ],
                'checks' => $this->checks, 'reason_codes' => array_keys($this->reasons),
                'checked_at' => now()->toIso8601String(), 'consumed' => $this->budget->consumed(),
            ];
        });
    }

    private function issue(string $component, string $code, string $state): void
    {
        $this->reasons[$code] = $state;
        $old = $this->checks[$component];
        if ($old !== 'mismatch' && ($state === 'mismatch' || $old !== 'incomplete')) $this->checks[$component] = $state;
    }
    private function passed(string $component): void
    {
        if ($this->checks[$component] === 'pending') $this->checks[$component] = 'passed';
    }
    private function bytesExpression(string $column): string
    {
        return DB::connection()->getDriverName() === 'sqlite' ? "length(CAST($column AS BLOB))" : "OCTET_LENGTH($column)";
    }
    private function loadVersion(string $id): DocumentVersion
    {
        $b = fn ($c) => $this->bytesExpression($c);
        $size = DB::table('document_versions')->where('id', $id)->selectRaw('COALESCE('.$b('snapshot_html').',0) + COALESCE('.$b('page_settings').',0) AS bytes')->first();
        abort_unless($size, 404);
        $this->budget->add('rows'); $this->budget->reserveData((int) $size->bytes);
        $v = DocumentVersion::query()->select(['id','document_id','version_number','snapshot_html','page_settings','content_hash','process_hash','sealed_at'])->findOrFail($id);
        $this->budget->add('rows');
        $actual = strlen($v->snapshot_html) + strlen($v->getRawOriginal('page_settings') ?? '');
        $this->budget->reserveData($actual); $this->budget->add('data_bytes', $actual);
        return $v;
    }
    private function read(string $id): void
    {
        $v = $this->loadVersion($id);
        $size = DB::table('certificates')->where('document_version_id', $id)->select(['id'])->selectRaw($this->bytesExpression('signed_payload').' AS bytes')->first();
        $this->budget->add('rows');
        if (!$size) { $this->issue('relationship', 'certificate_missing', 'incomplete'); return; }
        $this->budget->reserveData((int) $size->bytes);
        if ((int) $size->bytes > $this->budget->limits['manifest_bytes']) throw new VerificationBudgetExceeded;
        $c = Certificate::findOrFail($size->id); $this->budget->add('rows');
        $this->budget->add('data_bytes', strlen($c->getRawOriginal('signed_payload')));
        try { $p = json_decode($c->getRawOriginal('signed_payload'), true, 64, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { $this->issue('payload_signature', 'payload_invalid', 'unsupported'); return; }
        if (!is_array($p) || array_is_list($p)) { $this->issue('payload_signature', 'payload_invalid', 'unsupported'); return; }
        $format = array_key_exists('format_version', $p) ? $p['format_version'] : 1;
        $this->format = is_int($format) ? $format : null;
        if (!in_array($format, [1, 2, 3], true)) { $this->issue('payload_signature', 'format_unsupported', 'unsupported'); return; }
        $key = config('veritas.signing_key');
        if (!is_string($key) || $key === '') { $this->issue('payload_signature', 'signing_key_unavailable', 'incomplete'); return; }
        ksort($p);
        $signed = json_encode($p, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $this->budget->guard();
        $signatureValid = hash_equals($c->signature, hash_hmac('sha256', $signed, $key));
        if (!$signatureValid) $this->issue('payload_signature', 'payload_signature_mismatch', 'mismatch');
        else $this->passed('payload_signature');
        $fields = ['version_id' => $v->id, 'document_id' => $v->document_id, 'version' => (int) $v->version_number, 'page_settings' => $v->page_settings, 'content_hash' => $v->content_hash, 'process_hash' => $v->process_hash];
        $present = [];
        foreach ($fields as $field => $value) {
            if (!array_key_exists($field, $p)) {
                if ($format >= 2) $this->issue('relationship', 'signed_field_missing_'.$field, 'incomplete');
                continue;
            }
            $present[] = $field;
            if ($p[$field] !== $value) $this->issue('relationship', 'signed_field_mismatch_'.$field, 'mismatch');
        }
        // sealed_at is signed as ISO8601, while the DB stores second precision.
        if (array_key_exists('sealed_at', $p)) {
            $present[] = 'sealed_at';
            if (!is_string($p['sealed_at']) || $p['sealed_at'] !== $v->sealed_at?->toIso8601String()) $this->issue('relationship', 'sealed_at_mismatch', 'mismatch');
        } elseif ($format >= 2) $this->issue('relationship', 'signed_field_missing_sealed_at', 'incomplete');
        $this->checks['committed_fields'] = $present;
        if ($c->document_version_id !== $v->id) $this->issue('relationship', 'certificate_relationship_mismatch', 'mismatch');
        $this->passed('relationship');
        $hash = hash('sha256', $v->snapshot_html);
        if ($hash !== $v->content_hash || (isset($p['content_hash']) && $hash !== $p['content_hash'])) $this->issue('snapshot', 'snapshot_hash_mismatch', 'mismatch');
        elseif (!isset($p['content_hash'])) $this->issue('snapshot', 'snapshot_commitment_missing', 'incomplete');
        else $this->passed('snapshot');
        // Never traverse untrusted boundaries or image commitments after a bad signature/link.
        if (!$signatureValid || $this->checks['relationship'] !== 'passed') return;
        if ($format === 3) { $this->v3($v, $p, $key); return; }
        if ($format === 2 && !array_key_exists('images', $p)) $this->issue('images', 'image_manifest_missing', 'incomplete');
        $images = $p['images'] ?? [];
        if (array_key_exists('images', $p) && !is_array($p['images'])) {
            $this->issue('images', 'image_manifest_invalid', 'incomplete'); $images = [];
        }
        if (count($images) > $this->budget->limits['images']) throw new VerificationBudgetExceeded;
        $this->references($v->snapshot_html, $v->document_id, $images, true, $format === 2);
        foreach ($images as $imageId => $commitment) {
            $this->budget->guard();
            $this->image((string) $imageId, $v->document_id, $commitment, true);
        }
        if ($format === 2) {
            if (!is_array($p['history_boundary'] ?? null)) $this->issue('chains', 'history_boundary_missing', 'incomplete');
            else $this->chains($v->document_id, $p['history_boundary'], $images, $key);
        } else $this->checks['chains'] = 'limited';
        if (isset($this->reasons['historical_image_unsigned']) && $this->checks['images'] === 'pending') $this->checks['images'] = 'limited';
        $this->passed('images');
    }

    private function v3(DocumentVersion $v, array $p, string $key): void
    {
        $this->checks['evidence'] = 'pending';
        $length = $this->bytesExpression('manifest_bytes');
        $meta = DB::table('version_evidence')->where('document_version_id', $v->id)->select(['schema'])->selectRaw($length.' AS bytes')->first();
        $this->budget->add('rows');
        if (!$meta) { $this->issue('evidence', 'evidence_missing', 'incomplete'); return; }
        if ($meta->schema !== EvidenceCanon::SCHEMA || ($p['evidence_schema'] ?? null) !== EvidenceCanon::SCHEMA) { $this->issue('evidence', 'evidence_schema_unsupported', 'unsupported'); return; }
        if ((int) $meta->bytes > $this->budget->limits['manifest_bytes']) throw new VerificationBudgetExceeded;
        $this->budget->reserveData((int) $meta->bytes);
        $bytes = DB::table('version_evidence')->where('document_version_id', $v->id)->value('manifest_bytes');
        $this->budget->add('rows'); $this->budget->add('data_bytes', strlen($bytes));
        if (!is_string($p['evidence_digest'] ?? null) || $p['evidence_digest'] !== hash('sha256', $bytes)) $this->issue('evidence', 'evidence_digest_mismatch', 'mismatch');
        try { $manifest = EvidenceCanon::decode($bytes); }
        catch (\JsonException | \InvalidArgumentException) { $this->issue('evidence', 'evidence_canon_invalid', 'unsupported'); return; }
        if ($manifest->document_id !== $v->document_id || $manifest->version_id !== $v->id || $manifest->snapshot_hash !== $v->content_hash) $this->issue('evidence', 'evidence_relationship_mismatch', 'mismatch');
        $heads = json_decode(json_encode($manifest->heads, JSON_THROW_ON_ERROR), true, 64, JSON_THROW_ON_ERROR);
        // Object key order is irrelevant to map comparison; integer types are not.
        $expectedImages = []; foreach ($manifest->images as $id => $image) $expectedImages[$id] = $image->sha256;
        if (!is_array($p['history_boundary'] ?? null) || !$this->sameMaps($heads, $p['history_boundary'])) $this->issue('evidence', 'evidence_boundary_mismatch', 'mismatch');
        if (!is_array($p['images'] ?? null) || !$this->sameMaps($expectedImages, $p['images'])) $this->issue('evidence', 'evidence_images_mismatch', 'mismatch');
        // Traverse only the preserved original reference, even when the payload
        // has been re-signed with an omitted session/image. Never consult draft.
        $reader = new EvidenceReader($this->budget); $reader->read($v->document_id, $v->snapshot_html, $heads, $key);
        foreach ($reader->reasons as $code => $state) $this->issue(str_starts_with($code, 'image_') ? 'images' : 'chains', $code, $state);
        if ($reader->events !== $manifest->event_count) $this->issue('evidence', 'evidence_event_count_mismatch', isset($reader->reasons['event_missing']) || isset($reader->reasons['session_missing']) ? 'incomplete' : 'mismatch');
        $actualIds = array_keys($reader->images); $expectedIds = array_keys(get_object_vars($manifest->images)); sort($actualIds); sort($expectedIds);
        if ($actualIds !== $expectedIds) {
            $missingPrefix = isset($reader->reasons['event_missing']) || isset($reader->reasons['session_missing']);
            $this->issue('evidence', 'evidence_image_references_mismatch', !array_diff($actualIds, $expectedIds) && $missingPrefix ? 'incomplete' : 'mismatch');
        }
        foreach ($manifest->images as $id => $image) {
            if (!isset($reader->images[$id])) continue; // absence is recorded by reader
            if ($reader->images[$id]['sha256'] !== $image->sha256 || $reader->images[$id]['bytes'] !== $image->bytes) $this->issue('images', 'evidence_image_bytes_mismatch', 'mismatch');
        }
        $this->passed('chains'); $this->passed('images'); $this->passed('evidence');
        $this->v3Complete = !$this->reasons && $this->checks['snapshot'] === 'passed';
    }
    private function sameMaps(array $a, array $b): bool
    {
        $sort = function (array $v) use (&$sort): array { ksort($v, SORT_STRING); foreach ($v as &$x) if (is_array($x)) $x = $sort($x); return $v; };
        return $sort($a) === $sort($b);
    }

    private function chains(string $documentId, array $boundary, array $images, string $key): void
    {
        if (count($boundary) > $this->budget->limits['sessions']) throw new VerificationBudgetExceeded;
        foreach ($boundary as $sid => $head) {
            $this->budget->add('sessions');
            if (!is_string($sid) || !is_array($head) || !is_int($head['sequence'] ?? null) || $head['sequence'] < 1 || !is_int($head['event_id'] ?? null) || $head['event_id'] < 1 || !is_string($head['hash'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $head['hash'])) {
                $this->issue('chains', 'boundary_invalid', 'mismatch'); continue;
            }
            if ($head['sequence'] > $this->budget->limits['events'] - $this->budget->used['events']) throw new VerificationBudgetExceeded;
            $session = DB::table('writing_sessions')->where('id', $sid)->first(['document_id']); $this->budget->add('rows');
            if (!$session) { $this->issue('chains', 'session_missing', 'incomplete'); continue; }
            if ($session->document_id !== $documentId) { $this->issue('chains', 'session_membership_mismatch', 'mismatch'); continue; }
            $sequence = 1; $previous = null; $lastId = null; $afterId = 0; $afterSequence = 0;
            // Small metadata batches, then one size-checked event. No open PDO cursor,
            // no buffering attribute mutation, and no accumulated HTML snapshots.
            do {
                $this->budget->guard();
                $b = fn ($c) => $this->bytesExpression($c);
                $rows = DB::table('writing_events')->where('writing_session_id', $sid)
                    ->where('sequence', '<=', $head['sequence'])->where('id', '<=', $head['event_id'])
                    ->where(fn ($q) => $q->where('sequence', '>', $afterSequence)
                        ->orWhere(fn ($q) => $q->where('sequence', $afterSequence)->where('id', '>', $afterId)))
                    ->orderBy('sequence')->orderBy('id')->limit(64)->select(['id','sequence'])
                    ->selectRaw('COALESCE('.$b('after_html').',0) + COALESCE('.$b('data').',0) + COALESCE('.$b('event_type').',0) + COALESCE('.$b('input_type').',0) AS bytes')->get();
                $this->budget->add('rows', count($rows));
                foreach ($rows as $meta) {
                    $this->budget->reserveData((int) $meta->bytes);
                    $e = DB::table('writing_events')->where('id', $meta->id)->first(['id','sequence','event_type','input_type','data','after_html','elapsed_ms','previous_hash','event_hash']);
                    $this->budget->add('rows'); $this->budget->add('events');
                    $this->budget->add('data_bytes', strlen($e->after_html ?? '') + strlen($e->data ?? '') + strlen($e->event_type) + strlen($e->input_type ?? ''));
                    if ((int) $e->sequence !== $sequence) {
                        $this->issue('chains', (int) $e->sequence > $sequence ? 'event_missing' : 'event_sequence_mismatch', (int) $e->sequence > $sequence ? 'incomplete' : 'mismatch');
                    }
                    if ((int) $e->sequence === $sequence && $e->previous_hash !== $previous) $this->issue('chains', 'event_link_mismatch', 'mismatch');
                    if (!preg_match('/^[a-f0-9]{64}$/D', $e->event_hash)) $this->issue('chains', 'event_hash_invalid', 'mismatch');
                    elseif (!EventIntegrity::matches($sid, $e, $key, $this->budget)) $this->issue('chains', 'event_hmac_mismatch', 'mismatch');
                    $this->references($e->after_html ?? '', $documentId, $images, false);
                    $sequence = (int) $e->sequence + 1; $previous = $e->event_hash; $lastId = (int) $e->id; $afterId = (int) $e->id; $afterSequence = (int) $e->sequence;
                    unset($e); $this->budget->guard();
                }
            } while (count($rows) === 64);
            if ($sequence !== $head['sequence'] + 1) $this->issue('chains', 'event_missing', 'incomplete');
            if ($lastId !== $head['event_id']) $this->issue('chains', $sequence === $head['sequence'] + 1 ? 'terminal_id_mismatch' : 'terminal_event_missing', $sequence === $head['sequence'] + 1 ? 'mismatch' : 'incomplete');
            elseif ($previous !== $head['hash']) $this->issue('chains', 'terminal_hash_mismatch', 'mismatch');
        }
        $this->passed('chains');
    }

    private function references(string $html, string $documentId, array $commitments, bool $snapshot, bool $requiresCommitment = false): void
    {
        $this->budget->guard();
        if ($html === '') return;
        $dom = new \DOMDocument('1.0', 'UTF-8');
        $old = libxml_use_internal_errors(true);
        try { $dom->loadHTML('<?xml encoding="UTF-8">'.$html, LIBXML_NONET | LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($old); }
        foreach ($dom->getElementsByTagName('img') as $img) {
            $this->budget->guard();
            if (!preg_match('~^/api/documents/([a-f0-9-]{36})/images/([a-f0-9-]{36})$~D', $img->getAttribute('src'), $match) || $match[1] !== $documentId) {
                $this->issue('images', 'image_reference_unresolvable', 'incomplete'); continue;
            }
            $id = $match[2];
            if ($snapshot && $requiresCommitment && !array_key_exists($id, $commitments)) $this->issue('images', 'snapshot_image_commitment_missing', 'incomplete');
            if (!array_key_exists($id, $commitments)) $this->reasons['historical_image_unsigned'] = 'limited';
            $this->image($id, $documentId, $commitments[$id] ?? null, array_key_exists($id, $commitments));
        }
        unset($dom); $this->budget->guard();
    }

    private function image(string $id, string $documentId, mixed $commitment, bool $signed = false): void
    {
        $this->budget->guard();
        if (isset($this->imageCache[$id])) return;
        $this->budget->add('images'); $this->imageCache[$id] = true;
        if (!preg_match('/^[a-f0-9-]{36}$/D', $id) || ($signed && (!is_string($commitment) || !preg_match('/^[a-f0-9]{64}$/D', $commitment)))) { $this->issue('images', 'image_commitment_invalid', 'mismatch'); return; }
        $image = DocumentImage::where('document_id', $documentId)->find($id); $this->budget->add('rows');
        if (!$image) { $this->issue('images', 'image_metadata_missing', 'incomplete'); return; }
        $root = realpath(config('veritas.media_path'));
        // Reject traversal and symlinks even when they currently resolve within root.
        $path = $image->path(); $real = realpath($path);
        if (!$root || basename($image->filename) !== $image->filename || is_link($path) || !$real || !str_starts_with($real, $root.DIRECTORY_SEPARATOR) || !is_file($real) || !is_readable($real)) { $this->issue('images', 'image_file_unavailable', 'incomplete'); return; }
        $size = @filesize($real);
        if ($size === false) { $this->issue('images', 'image_file_unavailable', 'incomplete'); return; }
        if ($size > $this->budget->limits['image_file_bytes'] || $size > $this->budget->limits['image_bytes'] - $this->budget->used['image_bytes']) throw new VerificationBudgetExceeded;
        $handle = @fopen($real, 'rb');
        if (!$handle) { $this->issue('images', 'image_file_unavailable', 'incomplete'); return; }
        $hash = hash_init('sha256'); $bytes = 0;
        try {
            while (!feof($handle)) {
                $this->budget->guard(); $chunk = @fread($handle, 65536);
                if ($chunk === false || ($chunk === '' && !feof($handle))) { $this->issue('images', 'image_file_unreadable', 'incomplete'); return; }
                $this->budget->add('image_bytes', strlen($chunk)); $bytes += strlen($chunk);
                if ($bytes > $this->budget->limits['image_file_bytes']) throw new VerificationBudgetExceeded;
                hash_update($hash, $chunk);
            }
        } finally { fclose($handle); }
        $actual = hash_final($hash); $this->budget->guard();
        if ($signed && $actual !== $commitment) $this->issue('images', 'image_signed_hash_mismatch', 'mismatch');
        if ($actual !== $image->sha256 || $bytes !== (int) $image->bytes) $this->issue('images', 'image_metadata_mismatch', 'mismatch');
    }
}
