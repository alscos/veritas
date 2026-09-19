<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Support\DocumentSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentController
{
    public function index(Request $request): JsonResponse
    {
        $documents = Document::query()
            ->where('owner_id', $request->user()->id)
            ->withCount(['versions', 'sessions'])
            ->latest('updated_at')
            ->get();
        return response()->json(['documents' => $documents]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['title' => ['nullable', 'string', 'max:180']]);
        $document = Document::create([
            'owner_id' => $request->user()->id,
            'title' => trim($data['title'] ?? '') ?: 'Documento sin título',
        ]);
        return response()->json(['document' => $document->loadCount(['versions', 'sessions'])], 201);
    }

    public function show(Request $request, Document $document): JsonResponse
    {
        abort_unless($document->owner_id === $request->user()->id, 404);
        return response()->json(['document' => $document->load(['versions.certificate'])->loadCount(['versions', 'sessions'])]);
    }

    public function update(Request $request, Document $document): JsonResponse
    {
        abort_unless($document->owner_id === $request->user()->id, 404);
        $data = $request->validate([
            'title' => ['sometimes', 'nullable', 'string', 'max:180'],
            'content_html' => ['sometimes', 'nullable', 'string', 'max:'.config('veritas.max_document_bytes')],
        ]);
        if (array_key_exists('title', $data)) $document->title = trim((string) ($data['title'] ?? '')) ?: 'Documento sin título';
        if (array_key_exists('content_html', $data)) {
            $document->content_html = DocumentSanitizer::html((string) ($data['content_html'] ?? ''));
            $document->content_text = DocumentSanitizer::text($document->content_html);
            $document->word_count = DocumentSanitizer::wordCount($document->content_text);
            $document->last_session_at = now();
        }
        $document->save();
        return response()->json(['document' => $document]);
    }
}
