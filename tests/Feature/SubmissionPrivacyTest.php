<?php
namespace Tests\Feature;
use App\Models\{User, Document, DocumentVersion, Certificate};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class SubmissionPrivacyTest extends TestCase
{
    use RefreshDatabase;
    public function test_version_scopes_all_sessions_and_rejects_identifier_cursor_and_identity_attacks(): void
    {
        $users = [];
        foreach (['A','B','C','D'] as $name) $users[] = User::create(['name'=>$name,'email'=>strtolower($name).'@example.test','password'=>'Fictitious12345']);
        [$a,$b,$c,$d] = $users;
        $doc = Document::create(['owner_id'=>$a->id,'title'=>'Private']);
        $path = '/api/documents/'.$doc->id;
        $this->actingAs($a);
        $sessions = [(string) Str::uuid(),(string) Str::uuid()];
        foreach ($sessions as $session) $this->postJson($path.'/events',['session_id'=>$session,'events'=>[['sequence'=>1,'event_type'=>'insert','after_html'=>'<p>Delivered</p>','elapsed_ms'=>1000]]])->assertOk();
        $this->patchJson($path,['revision'=>(int) \App\Models\Document::findOrFail($doc->id)->revision,'content_html'=>'<p>Delivered</p>'])->assertOk();
        $sealed = $this->postJson($path.'/seal')->assertCreated()->json();
        $v1=$sealed['version']; $signature=$sealed['certificate']['signature'];
        $sub1=$this->postJson('/api/submissions',['document_version_id'=>$v1['id'],'recipient_email'=>$b->email])->assertCreated()->json('submission');
        $this->postJson($path.'/events',['session_id'=>$sessions[0],'events'=>[['sequence'=>2,'event_type'=>'insert','after_html'=>'<p>SECRET LATER</p>','data'=>'SECRET LATER','elapsed_ms'=>900000,'created_at'=>'2000-01-01']]])->assertOk();
        $this->patchJson($path,['revision'=>(int) \App\Models\Document::findOrFail($doc->id)->revision,'content_html'=>'<p>SECRET LATER</p>'])->assertOk();
        $v2=$this->postJson($path.'/seal')->assertCreated()->json('version');
        $this->postJson('/api/submissions',['document_version_id'=>$v2['id'],'recipient_email'=>$d->email])->assertCreated();
        $late=DB::table('writing_events')->max('id');
        // Identical server timestamps and forged ancient client dates must not cross the seal.
        DB::table('writing_events')->update(['server_received_at'=>'2026-10-10 12:00:00']);
        $this->actingAs($b)->getJson('/api/submissions/'.$sub1['id'])->assertOk()->assertJsonPath('version.snapshot_html','<p>Delivered</p>');
        $this->getJson($path)->assertNotFound();
        $this->getJson($path.'/timeline')->assertNotFound();
        $scope=$path.'/timeline?version_id='.$v1['id'];
        $page=$this->getJson($scope.'&metadata=1&limit=1&before_id=999999')->assertOk()->assertJsonPath('total',2)->json();
        $this->assertStringNotContainsString('SECRET',json_encode($page));
        $this->assertCount(2,$page['sessions']);
        foreach ($page['sessions'] as $session) $this->assertSame(1,$session['last_sequence']);
        $this->getJson($scope.'&metadata=1&before_id=999999&cursor='.urlencode($page['next_cursor']))->assertOk()->assertJsonPath('total',2)->assertJsonCount(1,'events');
        $this->getJson($scope.'&event_id='.$late)->assertNotFound();
        $this->getJson($scope.'&snapshot_ids[]='.$late)->assertNotFound();
        $this->getJson($path.'/timeline?version_id='.$v2['id'])->assertNotFound();
        $foreign=Document::create(['owner_id'=>$a->id]);
        $this->getJson('/api/documents/'.$foreign->id.'/timeline?version_id='.$v1['id'])->assertNotFound();
        $this->actingAs($c)->getJson('/api/submissions/'.$sub1['id'])->assertNotFound();
        $this->getJson($scope)->assertNotFound();
        $this->actingAs($d)->getJson($path.'/timeline?metadata=1&version_id='.$v2['id'])->assertOk()->assertJsonPath('total',3);
        $this->actingAs($a)->getJson($path.'/timeline?metadata=1')->assertOk()->assertJsonPath('total',3);
        $this->getJson('/api/verify/'.$sealed['certificate']['certificate_code'])->assertOk()->assertJsonPath('valid',true);
        $this->assertSame($signature,Certificate::find($sealed['certificate']['id'])->signature);
        $this->withHeader('X-InkGroove-User',(string)$b->id)->patchJson($path,['revision'=>(int) \App\Models\Document::findOrFail($doc->id)->revision,'content_html'=>'wrong identity'])->assertUnauthorized();
    }
    public function test_logout_response_remains_valid_after_guard_identity_is_cleared(): void
    {
        $a=User::create(['name'=>'A','email'=>'logout-a@example.test','password'=>'Fictitious12345']);
        $this->actingAs($a)->withHeader('X-InkGroove-User',(string)$a->id)->postJson('/api/auth/logout',[])->assertOk();
    }
    public function test_legacy_signature_and_snapshot_survive_without_retrospective_history(): void
    {
        $a=User::create(['name'=>'A','email'=>'legacy-a@example.test','password'=>'Fictitious12345']);
        $b=User::create(['name'=>'B','email'=>'legacy-b@example.test','password'=>'Fictitious12345']);
        $doc=Document::create(['owner_id'=>$a->id,'content_html'=>'<p>Legacy</p>','word_count'=>1]);
        $v=DocumentVersion::create(['document_id'=>$doc->id,'version_number'=>1,'snapshot_html'=>'<p>Legacy</p>','snapshot_text'=>'Legacy','word_count'=>1,'content_hash'=>hash('sha256','<p>Legacy</p>'),'sealed_at'=>now()]);
        $payload=['version_id'=>$v->id,'content_hash'=>$v->content_hash]; ksort($payload);
        $cert=Certificate::create(['document_version_id'=>$v->id,'certificate_code'=>'VRT-LEGACYTEST','signed_payload'=>$payload,'signature'=>hash_hmac('sha256',json_encode($payload,JSON_UNESCAPED_SLASHES),(string)config('veritas.signing_key')),'issued_at'=>now()]);
        $sub=$this->actingAs($a)->postJson('/api/submissions',['document_version_id'=>$v->id,'recipient_email'=>$b->email])->assertCreated()->json('submission');
        $this->actingAs($b)->getJson('/api/submissions/'.$sub['id'])->assertOk()->assertJsonPath('history_available',false)->assertJsonPath('version.snapshot_html','<p>Legacy</p>');
        $this->getJson('/api/documents/'.$doc->id.'/timeline?version_id='.$v->id)->assertStatus(409);
        $this->getJson('/api/submissions/'.$sub['id'], ['Accept-Language'=>'es'])->assertOk()->assertJsonPath('history_notice','Esta versión antigua no tiene una frontera de proceso verificable. Solo se comparte la instantánea sellada.');
        $this->getJson('/api/submissions/'.$sub['id'], ['Accept-Language'=>'en'])->assertOk()->assertJsonPath('history_notice','This older version has no verifiable process boundary. Only the sealed snapshot is shared.');
        $this->getJson('/api/verify/'.$cert->certificate_code)->assertOk()->assertJsonPath('valid',true);
        $this->assertSame($payload,$cert->fresh()->signed_payload);
    }
}
