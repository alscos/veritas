<?php

namespace App\Http\Controllers;

use App\Models\{Certificate, Document, DocumentImage, DocumentVersion, User};
use App\Support\{PublicCertificate, VersionAccess};
use Illuminate\Http\{JsonResponse, Request};
use Illuminate\Support\Facades\DB;

final class VersionPdfController
{
    /** Authenticated PDF source. No draft/event/account is read; title is a current document label. */
    public function source(Request $request, string $document, string $version): JsonResponse
    {
        $doc = Document::query()->select(['id', 'owner_id'])->findOrFail($document);
        VersionAccess::exact($request, $doc, $version);
        $isOwner = (int)$request->user()->id === (int)$doc->owner_id;
        $response = $this->buildSource($document, $version, $isOwner);
        if ($isOwner) {
            $summary = app(\App\Support\HistoricalVersionSummary::class)->summarize($request->user(), $document, $version);
            $data = $response->getData(true);
            $data['historical_counts'] = $summary['counts'];
            $response->setData($data);
        }
        return $response;
    }

    /** Internal Gate primitive, never routed; authorization rechecked by Gate after encoding. */
    public function ownedSource(User $owner, string $document, string $version): JsonResponse
    {
        abort_unless($owner->exists && Document::whereKey($document)->where('owner_id',$owner->id)->exists()
            && DocumentVersion::whereKey($version)->where('document_id',$document)->whereNotNull('sealed_at')->exists(),404);
        return $this->buildSource($document,$version);
    }

    private function buildSource(string $document, string $version, bool $ownerTitle = false): JsonResponse
    {
        return DB::transaction(function () use ($document, $version, $ownerTitle): JsonResponse {
            $length = fn ($column) => DB::connection()->getDriverName() === 'sqlite' ? "length(CAST($column AS BLOB))" : "OCTET_LENGTH($column)";
            $size = DB::table('document_versions')->where('id', $version)->selectRaw($length('snapshot_html').' + COALESCE('.$length('page_settings').',0) AS bytes')->first();
            abort_if(!$size || (int) $size->bytes > 250000, 413, __('inkgroove.pdf_unavailable'));
            $size = DB::table('certificates')->where('document_version_id', $version)->selectRaw($length('signed_payload').' AS bytes')->first();
            abort_unless($size, 404);
            abort_if((int) $size->bytes > 262144, 413, __('inkgroove.pdf_unavailable'));
            $v = DocumentVersion::query()->select(['id','document_id','version_number','snapshot_html','content_hash','page_settings','sealed_at'])->findOrFail($version);
            $c = Certificate::where('document_version_id', $version)->firstOrFail();
            $p = $c->signed_payload;
            abort_unless(PublicCertificate::valid($c) && in_array($p['format_version'] ?? 1, [1, 2, 3], true) && ($p['version_id'] ?? null) === $v->id
                && ($p['document_id'] ?? null) === $document
                && ($p['content_hash'] ?? null) === $v->content_hash
                && hash('sha256', $v->snapshot_html) === $v->content_hash
                && ($p['version'] ?? null) === (int) $v->version_number
                && ($p['page_settings'] ?? null) === $v->page_settings
                && ($p['sealed_at'] ?? null) === $v->sealed_at?->toIso8601String()
                && $c->issued_at?->toIso8601String() === $v->sealed_at?->toIso8601String(), 409, __('inkgroove.pdf_unavailable'));
            $url = PublicCertificate::url($c->certificate_code);
            $dom = new \DOMDocument('1.0', 'UTF-8');
            $previous = libxml_use_internal_errors(true);
            try { $dom->loadHTML('<?xml encoding="UTF-8"><div>'.$v->snapshot_html.'</div>', LIBXML_NONET); }
            finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
            abort_if($dom->getElementsByTagName('*')->length > 5000, 413, __('inkgroove.pdf_unavailable'));
            // Match the existing scoped v3 image gate; a payload HMAC alone is insufficient.
            if (($p['format_version'] ?? null) === 3 && $dom->getElementsByTagName('img')->length > 0) {
                $v->setRelation('certificate', $c);
                abort_unless(VersionAccess::boundary($v) !== null, 409, __('inkgroove.pdf_unavailable'));
            }
            $images = []; $total = 0; $pixels = 0;
            foreach ($dom->getElementsByTagName('img') as $node) {
                $src = $node->getAttribute('src');
                if (isset($images[$src])) continue;
                abort_unless(preg_match('~^/api/documents/'.preg_quote($document, '~').'/images/([a-f0-9-]{36})$~D', $src, $match), 409, __('inkgroove.pdf_unavailable'));
                abort_if(count($images) >= 50, 413, __('inkgroove.pdf_unavailable'));
                $image = DocumentImage::where('document_id', $document)->findOrFail($match[1]);
                abort_unless(str_contains($v->snapshot_html, $image->url()), 409, __('inkgroove.pdf_unavailable'));
                $path = $image->path();
                $root = realpath((string) config('veritas.media_path'));
                $real = realpath($path);
                abort_unless($root && $real && str_starts_with($real, $root.DIRECTORY_SEPARATOR) && is_file($real), 409, __('inkgroove.pdf_unavailable'));
                $bytes = @filesize($real);
                abort_unless($bytes !== false, 409, __('inkgroove.pdf_unavailable'));
                $total += $bytes;
                abort_if($bytes > 5 * 1024 * 1024 || $total > 8 * 1024 * 1024, 413, __('inkgroove.pdf_unavailable'));
                $data = @file_get_contents($real);
                abort_unless(is_string($data), 409, __('inkgroove.pdf_unavailable'));
                $hash = hash('sha256', $data);
                // Never substitute an image from a later mutable state or unsigned historical bytes.
                abort_unless(is_array($p['images'] ?? null) && ($p['images'][$image->id] ?? null) === $hash
                    && $image->sha256 === $hash, 409, __('inkgroove.pdf_unavailable'));
                $info = @getimagesizefromstring($data);
                abort_unless($info && in_array($info['mime'], ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], true)
                    && $info[0] * $info[1] <= 12000000, 409, __('inkgroove.pdf_unavailable'));
                $pixels += $info[0] * $info[1];
                abort_if($pixels > 20000000, 413, __('inkgroove.pdf_unavailable'));
                $images[$src] = 'data:'.$info['mime'].';base64,'.base64_encode($data);
            }
            return response()->json([
                'document_title' => $ownerTitle ? Document::whereKey($document)->value('title') : null,
                'version_id' => $v->id, 'version_number' => $v->version_number,
                'snapshot_html' => $v->snapshot_html, 'page_settings' => $v->page_settings,
                'certificate_code' => $c->certificate_code, 'issued_at' => $c->issued_at?->toIso8601String(),
                'format_version' => in_array($p['format_version'] ?? null, [2, 3], true) ? $p['format_version'] : null,
                'public_url' => $url, 'images' => (object) $images,
            ])->header('Cache-Control', 'private, no-store')->header('X-Content-Type-Options', 'nosniff');
        });
    }
}
