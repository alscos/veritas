<?php

namespace App\Http\Controllers;

use App\Models\DocumentFolder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FolderController
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['folders' => DocumentFolder::where('owner_id', $request->user()->id)->withCount('documents')->orderBy('name')->get()]);
    }
    public function store(Request $request): JsonResponse
    {
        if (is_string($request->input('name'))) $request->merge(['name' => trim($request->input('name'))]);
        $data = $request->validate(['name' => ['required', 'string', 'max:100', Rule::unique('document_folders')->where('owner_id', $request->user()->id)]]);
        $name = trim($data['name']);
        abort_if($name === '', 422, __('inkgroove.folder_name'));
        $folder = DocumentFolder::create(['owner_id' => $request->user()->id, 'name' => $name]);
        return response()->json(['folder' => $folder->loadCount('documents')], 201);
    }
    public function update(Request $request, DocumentFolder $folder): JsonResponse
    {
        abort_unless($folder->owner_id === $request->user()->id, 404);
        if (is_string($request->input('name'))) $request->merge(['name' => trim($request->input('name'))]);
        $data = $request->validate(['name' => ['required', 'string', 'max:100', Rule::unique('document_folders')->where('owner_id', $request->user()->id)->ignore($folder->id)]]);
        $name = trim($data['name']);
        abort_if($name === '', 422, __('inkgroove.folder_name'));
        $folder->update(['name' => $name]);
        return response()->json(['folder' => $folder->loadCount('documents')]);
    }
    public function destroy(Request $request, DocumentFolder $folder): JsonResponse
    {
        abort_unless($folder->owner_id === $request->user()->id, 404);
        $folder->delete(); // Documents return to the unfiled collection via the FK.
        return response()->json(['deleted' => true]);
    }
}
