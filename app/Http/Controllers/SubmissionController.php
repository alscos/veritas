<?php

namespace App\Http\Controllers;

use App\Models\DocumentVersion;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Collection;
use App\Models\Submission;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class SubmissionController
{
    public function index(Request $request): JsonResponse
    {
        $sent = Submission::query()->where('sender_id', $request->user()->id)->latest('submitted_at')->get();
        $received = Submission::query()->where('recipient_user_id', $request->user()->id)->latest('submitted_at')->get();
        $identities = $this->identities($sent->concat($received));
        return response()->json(['sent' => $sent->map(fn ($row) => $this->present($row, $identities)), 'received' => $received->map(fn ($row) => $this->present($row, $identities))]);
    }

    public function show(Request $request, Submission $submission): JsonResponse
    {
        abort_unless($submission->sender_id === $request->user()->id || $submission->recipient_user_id === $request->user()->id, 404);
        $version = DocumentVersion::query()->with('certificate')->findOrFail($submission->document_version_id);
        return response()->json(['submission' => $this->present($submission, $this->identities(collect([$submission]))), 'version' => $version, 'history_available' => \App\Support\VersionAccess::boundary($version) !== null, 'history_notice' => \App\Support\VersionAccess::boundary($version) === null ? __('inkgroove.legacy_history') : null]);
    }

    /** Only account presentation metadata; never load the mutable document body. */
    private function identities(Collection $rows): array
    {
        $owners = DB::table('document_versions as v')->join('documents as d', 'd.id', '=', 'v.document_id')
            ->whereIn('v.id', $rows->pluck('document_version_id')->unique())
            ->pluck('d.owner_id', 'v.id');
        $senders = User::query()->select(['id', 'name', 'email'])
            ->whereIn('id', $rows->pluck('sender_id')->unique())->get()->keyBy('id');
        return ['owners' => $owners, 'senders' => $senders];
    }

    private function present(Submission $submission, array $identities): array
    {
        $sender = $identities['senders']->get($submission->sender_id);
        $name = trim($sender?->name ?? '');
        $email = trim($sender?->email ?? '');
        $senderIdentity = $sender
            ? ['id' => $sender->id, 'kind' => $name !== '' ? 'name' : ($email !== '' ? 'email' : 'account'), 'value' => $name !== '' ? $name : ($email !== '' ? $email : null)]
            : ['id' => null, 'kind' => 'unavailable', 'value' => null];
        $owner = $identities['owners']->get($submission->document_version_id);
        // No sharing preference exists for a different owner's profile.
        $creator = $owner === null ? ['id' => null, 'kind' => 'unavailable', 'value' => null]
            : ((int) $owner === $submission->sender_id ? $senderIdentity
                : ['id' => (int) $owner, 'kind' => 'restricted', 'value' => null]);
        return array_merge($submission->attributesToArray(), ['creator_account' => $creator, 'sender_account' => $senderIdentity]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'document_version_id' => ['required', 'uuid'],
            'recipient_email' => ['required_without:assignment_id', 'nullable', 'email:rfc', 'max:255'],
            'assignment_id' => ['nullable', 'uuid', 'exists:assignments,id'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);
        $version = DocumentVersion::query()->with('document')->whereHas('document', fn ($q) => $q->where('owner_id', $request->user()->id))->findOrFail($data['document_version_id']);
        abort_unless($version->document->owner_id === $request->user()->id, 404);
        $recipient = isset($data['recipient_email']) ? User::query()->where('email', mb_strtolower($data['recipient_email']))->first() : null;
        if (empty($data['assignment_id']) && !$recipient) {
            throw ValidationException::withMessages(['recipient_email' => __('inkgroove.recipient_account_required')]);
        }
        abort_if($recipient?->id === $request->user()->id, 422, __('inkgroove.self_submission'));
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
