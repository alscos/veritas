<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Support\DocumentSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

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
        $data = $request->validate([
            'title' => ['nullable', 'string', 'max:180'],
            'folder_id' => ['nullable', 'uuid', Rule::exists('document_folders', 'id')->where('owner_id', $request->user()->id)],
        ]);
        $document = Document::create([
            'owner_id' => $request->user()->id,
            'title' => trim($data['title'] ?? '') ?: __('inkgroove.untitled'),
            'folder_id' => $data['folder_id'] ?? null,
        ]);
        // Reload database defaults such as content_html before serializing the
        // new document. Otherwise an empty document reaches the client without
        // those attributes and `undefined` can become literal editor content.
        $document->refresh();
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
            'folder_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('document_folders', 'id')->where('owner_id', $request->user()->id)],
            'page_settings' => ['sometimes', 'array:format,orientation,margin'],
            'page_settings.format' => ['required_with:page_settings', Rule::in(['a4', 'a5', 'letter', 'legal'])],
            'page_settings.orientation' => ['required_with:page_settings', Rule::in(['portrait', 'landscape'])],
            'page_settings.margin' => ['required_with:page_settings', 'integer', Rule::in([15, 20, 25, 30])],
        ]);
        if (array_key_exists('folder_id', $data)) $document->folder_id = $data['folder_id'];
        if (array_key_exists('page_settings', $data)) $document->page_settings = $data['page_settings'];
        if (array_key_exists('title', $data)) $document->title = trim((string) ($data['title'] ?? '')) ?: __('inkgroove.untitled');
        if (array_key_exists('content_html', $data)) {
            $document->content_html = DocumentSanitizer::html((string) ($data['content_html'] ?? ''));
            DocumentSanitizer::validateImages($document->content_html, $document->id);
            $document->content_text = DocumentSanitizer::text($document->content_html);
            $document->word_count = DocumentSanitizer::wordCount($document->content_text);
            $document->last_session_at = now();
        }
        $document->save();
        return response()->json(['document' => $document]);
    }

    public function destroy(Request $request, Document $document): JsonResponse
    {
        abort_unless($document->owner_id === $request->user()->id, 404);

        $hasSubmissions = DB::table('submissions')
            ->join('document_versions', 'document_versions.id', '=', 'submissions.document_version_id')
            ->where('document_versions.document_id', $document->id)
            ->exists();

        abort_if($hasSubmissions, 409, __('inkgroove.submitted_document'));

        $paths = $document->images()->get()->map(fn ($image) => $image->path());
        $document->delete();
        foreach ($paths as $path) if (is_file($path)) @unlink($path);

        return response()->json(['deleted' => true]);
    }
}
