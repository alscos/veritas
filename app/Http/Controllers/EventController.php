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
            $document = Document::query()->lockForUpdate()->findOrFail($document->id);
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
                if (!in_array($event['event_type'], self::TYPES, true)) abort(422, __('inkgroove.event_type'));
                $afterHtml = DocumentSanitizer::html((string) ($event['after_html'] ?? ''));
                DocumentSanitizer::validateImages($afterHtml, $document->id);
                $requestHash = hash('sha256', json_encode([
                    $event['event_type'], $event['input_type'] ?? null, $event['data'] ?? null,
                    $event['after_html'], (int) $event['elapsed_ms'], $event['created_at'] ?? null,
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                if ($event['sequence'] <= $lastSequence) {
                    $existing = WritingEvent::where('writing_session_id', $session->id)->where('sequence', $event['sequence'])->firstOrFail();
                    abort_if($existing->request_hash !== null && !hash_equals($existing->request_hash, $requestHash), 409, __('inkgroove.event_mismatch'));
                    abort_unless($existing->event_type === $event['event_type']
                        && $existing->input_type === ($event['input_type'] ?? null)
                        && $existing->data === ($event['data'] ?? null)
                        && $existing->after_html === $afterHtml
                        && (int) $existing->elapsed_ms === (int) $event['elapsed_ms'], 409, __('inkgroove.event_mismatch'));
                    continue;
                }
                if ($event['sequence'] !== $lastSequence + 1) abort(409, __('inkgroove.event_sequence'));
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
                    'request_hash' => $requestHash,
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
        $version = \App\Support\VersionAccess::resolve($request, $document);
        $boundary = $version ? \App\Support\VersionAccess::boundary($version) : null;
        abort_if($version && $boundary === null, 409, __('inkgroove.legacy_history'));
        $data = $request->validate([
            'limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'before_id' => ['required_with:cursor', 'integer', 'min:0'],
            'cursor' => ['sometimes', 'string', 'max:512'],
            'metadata' => ['sometimes', 'boolean'],
            'event_id' => ['sometimes', 'integer', 'min:1'],
            'snapshot_ids' => ['sometimes', 'array', 'min:1', 'max:32'],
            'snapshot_ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $sessions = WritingSession::query()->where('document_id', $document->id)->orderBy('created_at')->orderBy('id')->get();
        $base = WritingEvent::query()->whereIn('writing_session_id', $sessions->pluck('id'));
        if ($boundary !== null) {
            $base->where(function ($q) use ($boundary) {
                $q->whereRaw('1 = 0');
                foreach ($boundary as $id => $head) $q->orWhere(fn ($q) => $q->where('writing_session_id', $id)->where('sequence', '<=', $head['sequence'])->where('id', '<=', $head['event_id']));
            });
            // Live session rows contain later heads and timestamps. Never serialize them.
            $sessions = collect($boundary)->map(fn ($head, $id) => ['id' => $id, 'last_sequence' => $head['sequence'], 'last_hash' => $head['hash']])->values();
        }
        if (isset($data['snapshot_ids'])) {
            $snapshots = $base->whereIn('id', $data['snapshot_ids'])->get();
            abort_unless($snapshots->count() === count($data['snapshot_ids']), 404);
            return response()->json(['events' => $snapshots]);
        }
        if (isset($data['event_id'])) {
            return response()->json(['events' => [$base->whereKey($data['event_id'])->firstOrFail()]]);
        }
        // A fixed high-water mark excludes concurrent appends, including backdated events.
        $watermark = (int) ($data['before_id'] ?? (clone $base)->max('id') ?? 0);
        $base->where('id', '<=', $watermark);
        $total = (clone $base)->count();
        if (isset($data['cursor'])) {
            try {
                $cursor = json_decode(base64_decode($data['cursor'], true) ?: '', true, flags: JSON_THROW_ON_ERROR);
            } catch (\Throwable) { abort(422, 'Invalid history cursor'); }
            abort_unless(is_array($cursor) && count($cursor) === 3 && is_string($cursor[0]) && is_int($cursor[1]) && is_int($cursor[2]), 422);
            [$time, $sequence, $id] = $cursor;
            $base->where(function ($q) use ($time, $sequence, $id) {
                $q->where('server_received_at', '>', $time)
                    ->orWhere(fn ($q) => $q->where('server_received_at', $time)->where('sequence', '>', $sequence))
                    ->orWhere(fn ($q) => $q->where('server_received_at', $time)->where('sequence', $sequence)->where('id', '>', $id));
            });
        }
        $metadata = $request->boolean('metadata');
        $limit = min((int) ($data['limit'] ?? ($metadata ? 1000 : 50)), $metadata ? 1000 : 100);
        if ($metadata) $base->select(['id', 'writing_session_id', 'sequence', 'event_type', 'input_type', 'elapsed_ms', 'server_received_at', 'after_html']);
        $payload = []; $last = null; $more = false; $snapshotBytes = 0;
        // PDO normally buffers MySQL results, including every HTML snapshot.
        // Disable buffering only on this request's connection during this read.
        $connection = DB::connection();
        $pdo = $connection->getPdo();
        $buffered = $connection->getDriverName() === 'mysql' ? $pdo->getAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY) : null;
        if ($buffered !== null) $pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        try {
            foreach ($base->orderBy('server_received_at')->orderBy('sequence')->orderBy('id')->limit($limit + 1)->cursor() as $event) {
                if (count($payload) >= $limit || (!$metadata && $snapshotBytes + strlen($event->after_html) > 2_000_000 && count($payload))) { $more = true; break; }
                $snapshotBytes += strlen($event->after_html);
                $payload[] = $metadata ? [
                    'id' => $event->id, 'writing_session_id' => $event->writing_session_id,
                    'sequence' => $event->sequence, 'event_type' => $event->event_type,
                    'input_type' => $event->input_type, 'elapsed_ms' => $event->elapsed_ms,
                    'server_received_at' => $event->server_received_at,
                    'direct_words' => \App\Support\HistoryWords::direct($event->after_html),
                ] : $event;
                $last = $event;
            }
        } finally {
            if ($buffered !== null) $pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $buffered);
        }
        $next = $more && $last ? base64_encode(json_encode([$last->getRawOriginal('server_received_at'), $last->sequence, $last->id], JSON_THROW_ON_ERROR)) : null;
        return response()->json(['sessions' => $request->has('cursor') ? [] : $sessions, 'events' => $payload, 'total' => $total, 'before_id' => $watermark, 'next_cursor' => $next]);
    }
}
