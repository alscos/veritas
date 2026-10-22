<?php
namespace Tests\Feature;

use App\Models\{User, Document, DocumentVersion};
use App\Support\{VersionAccess, VersionVerifier};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Design gates for a future summary, not tests of an implemented sharing API. */
final class M33HistoricalSummaryGateTest extends TestCase
{
    use RefreshDatabase;

    public function test_exact_prefixes_and_existing_access_with_two_accounts_two_documents_three_versions(): void
    {
        config(['veritas.seal_format' => 2]);
        $a = User::create(['name'=>'A','email'=>'m33-a@example.test','password'=>'synthetic-password']);
        $b = User::create(['name'=>'B','email'=>'m33-b@example.test','password'=>'synthetic-password']);
        $docA = Document::create(['owner_id'=>$a->id,'content_html'=>'<p>antes á génesis</p>','word_count'=>3]);
        $docB = Document::create(['owner_id'=>$b->id,'content_html'=>'<p>otra cuenta</p>','word_count'=>2]);
        $sid = (string) Str::uuid();
        $path = '/api/documents/'.$docA->id;
        $this->actingAs($a)->postJson($path.'/events', ['session_id'=>$sid,'events'=>[
            ['sequence'=>1,'event_type'=>'insert','after_html'=>$docA->content_html,'elapsed_ms'=>1000],
        ]])->assertOk();
        $first = $this->postJson($path.'/seal')->assertCreated()->json();
        $this->postJson($path.'/events', ['session_id'=>$sid,'events'=>[
            ['sequence'=>2,'event_type'=>'paste','after_html'=>'<p>posterior privado</p>','elapsed_ms'=>20000],
        ]])->assertOk();
        $docA->update(['content_html'=>'<p>posterior privado</p>','word_count'=>2]);
        $second = $this->postJson($path.'/seal')->assertCreated()->json();
        $third = $this->actingAs($b)->postJson('/api/documents/'.$docB->id.'/seal')->assertCreated()->json();
        $v1 = DocumentVersion::findOrFail($first['version']['id']);
        $v2 = DocumentVersion::findOrFail($second['version']['id']);
        self::assertSame(1, VersionAccess::boundary($v1)[$sid]['sequence']);
        self::assertSame(2, VersionAccess::boundary($v2)[$sid]['sequence']);
        self::assertSame(1, app(VersionVerifier::class)->verify($v1->id)['consumed']['events']);
        self::assertSame(2, app(VersionVerifier::class)->verify($v2->id)['consumed']['events']);
        $docA->update(['content_html'=>'<p>borrador posterior a ambos sellos</p>']);
        self::assertSame(1, app(VersionVerifier::class)->verify($v1->id)['consumed']['events']);
        $this->getJson($path.'/versions/'.$v1->id)->assertNotFound();
        $this->postJson($path.'/versions/'.$v1->id.'/verification')->assertNotFound();
        $this->getJson($path.'/timeline?version_id='.$v1->id)->assertNotFound();
        $this->getJson($path.'/versions/'.$v1->id.'/pdf-source')->assertNotFound();
        $this->actingAs($a)->getJson($path.'/versions/'.$third['version']['id'])->assertNotFound();
        $publicBefore = $this->getJson('/api/verify/'.$first['certificate']['certificate_code'])->assertOk()->json();
        self::assertSame(['valid','scope','certificate_code','issued_at','content_hash'], array_keys($publicBefore));
        self::assertStringNotContainsString('posterior', json_encode($publicBefore));

        // A signed boundary alone is not verification of snapshot/event integrity.
        $original = $v1->snapshot_html;
        $v1->update(['snapshot_html'=>'<p>alterado</p>']);
        self::assertNotNull(VersionAccess::boundary($v1->fresh()));
        self::assertSame('mismatch', app(VersionVerifier::class)->verify($v1->id)['status']);
        $v1->update(['snapshot_html'=>$original]);

        // Server arrival order is outside the event HMAC and evidence manifest.
        // Do not present client "last session PPM" as an authenticated chronology.
        DB::table('writing_events')->where('writing_session_id',$sid)->where('sequence',1)
            ->update(['server_received_at'=>'2001-01-01 00:00:00']);
        $verified = app(VersionVerifier::class)->verify($v1->id);
        self::assertSame('limited', $verified['status']);
        self::assertSame('passed', $verified['checks']['chains']);
        self::assertFalse($verified['complete']);
        self::assertSame($publicBefore, $this->getJson('/api/verify/'.$first['certificate']['certificate_code'])->assertOk()->json());
    }
}
