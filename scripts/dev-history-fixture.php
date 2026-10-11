<?php
// Only the isolated dev application's database. Never use on an installed instance.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (config('database.connections.mysql.database') !== 'inkgroove_dev' || !app()->environment('local')) throw new RuntimeException('Dev database only');
$manifest = storage_path('app/history-benchmark.json');
if (($argv[1] ?? '') === 'integrity') {
    $ids = json_decode(file_get_contents($manifest), true, flags: JSON_THROW_ON_ERROR);
    $document = App\Models\Document::where('owner_id', $ids['user_id'])->findOrFail($ids['document_id']);
    $checked = 0;
    foreach ($document->sessions()->get() as $session) {
        $hash = null; $sequence = 0;
        foreach (App\Models\WritingEvent::where('writing_session_id', $session->id)->orderBy('sequence')->cursor() as $event) {
            $canonical = json_encode(['session' => $session->id, 'sequence' => $event->sequence, 'type' => $event->event_type, 'input' => $event->input_type, 'data' => $event->data, 'after' => $event->after_html, 'elapsed' => $event->elapsed_ms], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $expected = hash_hmac('sha256', ($hash ?? '').$canonical, (string) config('veritas.signing_key'));
            if ($event->sequence !== ++$sequence || $event->previous_hash !== $hash || !hash_equals($event->event_hash, $expected)) throw new RuntimeException('Chain mismatch');
            $hash = $event->event_hash; $checked++;
        }
        if ($session->last_sequence !== $sequence || $session->last_hash !== $hash) throw new RuntimeException('Session head mismatch');
    }
    foreach ($document->versions()->with('certificate')->get() as $version) {
        if (!hash_equals($version->content_hash, hash('sha256', $version->snapshot_html))) throw new RuntimeException('Content seal mismatch');
        $payload = $version->certificate->signed_payload; ksort($payload);
        if (!hash_equals($version->certificate->signature, hash_hmac('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), (string) config('veritas.signing_key')))) throw new RuntimeException('Signature mismatch');
    }
    echo json_encode(['checked_events' => $checked, 'versions' => $document->versions()->count(), 'valid' => true]).PHP_EOL; exit;
}
if (($argv[1] ?? '') === 'outsider') {
    $ids = json_decode(file_get_contents($manifest), true, flags: JSON_THROW_ON_ERROR);
    if (isset($ids['outsider_id'])) throw new RuntimeException('Already exists');
    $outsider = App\Models\User::create(['name' => 'History outsider', 'email' => 'history-benchmark-'.Illuminate\Support\Str::uuid().'@example.test', 'password' => 'Fictitious12345']);
    $ids['outsider_id'] = $outsider->id; $ids['outsider_email'] = $outsider->email;
    file_put_contents($manifest, json_encode($ids)); echo json_encode($ids).PHP_EOL; exit;
}
if (($argv[1] ?? '') === 'clean') {
    $ids = json_decode(file_get_contents($manifest), true, flags: JSON_THROW_ON_ERROR);
    Illuminate\Support\Facades\DB::transaction(function () use ($ids) {
        $user = App\Models\User::findOrFail($ids['user_id']);
        if ($user->email !== $ids['email'] || !str_starts_with($user->email, 'history-benchmark-')) throw new RuntimeException('Identity mismatch');
        Illuminate\Support\Facades\DB::table('sessions')->where('user_id', $user->id)->delete();
        $user->delete();
        if (isset($ids['outsider_id'])) {
            $outsider = App\Models\User::where('email', $ids['outsider_email'])->findOrFail($ids['outsider_id']);
            if (!str_starts_with($outsider->email, 'history-benchmark-')) throw new RuntimeException('Identity mismatch');
            Illuminate\Support\Facades\DB::table('sessions')->where('user_id', $outsider->id)->delete();
            $outsider->delete();
        }
    });
    unlink($manifest); echo json_encode(['cleaned' => $ids]).PHP_EOL; exit;
}
if (file_exists($manifest)) throw new RuntimeException('Clean existing fixture first');
$count = (int) ($argv[1] ?? 2000);
if (!in_array($count, [2000, 25000], true)) throw new RuntimeException('Controlled sizes only');
$ids = Illuminate\Support\Facades\DB::transaction(function () use ($count) {
    $email = 'history-benchmark-'.Illuminate\Support\Str::uuid().'@example.test';
    $user = App\Models\User::create(['name' => 'History benchmark', 'email' => $email, 'password' => 'Fictitious12345']);
    $html = '<p>'.str_repeat('El pingüino llegó. génesis ', $count === 2000 ? 150 : 6).'</p><p></p><p><mark data-origin="paste">Texto pegado</mark> <mark data-origin="paste-edited">revisión</mark></p>';
    $doc = App\Models\Document::create(['owner_id' => $user->id, 'title' => 'History benchmark '.$count, 'content_html' => $html.'<p>'.$count.'</p>']);
    $sessions = []; $sequence = 0; $hash = null; $rows = [];
    for ($i = 1; $i <= $count; $i++) {
        if (($i - 1) % ($count === 2000 ? 1000 : 5000) === 0) {
            $session = App\Models\WritingSession::create(['document_id' => $doc->id, 'user_id' => $user->id]);
            $sessions[] = $session->id; $sequence = 0; $hash = null;
        }
        $sequence++; $after = $html.'<p>'.$i.'</p>'; $type = $sequence === 1 ? 'start' : 'insert';
        $canonical = json_encode(['session' => $session->id, 'sequence' => $sequence, 'type' => $type, 'input' => 'insertText', 'data' => null, 'after' => $after, 'elapsed' => $sequence * 200], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $next = hash_hmac('sha256', ($hash ?? '').$canonical, (string) config('veritas.signing_key'));
        $rows[] = ['writing_session_id' => $session->id, 'sequence' => $sequence, 'event_type' => $type, 'input_type' => 'insertText', 'after_html' => $after, 'elapsed_ms' => $sequence * 200, 'server_received_at' => $count === 2000 ? '2026-10-10 12:00:00' : '2026-10-10 12:00:0'.(count($sessions) - 1), 'previous_hash' => $hash, 'event_hash' => $next]; $hash = $next;
        if (count($rows) === 50 || $i === $count) { Illuminate\Support\Facades\DB::table('writing_events')->insert($rows); $rows = []; }
        if ($i % ($count === 2000 ? 1000 : 5000) === 0) $session->update(['last_sequence' => $sequence, 'last_hash' => $hash]);
    }
    return ['user_id' => $user->id, 'email' => $email, 'document_id' => $doc->id, 'sessions' => $sessions, 'events' => $count];
});
file_put_contents($manifest, json_encode($ids)); chmod($manifest, 0600); echo json_encode($ids).PHP_EOL;
