<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Models\WritingSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class TimelineTransportTest extends TestCase
{
    use RefreshDatabase;

    public function test_small_history_does_not_pay_compression_cost(): void
    {
        $user = User::create(['name' => 'Author', 'email' => 'small@example.test', 'password' => 'test-password-123']);
        $document = Document::create(['owner_id' => $user->id, 'title' => 'Empty']);
        $this->actingAs($user)->getJson('/api/documents/'.$document->id.'/timeline', ['Accept-Encoding' => 'gzip'])
            ->assertOk()->assertHeaderMissing('Content-Encoding')->assertJsonPath('events', [])
            ->assertHeader('Vary', 'Accept-Encoding');
    }

    public function test_representative_history_transport(): void
    {
        $user = User::create(['name' => 'Benchmark', 'email' => 'benchmark@example.test', 'password' => 'test-password-123']);
        $document = Document::create(['owner_id' => $user->id, 'title' => 'Synthetic history']);
        $session = WritingSession::create(['document_id' => $document->id, 'user_id' => $user->id]);
        $html = '<p>'.str_repeat('El pingüino llegó. génesis ', 150).'</p><p></p><p><mark data-origin="paste">Texto pegado</mark> <mark data-origin="paste-edited">revisión</mark></p>';
        $rows = [];
        for ($index = 1; $index <= 2000; $index++) {
            $rows[] = ['writing_session_id' => $session->id, 'sequence' => $index, 'event_type' => 'insert', 'input_type' => 'insertText', 'after_html' => $html.'<p>'.$index.'</p>', 'elapsed_ms' => $index * 200, 'server_received_at' => '2026-10-10 12:00:00', 'event_hash' => hash('sha256', (string) $index)];
            if (count($rows) === 50) { DB::table('writing_events')->insert($rows); $rows = []; }
        }
        $this->actingAs($user);
        $path = '/api/documents/'.$document->id.'/timeline?limit=100';
        $samples = [];
        for ($run = 0; $run < 5; $run++) {
            DB::enableQueryLog(); DB::flushQueryLog();
            $start = hrtime(true);
            $response = $this->getJson($path)->assertOk();
            $ms = (hrtime(true) - $start) / 1e6;
            $queryMs = array_sum(array_column(DB::getQueryLog(), 'time'));
            DB::disableQueryLog();
            $body = $response->getContent();
            $compressionStart = hrtime(true); $compressed = gzencode($body, 1);
            $samples[] = ['request_ms' => round($ms, 2), 'sql_ms' => round($queryMs, 2), 'gzip_ms' => round((hrtime(true) - $compressionStart) / 1e6, 2)];
        }
        $this->assertCount(100, $response->json('events'));
        $this->assertSame($html.'<p>100</p>', $response->json('events.99.after_html'));
        $gzipSamples = [];
        for ($run = 0; $run < 5; $run++) {
            $start = hrtime(true);
            $encoded = $this->getJson($path, ['Accept-Encoding' => 'gzip'])->assertOk()->assertHeader('Content-Encoding', 'gzip');
            $gzipSamples[] = round((hrtime(true) - $start) / 1e6, 2);
            $this->assertSame($body, gzdecode($encoded->getContent()));
        }
        $encoded->assertHeader('Vary', 'Accept-Encoding');
        $this->assertStringContainsString('no-store', $encoded->headers->get('Cache-Control'));
        $this->getJson($path, ['Accept-Encoding' => 'gzip;q=0, identity;q=1'])->assertOk()->assertHeaderMissing('Content-Encoding');
        $this->getJson($path, ['Accept-Encoding' => 'br'])->assertOk()->assertHeaderMissing('Content-Encoding');
        $this->assertDatabaseCount('writing_events', 2000);
        $this->actingAs(User::create(['name' => 'Other', 'email' => 'other@example.test', 'password' => 'test-password-123']))
            ->getJson($path, ['Accept-Encoding' => 'gzip'])->assertNotFound()->assertHeaderMissing('Content-Encoding');
        if (getenv('INKGROOVE_BENCHMARK')) fwrite(STDOUT, json_encode(['events' => 2000, 'json_bytes' => strlen($body), 'gzip_bytes' => strlen($compressed), 'samples' => $samples, 'gzip_request_ms' => $gzipSamples]).PHP_EOL);
    }
}
