<?php
namespace App\Support;
use App\Models\{Document, DocumentVersion, Certificate, VersionEvidence};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Two distinct transactions: consistent bounded preparation, then fresh locked commit. */
final class V3Capture
{
    private function fresh(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite' && DB::transactionLevel() !== 0) throw new \LogicException('V3 requires a fresh transaction');
    }
    public function prepare(string $id): array
    {
        $this->fresh(); $budget = new VerificationBudget(config('veritas.verification'));
        if (DB::connection()->getDriverName() === 'mysql') DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        return DB::transaction(function () use ($id, $budget) {
            $cut = $this->cut($id, $budget); $d = $cut['document'];
            abort_if($d->word_count < 1, 422, __('inkgroove.empty_document'));
            $key = config('veritas.signing_key');
            if (!is_string($key) || $key === '') throw new EvidenceFailure('signing_key_unavailable', 'incomplete');
            $reader = new EvidenceReader($budget); $reader->read($id, $d->content_html, $cut['heads'], $key);
            if ($reader->reasons) throw new EvidenceFailure(array_key_first($reader->reasons), in_array('mismatch', $reader->reasons, true) ? 'mismatch' : 'incomplete');
            $version = (string) Str::uuid();
            $manifest = (object) ['schema' => EvidenceCanon::SCHEMA, 'document_id' => $id, 'version_id' => $version,
                'snapshot_hash' => hash('sha256', $d->content_html), 'heads' => json_decode(json_encode((object) $cut['heads'], JSON_THROW_ON_ERROR)),
                'event_count' => $reader->events, 'images' => json_decode(json_encode((object) $reader->images, JSON_THROW_ON_ERROR))];
            EvidenceCanon::validate($manifest); $bytes = EvidenceCanon::encode($manifest);
            if (strlen($bytes) > $budget->limits['manifest_bytes']) throw new VerificationBudgetExceeded;
            $budget->add('data_bytes', strlen($bytes)); $budget->guard();
            return ['cut' => $cut['fingerprint'], 'version_id' => $version, 'manifest' => $bytes,
                'image_metadata' => $this->imageMetadata($id, array_keys($reader->images), $budget), 'key_commitment' => hash('sha256', $key), 'consumed' => $budget->consumed()];
        });
    }
    public function commit(array $prepared): array
    {
        $this->fresh(); $manifest = EvidenceCanon::decode($prepared['manifest']);
        $budget = new VerificationBudget(config('veritas.capture'));
        return DB::transaction(function () use ($prepared, $manifest, $budget) {
            $cut = $this->cut($manifest->document_id, $budget, true); $d = $cut['document'];
            abort_if($cut['fingerprint'] !== $prepared['cut'] || $this->imageMetadata($d->id, array_keys(get_object_vars($manifest->images)), $budget) !== $prepared['image_metadata'], 409, 'V3 capture conflict');
            $key = config('veritas.signing_key');
            abort_if(!is_string($key) || hash('sha256', $key) !== $prepared['key_commitment'], 409, 'V3 key conflict');
            $number = (int) $d->versions()->max('version_number') + 1; $at = now();
            $process = $d->sessions()->latest()->value('last_hash');
            $version = new DocumentVersion(['document_id' => $d->id, 'version_number' => $number,
                'snapshot_html' => $d->content_html, 'snapshot_text' => $d->content_text, 'page_settings' => $d->page_settings,
                'word_count' => $d->word_count, 'content_hash' => $manifest->snapshot_hash, 'process_hash' => $process, 'sealed_at' => $at]);
            $version->id = $manifest->version_id; $version->save();
            VersionEvidence::create(['document_version_id' => $version->id, 'schema' => EvidenceCanon::SCHEMA, 'manifest_bytes' => $prepared['manifest']]);
            $images = []; foreach ($manifest->images as $id => $image) $images[$id] = $image->sha256;
            $payload = ['format_version' => 3, 'history_boundary' => $cut['heads'], 'version_id' => $version->id,
                'document_id' => $d->id, 'version' => $number, 'content_hash' => $manifest->snapshot_hash, 'process_hash' => $process,
                'sealed_at' => $at->toIso8601String(), 'page_settings' => $d->page_settings, 'images' => $images,
                'evidence_schema' => EvidenceCanon::SCHEMA, 'evidence_digest' => hash('sha256', $prepared['manifest'])];
            $payload['payload_encoding'] = CertificatePayload::ENCODING;
            ksort($payload); $encoded = CertificatePayload::encode($payload);
            $certificate = Certificate::create(['document_version_id' => $version->id, 'certificate_code' => 'VRT-'.strtoupper(Str::random(20)),
                'signature' => hash_hmac('sha256', $encoded, $key), 'signed_payload' => $payload, 'issued_at' => $at]);
            $budget->guard(); return [$version, $certificate];
        });
    }
    private function cut(string $id, VerificationBudget $budget, bool $lock = false): array
    {
        $length = DB::connection()->getDriverName() === 'sqlite' ? 'length(CAST(content_html AS BLOB)) + length(CAST(content_text AS BLOB)) + COALESCE(length(CAST(page_settings AS BLOB)),0)' : 'OCTET_LENGTH(content_html) + OCTET_LENGTH(content_text) + COALESCE(OCTET_LENGTH(page_settings),0)';
        // The locked document is the first read in the new write transaction.
        if ($lock) {
            $q = DB::table('documents')->where('id', $id)->lockForUpdate()->select(['id'])->selectRaw($length.' AS bytes')->first();
        } else $q = DB::table('documents')->where('id', $id)->selectRaw($length.' AS bytes')->first();
        abort_unless($q, 404); $budget->add('rows'); $budget->reserveData((int) $q->bytes);
        $d = Document::findOrFail($id); $budget->add('rows'); $budget->add('data_bytes', (int) $q->bytes);
        $sessions = DB::table('writing_sessions')->where('document_id', $id)->orderBy('id')->limit($budget->limits['sessions'] + 1)->get(['id','last_sequence','last_hash']);
        if (count($sessions) > $budget->limits['sessions']) throw new VerificationBudgetExceeded;
        $budget->add('rows', count($sessions)); $heads = []; $sessionState = [];
        foreach ($sessions as $s) {
            $budget->guard();
            $last = DB::table('writing_events')->where('writing_session_id', $s->id)->orderByDesc('sequence')->first(['id','sequence','event_hash']); $budget->add('rows');
            $sessionState[$s->id] = [(int) $s->last_sequence, $s->last_hash];
            if ($last) {
                if ((int) $s->last_sequence !== (int) $last->sequence || $s->last_hash !== $last->event_hash) throw new EvidenceFailure('session_head_mismatch', 'mismatch');
                $heads[$s->id] = ['sequence' => (int) $last->sequence, 'event_id' => (int) $last->id, 'hash' => $last->event_hash];
            } elseif ((int) $s->last_sequence !== 0 || $s->last_hash !== null) throw new EvidenceFailure('session_head_missing', 'incomplete');
        }
        $fingerprint = [$d->owner_id, $d->revision, $d->content_html, $d->content_text, $d->word_count, $d->getRawOriginal('page_settings'), $sessionState, $heads];
        $budget->guard(); return ['document' => $d, 'heads' => $heads, 'fingerprint' => $fingerprint];
    }
    private function imageMetadata(string $document, array $ids, VerificationBudget $budget): array
    {
        if (count($ids) > $budget->limits['images']) throw new VerificationBudgetExceeded;
        sort($ids, SORT_STRING); $result = [];
        foreach ($ids as $id) {
            $row = DB::table('document_images')->where('document_id', $document)->where('id', $id)->first(['id','filename','sha256','bytes','mime','width','height']); $budget->add('rows');
            if (!$row) throw new EvidenceFailure('image_metadata_missing', 'incomplete');
            $result[$id] = (array) $row;
            // Normal storage is write-once at a new UUID; document deletion and
            // upload serialize on the document. No ordinary writer replaces bytes.
            $path = rtrim(config('veritas.media_path'), '/').'/'.$row->filename;
            if (is_link($path) || !is_file($path) || filesize($path) !== (int) $row->bytes) throw new EvidenceFailure('image_file_unavailable', 'incomplete');
        }
        $budget->guard(); return $result;
    }
}
