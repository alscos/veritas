<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Models\DocumentImage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class ImageController
{
    public function store(Request $request, Document $document): JsonResponse
    {
        abort_unless($document->owner_id === $request->user()->id, 404);
        $request->validate(['image' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp,gif', 'max:5120', 'dimensions:min_width=1,min_height=1,max_width=12000,max_height=12000']]);
        $file = $request->file('image');
        [$width, $height] = getimagesize($file->getRealPath());
        abort_if($width * $height > 40_000_000, 422, __('inkgroove.image_pixels'));
        abort_if($document->images()->count() >= 100, 422, __('inkgroove.image_limit'));
        $mime = $file->getMimeType();
        $extension = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'][$mime] ?? null;
        abort_unless($extension, 422, __('inkgroove.image_format'));
        $id = (string) Str::uuid();
        $filename = $id.'.'.$extension;
        $directory = (string) config('veritas.media_path');
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) abort(500, __('inkgroove.image_storage'));
        $sha256 = hash_file('sha256', $file->getRealPath());
        $bytes = $file->getSize();
        $file->move($directory, $filename);
        try {
            $image = DocumentImage::create(compact('id', 'filename', 'mime', 'width', 'height', 'bytes', 'sha256') + ['document_id' => $document->id]);
        } catch (\Throwable $error) {
            @unlink($directory.'/'.$filename);
            throw $error;
        }
        return response()->json(['image' => $image, 'src' => $image->url()], 201);
    }

    public function show(Request $request, Document $document, DocumentImage $image): BinaryFileResponse
    {
        abort_unless($image->document_id === $document->id, 404);
        $mayRead = $document->owner_id === $request->user()->id || DB::table('submissions')
            ->join('document_versions', 'document_versions.id', '=', 'submissions.document_version_id')
            ->where('document_versions.document_id', $document->id)
            ->where('submissions.recipient_user_id', $request->user()->id)
            ->where('document_versions.snapshot_html', 'like', '%'.$image->url().'%')->exists();
        abort_unless($mayRead && is_file($image->path()), 404);
        return response()->file($image->path(), [
            'Content-Type' => $image->mime,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'ETag' => '"'.$image->sha256.'"',
        ]);
    }
}
