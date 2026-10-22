<?php
namespace App\Support;
use App\Models\DocumentImage;
use Illuminate\Support\Facades\DB;

/** Bounded read of exact committed prefixes, never the current draft/session set. */
final class EvidenceReader
{
    public array $reasons = [];
    public array $images = [];
    private array $attributes = [];
    public int $events = 0;
    public function __construct(private VerificationBudget $budget) {}
    private function issue(string $code, string $state): void { $this->reasons[$code] = $state; }
    public function read(string $document, string $html, array $heads, string $key): void
    {
        $this->references($document, $html);
        if (count($heads) > $this->budget->limits['sessions']) throw new VerificationBudgetExceeded;
        foreach ($heads as $sid => $head) {
            $this->budget->add('sessions');
            $session = DB::table('writing_sessions')->where('id', $sid)->first(['document_id']); $this->budget->add('rows');
            if (!$session) { $this->issue('session_missing', 'incomplete'); continue; }
            if ($session->document_id !== $document) { $this->issue('session_membership_mismatch', 'mismatch'); continue; }
            if ($head['sequence'] > $this->budget->limits['events'] - $this->budget->used['events']) throw new VerificationBudgetExceeded;
            $sequence = 1; $previous = null; $lastId = null; $afterSequence = 0; $afterId = 0;
            do {
                $this->budget->guard();
                $length = DB::connection()->getDriverName() === 'sqlite' ? 'length(CAST(%s AS BLOB))' : 'OCTET_LENGTH(%s)';
                $size = implode(' + ', array_map(fn ($c) => 'COALESCE('.sprintf($length, $c).',0)', ['after_html','data','event_type','input_type']));
                $rows = DB::table('writing_events')->where('writing_session_id', $sid)
                    ->where('sequence', '<=', $head['sequence'])->where('id', '<=', $head['event_id'])
                    ->where(fn ($q) => $q->where('sequence', '>', $afterSequence)->orWhere(fn ($q) => $q->where('sequence', $afterSequence)->where('id', '>', $afterId)))
                    ->orderBy('sequence')->orderBy('id')->limit(64)->select(['id','sequence'])->selectRaw($size.' AS bytes')->get();
                $this->budget->add('rows', count($rows));
                foreach ($rows as $meta) {
                    $this->budget->reserveData((int) $meta->bytes);
                    $e = DB::table('writing_events')->where('id', $meta->id)->first(['id','sequence','event_type','input_type','data','after_html','elapsed_ms','previous_hash','event_hash']);
                    $this->budget->add('rows'); $this->budget->add('events'); $this->events++;
                    $this->budget->add('data_bytes', (int) $meta->bytes);
                    if ((int) $e->sequence !== $sequence) $this->issue((int) $e->sequence > $sequence ? 'event_missing' : 'event_sequence_mismatch', (int) $e->sequence > $sequence ? 'incomplete' : 'mismatch');
                    if ((int) $e->sequence === $sequence && $e->previous_hash !== $previous) $this->issue('event_link_mismatch', 'mismatch');
                    if (!EventIntegrity::matches($sid, $e, $key, $this->budget)) $this->issue('event_hmac_mismatch', 'mismatch');
                    $this->references($document, $e->after_html ?? '');
                    $sequence = (int) $e->sequence + 1; $previous = $e->event_hash; $lastId = (int) $e->id; $afterSequence = (int) $e->sequence; $afterId = (int) $e->id;
                }
            } while (count($rows) === 64);
            if ($sequence !== $head['sequence'] + 1) $this->issue('event_missing', 'incomplete');
            if ($lastId !== $head['event_id']) $this->issue('terminal_event_mismatch', $lastId === null ? 'incomplete' : 'mismatch');
            elseif ($previous !== $head['hash']) $this->issue('terminal_hash_mismatch', 'mismatch');
        }
        ksort($this->images, SORT_STRING);
    }
    private function references(string $document, string $html): void
    {
        $this->budget->guard(); if ($html === '') return;
        $dom = new \DOMDocument('1.0', 'UTF-8'); $old = libxml_use_internal_errors(true);
        try { $dom->loadHTML('<?xml encoding="UTF-8">'.$html, LIBXML_NONET | LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($old); }
        foreach ($dom->getElementsByTagName('img') as $img) {
            if (!preg_match('~^/api/documents/([a-f0-9-]{36})/images/([a-f0-9-]{36})$~D', $img->getAttribute('src'), $m) || $m[1] !== $document) { $this->issue('image_reference_unresolvable', 'incomplete'); continue; }
            $id = $m[2]; $this->image($id, $document);
            if ($img->hasAttribute('data-image-sha256') && isset($this->images[$id]) && $img->getAttribute('data-image-sha256') !== $this->images[$id]['sha256']) $this->issue('image_attribute_mismatch', 'mismatch');
        }
        $this->budget->guard();
    }
    private function image(string $id, string $document): void
    {
        if (array_key_exists($id, $this->images)) return;
        $this->budget->add('images'); $this->images[$id] = null;
        $image = DocumentImage::where('document_id', $document)->find($id); $this->budget->add('rows');
        if (!$image) { $this->issue('image_metadata_missing', 'incomplete'); return; }
        $root = realpath(config('veritas.media_path')); $path = $image->path(); $real = realpath($path);
        if (!$root || basename($image->filename) !== $image->filename || is_link($path) || !$real || !str_starts_with($real, $root.DIRECTORY_SEPARATOR) || !is_file($real) || !is_readable($real)) { $this->issue('image_file_unavailable', 'incomplete'); return; }
        $size = filesize($real);
        if ($size > $this->budget->limits['image_file_bytes'] || $size > $this->budget->limits['image_bytes'] - $this->budget->used['image_bytes']) throw new VerificationBudgetExceeded;
        $handle = fopen($real, 'rb'); if (!$handle) { $this->issue('image_file_unavailable', 'incomplete'); return; }
        $hash = hash_init('sha256'); $bytes = 0;
        try {
            while (!feof($handle)) {
                $this->budget->guard(); $chunk = fread($handle, 65536);
                if ($chunk === false || ($chunk === '' && !feof($handle))) { $this->issue('image_file_unreadable', 'incomplete'); return; }
                $bytes += strlen($chunk); $this->budget->add('image_bytes', strlen($chunk));
                if ($bytes > $this->budget->limits['image_file_bytes']) throw new VerificationBudgetExceeded;
                hash_update($hash, $chunk);
            }
        } finally { fclose($handle); }
        $digest = hash_final($hash);
        $this->images[$id] = ['bytes' => $bytes, 'sha256' => $digest];
        if ($digest !== $image->sha256 || $bytes !== (int) $image->bytes) $this->issue('image_metadata_mismatch', 'mismatch');
        $this->budget->guard();
    }
}
