<?php
namespace Tests\Feature;
use App\Models\{User, Document, WritingEvent};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;
class DocumentConcurrencyTest extends TestCase
{
    use RefreshDatabase;
    public function test_same_second_stale_and_missing_revision_never_overwrite(): void
    {
        $this->freezeTime();
        $a=User::create(['name'=>'A','email'=>'concurrency@example.test','password'=>'Fictitious12345']);
        $doc=Document::create(['owner_id'=>$a->id]); $path='/api/documents/'.$doc->id;
        $this->actingAs($a);
        $this->patchJson($path,['revision'=>0,'content_html'=>'<p>First</p>'])->assertOk()->assertJsonPath('document.revision',1);
        $this->patchJson($path,['revision'=>0,'content_html'=>'<p>Stale</p>'])->assertConflict();
        $this->patchJson($path,['content_html'=>'<p>Missing</p>'])->assertUnprocessable();
        $this->assertSame('<p>First</p>',$doc->refresh()->content_html);
        $this->patchJson($path,['revision'=>1,'content_html'=>'<p>Next</p>'])->assertOk()->assertJsonPath('document.revision',2);
        $this->assertEquals($doc->created_at,$doc->refresh()->updated_at);
    }
    public function test_retry_is_exact_idempotent_ordered_and_batch_rolls_back(): void
    {
        $a=User::create(['name'=>'A','email'=>'retry@example.test','password'=>'Fictitious12345']);
        $doc=Document::create(['owner_id'=>$a->id]);$path='/api/documents/'.$doc->id.'/events';$session=(string)Str::uuid();
        $this->actingAs($a);
        $event=['sequence'=>1,'event_type'=>'insert','after_html'=>'<p>NFC á NFD á</p>','data'=>'á','elapsed_ms'=>10];
        $batch=['session_id'=>$session,'events'=>[$event]];
        $this->postJson($path,$batch)->assertOk()->assertJsonPath('accepted',1);
        $hash=WritingEvent::first()->event_hash;
        $this->postJson($path,$batch)->assertOk()->assertJsonPath('accepted',0);
        $batch['events'][0]['data']='different';$this->postJson($path,$batch)->assertConflict();
        $next=[...$event,'sequence'=>2];$gap=[...$event,'sequence'=>4];
        $this->postJson($path,['session_id'=>$session,'events'=>[$next,$gap]])->assertConflict();
        $this->assertSame(1,WritingEvent::count());$this->assertSame($hash,WritingEvent::first()->event_hash);
        $this->postJson($path,['session_id'=>$session,'events'=>[$event,$next]])->assertOk()->assertJsonPath('accepted',1);
        $this->assertSame($hash,WritingEvent::orderBy('sequence')->skip(1)->first()->previous_hash);
    }
}
