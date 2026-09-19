<?php

namespace App\Http\Controllers;

use App\Models\DocumentVersion;
use App\Models\Submission;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SubmissionController
{
    public function index(Request $request): JsonResponse
    {
        $sent = Submission::query()->where('sender_id', $request->user()->id)->latest('submitted_at')->get();
        $received = Submission::query()->where('recipient_user_id', $request->user()->id)->latest('submitted_at')->get();
        return response()->json(['sent' => $sent, 'received' => $received]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'document_version_id' => ['required', 'uuid', 'exists:document_versions,id'],
            'recipient_email' => ['required_without:assignment_id', 'nullable', 'email:rfc', 'max:255'],
            'assignment_id' => ['nullable', 'uuid', 'exists:assignments,id'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);
        $version = DocumentVersion::query()->with('document')->findOrFail($data['document_version_id']);
        abort_unless($version->document->owner_id === $request->user()->id, 404);
        $recipient = isset($data['recipient_email']) ? User::query()->where('email', mb_strtolower($data['recipient_email']))->first() : null;
        abort_if($recipient?->id === $request->user()->id, 422, 'No puedes entregarte un documento a ti mismo.');
        $submission = Submission::create([
            'document_version_id' => $version->id,
            'sender_id' => $request->user()->id,
            'recipient_user_id' => $recipient?->id,
            'recipient_email' => isset($data['recipient_email']) ? mb_strtolower($data['recipient_email']) : null,
            'assignment_id' => $data['assignment_id'] ?? null,
            'note' => $data['note'] ?? null,
            'submitted_at' => now(),
        ]);
        return response()->json(['submission' => $submission], 201);
    }
}
