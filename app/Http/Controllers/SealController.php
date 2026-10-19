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
        if (config('veritas.seal_format') === 3) {
            try {
                $capture = new \App\Support\V3Capture;
                [$version, $certificate] = $capture->commit($capture->prepare($document->id));
            } catch (\App\Support\VerificationBudgetExceeded | \App\Support\EvidenceFailure $e) {
                abort(409, 'V3 evidence unavailable');
            }
            return response()->json(['version' => $version, 'certificate' => $certificate], 201);
        }
        [$version, $certificate] = DB::transaction(function () use ($document): array {
            $document = Document::query()->lockForUpdate()->findOrFail($document->id);
            abort_if($document->word_count < 1, 422, __('inkgroove.empty_document'));
            $boundary = [];
            foreach ($document->sessions()->orderBy('id')->get() as $session) {
                $last = $session->events()->reorder()->orderByDesc('sequence')->first();
                if ($last) $boundary[$session->id] = ['sequence' => (int) $last->sequence, 'event_id' => (int) $last->id, 'hash' => $last->event_hash];
            }
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
                'format_version' => 2,
                'history_boundary' => $boundary,
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
        $certificate = \App\Support\PublicCertificate::find($code);
        if (!$certificate) return response()->json(['message' => __('inkgroove.certificate_unavailable')], 404)->header('Cache-Control', 'no-store');
        $summary = \App\Support\PublicCertificate::summary($certificate);
        return response()->json($summary, $summary['valid'] ? 200 : 409)->header('Cache-Control', 'no-store');
    }

    public function publicPage(Request $request, string $code)
    {
        $certificate = \App\Support\PublicCertificate::find($code);
        if (!$certificate) return response()->view('certificate-unavailable', ['english' => $request->query('lang') === 'en'], 404)->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex, nofollow')->header('Content-Security-Policy', "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        $summary = \App\Support\PublicCertificate::summary($certificate);
        $english = $request->query('lang') === 'en';
        // Explicit projection: the public view never receives a model or payload.
        return response()->view('certificate-public', [
            'code' => $summary['certificate_code'], 'issuedAt' => $summary['issued_at']?->toIso8601String(),
            'valid' => $summary['valid'], 'english' => $english,
            'sealFormat' => $summary['valid'] && is_array($certificate->signed_payload) && in_array($certificate->signed_payload['format_version'] ?? null, [2, 3], true) ? $certificate->signed_payload['format_version'] : null,
        ], $summary['valid'] ? 200 : 409)->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow')->header('Referrer-Policy', 'no-referrer')
            ->header('Content-Security-Policy', "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    }
}
