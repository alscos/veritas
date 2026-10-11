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

    public static function boundary(DocumentVersion $version): ?array
    {
        $certificate = $version->certificate;
        if (!$certificate) return null;
        $payload = $certificate->signed_payload;
        ksort($payload);
        $signature = hash_hmac('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), (string) config('veritas.signing_key'));
        if (!hash_equals($certificate->signature, $signature) || ($payload['format_version'] ?? null) !== 2 || ($payload['version_id'] ?? null) !== $version->id || ($payload['document_id'] ?? null) !== $version->document_id || !is_array($payload['history_boundary'] ?? null)) return null;
        return $payload['history_boundary'];
    }
}
