<?php

namespace App\Http\Controllers;

use App\Models\Certificate;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SealController
{
    public function store(Request $request, Document $document): JsonResponse
    {
        abort_unless($document->owner_id === $request->user()->id, 404);
        abort_if($document->word_count < 1, 422, __('inkgroove.empty_document'));

        [$version, $certificate] = DB::transaction(function () use ($document): array {
            $document = Document::query()->lockForUpdate()->findOrFail($document->id);
            $versionNumber = ((int) $document->versions()->max('version_number')) + 1;
            $processHash = $document->sessions()->latest()->value('last_hash');
            $sealedAt = now();
            $contentHash = hash('sha256', $document->content_html);
            $version = DocumentVersion::create([
                'document_id' => $document->id,
                'version_number' => $versionNumber,
                'snapshot_html' => $document->content_html,
                'snapshot_text' => $document->content_text,
                'page_settings' => $document->page_settings,
                'word_count' => $document->word_count,
                'content_hash' => $contentHash,
                'process_hash' => $processHash,
                'sealed_at' => $sealedAt,
            ]);
            $payload = [
                'version_id' => $version->id,
                'document_id' => $document->id,
                'version' => $versionNumber,
                'content_hash' => $contentHash,
                'process_hash' => $processHash,
                'sealed_at' => $sealedAt->toIso8601String(),
                'page_settings' => $document->page_settings,
                'images' => $document->images()->get()->filter(fn ($image) => str_contains($document->content_html, $image->url()))->mapWithKeys(fn ($image) => [$image->id => $image->sha256])->all(),
            ];
            ksort($payload);
            $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $certificate = Certificate::create([
                'document_version_id' => $version->id,
                'certificate_code' => 'VRT-'.strtoupper(Str::random(20)),
                'signature' => hash_hmac('sha256', $encoded, (string) config('veritas.signing_key')),
                'signed_payload' => $payload,
                'issued_at' => $sealedAt,
            ]);
            return [$version, $certificate];
        });
        return response()->json(['version' => $version, 'certificate' => $certificate], 201);
    }

    public function verify(string $code): JsonResponse
    {
        $certificate = Certificate::query()->where('certificate_code', $code)->firstOrFail();
        $payload = $certificate->signed_payload;
        ksort($payload);
        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $valid = hash_equals($certificate->signature, hash_hmac('sha256', $encoded, (string) config('veritas.signing_key')));
        return response()->json([
            'valid' => $valid,
            'certificate_code' => $certificate->certificate_code,
            'issued_at' => $certificate->issued_at,
            'content_hash' => $certificate->signed_payload['content_hash'] ?? null,
        ], $valid ? 200 : 409);
    }
}
