<?php
namespace App\Support;

use App\Models\{Certificate, Document, DocumentImage, DocumentVersion, User};
use Illuminate\Support\Facades\DB;

/** Internal owner-only primitive. NOT a capability endpoint or a replacement for VersionAccess.
 * Each call verifies all declared prefixes in one consistent cut. A public adapter must
 * additionally authorize the current grant + authenticated visitor before AND after it.
 */
final class SealedVersionReader
{
    private const PAGE = 32;
    private const HTML_BYTES = 250000;
    private const PAGE_BYTES = 1000000;

    private function own(User $owner, string $document, string $version): void
    {
        abort_unless($owner->exists && Document::whereKey($document)->where('owner_id', $owner->getKey())->exists()
            && DocumentVersion::whereKey($version)->where('document_id', $document)->whereNotNull('sealed_at')->exists(), 404);
    }

    private function consistent(User $owner, string $document, string $version, callable $read): mixed
    {
        $db = DB::connection();
        abort_unless($db->transactionLevel() === 0 && in_array($db->getDriverName(), ['mysql','sqlite'], true), 503);
        if ($db->getDriverName() === 'mysql') $db->statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $result = $db->transaction(function () use ($owner, $document, $version, $read) {
            $this->own($owner, $document, $version);
            $verification = (new VersionVerifier)->verify($version);
            abort_unless(in_array($verification['format_version'], [2,3], true)
                && in_array($verification['status'], ['limited','verified'], true), 409);
            foreach (['relationship','payload_signature','snapshot','chains'] as $check) {
                abort_unless(($verification['checks'][$check] ?? null) === 'passed', 409);
            }
            if ($verification['format_version'] === 3) abort_unless($verification['complete'] === true, 409);
            // Loaded only after size/signature/relationship/snapshot/prefix verification.
            $v = DocumentVersion::where('document_id', $document)->findOrFail($version);
            $c = Certificate::where('document_version_id', $version)->firstOrFail();
            $boundary = $c->signed_payload['history_boundary'] ?? null;
            abort_unless(is_array($boundary), 409);
            return $read($v, $c, $boundary, [
                'status'=>$verification['status'], 'complete'=>$verification['complete'],
                'format_version'=>$verification['format_version'],
                'order'=>'storage_id_not_authenticated_global_chronology',
            ]);
        });
        // Fresh cut after computation, not a stale author relationship.
        $this->own($owner, $document, $version);
        return $result;
    }

    private function events(string $document, array $boundary): \Illuminate\Database\Query\Builder
    {
        return DB::table('writing_events as e')->join('writing_sessions as s', 's.id', '=', 'e.writing_session_id')
            ->where('s.document_id', $document)->where(function ($q) use ($boundary) {
                $q->whereRaw('1 = 0');
                foreach ($boundary as $session => $head) {
                    $q->orWhere(fn ($q) => $q->where('e.writing_session_id', $session)
                        ->where('e.sequence', '<=', $head['sequence'])->where('e.id', '<=', $head['event_id']));
                }
            });
    }

    private function boundedHtml(string $html): string
    {
        abort_if(strlen($html) > self::HTML_BYTES, 413);
        return $html; // Literal bytes, no Unicode normalization or sanitation of the stored evidence.
    }

    /** Cursor is an untrusted position, never authority. IDs outside the signed prefixes cannot match. */
    public function page(User $owner, string $document, string $version, int $after = 0, ?int $event = null): array
    {
        abort_unless($after >= 0 && ($event === null || $event > 0), 422);
        return $this->consistent($owner, $document, $version, function ($v, $c, $boundary, $coverage) use ($document, $after, $event) {
            $base = $this->events($document, $boundary)->where('e.id', '>', $after);
            if ($event !== null) $base->where('e.id', $event);
            $length = DB::connection()->getDriverName() === 'sqlite' ? 'length(CAST(e.after_html AS BLOB))' : 'OCTET_LENGTH(e.after_html)';
            // Size metadata first; never materialize an unbounded page of HTML.
            $rows = $base->orderBy('e.id')->limit(self::PAGE + 1)
                ->select(['e.id','e.sequence'])->selectRaw('COALESCE('.$length.',0) AS bytes')->get();
            if ($event !== null) abort_unless(count($rows) === 1, 404);
            $events = []; $bytes = 0; $more = false;
            foreach ($rows as $meta) {
                if (count($events) === self::PAGE || ($bytes + (int) $meta->bytes > self::PAGE_BYTES && count($events))) { $more = true; break; }
                abort_if((int) $meta->bytes > self::HTML_BYTES, 413);
                // The same boundary is applied to every individual snapshot lookup too.
                $e = $this->events($document, $boundary)->where('e.id', $meta->id)
                    ->first(['e.id','e.sequence','e.after_html']);
                abort_unless($e && is_string($e->after_html), 409);
                $html = $this->boundedHtml($e->after_html); $bytes += strlen($html);
                $events[] = ['id'=>(int) $e->id, 'sequence'=>(int) $e->sequence, 'html'=>$html];
            }
            return ['version'=>['number'=>$v->version_number,'sealed_at'=>$v->sealed_at?->toIso8601String()],
                'coverage'=>$coverage, 'total_events'=>$this->events($document, $boundary)->count(), 'snapshot_html'=>$this->boundedHtml($v->snapshot_html), 'events'=>$events,
                'next_after'=>$more && $events ? $events[array_key_last($events)]['id'] : null];
        });
    }

    /** Exact verified bytes, never a mutable private URL/BinaryFileResponse reopened later.
     * Only images referenced by this snapshot/event AND committed in this seal are eligible.
     * Historical v2 images without a signed digest remain unavailable (safe absence).
     */
    public function image(User $owner, string $document, string $version, string $image, ?int $event = null): array
    {
        abort_unless(preg_match('/^[a-f0-9-]{36}$/D', $image) === 1 && ($event === null || $event > 0), 404);
        return $this->consistent($owner, $document, $version, function ($v, $c, $boundary) use ($document, $image, $event) {
            $html = $v->snapshot_html;
            if ($event !== null) {
                $e = $this->events($document, $boundary)->where('e.id', $event)->first(['e.after_html']);
                abort_unless($e && is_string($e->after_html), 404); $html = $e->after_html;
            }
            $this->boundedHtml($html);
            $src = '/api/documents/'.$document.'/images/'.$image;
            $dom = new \DOMDocument('1.0', 'UTF-8'); $old = libxml_use_internal_errors(true);
            try { $dom->loadHTML('<?xml encoding="UTF-8">'.$html, LIBXML_NONET); }
            finally { libxml_clear_errors(); libxml_use_internal_errors($old); }
            $found = false;
            foreach ($dom->getElementsByTagName('img') as $node) if ($node->getAttribute('src') === $src) $found = true;
            $expected = $c->signed_payload['images'][$image] ?? null;
            abort_unless($found && is_string($expected) && preg_match('/^[a-f0-9]{64}$/D', $expected), 404);
            $row = DocumentImage::where('document_id', $document)->findOrFail($image);
            $path = $row->path(); $root = realpath((string) config('veritas.media_path')); $real = realpath($path);
            abort_unless($root && $real && basename($row->filename) === $row->filename && !is_link($path)
                && str_starts_with($real, $root.DIRECTORY_SEPARATOR) && is_file($real), 404);
            $handle = @fopen($real, 'rb'); abort_unless($handle, 404);
            try { $data = stream_get_contents($handle, 5 * 1024 * 1024 + 1); }
            finally { fclose($handle); }
            abort_unless(is_string($data) && strlen($data) <= 5 * 1024 * 1024
                && strlen($data) === (int) $row->bytes && hash_equals($expected, hash('sha256', $data))
                && hash_equals($row->sha256, hash('sha256', $data)), 409);
            $info = @getimagesizefromstring($data);
            abort_unless($info && in_array($info['mime'], ['image/png','image/jpeg','image/gif','image/webp'], true)
                && $info[0] > 0 && $info[1] > 0 && $info[0] * $info[1] <= 12000000, 409);
            return ['mime'=>$info['mime'], 'bytes'=>$data];
        });
    }
}
