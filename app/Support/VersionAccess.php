<?php
namespace App\Support;

use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class VersionAccess
{
    public static function resolve(Request $request, Document $document): ?DocumentVersion
    {
        $request->validate(['version_id' => ['sometimes', 'required', 'uuid']]);
        if (!$request->filled('version_id')) {
            abort_unless($document->owner_id === $request->user()->id, 404);
            return null;
        }
        $version = DocumentVersion::query()->with('certificate')->where('document_id', $document->id)->findOrFail($request->input('version_id'));
        abort_unless($document->owner_id === $request->user()->id || DB::table('submissions')->where('document_version_id', $version->id)->where('recipient_user_id', $request->user()->id)->exists(), 404);
        return $version;
    }

    /** Exact path scope; no request parameter can replace it. Read metadata only. */
    public static function exact(Request $request, Document $document, string $id): DocumentVersion
    {
        $version = DocumentVersion::query()->select(['id', 'document_id'])->where('document_id', $document->id)->findOrFail($id);
        abort_unless($document->owner_id === $request->user()->id || DB::table('submissions')->where('document_version_id', $id)->where('recipient_user_id', $request->user()->id)->exists(), 404);
        return $version;
    }

    public static function boundary(DocumentVersion $version): ?array
    {
        $certificate = $version->certificate;
        if (!$certificate) return null;
        $key = config('veritas.signing_key');
        if (!is_string($key) || $key === '') return null;
        $payload = $certificate->signed_payload;
        if (!is_array($payload)) return null;
        ksort($payload);
        $signature = hash_hmac('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), $key);
        if (!hash_equals($certificate->signature, $signature) || !in_array($payload['format_version'] ?? null, [2, 3], true) || ($payload['version_id'] ?? null) !== $version->id || ($payload['document_id'] ?? null) !== $version->document_id || !is_array($payload['history_boundary'] ?? null)) return null;
        if (($payload['format_version'] ?? null) === 3) {
            $length = DB::connection()->getDriverName() === 'sqlite' ? 'length(CAST(manifest_bytes AS BLOB))' : 'OCTET_LENGTH(manifest_bytes)';
            $size = DB::table('version_evidence')->where('document_version_id', $version->id)->selectRaw($length.' AS bytes')->first();
            if (!$size || (int) $size->bytes > config('veritas.verification.manifest_bytes')) return null;
            $row = DB::table('version_evidence')->where('document_version_id', $version->id)->first();
            if (!$row || $row->schema !== EvidenceCanon::SCHEMA || ($payload['evidence_schema'] ?? null) !== EvidenceCanon::SCHEMA || ($payload['evidence_digest'] ?? null) !== hash('sha256', $row->manifest_bytes)) return null;
            try { $manifest = EvidenceCanon::decode($row->manifest_bytes); }
            catch (\JsonException | \InvalidArgumentException) { return null; }
            if ($manifest->version_id !== $version->id || $manifest->document_id !== $version->document_id) return null;
            if ($manifest->snapshot_hash !== $version->content_hash || count(get_object_vars($manifest->heads)) > config('veritas.verification.sessions') || count(get_object_vars($manifest->images)) > config('veritas.verification.images')) return null;
            $images = []; foreach ($manifest->images as $id => $image) $images[$id] = $image->sha256;
            if (!is_array($payload['images'] ?? null)) return null;
            $signedImages = $payload['images']; ksort($images); ksort($signedImages); if ($images !== $signedImages) return null;
            $heads = json_decode(json_encode($manifest->heads, JSON_THROW_ON_ERROR), true);
            $boundary = $payload['history_boundary'];
            if (count($heads) !== count($boundary)) return null;
            foreach ($heads as $id => $head) {
                if (!isset($boundary[$id]) || !is_array($boundary[$id])) return null;
                ksort($head); $other = $boundary[$id]; ksort($other); if ($head !== $other) return null;
            }
        }
        return $payload['history_boundary'];
    }
}
