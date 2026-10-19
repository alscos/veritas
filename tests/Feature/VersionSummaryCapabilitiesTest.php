<?php
namespace Tests\Feature;
use App\Models\{User, Document, DocumentVersion};
use App\Support\{HistoricalVersionSummary,VersionSummaryCapabilities as S};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\{DB,Route};
use Tests\TestCase;

final class VersionSummaryCapabilitiesTest extends TestCase
{
    use DatabaseMigrations;
    private function fixture(): array {
        config(['veritas.seal_format'=>3,'app.url'=>'http://localhost:8083','veritas.public_origin'=>'http://127.0.0.1:8084']);
        $a=User::create(['name'=>'PRIVATE NAME','email'=>'private-a@example.test','password'=>'synthetic']);
        $b=User::create(['name'=>'B','email'=>'private-b@example.test','password'=>'synthetic']);
        $d=Document::create(['owner_id'=>$a->id,'title'=>'PRIVATE TITLE','word_count'=>2,'content_html'=>'<p>PRIVATE SNAPSHOT</p>']);
        $other=Document::create(['owner_id'=>$b->id,'word_count'=>1,'content_html'=>'<p>OTHER</p>']);
        $v=$this->actingAs($a)->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $v2=$this->actingAs($b)->postJson('/api/documents/'.$other->id.'/seal')->assertCreated()->json('version.id');
        return [$a,$b,$d,$other,$v,$v2];
    }
    private function denied(callable $f, int $status=404): void {
        try {$f();self::fail('Unexpected authorization');}
        catch (\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {self::assertSame($status,$e->getStatusCode());}
    }
    public function test_digest_ttl_owner_inventory_crosses_revocation_and_readonly(): void {
        [$a,$b,$d,$other,$v,$v2]=$this->fixture();$s=new S;
        DB::table('submissions')->insert(['id'=>(string) \Illuminate\Support\Str::uuid(),'document_version_id'=>$v,'sender_id'=>$a->id,'recipient_user_id'=>$b->id,'submitted_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        $one=$s->issue($a,$d->id,$v);$two=$s->issue($a,$d->id,$v,30);
        self::assertNotSame($one['secret'],$two['secret']);self::assertSame(43,strlen($one['secret']));
        self::assertSame(32,strlen(base64_decode(strtr($one['secret'],'-_','+/').'=')));
        $row=DB::table('version_summary_grants')->where('id',$one['grant']['id'])->first();
        self::assertSame(hash('sha256',$one['secret']),$row->digest);
        self::assertGreaterThan(6.99,now()->diffInDays(\App\Support\GrantTime::instant($row, 'expires_at'),false));
        self::assertLessThanOrEqual(7*86400,now()->diffInSeconds(\App\Support\GrantTime::instant($row, 'expires_at')));
        foreach([[$b,$d,$v],[$a,$other,$v2],[$a,$d,$v2]] as [$u,$doc,$ver]) {
            $this->denied(fn()=>$s->issue($u,$doc->id,$ver));
            $this->denied(fn()=>$s->listing($u,$doc->id,$ver));
            $this->denied(fn()=>$s->revoke($u,$doc->id,$ver,$one['grant']['id']));
        }
        foreach([0,31] as $ttl)$this->denied(fn()=>$s->issue($a,$d->id,$v,$ttl),422);
        $inventory=json_encode($s->listing($a,$d->id,$v));self::assertStringNotContainsString('digest',$inventory);self::assertStringNotContainsString($one['secret'],$inventory);
        $before=[];foreach(['documents','document_versions','writing_events','writing_sessions','certificates','version_evidence','version_summary_grants'] as $t)$before[$t]=DB::table($t)->get()->toJson();
        $r=$s->redeem($one['secret']);self::assertSame(2,$r['counts']['value']['total']);
        foreach($before as $t=>$value)self::assertSame($value,DB::table($t)->get()->toJson());
        $json=json_encode($r);foreach(['PRIVATE','private-a@',$d->id,$v,'snapshot','html','event','digest','signature','/api/'] as $forbidden)self::assertStringNotContainsString($forbidden,$json);
        foreach(['times','pauses','ppm','last_ppm'] as $k)self::assertSame(['state'=>'unavailable','value'=>null],$r[$k]);
        $d->update(['content_html'=>'<p>LATER DRAFT WITH DIFFERENT COUNTS</p>']);
        $this->actingAs($a)->postJson('/api/documents/'.$d->id.'/seal')->assertCreated();self::assertSame($r,$s->redeem($one['secret']));
        $s->revoke($a,$d->id,$v,$one['grant']['id']);$s->revoke($a,$d->id,$v,$one['grant']['id']);
        $this->denied(fn()=>$s->redeem($one['secret']));self::assertSame($r,$s->redeem($two['secret']));
        foreach(['','VRT-123','x'.substr($two['secret'],1),str_repeat('A',43)] as $bad)$this->denied(fn()=>$s->redeem($bad));
        $this->travel(31)->days();$this->denied(fn()=>$s->redeem($two['secret']));
    }
    public function test_rejects_inherited_transactions_even_in_sqlite(): void {
        [$a,,$d,,$v]=$this->fixture();$s=new S;$g=$s->issue($a,$d->id,$v);
        DB::beginTransaction();
        try {
            $this->denied(fn()=>$s->redeem($g['secret']),503);
            $this->denied(fn()=>$s->issue($a,$d->id,$v),503);
            $this->denied(fn()=>$s->revoke($a,$d->id,$v,$g['grant']['id']),503);
        } finally {DB::rollBack();}
        self::assertSame(2,$s->redeem($g['secret'])['counts']['value']['total']);
    }
    public function test_recheck_revocation_expiry_and_ownership_during_computation(): void {
        [$a,$b,$d,,$v]=$this->fixture();$s=new S;
        foreach(['revoke','expire','owner'] as $action) {
            $d->update(['owner_id'=>$a->id]);$g=$s->issue($a,$d->id,$v,1);
            $real=new HistoricalVersionSummary;
            $this->app->instance(HistoricalVersionSummary::class,new class($real,$action,$s,$a,$b,$d,$v,$g) {
                public function __construct(private $real,private $action,private $s,private $a,private $b,private $d,private $v,private $g){}
                public function summarize($a,$d,$v) {
                    $r=$this->real->summarize($a,$d,$v);
                    if($this->action==='revoke')$this->s->revoke($this->a,$this->d->id,$this->v,$this->g['grant']['id']);
                    elseif($this->action==='expire')DB::table('version_summary_grants')->where('id',$this->g['grant']['id'])->update(['expires_at_epoch'=>now('UTC')->subSecond()->getTimestamp()]);
                    else $this->d->update(['owner_id'=>$this->b->id]);
                    return $r;
                }
            });
            $this->denied(fn()=>$s->redeem($g['secret']));$this->app->forgetInstance(HistoricalVersionSummary::class);
        }
    }
    public function test_v2_limited_tamper_missing_boundary_budget_and_projection(): void {
        [$a,,$d,,$v]=$this->fixture();$s=new S;config(['veritas.seal_format'=>2]);
        $v=$this->actingAs($a)->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');$g=$s->issue($a,$d->id,$v);
        $r=$s->redeem($g['secret']);self::assertSame('limited',$r['coverage']['status']);self::assertFalse($r['coverage']['complete']);
        $version=DocumentVersion::findOrFail($v);$html=$version->snapshot_html;
        $version->update(['snapshot_html'=>'<p>TAMPER</p>']);self::assertNull($s->redeem($g['secret'])['counts']['value']);
        $version->update(['snapshot_html'=>$html]);config(['veritas.verification.rows'=>0]);self::assertNull($s->redeem($g['secret'])['counts']['value']);
        config(['veritas.verification.rows'=>100000]);
        $c=$version->certificate;$p=$c->signed_payload;unset($p['history_boundary']);ksort($p);$c->update(['signed_payload'=>$p,'signature'=>hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),config('veritas.signing_key'))]);
        self::assertNull($s->redeem($g['secret'])['counts']['value']);
        $this->denied(fn()=>$s->issue($a,$d->id,$v),409);
        $raw=(new HistoricalVersionSummary)->summarize($a,$d->id,$v);$raw['PRIVATE']='secret';$dto=S::project($raw);
        self::assertSame(['schema','version','coverage','counts','times','pauses','ppm','last_ppm'],array_keys($dto));self::assertNull($dto['version']['number']);self::assertNull($dto['counts']['value']);
    }
    public function test_runtime_routes_keep_level_one_and_private_surfaces_closed(): void {
        [$a,,$d,,$v]=$this->fixture();$code=DocumentVersion::find($v)->certificate->certificate_code;
        $before=$this->getJson('/api/verify/'.$code)->assertOk()->json();$s=new S;$g=$s->issue($a,$d->id,$v);
        self::assertSame($before,$this->getJson('/api/verify/'.$code)->assertOk()->json());
        $this->withHeader('Origin','http://127.0.0.1:8084')->postJson('/process-summary/query',['capability'=>$g['secret']])->assertOk();
        $this->get('/process-summary')->assertOk()->assertHeader('X-Robots-Tag','noindex, nofollow');
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source')->assertUnauthorized();
        $this->getJson('/api/documents/'.$d->id.'/timeline')->assertUnauthorized();
    }
    public function test_candidate_http_csrf_origin_headers_throttle_and_no_enumeration(): void {
        [$a,$b,$d,,$v]=$this->fixture();$s=new S;$g=$s->issue($a,$d->id,$v);
        $this->app['auth']->forgetGuards();
        // Laravel disables CSRF in testing. Turn only this bypass off after isolated DB setup.
        $this->app['env']='production';
        $shell=$this->get('/process-summary')->assertOk();self::assertStringNotContainsString($g['secret'],$shell->getContent());
        $body=['capability'=>$g['secret']];
        $this->withHeader('Origin','http://127.0.0.1:8084')->postJson('/process-summary/query',$body)->assertStatus(419)->assertHeader('Referrer-Policy','no-referrer');
        $ownerPath='/api/summary-grants/'.$d->id.'/'.$v;
        $this->actingAs($a)->postJson($ownerPath,['days'=>7])->assertStatus(419)->assertHeader('X-Robots-Tag','noindex, nofollow');
        $this->postJson($ownerPath.'/'.$g['grant']['id'].'/revoke',[])->assertStatus(419);
        $this->app['auth']->forgetGuards();
        $csrf='synthetic-csrf';$this->withSession(['_token'=>$csrf])->withHeader('X-CSRF-TOKEN',$csrf);
        $this->withHeader('Origin','https://evil.example')->postJson('/process-summary/query',$body)->assertForbidden();
        $this->withHeader('Origin','http://127.0.0.1:8084')->withHeader('Sec-Fetch-Site','cross-site')->postJson('/process-summary/query',$body)->assertForbidden();
        $this->withHeader('Sec-Fetch-Site','same-origin');
        $this->withHeader('Origin','http://localhost:8083')->withHeader('X-Forwarded-Host','localhost:8083')->withHeader('X-Forwarded-Proto','http')->postJson('/process-summary/query',$body)->assertForbidden();
        $this->withHeader('Origin','http://127.0.0.1:8084')->withHeader('Host','forged.example')->withHeader('X-Forwarded-Host','forged.example')->postJson('/process-summary/query',$body)->assertOk();
        $this->withHeader('Host','localhost')->withHeader('X-Forwarded-Host','localhost');
        $ok=$this->postJson('/process-summary/query',$body)->assertOk();
        foreach(['Referrer-Policy'=>'no-referrer','X-Robots-Tag'=>'noindex, nofollow'] as $k=>$val)$ok->assertHeader($k,$val);
        self::assertStringContainsString('no-store',$ok->headers->get('Cache-Control'));self::assertStringContainsString("default-src 'none'",$ok->headers->get('Content-Security-Policy'));
        $bad=$this->postJson('/process-summary/query',['capability'=>'VRT-public'])->assertNotFound()->json();
        self::assertSame($bad,$this->postJson('/process-summary/query',[])->assertNotFound()->json());
        // A verifier/SQL failure cannot reflect the secret or reach Laravel's error logger.
        \Illuminate\Support\Facades\Log::spy();
        $this->app->instance(HistoricalVersionSummary::class,new class {
            public function summarize($a,$d,$v) { throw new \RuntimeException('PRIVATE '.str_repeat('A',43)); }
        });
        $failure=$this->postJson('/process-summary/query',$body)->assertNotFound();
        self::assertSame($bad,$failure->json());
        \Illuminate\Support\Facades\Log::shouldNotHaveReceived('error');
        $this->app->forgetInstance(HistoricalVersionSummary::class);
        $s->revoke($a,$d->id,$v,$g['grant']['id']);self::assertSame($bad,$this->postJson('/process-summary/query',$body)->assertNotFound()->json());
        $path='/api/summary-grants/'.$d->id.'/'.$v;
        $this->getJson($path)->assertUnauthorized();
        $this->actingAs($b)->postJson($path,['days'=>7])->assertNotFound();
        $this->actingAs($a)->postJson($path,['days'=>31])->assertUnprocessable();
        $issued=$this->postJson($path,['days'=>1])->assertCreated();self::assertStringStartsWith('/process-summary#token=',$issued->json('url'));
        $this->getJson($path)->assertOk()->assertJsonMissingPath('grants.0.digest');
        $this->postJson($path.'/'.$issued->json('grant.id').'/revoke',[])->assertNoContent();
        $last=null;for($i=0;$i<13;$i++)$last=$this->postJson('/process-summary/query',[]);
        $last->assertStatus(429)->assertHeader('Referrer-Policy','no-referrer');
        $this->app['env']='testing';
    }
    public function test_canonical_public_origin_is_strict_and_configuration_fails_closed(): void {
        config(['app.url'=>'http://localhost:8083','veritas.public_origin'=>'http://127.0.0.1:8084']);
        $this->app['env']='production';
        $csrf='synthetic-r5';
        $this->withSession(['_token'=>$csrf])->withHeader('X-CSRF-TOKEN',$csrf);
        // A syntactically invalid capability reaches the neutral 404 only after Origin + CSRF.
        $this->withHeader('Origin','http://127.0.0.1:8084')->postJson('/process-summary/query',[])->assertNotFound();
        foreach ([null,'null','http://localhost:8083','http://localhost:8084',
            'http://127.0.0.1:8083','https://127.0.0.1:8084','http://127.0.0.1:8084/',
            'http://127.0.0.1:8084, http://evil.test'] as $origin) {
            $this->flushHeaders();
            $this->withHeader('X-CSRF-TOKEN',$csrf)->withHeader('Host','127.0.0.1:8084')
                ->withHeader('X-Forwarded-Host','127.0.0.1:8084')->withHeader('X-Forwarded-Proto','http');
            if ($origin !== null) $this->withHeader('Origin',$origin);
            $r=$this->postJson('/process-summary/query',[])->assertForbidden();
            $r->assertHeader('Referrer-Policy','no-referrer');
            self::assertStringContainsString('no-store',$r->headers->get('Cache-Control'));
            self::assertStringContainsString("default-src 'none'",$r->headers->get('Content-Security-Policy'));
        }
        foreach ([null,'',[],false,'//127.0.0.1:8084','ftp://127.0.0.1:8084',
            'http://user@127.0.0.1:8084','http://u:p@127.0.0.1:8084',
            'http://127.0.0.1:8084/path','http://127.0.0.1:8084?x',
            'http://127.0.0.1:8084#x','http://127.0.0.1:0','http://bad_host:8084',
            "http://127.0.0.1:8084\n",'http://127.0.0.1:8084\\evil'] as $bad) {
            config(['veritas.public_origin'=>$bad]);
            $this->withHeader('Origin','http://127.0.0.1:8084');
            $r=$this->postJson('/process-summary/query',[])->assertForbidden();
            $r->assertHeader('Referrer-Policy','no-referrer');
            self::assertStringContainsString('no-store',$r->headers->get('Cache-Control'));
            self::assertStringContainsString("default-src 'none'",$r->headers->get('Content-Security-Policy'));
        }
        config(['veritas.public_origin'=>'http://127.0.0.1:8084/']);
        $this->withHeader('Origin','http://127.0.0.1:8084')->postJson('/process-summary/query',[])->assertNotFound();
        // Scope remains capability paths only, even if the public origin is unavailable.
        config(['veritas.public_origin'=>null]);
        $this->postJson('/api/documents',[])->assertUnauthorized();
        $this->app['env']='testing';
    }

}
