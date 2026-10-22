<?php
namespace Tests\Feature;

use App\Models\{Document, DocumentImage, DocumentVersion, User};
use App\Support\{SealedVersionReader, VersionShareGate, VersionSummaryCapabilities};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Auth, DB, Route};
use Illuminate\Support\Str;
use Tests\TestCase;

/** Internal adapter tests. Fixture-only routes below MUST NOT be registered in runtime. */
final class VersionShareGateTest extends TestCase
{
    use DatabaseMigrations;

    private function fixture(int $count = 2): array
    {
        config(['veritas.seal_format'=>2, 'veritas.public_origin'=>'http://127.0.0.1:8084']);
        $users=[];
        foreach (['author','other','one','two','three'] as $name) {
            $users[]=User::create(['name'=>$name,'email'=>$name.'@gate.example.test','password'=>'synthetic-password-123']);
        }
        [$a,$b,$one,$two,$three]=$users;
        $html='<p>á génesis  <mark data-origin="paste">pegado</mark><mark data-origin="paste-edited"> cambio</mark></p><p></p>';
        $d=Document::create(['owner_id'=>$a->id,'content_html'=>$html,'word_count'=>4]);
        $other=Document::create(['owner_id'=>$b->id,'content_html'=>'<p>OTHER</p>','word_count'=>1]);
        $this->actingAs($a);$sessions=[];
        for ($j=0;$j<2;$j++) {
            $sid=(string)Str::uuid();$sessions[]=$sid;$events=[];
            for($i=1;$i<=$count;$i++)$events[]=['sequence'=>$i,'event_type'=>'insert','elapsed_ms'=>$i,'after_html'=>$html];
            $this->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sid,'events'=>$events])->assertOk();
        }
        $v=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $v2=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        foreach([[$v,$one],[$v,$two],[$v2,$three]] as [$version,$u]) {
            DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'document_version_id'=>$version,
                'sender_id'=>$a->id,'recipient_user_id'=>$u->id,'submitted_at'=>now()]);
        }
        // Candidate grants in fixtures only: current runtime still issues level 2 exclusively.
        $grants=[];
        for($i=0;$i<4;$i++) {
            $g=(new VersionSummaryCapabilities)->issue($a,$d->id,$v);
            DB::table('version_summary_grants')->where('id',$g['grant']['id'])->update([
                'level'=>3,'audience_mode'=>$i===3?'signed_in_link':'restricted',
            ]);
            DB::table('version_share_recipients')->insert(['grant_id'=>$g['grant']['id'],'user_id'=>$one->id]);
            $grants[]=$g;
        }
        $this->app['auth']->forgetGuards();$this->flushSession();
        return compact('users','a','b','one','two','three','d','other','v','v2','html','sessions','grants');
    }

    /** Server-side SessionGuard login on fictitious accounts; no HTTP/browser claim. */
    private function login(User $user): Request
    {
        $this->app['auth']->forgetGuards();$this->flushSession();
        // Exercise Laravel SessionGuard::login (server-side), not actingAs or a client identity.
        app('session.store')->start();
        Auth::guard('web')->login($user);
        $request=Request::create('/process-summary/candidate','POST');
        $request->setLaravelSession(app('session.store'));
        return $request;
    }
    private function denied(callable $call, int $status=404): void
    {
        try {$call();self::fail('Unauthorized response');}
        catch(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e){self::assertSame($status,$e->getStatusCode());}
    }
    private function countAccesses(string $grant): int
    {
        return (int)DB::table('version_share_accesses')->where('grant_id',$grant)->sum('access_count');
    }

    public function test_session_audience_token_all_required_and_no_denied_audit(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$g=$grants[0];
        $none=Request::create('/','POST');
        $this->denied(fn()=>$gate->page($none,$g['secret']),401);
        // Arbitrary Request resolver or actingAs identity cannot stand in for session login.
        $none->setUserResolver(fn()=>$one);$this->actingAs($one);
        $this->denied(fn()=>$gate->page($none,$g['secret']),401);
        foreach([$a,$b,$two,$three] as $u) {
            $request=$this->login($u);$this->denied(fn()=>$gate->page($request,$g['secret']));
        }
        $request=$this->login($one);
        foreach(['','VRT-PUBLIC',str_repeat('x',43)] as $bad)$this->denied(fn()=>$gate->page($request,$bad));
        self::assertSame(0,$this->countAccesses($g['grant']['id']));
        self::assertSame($html,$gate->page($request,$g['secret'])['snapshot_html']);
        self::assertSame(1,$this->countAccesses($g['grant']['id']));
        // A selected account still needs an Entrega for the exact version on every request.
        DB::table('submissions')->where('document_version_id',$v)->where('recipient_user_id',$one->id)->delete();
        $this->denied(fn()=>$gate->page($request,$g['secret']));
        self::assertSame(1,$this->countAccesses($g['grant']['id']));
        $request=$this->login($three);
        self::assertSame($html,$gate->page($request,$grants[3]['secret'])['snapshot_html']);
        $this->app['auth']->forgetGuards();$request->session()->flush();
        $this->denied(fn()=>$gate->page($request,$grants[3]['secret']),401);
    }

    public function test_independent_grants_fresh_pages_fixed_level_and_readonly_history(): void
    {
        extract($this->fixture(18));$gate=new VersionShareGate;$request=$this->login($one);$g=$grants[0];
        $tables=['documents','document_versions','writing_sessions','writing_events','certificates','version_evidence'];
        $before=[];foreach($tables as $t)$before[$t]=DB::table($t)->get()->toJson();
        $page=$gate->page($request,$g['secret']);self::assertCount(32,$page['events']);
        $next=$gate->page($request,$g['secret'],$page['next_after']);self::assertCount(4,$next['events']);self::assertNull($next['next_after']);
        self::assertSame($html,$page['snapshot_html']);self::assertSame('limited',$page['coverage']['status']);self::assertFalse($page['coverage']['complete']);
        $id=$page['events'][0]['id'];self::assertCount(1,$gate->event($request,$g['secret'],$id)['events']);
        self::assertSame(3,$this->countAccesses($g['grant']['id']));
        $audit=DB::table('version_share_accesses')->where('grant_id',$g['grant']['id'])->first();
        self::assertSame($one->id,(int)$audit->user_id);self::assertNotNull($audit->first_seen);self::assertNotNull($audit->last_seen);
        foreach($before as $t=>$value)self::assertSame($value,DB::table($t)->get()->toJson());
        (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);
        $this->denied(fn()=>$gate->page($request,$g['secret'],$page['next_after']));
        $this->denied(fn()=>$gate->event($request,$g['secret'],$id));
        self::assertSame($html,$gate->page($request,$grants[1]['secret'])['snapshot_html']);
        DB::table('version_summary_grants')->where('id',$grants[1]['grant']['id'])->update(['expires_at_epoch'=>now('UTC')->subSecond()->getTimestamp()]);
        $this->denied(fn()=>$gate->page($request,$grants[1]['secret']));
        DB::table('version_summary_grants')->where('id',$grants[2]['grant']['id'])->update(['level'=>2]);
        $this->denied(fn()=>$gate->page($request,$grants[2]['secret']));
        self::assertSame(3,$this->countAccesses($g['grant']['id']));
    }

    public function test_grant_relationship_crosses_and_inherited_transactions_fail_closed(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$request=$this->login($one);
        foreach([['owner_id'=>$b->id],['document_id'=>$other->id],['version_id'=>$v2],['audience_mode'=>'unknown']] as $i=>$mutation) {
            $g=$grants[$i];DB::table('version_summary_grants')->where('id',$g['grant']['id'])->update($mutation);
            $this->denied(fn()=>$gate->page($request,$g['secret']));self::assertSame(0,$this->countAccesses($g['grant']['id']));
        }
        DB::beginTransaction();
        try{$this->denied(fn()=>$gate->page($request,$grants[0]['secret']),503);}finally{DB::rollBack();}
    }

    public function test_fresh_final_cut_denies_changes_during_reader_computation_without_audit(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$request=$this->login($one);
        foreach(['revoke','expiry','audience','session'] as $i=>$action) {
            $g=$grants[$i];$real=new SealedVersionReader;
            $this->app->instance(SealedVersionReader::class,new class($real,$action,$g,$request) {
                public function __construct(private $real,private $action,private $g,private $request){}
                public function page($owner,$document,$version,$after=0,$event=null) {
                    $result=$this->real->page($owner,$document,$version,$after,$event);
                    $key=['id'=>$this->g['grant']['id']];
                    if($this->action==='revoke')DB::table('version_summary_grants')->where($key)->update(['revoked_at'=>now()]);
                    if($this->action==='expiry')DB::table('version_summary_grants')->where($key)->update(['expires_at_epoch'=>now('UTC')->subSecond()->getTimestamp()]);
                    if($this->action==='audience')DB::table('version_share_recipients')->where('grant_id',$this->g['grant']['id'])->delete();
                    if($this->action==='session')$this->request->session()->flush();
                    return $result;
                }
            });
            $this->denied(fn()=>$gate->page($request,$g['secret']),$action==='session'?401:404);
            self::assertSame(0,$this->countAccesses($g['grant']['id']));$this->app->forgetInstance(SealedVersionReader::class);
        }
    }

    public function test_later_draft_sessions_events_and_tamper_cannot_expand_seal(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$g=$grants[0];$request=$this->login($one);
        $initial=$gate->page($request,$g['secret']);
        $this->actingAs($a);
        foreach([$sessions[0],(string)Str::uuid()] as $i=>$sid) {
            $this->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sid,'events'=>[
                ['sequence'=>$i===0?3:1,'event_type'=>'insert','elapsed_ms'=>90,'after_html'=>'<p>LATER SECRET</p>'],
            ]])->assertOk();
        }
        $late=(int)DB::table('writing_events')->max('id');$d->update(['content_html'=>'<p>LATER SECRET</p>']);
        $this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated();$request=$this->login($one);
        self::assertSame($initial,$gate->page($request,$g['secret']));
        $this->denied(fn()=>$gate->event($request,$g['secret'],$late));
        self::assertSame([],$gate->page($request,$g['secret'],$late)['events']);
        $this->denied(fn()=>$gate->page($request,$g['secret'],-1),422);
        DocumentVersion::whereKey($v)->update(['snapshot_html'=>'<p>TAMPERED</p>']);
        $this->denied(fn()=>$gate->page($request,$g['secret']),409);
    }

    public function test_image_surface_rechecks_token_session_and_audience_and_counts_only_success(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;
        $root=sys_get_temp_dir().'/m33dr2-'.Str::uuid();mkdir($root,0700);config(['veritas.media_path'=>$root]);
        $id=(string)Str::uuid();$file=$root.'/'.$id.'.png';
        $bytes=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5x8AAAAASUVORK5CYII=');file_put_contents($file,$bytes);
        try {
            $image=DocumentImage::create(['id'=>$id,'document_id'=>$d->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
            $d->update(['content_html'=>'<p>imagen</p><img src="'.$image->url().'">']);$this->actingAs($a);
            $version=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
            $g=(new VersionSummaryCapabilities)->issue($a,$d->id,$version);
            DB::table('version_summary_grants')->where('id',$g['grant']['id'])->update(['level'=>3,'audience_mode'=>'signed_in_link']);
            $request=$this->login($one);
            self::assertSame(['mime'=>'image/png','bytes'=>$bytes],$gate->image($request,$g['secret'],$id));
            $this->denied(fn()=>$gate->image($request,$g['secret'],$id,999999));
            $this->denied(fn()=>$gate->image($request,$g['secret'],(string)Str::uuid()));
            self::assertSame(1,$this->countAccesses($g['grant']['id']));
            (new VersionSummaryCapabilities)->revoke($a,$d->id,$version,$g['grant']['id']);
            $this->denied(fn()=>$gate->image($request,$g['secret'],$id));
            self::assertSame(1,$this->countAccesses($g['grant']['id']));
        } finally {unlink($file);rmdir($root);}
    }

    public function test_audit_inventory_is_scoped_to_owner_document_version_and_grant(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$request=$this->login($one);$g=$grants[0];
        $gate->page($request,$g['secret']);
        foreach([[$b,$d->id,$v,$g['grant']['id']],[$a,$other->id,$v,$g['grant']['id']],
            [$a,$d->id,$v2,$g['grant']['id']],[$one,$d->id,$v,$g['grant']['id']]] as [$u,$doc,$ver,$grant]) {
            $this->denied(fn()=>$gate->accesses($u,$doc,$ver,$grant));
        }
        $audit=$gate->accesses($a,$d->id,$v,$g['grant']['id']);
        self::assertCount(1,$audit['accounts']);self::assertSame($one->id,$audit['accounts'][0]['user_id']);
        self::assertSame(1,$audit['accounts'][0]['access_count']);self::assertNull($audit['next_after']);
        self::assertSame([],$gate->accesses($a,$d->id,$v,$grants[1]['grant']['id'])['accounts']);
        (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);
        self::assertSame($audit,$gate->accesses($a,$d->id,$v,$g['grant']['id']));
        $json=json_encode($audit);foreach(['digest','secret','ip_address','user_agent'] as $key)self::assertStringNotContainsString($key,$json);
    }

    public function test_forged_and_deleted_session_identities_cannot_read(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$g=$grants[0];
        $request=$this->login($one);$name=Auth::guard('web')->getName();
        // A body/header/resolver cannot replace Laravel's authenticated identity.
        $request->headers->set('X-InkGroove-User',(string)$three->id);
        $request->merge(['user_id'=>$three->id,'owner_id'=>$a->id,'document_id'=>$other->id,'version_id'=>$v2]);
        self::assertSame($html,$gate->page($request,$g['secret'])['snapshot_html']);
        $request->session()->put($name,$three->id); // Stale guard and a different session identity.
        $this->denied(fn()=>$gate->page($request,$g['secret']),401);
        $request=$this->login($one);DB::table('users')->where('id',$one->id)->delete();
        $this->denied(fn()=>$gate->page($request,$g['secret']));
    }

    public function test_final_image_recheck_denies_revocation_after_verified_bytes_without_audit(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$g=$grants[0];$request=$this->login($one);
        // Controlled dependency tests the outer gate's final cut only, not image verification.
        $this->app->instance(SealedVersionReader::class,new class($g) {
            public function __construct(private $g){}
            public function image($owner,$document,$version,$image,$event=null) {
                DB::table('version_summary_grants')->where('id',$this->g['grant']['id'])->update(['revoked_at'=>now()]);
                return ['mime'=>'image/png','bytes'=>'SYNTHETIC ALREADY COMPUTED'];
            }
        });
        $this->denied(fn()=>$gate->image($request,$g['secret'],(string)Str::uuid()));
        self::assertSame(0,$this->countAccesses($g['grant']['id']));
    }

    public function test_level_two_http_accepts_capability_only_in_protected_json_body(): void
    {
        extract($this->fixture());$g=(new VersionSummaryCapabilities)->issue($a,$d->id,$v);
        $this->withHeader('Origin','http://127.0.0.1:8084');
        $this->postJson('/process-summary/query',['capability'=>$g['secret']])->assertOk();
        $this->postJson('/process-summary/query?capability='.$g['secret'],[])->assertNotFound();
        $this->postJson('/process-summary/query?capability=irrelevant',['capability'=>$g['secret']])->assertNotFound();
        $this->post('/process-summary/query',['capability'=>$g['secret']])->assertNotFound();
        $this->withCookie('capability',$g['secret'])->postJson('/process-summary/query',[])->assertNotFound();
        $shell=$this->get('/process-summary?capability='.$g['secret'])->assertOk();
        self::assertStringNotContainsString($g['secret'],$shell->getContent());
        self::assertSame(0,DB::table('version_share_accesses')->count());
    }

    public function test_candidate_http_kernel_all_surfaces_have_csrf_origin_session_and_neutral_headers(): void
    {
        extract($this->fixture());$g=$grants[0];$request=$this->login($one);
        // Real candidate controller, fixture-only routes; NOT runtime registration or served HTTP.
        foreach(['page','event','image'] as $method) {
            Route::middleware(['web','auth','throttle:12,1,candidate-'.$method])->post('/process-summary/candidate/'.$method,
                [\App\Http\Controllers\VersionShareReadController::class,$method]);
        }
        $this->app['env']='production'; // Enable Laravel's real CSRF check after guarded DB creation.
        $event=(int)DB::table('writing_events')->min('id');$csrf='synthetic-share-csrf';
        foreach(['page'=>[], 'event'=>['event'=>$event], 'image'=>['image'=>(string)Str::uuid()]] as $method=>$extra) {
            $path='/process-summary/candidate/'.$method;$body=['capability'=>$g['secret']]+$extra;
            $this->flushHeaders();$this->withHeader('Origin','http://127.0.0.1:8084')->postJson($path,$body)->assertStatus(419);
            $this->withSession(['_token'=>$csrf])->withHeader('X-CSRF-TOKEN',$csrf);
            $this->withHeader('Origin','https://foreign.example.test')->postJson($path,$body)->assertForbidden();
            $this->withHeader('Origin','http://127.0.0.1:8084')->withHeader('Sec-Fetch-Site','cross-site')->postJson($path,$body)->assertForbidden();
            $this->withHeader('Sec-Fetch-Site','same-origin')->withHeader('Host','forged.example.test')->withHeader('X-Forwarded-Host','forged.example.test');
            $response=$this->postJson($path,$body);$response->assertStatus($method==='image'?404:200);
            $response->assertHeader('Referrer-Policy','no-referrer')->assertHeader('X-Robots-Tag','noindex, nofollow')->assertHeader('X-Content-Type-Options','nosniff');
            self::assertStringContainsString('no-store',$response->headers->get('Cache-Control'));
            self::assertStringContainsString("default-src 'none'",$response->headers->get('Content-Security-Policy'));
            $denied=$this->postJson($path.'?capability='.$g['secret'],$extra)->assertNotFound();
            self::assertSame(['message'=>'Unavailable / No disponible'],$denied->json());
            self::assertStringNotContainsString($g['secret'],$denied->getContent());
            self::assertStringContainsString('no-store',$denied->headers->get('Cache-Control'));
            $this->app['auth']->forgetGuards();$this->flushSession();
            $this->withSession(['_token'=>$csrf])->postJson($path,$body)->assertUnauthorized()->assertHeader('Referrer-Policy','no-referrer');
            $this->login($one);
        }
        self::assertSame(2,$this->countAccesses($g['grant']['id']));
        $this->app['env']='testing';
    }

    public function test_legacy_level_two_emission_stays_closed_to_level_three(): void
    {
        extract($this->fixture());$this->actingAs($a)->withHeader('Origin','http://127.0.0.1:8084')
            ->postJson('/api/summary-grants/'.$d->id.'/'.$v,['level'=>3])->assertStatus(422);
        self::assertSame(0,DB::table('version_share_accesses')->count());
    }
}
