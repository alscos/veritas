<?php
namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Models\WritingSession;
use App\Support\HistoryWords;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class HistoryPaginationTest extends TestCase
{
    use RefreshDatabase;

    public function test_full_25000_event_history_has_stable_pages_and_lazy_snapshots(): void
    {
        $owner = User::create(['name' => 'Fixture', 'email' => 'pages@example.test', 'password' => 'Fictitious12345']);
        $doc = Document::create(['owner_id' => $owner->id, 'title' => 'Controlled fixture', 'content_html' => '<p>Draft remains</p>']);
        $sessions = [];
        for ($s = 0; $s < 5; $s++) {
            $session = WritingSession::create(['document_id' => $doc->id, 'user_id' => $owner->id]); $sessions[] = $session;
            for ($batch = 0; $batch < 50; $batch++) {
                $rows = [];
                for ($i = 1; $i <= 100; $i++) {
                    $seq = $batch * 100 + $i;
                    $rows[] = ['writing_session_id' => $session->id, 'sequence' => $seq, 'event_type' => $seq === 1 ? 'start' : 'insert', 'input_type' => 'insertText', 'after_html' => '<p>á génesis '.$s.' '.$seq.'</p><p></p>', 'elapsed_ms' => $seq * 200, 'server_received_at' => '2026-10-10 12:00:00', 'event_hash' => hash('sha256', "$s:$seq")];
                }
                DB::table('writing_events')->insert($rows);
            }
        }
        $expected = DB::table('writing_events')->orderBy('server_received_at')->orderBy('sequence')->orderBy('id')->pluck('id')->all();
        $this->actingAs($owner);
        $path = '/api/documents/'.$doc->id.'/timeline';
        $page = $this->getJson($path.'?metadata=1')->assertOk()->assertJsonPath('total', 25000)->json();
        $this->assertArrayNotHasKey('after_html', $page['events'][0]);
        $this->assertSame(4, $page['events'][0]['direct_words']);
        $ids = array_column($page['events'], 'id'); $watermark = $page['before_id'];
        // Append with an earlier timestamp while paging: excluded by the watermark.
        $newId = DB::table('writing_events')->insertGetId(['writing_session_id' => $sessions[0]->id, 'sequence' => 5001, 'event_type' => 'save', 'after_html' => '<p>New</p>', 'elapsed_ms' => 1000200, 'server_received_at' => '2026-10-09 12:00:00', 'event_hash' => str_repeat('a',64)]);
        while ($page['next_cursor']) {
            $query = http_build_query(['metadata' => 1, 'before_id' => $watermark, 'cursor' => $page['next_cursor']]);
            $page = $this->getJson($path.'?'.$query)->assertOk()->assertJsonPath('total', 25000)->json();
            $ids = array_merge($ids, array_column($page['events'], 'id'));
        }
        $this->assertSame($expected, $ids);
        $this->assertCount(25000, array_unique($ids));
        foreach ([0, 12499, 24999] as $index) {
            $this->getJson($path.'?event_id='.$ids[$index])->assertOk()->assertJsonPath('events.0.id', $ids[$index]);
        }
        $query = http_build_query(['snapshot_ids' => array_slice($ids, 12499, 32)]);
        $this->getJson($path.'?'.$query)->assertOk()->assertJsonCount(32, 'events');
        $this->getJson($path.'?metadata=1')->assertOk()->assertJsonPath('total', 25001)->assertJsonPath('events.0.id', $newId);
        $this->getJson($path.'?cursor=invalid')->assertUnprocessable();
        $this->assertSame('<p>Draft remains</p>', $doc->fresh()->content_html);
        $this->assertSame(hash('sha256', '0:1'), DB::table('writing_events')->where('id', $ids[0])->value('event_hash'));
        $other = User::create(['name' => 'Other', 'email' => 'pages-other@example.test', 'password' => 'Fictitious12345']);
        $foreign = Document::create(['owner_id' => $other->id, 'title' => 'Other']);
        $this->getJson('/api/documents/'.$foreign->id.'/timeline?event_id='.$ids[0])->assertNotFound();
        $this->actingAs($other)->getJson($path.'?metadata=1')->assertNotFound();
        $this->getJson($path.'?'.$query)->assertNotFound();
    }

    public function test_word_counts_follow_editor_provenance_and_unicode_rules(): void
    {
        $this->assertSame(3, HistoryWords::direct('<p>á génesis pingüino</p><p></p><p><mark data-origin="paste">texto</mark><mark data-origin="paste-edited">revisado</mark></p>'));
        $this->assertSame(0, HistoryWords::direct('<p>dire<mark data-origin="paste">cto</mark></p>'));
        $this->assertSame(4, HistoryWords::direct('<p>uno<br>dos</p><p>𐐀 tres</p>'));
    }
}
