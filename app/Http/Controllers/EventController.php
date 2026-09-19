<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Models\WritingEvent;
use App\Models\WritingSession;
use App\Support\DocumentSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EventController
{
    private const TYPES = ['start', 'insert', 'delete', 'paste', 'paste_edit', 'format', 'focus', 'blur', 'save'];

    public function store(Request $request, Document $document): JsonResponse
    {
        abort_unless($document->owner_id === $request->user()->id, 404);
        $data = $request->validate([
            'session_id' => ['required', 'uuid'],
            'started_at' => ['nullable', 'date'],
            'events' => ['required', 'array', 'max:'.config('veritas.max_event_batch')],
            'events.*.sequence' => ['required', 'integer', 'min:1'],
            'events.*.event_type' => ['required', 'string'],
            'events.*.input_type' => ['nullable', 'string', 'max:64'],
            'events.*.data' => ['nullable', 'string', 'max:'.config('veritas.max_event_data_bytes')],
            'events.*.after_html' => ['present', 'nullable', 'string', 'max:'.config('veritas.max_document_bytes')],
            'events.*.elapsed_ms' => ['required', 'integer', 'min:0'],
            'events.*.created_at' => ['nullable', 'date'],
        ]);

        $accepted = DB::transaction(function () use ($request, $document, $data): int {
            $session = WritingSession::query()->lockForUpdate()->find($data['session_id']);
            if (!$session) {
                $session = WritingSession::create([
                    'id' => $data['session_id'],
                    'document_id' => $document->id,
                    'user_id' => $request->user()->id,
                    'client_started_at' => $data['started_at'] ?? now(),
                ]);
            }
            abort_unless($session->document_id === $document->id && $session->user_id === $request->user()->id, 403);

            $lastSequence = $session->last_sequence;
            $lastHash = $session->last_hash;
            $accepted = 0;
            foreach ($data['events'] as $event) {
                if (!in_array($event['event_type'], self::TYPES, true)) abort(422, 'Tipo de evento no válido.');
                if ($event['sequence'] <= $lastSequence) continue;
                if ($event['sequence'] !== $lastSequence + 1) abort(409, 'La secuencia de eventos está incompleta.');
                $afterHtml = DocumentSanitizer::html((string) ($event['after_html'] ?? ''));
                $canonical = json_encode([
                    'session' => $session->id,
                    'sequence' => $event['sequence'],
                    'type' => $event['event_type'],
                    'input' => $event['input_type'] ?? null,
                    'data' => $event['data'] ?? null,
                    'after' => $afterHtml,
                    'elapsed' => $event['elapsed_ms'],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                $eventHash = hash_hmac('sha256', ($lastHash ?? '').$canonical, (string) config('veritas.signing_key'));
                WritingEvent::create([
                    'writing_session_id' => $session->id,
                    'sequence' => $event['sequence'],
                    'event_type' => $event['event_type'],
                    'input_type' => $event['input_type'] ?? null,
                    'data' => $event['data'] ?? null,
                    'after_html' => $afterHtml,
                    'elapsed_ms' => $event['elapsed_ms'],
                    'client_created_at' => $event['created_at'] ?? null,
                    'server_received_at' => now(),
                    'previous_hash' => $lastHash,
                    'event_hash' => $eventHash,
                ]);
                $lastSequence = $event['sequence'];
                $lastHash = $eventHash;
                $accepted++;
            }
            $session->update(['last_sequence' => $lastSequence, 'last_hash' => $lastHash, 'ended_at' => now()]);
            return $accepted;
        });

        return response()->json(['accepted' => $accepted]);
    }

    public function timeline(Request $request, Document $document): JsonResponse
    {
        $mayRead = $document->owner_id === $request->user()->id || DB::table('submissions')
            ->join('document_versions', 'document_versions.id', '=', 'submissions.document_version_id')
            ->where('document_versions.document_id', $document->id)
            ->where('submissions.recipient_user_id', $request->user()->id)
            ->exists();
        abort_unless($mayRead, 404);
        $sessions = WritingSession::query()->where('document_id', $document->id)->orderBy('created_at')->get();
        $events = WritingEvent::query()->whereIn('writing_session_id', $sessions->pluck('id'))->orderBy('server_received_at')->orderBy('sequence')->limit(10_000)->get();
        return response()->json(['sessions' => $sessions, 'events' => $events]);
    }
}
