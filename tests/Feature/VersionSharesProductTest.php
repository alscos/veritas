<?php
namespace Tests\Feature;

use App\Models\{Document, DocumentImage, DocumentVersion, User};
use App\Support\{SealedVersionReader, VersionShareGate, VersionSummaryCapabilities};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Auth, DB};
use Illuminate\Support\Str;
use Tests\TestCase;

final class VersionSharesProductTest extends TestCase
{
    use DatabaseMigrations;
    protected function setUp(): void
    {
        parent::setUp(); $this->withoutVite();
        \Illuminate\Support\Facades\URL::forceRootUrl('http://127.0.0.1:8084');
        $this->withHeader('Host','127.0.0.1:8084');

    }
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
        // Synthetic rows for gate tests; ordinary issuance is exercised separately.
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

    public function test_real_issuance_fixed_independent_levels_and_exact_recipient_selection(): void
    {
        extract($this->fixture());$s=new \App\Support\VersionShares;
        $input=['level'=>3,'days'=>7,'recipient_ids'=>[$one->id],'label'=>'Clase A'];
        $g=$s->issue($a,$d->id,$v,$input);self::assertSame(3,$g['grant']['level']);self::assertSame('restricted',$g['grant']['audience_mode']);
        self::assertStringContainsString('T',$g['grant']['expires_at']);
        self::assertSame([$one->id],DB::table('version_share_recipients')->where('grant_id',$g['grant']['id'])->pluck('user_id')->map(fn($id)=>(int)$id)->all());
        $token=explode('#token=',$g['url'])[1];
        self::assertSame(hash('sha256',$token),DB::table('version_summary_grants')->where('id',$g['grant']['id'])->value('digest'));
        foreach([[],[$three->id],[$a->id],[$two->email]] as $ids) $this->denied(fn()=>$s->issue($a,$d->id,$v,array_replace($input,['recipient_ids'=>$ids])),422);
        $this->denied(fn()=>$s->issue($b,$d->id,$v,$input));
        $this->denied(fn()=>$s->issue($a,$d->id,$v,['level'=>3,'days'=>7,'audience_mode'=>'signed_in_link']),422);
        $open=$s->issue($a,$d->id,$v,['level'=>3,'days'=>1,'audience_mode'=>'signed_in_link','forwardable_accepted'=>true]);$openToken=explode('#token=',$open['url'])[1];
        $gate=new VersionShareGate;$request=$this->login($three);
        self::assertSame(3,$gate->cardResponse($request,$openToken)->getData(true)['level']);
        $this->denied(fn()=>$gate->cardResponse($request,$token));
        $request=$this->login($one);$card=$gate->cardResponse($request,$token)->getData(true);
        self::assertSame($html,$card['reading']['snapshot_html']);self::assertFalse($card['summary']['coverage']['complete']);
        foreach([1,2] as $level) {
            $g2=$s->issue($a,$d->id,$v,['level'=>$level,'days'=>30]);$t=explode('#token=',$g2['url'])[1];
            $result=$gate->cardResponse(Request::create('/'),$t)->getData(true);
            self::assertSame($level,$result['level']);self::assertSame(1,$result['seal']['version_number']);self::assertArrayNotHasKey('reading',$result);
            if($level===1) self::assertArrayNotHasKey('summary',$result);
            else self::assertSame('limited',$result['summary']['coverage']['status']);
            $this->denied(fn()=>$gate->page($request,$t));
        }
        $listing=$s->listing($a,$d->id,$v);self::assertCount(8,$listing);
        foreach($listing as $row) {self::assertArrayNotHasKey('digest',$row);self::assertArrayNotHasKey('secret',$row);}
        (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);$this->denied(fn()=>$gate->cardResponse($request,$token));
        self::assertSame(3,$gate->cardResponse($request,$openToken)->getData(true)['level']);
    }
    public function test_ordinary_http_owner_reader_headers_csrf_and_no_scope_elevation(): void
    {
        extract($this->fixture());$this->login($a);$base='/process-summary/share/manage/'.$d->id.'/'.$v;
        $this->withHeader('Origin','http://127.0.0.1:8084');
        $this->get($base)->assertOk();$this->get($base.'/grants')->assertOk()->assertJsonCount(2,'recipients');
        $g=$this->postJson($base.'/grants',['level'=>3,'days'=>7,'recipient_ids'=>[$one->id]])->assertCreated()->json();$secret=explode('#token=',$g['url'])[1];
        $this->login($two);$this->get($base.'/grants')->assertNotFound();
        $this->postJson('/process-summary/share/query',['capability'=>$secret])->assertNotFound();
        $this->login($one);$response=$this->postJson('/process-summary/share/query',['capability'=>$secret])->assertOk();
        $response->assertJsonPath('level',3)->assertJsonPath('reading.snapshot_html',$html)->assertHeader('Referrer-Policy','no-referrer');
        $this->postJson('/process-summary/share/query?capability='.$secret,['capability'=>$secret])->assertNotFound();
        $this->postJson('/process-summary/share/query',['capability'=>'VRT-PUBLIC','level'=>3])->assertNotFound();
        foreach(['/api/documents/'.$d->id, '/api/documents/'.$d->id.'/timeline', '/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source'] as $path) {
            $this->login($three);$this->getJson($path)->assertNotFound();
        }
        $this->login($one);$csrf='synthetic-r3-csrf';$this->app['env']='production';
        $this->flushHeaders();$this->withHeader('Host','127.0.0.1:8084')->withHeader('Origin','http://127.0.0.1:8084')->postJson('/process-summary/share/query',['capability'=>$secret])->assertStatus(419);
        $this->withSession(['_token'=>$csrf])->withHeader('X-CSRF-TOKEN',$csrf)->withHeader('Origin','https://foreign.example.test')->postJson('/process-summary/share/query',['capability'=>$secret])->assertForbidden();
        $this->withHeader('Origin','http://127.0.0.1:8084')->postJson('/process-summary/share/query',['capability'=>$secret])->assertOk();
        $this->app['env']='testing';$this->login($a);
        $this->postJson($base.'/grants/'.$g['grant']['id'].'/revoke',[])->assertNoContent();
        $this->login($one);$this->postJson('/process-summary/share/query',['capability'=>$secret])->assertNotFound();
        $this->login($a);$this->get($base.'/grants/'.$g['grant']['id'].'/accesses')->assertOk()->assertJsonCount(1,'accounts');
        $this->patchJson($base.'/grants/'.$g['grant']['id'],['level'=>1])->assertStatus(405);
    }
    public function test_http_positive_image_and_secondary_endpoints_recheck_authorization(): void
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
            $this->withHeader('Origin','http://127.0.0.1:8084');
            $response=$this->postJson('/process-summary/share/image',['capability'=>$g['secret'],'image'=>$id])->assertOk();
            self::assertSame($bytes,$response->getContent());
            $this->getJson($image->url().'?version_id='.$version)->assertNotFound();
            $this->getJson('/api/documents/'.$d->id.'/versions/'.$version.'/pdf-source')->assertNotFound();$response->assertHeader('Content-Type','image/png')->assertHeader('Referrer-Policy','no-referrer');
            $this->postJson('/process-summary/share/event',['capability'=>$g['secret'],'event'=>999999])->assertNotFound();
            $this->postJson('/process-summary/share/image',['capability'=>$g['secret'],'image'=>$id,'event'=>999999])->assertNotFound();
            $this->denied(fn()=>$gate->image($request,$g['secret'],$id,999999));
            $this->denied(fn()=>$gate->image($request,$g['secret'],(string)Str::uuid()));
            self::assertSame(1,$this->countAccesses($g['grant']['id']));
            (new VersionSummaryCapabilities)->revoke($a,$d->id,$version,$g['grant']['id']);
            $this->denied(fn()=>$gate->image($request,$g['secret'],$id));
            self::assertSame(1,$this->countAccesses($g['grant']['id']));
            $this->postJson('/process-summary/share/image',['capability'=>$g['secret'],'image'=>$id])->assertNotFound();
            $this->postJson('/process-summary/share/event',['capability'=>$g['secret'],'event'=>1])->assertNotFound();
        } finally {unlink($file);rmdir($root);}
    }


    public function test_card_fresh_recheck_covers_all_levels_expiry_revocation_and_transactions(): void
    {
        extract($this->fixture());$s=new \App\Support\VersionShares;$gate=new VersionShareGate;
        foreach([1,2,3] as $level) {
            $g=$s->issue($a,$d->id,$v,['level'=>$level,'days'=>1]+($level===3?['recipient_ids'=>[$one->id]]:[]));$token=explode('#token=',$g['url'])[1];
            $r=$this->login($one);DB::beginTransaction();
            try{$this->denied(fn()=>$gate->cardResponse($r,$token),503);}finally{DB::rollBack();}
            DB::table('version_summary_grants')->where('id',$g['grant']['id'])->update(['expires_at_epoch'=>now('UTC')->subSecond()->getTimestamp()]);
            $this->denied(fn()=>$gate->cardResponse($r,$token));
        }
        $g=$s->issue($a,$d->id,$v,['level'=>3,'days'=>1,'recipient_ids'=>[$one->id]]);$token=explode('#token=',$g['url'])[1];$r=$this->login($one);
        $real=new \App\Support\HistoricalVersionSummary;
        $this->app->instance(\App\Support\HistoricalVersionSummary::class,new class($real,$g) {
            public function __construct(private $real,private $g){}
            public function summarize($owner,$document,$version) {
                $result=$this->real->summarize($owner,$document,$version);
                DB::table('version_summary_grants')->where('id',$this->g['grant']['id'])->update(['revoked_at'=>now()]);
                return $result;
            }
        });
        $this->denied(fn()=>$gate->cardResponse($r,$token));self::assertSame(0,$this->countAccesses($g['grant']['id']));
    }

    public function test_pdf_source_keeps_deliveries_and_capabilities_never_elevate_scope(): void
    {
        extract($this->fixture());
        $source='/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source';
        $otherSource='/api/documents/'.$d->id.'/versions/'.$v2.'/pdf-source';
        foreach ([$a,$one] as $reader) {
            $this->login($reader);$this->getJson($source)->assertOk()->assertJsonPath('snapshot_html',$html);
        }
        $this->login($a);$this->getJson($otherSource)->assertOk();
        $this->login($one);$this->getJson($otherSource.'?version_id='.$v)->assertNotFound();
        foreach ([1,2,3] as $level) {
            $g=(new \App\Support\VersionShares)->issue($a,$d->id,$v,['level'=>$level,'days'=>1]
                +($level===3?['audience_mode'=>'signed_in_link','forwardable_accepted'=>true]:[]));
            $secret=explode('#token=',$g['url'])[1];
            $this->login($b);$this->withHeader('Origin','http://127.0.0.1:8084');
            $this->postJson('/process-summary/share/query',['capability'=>$secret])->assertOk()->assertJsonPath('level',$level);
            foreach ([$source,$otherSource,'/api/documents/'.$d->id,'/api/documents/'.$d->id.'/timeline'] as $path) {
                $this->withHeader('Authorization','Bearer '.$secret)->getJson($path.'?capability='.$secret)->assertNotFound();
            }
            $this->app['auth']->forgetGuards();$this->flushSession();
            $this->getJson($source.'?capability='.$secret)->assertUnauthorized();
            $r=$this->postJson('/process-summary/share/query',['capability'=>$secret]);
            if ($level===3) {
                $r->assertUnauthorized();self::assertStringNotContainsString($html,$r->getContent());
            } else $r->assertOk()->assertJsonMissingPath('reading');
        }
    }

    public function test_new_collection_raw_authority_origin_forwarding_and_csrf_kernel(): void
    {
        config(['app.url'=>'http://localhost:8083','veritas.public_origin'=>'http://127.0.0.1:8084']);
        $shell='/process-summary/share';$query=$shell.'/query';
        $this->get($shell)->assertOk()->assertHeader('Referrer-Policy','no-referrer');
        $this->app['env']='production';
        $cases=[
            ['Host'=>'evil.example.test'],
            ['Host'=>'evil.example.test','X-Forwarded-Host'=>'127.0.0.1:8084'],
            ['X-Forwarded-Host'=>'evil.example.test'],
            ['X-Forwarded-Host'=>'127.0.0.1:8084, evil.example.test'],
            ['X-Forwarded-Proto'=>'https'], ['X-Forwarded-Proto'=>'http, https'],
            ['X-Forwarded-Prefix'=>'/foreign'], ['X-Forwarded-Port'=>'443'], ['Forwarded'=>'host=evil.example.test;proto=https'],
        ];
        foreach ($cases as $headers) {
            $this->flushHeaders();$this->withHeaders(['Host'=>'127.0.0.1:8084','Origin'=>'http://127.0.0.1:8084']);
            $this->withHeaders($headers);
            // Symfony Request::create derives raw Host from an absolute test URI.
            $origin='http://'.($headers['Host'] ?? '127.0.0.1:8084');
            foreach ([$this->get($origin.$shell),$this->postJson($origin.$query,[])] as $response) {
                $response->assertForbidden()->assertHeader('Referrer-Policy','no-referrer')->assertHeader('X-Robots-Tag','noindex, nofollow');
                self::assertStringContainsString('no-store',$response->headers->get('Cache-Control'));
                self::assertSame(['message'=>'Unavailable / No disponible'],$response->json());
            }
        }
        foreach ([null,'null','https://foreign.example.test','http://localhost:8083'] as $origin) {
            $this->flushHeaders();$this->withHeader('Host','127.0.0.1:8084');
            if ($origin!==null) $this->withHeader('Origin',$origin);
            $this->postJson($query,[])->assertForbidden();
        }
        $this->withHeader('Origin','http://127.0.0.1:8084')->withHeader('Sec-Fetch-Site','cross-site')->postJson($query,[])->assertForbidden();
        $this->withHeader('Sec-Fetch-Site','same-origin')->postJson($query,[])->assertStatus(419);
        $this->withSession(['_token'=>'synthetic-r7-csrf'])->withHeader('X-CSRF-TOKEN','synthetic-r7-csrf');
        // Matching forwarded metadata is tolerated, never used instead of Host.
        $this->withHeaders(['X-Forwarded-Host'=>'127.0.0.1:8084','X-Forwarded-Proto'=>'http','X-Forwarded-Port'=>'8084'])
            ->postJson($query,[])->assertNotFound();
        $this->get($shell)->assertOk();
        config(['veritas.public_origin'=>null]);$this->get($shell)->assertForbidden();
        $this->app['env']='testing';
    }

    public function test_ordinary_route_registration_management_scope_and_throttle(): void
    {
        $expected=[
            'process-summary/share'=>'shell', 'process-summary/share/query'=>'card',
            'process-summary/share/event'=>'event','process-summary/share/image'=>'image',
            'process-summary/share/manage/{document}/{version}'=>'owner',
            'process-summary/share/manage/{document}/{version}/grants/{grant}/accesses'=>'accesses',
        ];
        $seen=[];$fallback=false;
        foreach (app('router')->getRoutes() as $route) {
            if ($route->uri()==='{path?}') $fallback=true;
            if (isset($expected[$route->uri()])) {
                self::assertFalse($fallback);self::assertSame($expected[$route->uri()],$route->getActionMethod());
                self::assertContains('web',$route->gatherMiddleware());
                $seen[]=$route->uri();
            }
        }
        self::assertSame(array_keys($expected),$seen);
        extract($this->fixture());$base='/process-summary/share/manage/'.$d->id.'/'.$v;
        $this->getJson($base)->assertUnauthorized();
        $this->login($a);$this->get($base)->assertOk()->assertSee('data-version="'.$v.'"',false)->assertSee('data-document="'.$d->id.'"',false);
        $this->get('/process-summary/share/manage/'.$other->id.'/'.$v)->assertNotFound();
        $this->login($one);$this->getJson($base)->assertNotFound();
        $this->getJson($base.'/grants')->assertNotFound();
        $this->withHeader('Origin','http://127.0.0.1:8084')->postJson($base.'/grants',['level'=>1,'days'=>1])->assertNotFound();
        $this->app['auth']->forgetGuards();$this->flushSession();
        // No controller replacement or middleware bypass; exhaust only the test's array cache.
        for($i=0;$i<31;$i++) $response=$this->get('/process-summary/share');
        $response->assertStatus(429)->assertHeader('Referrer-Policy','no-referrer');
        self::assertTrue($response->headers->has('Retry-After'));
    }

    public function test_ordinary_fixed_levels_utc_pages_audit_boundary_and_compatibility(): void
    {
        extract($this->fixture(20));$base='/process-summary/share/manage/'.$d->id.'/'.$v;
        $this->withHeader('Origin','http://127.0.0.1:8084');$this->login($a);
        $publicBefore=$this->get('/verify/'.DocumentVersion::findOrFail($v)->certificate->certificate_code)->assertOk()->getContent();
        $issued=[];
        foreach([1,2,3] as $level) {
            $g=$this->postJson($base.'/grants',['level'=>$level,'days'=>1]+($level===3?['recipient_ids'=>[$one->id]]:[]))->assertCreated()->json();
            $issued[$level]=[$g['grant']['id'],explode('#token=',$g['url'])[1]];
        }
        $open=$this->postJson($base.'/grants',['level'=>3,'days'=>1,'audience_mode'=>'signed_in_link','forwardable_accepted'=>true])->assertCreated()->json();
        $openToken=explode('#token=',$open['url'])[1];
        // Later events and later draft must never enter the sealed projection.
        $later='<p>LATER PRIVATE á é</p>';
        $this->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sessions[0],'events'=>[
            ['sequence'=>21,'event_type'=>'insert','after_html'=>$later,'elapsed_ms'=>21]]])->assertOk();
        $d->update(['content_html'=>$later]);
        $laterId=(int)DB::table('writing_events')->max('id');
        $before=[];foreach(['documents','document_versions','certificates','writing_sessions','writing_events','document_images'] as $table)$before[$table]=DB::table($table)->get()->toJson();
        $this->app['auth']->forgetGuards();$this->flushSession();
        foreach([1,2] as $level) {
            $r=$this->postJson('/process-summary/share/query',['capability'=>$issued[$level][1]])->assertOk()->assertJsonPath('level',$level)->assertJsonMissingPath('reading');
            if($level===1)$r->assertJsonMissingPath('summary');
            else $r->assertJsonPath('summary.coverage.complete',false)->assertJsonPath('summary.coverage.status','limited');
        }
        $this->postJson('/process-summary/share/query',['capability'=>$issued[3][1]])->assertUnauthorized();
        $this->login($two);$this->postJson('/process-summary/share/query',['capability'=>$issued[3][1]])->assertNotFound();
        $this->login($one);$body=['capability'=>$issued[3][1]];
        $first=$this->postJson('/process-summary/share/query',$body)->assertOk()->assertJsonPath('reading.snapshot_html',$html)->json('reading');
        self::assertCount(32,$first['events']);self::assertNotNull($first['next_after']);
        $last=$this->postJson('/process-summary/share/query',$body+['after'=>$first['next_after']])->assertOk()->json('reading');
        self::assertCount(8,$last['events']);self::assertNull($last['next_after']);
        $this->postJson('/process-summary/share/event',$body+['event'=>$laterId])->assertNotFound();
        $event=$first['events'][0];
        $this->postJson('/process-summary/share/event',$body+['event'=>$event['id']])->assertOk()->assertJsonPath('events.0.html',$html);
        $this->login($b);$this->postJson('/process-summary/share/query',['capability'=>$openToken])->assertOk()->assertJsonPath('reading.snapshot_html',$html);
        $this->getJson('/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source')->assertNotFound();
        // Existing C endpoint remains level 2; public verification is independent.
        $this->postJson('/process-summary/query',['capability'=>$issued[2][1]])->assertOk()->assertJsonPath('coverage.complete',false);
        foreach([1,3] as $level)$this->postJson('/process-summary/query',['capability'=>$issued[$level][1]])->assertNotFound();
        $this->login($a);$this->getJson($base.'/grants/'.$issued[3][0].'/accesses')->assertOk()->assertJsonPath('accounts.0.access_count',3);
        $this->postJson($base.'/grants/'.$issued[3][0].'/revoke',[])->assertNoContent();
        $this->login($one);$this->postJson('/process-summary/share/query',$body+['after'=>$first['next_after']])->assertNotFound();
        $this->postJson('/process-summary/share/event',$body+['event'=>$event['id']])->assertNotFound();
        // UTC epoch is the new-grant authority, independently of display SQL dates.
        DB::table('version_summary_grants')->where('id',$open['grant']['id'])->update(['expires_at_epoch'=>now('UTC')->subSecond()->getTimestamp()]);
        $this->postJson('/process-summary/share/query',['capability'=>$openToken])->assertNotFound();
        self::assertSame($publicBefore,$this->get('/verify/'.DocumentVersion::findOrFail($v)->certificate->certificate_code)->assertOk()->getContent());
        foreach($before as $table=>$rows)self::assertSame($rows,DB::table($table)->get()->toJson());
    }

}
