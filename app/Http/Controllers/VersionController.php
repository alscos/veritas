<?php
namespace App\Http\Controllers;

use App\Models\{Certificate, Document, DocumentVersion};
use App\Support\{VersionAccess, VersionVerifier};
use Illuminate\Http\{JsonResponse, Request};
use Illuminate\Support\Facades\DB;

final class VersionController
{
    public function show(Request $request, string $document, string $version): JsonResponse
    {
        $document = Document::query()->select(['id', 'owner_id'])->findOrFail($document);
        VersionAccess::exact($request, $document, $version);
        if (DB::connection()->getDriverName() === 'mysql' && DB::transactionLevel() === 0) DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        return DB::transaction(function () use ($version): JsonResponse {
            $bytes = fn ($c) => DB::connection()->getDriverName() === 'sqlite' ? "length(CAST($c AS BLOB))" : "OCTET_LENGTH($c)";
            $size = DB::table('document_versions')->where('id', $version)->selectRaw('COALESCE('.$bytes('snapshot_html').',0) + COALESCE('.$bytes('snapshot_text').',0) + COALESCE('.$bytes('page_settings').',0) AS bytes')->first();
            abort_unless($size, 404);
            abort_if((int) $size->bytes > config('veritas.verification.row_bytes'), 413, 'Version evidence exceeds the server read limit.');
            $certificateSize = DB::table('certificates')->where('document_version_id', $version)->selectRaw($bytes('signed_payload').' AS bytes')->first();
            abort_if($certificateSize && (int) $certificateSize->bytes > config('veritas.verification.manifest_bytes'), 413, 'Version evidence exceeds the server read limit.');
            $v = DocumentVersion::findOrFail($version);
            $c = Certificate::where('document_version_id', $version)->first();
            return response()->json(['version' => $v, 'certificate' => $c])->header('Cache-Control', 'private, no-store');
        });
    }
    public function verify(Request $request, string $document, string $version, VersionVerifier $verifier): JsonResponse
    {
        $document = Document::query()->select(['id', 'owner_id'])->findOrFail($document);
        VersionAccess::exact($request, $document, $version);
        return response()->json($verifier->verify($version))->header('Cache-Control', 'private, no-store');
    }
}
