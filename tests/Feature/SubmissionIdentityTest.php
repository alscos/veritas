<?php
namespace Tests\Feature;

use App\Models\{User, Document, Submission, Certificate};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SubmissionIdentityTest extends TestCase
{
    use RefreshDatabase;

    private function fixture(): array
    {
        $a = User::create(['name'=>'Cuenta autora', 'email'=>'sender@example.test', 'password'=>'Fictitious12345']);
        $b = User::create(['name'=>'Cuenta receptora', 'email'=>'recipient@example.test', 'password'=>'Fictitious12345']);
        $c = User::create(['name'=>'Perfil privado', 'email'=>'private@example.test', 'password'=>'Fictitious12345']);
        $doc = Document::create(['owner_id'=>$a->id, 'content_html'=>'<p>Sellado</p>', 'word_count'=>1]);
        $this->actingAs($a)->postJson('/api/documents/'.$doc->id.'/events', ['session_id'=>(string) \Illuminate\Support\Str::uuid(), 'events'=>[['sequence'=>1,'event_type'=>'insert','after_html'=>'<p>Sellado</p>','elapsed_ms'=>1000]]])->assertOk();
        $seal = $this->postJson('/api/documents/'.$doc->id.'/seal')->assertCreated()->json();
        $sub = $this->postJson('/api/submissions',['document_version_id'=>$seal['version']['id'],'recipient_email'=>$b->email])->assertCreated()->json('submission');
        return [$a,$b,$c,$doc,$seal,$sub];
    }

    public function test_participants_receive_explicit_roles_without_private_columns_or_mutable_text(): void
    {
        [$a,$b,$c,$doc,$seal,$sub] = $this->fixture();
        $before = Certificate::findOrFail($seal['certificate']['id'])->getAttributes();
        $doc->update(['content_html'=>'<p>PRIVATE LATER</p>','title'=>'PRIVATE TITLE']);
        foreach ([$a,$b] as $user) {
            $response = $this->actingAs($user)->getJson('/api/submissions/'.$sub['id'])->assertOk();
            foreach (['creator_account','sender_account'] as $role) {
                $this->assertSame(['id'=>$a->id,'kind'=>'name','value'=>'Cuenta autora'], $response->json('submission.'.$role));
            }
            $text = $response->getContent();
            foreach (['PRIVATE LATER','PRIVATE TITLE','private@example.test','email_verified_at','remember_token','password','"document":'] as $secret) $this->assertStringNotContainsString($secret,$text);
            $response->assertJsonPath('version.snapshot_html','<p>Sellado</p>');
            $list=$this->getJson('/api/submissions')->assertOk();
            $list->assertJsonPath(($user->id === $a->id ? 'sent' : 'received').'.0.sender_account.value','Cuenta autora');
        }
        $this->assertSame($before, Certificate::findOrFail($seal['certificate']['id'])->getAttributes());
        $this->actingAs($c)->getJson('/api/submissions/'.$sub['id'])->assertNotFound()->assertJsonMissingPath('submission');
        $this->getJson('/api/submissions')->assertJsonCount(0,'sent')->assertJsonCount(0,'received');
        $this->postJson('/api/submissions',['document_version_id'=>$seal['version']['id'],'recipient_email'=>$b->email])->assertNotFound();
        $public=$this->getJson('/api/verify/'.$seal['certificate']['certificate_code'])->assertOk()->getContent();
        foreach (['creator_account','sender_account','Cuenta autora','sender@example.test','private@example.test'] as $secret) $this->assertStringNotContainsString($secret,$public);
        auth()->forgetGuards();
        $this->getJson('/api/submissions/'.$sub['id'])->assertUnauthorized()->assertJsonMissingPath('submission');
        $this->getJson('/api/submissions')->assertUnauthorized();
    }

    public function test_missing_name_legacy_recipient_and_current_owner_have_honest_fallbacks(): void
    {
        [$a,$b,$c,$doc,$seal,$sub] = $this->fixture();
        $a->update(['name'=>'']);
        $this->getJson('/api/submissions/'.$sub['id'])->assertOk()->assertJsonPath('submission.sender_account.kind','email')->assertJsonPath('submission.sender_account.value','sender@example.test');
        // The HTTP store contract cannot create different owner/sender accounts.
        $this->actingAs($c)->postJson('/api/submissions',['document_version_id'=>$seal['version']['id'],'recipient_email'=>$b->email])->assertNotFound();
        $this->actingAs($a);
        $legacy=Submission::create(['document_version_id'=>$seal['version']['id'],'sender_id'=>$a->id,'recipient_email'=>'unlinked@example.test','submitted_at'=>now()]);
        $this->getJson('/api/submissions/'.$legacy->id)->assertOk()->assertJsonPath('submission.recipient_user_id',null)->assertJsonPath('submission.recipient_email','unlinked@example.test');
        $this->actingAs($b)->getJson('/api/submissions/'.$legacy->id)->assertNotFound();
        // Test an absent projection without disabling foreign keys or deleting sealed evidence.
        $controller=new \App\Http\Controllers\SubmissionController;
        $method=new \ReflectionMethod($controller,'present');
        $restricted=$method->invoke($controller, Submission::findOrFail($sub['id']), ['owners'=>collect([$seal['version']['id']=>$c->id]), 'senders'=>collect([$a->id=>$a])]);
        $this->assertSame(['id'=>$c->id,'kind'=>'restricted','value'=>null],$restricted['creator_account']);
        $dto=$method->invoke($controller, Submission::findOrFail($sub['id']), ['owners'=>collect(), 'senders'=>collect()]);
        $this->assertSame(['id'=>null,'kind'=>'unavailable','value'=>null],$dto['sender_account']);
        $this->assertSame(['id'=>null,'kind'=>'unavailable','value'=>null],$dto['creator_account']);
        $b->delete();
        $this->actingAs($a)->getJson('/api/submissions/'.$sub['id'])->assertOk()->assertJsonPath('submission.recipient_user_id',null);
    }

    public function test_list_account_queries_are_batched_and_never_select_draft_columns(): void
    {
        [$a,$b,$c,$doc,$seal,$sub]=$this->fixture();
        for ($i=0;$i<8;$i++) Submission::create(['document_version_id'=>$seal['version']['id'],'sender_id'=>$a->id,'recipient_user_id'=>$b->id,'submitted_at'=>now()]);
        $this->actingAs($b); DB::enableQueryLog(); DB::flushQueryLog();
        $this->getJson('/api/submissions')->assertOk()->assertJsonCount(9,'received');
        $queries=collect(DB::getQueryLog())->pluck('query'); DB::disableQueryLog();
        $this->assertCount(1,$queries->filter(fn($q)=>str_contains($q,'"document_versions" as "v"')));
        $this->assertCount(1,$queries->filter(fn($q)=>str_contains($q,'"name", "email"')));
        foreach ($queries as $query) $this->assertStringNotContainsString('content_html',$query);
    }
}
