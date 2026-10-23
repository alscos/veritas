<?php
namespace Tests\Feature;

use App\Models\{Document, User};
use App\Support\{VersionShares, VersionShareGate, VersionSummaryCapabilities};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Auth, DB};
use Illuminate\Support\Str;
use Tests\TestCase;

final class UnifiedVersionShareTest extends TestCase
{
    use DatabaseMigrations;

    private function fixture(): array
    {
        $this->withoutVite();
        config(['veritas.seal_format'=>2,'veritas.public_origin'=>'http://localhost']);
        $a=User::create(['name'=>'Author','email'=>'author@unified.test','password'=>'test-password-123']);
        $b=User::create(['name'=>'Reader','email'=>'reader@unified.test','password'=>'test-password-123']);
        $c=User::create(['name'=>'Other','email'=>'other@unified.test','password'=>'test-password-123']);
        $html='<p>á génesis <mark data-origin="paste">pegado</mark> <mark data-origin="paste-edited">azul</mark><br><br></p><p></p>';
        $d=Document::create(['owner_id'=>$a->id,'content_html'=>$html,'word_count'=>4]);
        $this->actingAs($a);
        $sid=(string)Str::uuid();
        $this->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sid,'events'=>[
            ['sequence'=>1,'event_type'=>'insert','elapsed_ms'=>1,'after_html'=>$html],
        ]])->assertOk();
        $v=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $input=['operation_key'=>(string)Str::uuid(),'level'=>3,'days'=>1,'recipient_emails'=>[$b->email]];
        return compact('a','b','c','d','v','input','html','sid');
    }

    private function login(User $user): Request
    {
        $this->app['auth']->forgetGuards();$this->flushSession();app('session.store')->start();
        Auth::guard('web')->login($user);
        $r=Request::create('/process-summary/share/query','POST');
        $r->setLaravelSession(app('session.store'));return $r;
    }
    private function denied(callable $call, int $code=404): void
    {
        try {$call();self::fail('Unexpected authorization');}
        catch(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {self::assertSame($code,$e->getStatusCode());}
    }

    public function test_new_v2_and_v3_share_after_nested_json_order_changes(): void
    {
        extract($this->fixture());
        $this->withHeader('Origin','http://localhost');
        $d->update(['page_settings'=>['orientation'=>'portrait','format'=>'a4','margin'=>20]]);
        $reorder = function (array $p) use (&$reorder): array {
            foreach ($p as &$value) if (is_array($value)) $value=$reorder($value);
            unset($value); krsort($p,SORT_STRING); return $p;
        };
        foreach ([2,3] as $format) {
            config(['veritas.seal_format'=>$format]);
            $version=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
            $certificate=\App\Models\Certificate::where('document_version_id',$version)->firstOrFail();
            self::assertSame(\App\Support\CertificatePayload::ENCODING,$certificate->signed_payload['payload_encoding']);
            $certificate->update(['signed_payload'=>$reorder($certificate->signed_payload)]);
            $this->postJson('/process-summary/share/manage/'.$d->id.'/'.$version.'/grants',
                array_replace($input,['operation_key'=>(string)Str::uuid()]))->assertCreated();
            $certificate->update(['signature'=>str_repeat('0',64)]);
            $this->postJson('/process-summary/share/manage/'.$d->id.'/'.$version.'/grants',
                array_replace($input,['operation_key'=>(string)Str::uuid()]))->assertStatus(409);
        }
    }

    public function test_reconstructed_historical_v2_can_share_without_changing_certificate(): void
    {
        extract($this->fixture());$this->withHeader('Origin','http://localhost');
        $c=\App\Models\Certificate::where('document_version_id',$v)->firstOrFail();
        $p=$c->signed_payload;unset($p['payload_encoding']);ksort($p);ksort($p['history_boundary']);
        $sig=hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),config('veritas.signing_key'));
        foreach ($p['history_boundary'] as &$head) ksort($head);
        unset($head);$c->update(['signed_payload'=>$p,'signature'=>$sig]);
        $before=$c->fresh()->getAttributes();
        $base='/process-summary/share/manage/'.$d->id.'/'.$v.'/grants';
        $this->postJson($base,$input)->assertCreated();
        $this->postJson($base,$input)->assertCreated()->assertJsonPath('replayed',true);
        $this->postJson($base,array_replace($input,['days'=>2]))->assertStatus(409);
        self::assertSame($before,$c->fresh()->getAttributes());
    }

    public function test_atomic_nominal_delivery_idempotency_and_no_legacy_shortcut(): void
    {
        extract($this->fixture());$s=new VersionShares;
        $g=$s->issue($a,$d->id,$v,$input);$id=$g['grant']['id'];
        self::assertSame(0,DB::table('submissions')->count());
        self::assertSame(1,DB::table('version_share_deliveries')->where('grant_id',$id)->where('user_id',$b->id)->count());
        self::assertSame(1,DB::table('version_share_recipients')->where('grant_id',$id)->count());
        $repeat=$s->issue($a,$d->id,$v,$input);
        self::assertSame($id,$repeat['grant']['id']);self::assertNull($repeat['url']);self::assertTrue($repeat['replayed']);
        self::assertSame(1,DB::table('version_summary_grants')->count());
        $this->denied(fn()=>$s->issue($a,$d->id,$v,array_replace($input,['days'=>2])),409);
        $token=explode('#token=',$g['url'])[1];
        self::assertStringNotContainsString($token,json_encode(DB::table('version_summary_grants')->first()));
        $r=$this->login($b);$gate=new VersionShareGate;
        self::assertSame($html,$gate->deliveryResponse($r,$id)->getData(true)['snapshot_html']);
        self::assertSame($html,$gate->cardResponse($r,$token)->getData(true)['reading']['snapshot_html']);
        self::assertSame($html,$gate->deliveryResponse($r,$id,'pdf')->getData(true)['snapshot_html']);
        foreach(['/api/documents/'.$d->id,'/api/documents/'.$d->id.'/timeline?version_id='.$v,
            '/api/documents/'.$d->id.'/versions/'.$v,'/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source'] as $url) {
            $this->getJson($url)->assertNotFound();
        }
        $r=$this->login($c);$this->denied(fn()=>$gate->deliveryResponse($r,$id));
        $this->denied(fn()=>$gate->cardResponse($r,$token));
    }

    public function test_revoke_expire_and_final_recheck_close_link_delivery_and_pdf(): void
    {
        extract($this->fixture());$s=new VersionShares;$gate=new VersionShareGate;
        $g=$s->issue($a,$d->id,$v,$input);$id=$g['grant']['id'];$token=explode('#token=',$g['url'])[1];
        $r=$this->login($b);
        $method=new \ReflectionMethod($gate,'readDigest');
        // Deterministic SQLite logic interleave, not concurrent SQL connections.
        $this->denied(fn()=>$method->invoke($gate,$r,hash('sha256',$token),3,function () use ($a,$d,$v,$id) {
            $response=response()->json(['snapshot_html'=>'must never return']);
            (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$id);
            return $response;
        }));
        self::assertSame(0,DB::table('version_share_accesses')->count());
        foreach(['page','pdf','image'] as $resource) $this->denied(fn()=>$gate->deliveryResponse($r,$id,$resource,0,(string)Str::uuid()));
        $this->denied(fn()=>$gate->cardResponse($r,$token));
        self::assertSame(1,DB::table('version_share_deliveries')->count());
        $g=$s->issue($a,$d->id,$v,array_replace($input,['operation_key'=>(string)Str::uuid()]));
        $this->travel(2)->days();
        foreach(['page','pdf','image'] as $resource) $this->denied(fn()=>$gate->deliveryResponse($r,$g['grant']['id'],$resource,0,(string)Str::uuid()));
        $this->denied(fn()=>$gate->cardResponse($r,explode('#token=',$g['url'])[1]));
        $this->travelBack();
    }

    public function test_failure_after_first_delivery_rolls_back_every_row(): void
    {
        extract($this->fixture());$fail=true;
        DB::listen(function ($query) use (&$fail) {
            if ($fail && str_starts_with($query->sql,'insert into "version_share_deliveries"')) {
                $fail=false;throw new \RuntimeException('Injected receipt failure');
            }
        });
        try {(new VersionShares)->issue($a,$d->id,$v,$input);self::fail('Expected failure');}
        catch(\RuntimeException $e) {self::assertSame('Injected receipt failure',$e->getMessage());}
        foreach(['version_summary_grants','version_share_recipients','version_share_deliveries'] as $table) self::assertSame(0,DB::table($table)->count());
        $g=(new VersionShares)->issue($a,$d->id,$v,$input);
        self::assertSame(1,DB::table('version_share_deliveries')->where('grant_id',$g['grant']['id'])->count());
    }

    public function test_independent_submission_and_signed_in_link_remain_independent(): void
    {
        extract($this->fixture());$s=new VersionShares;$gate=new VersionShareGate;
        $g=$s->issue($a,$d->id,$v,$input);
        DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'sender_id'=>$a->id,'recipient_user_id'=>$b->id,'document_version_id'=>$v,'submitted_at'=>now()]);
        (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);
        $r=$this->login($b);$this->denied(fn()=>$gate->deliveryResponse($r,$g['grant']['id']));
        $this->getJson('/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source')->assertOk();
        $open=$s->issue($a,$d->id,$v,['operation_key'=>(string)Str::uuid(),'level'=>3,'days'=>1,'audience_mode'=>'signed_in_link','forwardable_accepted'=>true]);
        self::assertSame(1,DB::table('version_share_deliveries')->count());
        $r=$this->login($c);
        self::assertSame(3,$gate->cardResponse($r,explode('#token=',$open['url'])[1])->getData(true)['level']);
        $this->denied(fn()=>$gate->deliveryResponse($r,$open['grant']['id']));
    }

    public function test_tombstones_are_minimal_and_do_not_hide_independent_permissions(): void
    {
        extract($this->fixture());$g=(new VersionShares)->issue($a,$d->id,$v,$input);
        $listing=new \App\Support\VersionShareDeliveries;
        self::assertCount(1,$listing->listing($a)['sent']);
        self::assertCount(1,$listing->listing($b)['received']);
        self::assertSame(['sent'=>[],'received'=>[]],$listing->listing($c));
        (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);
        DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'sender_id'=>$a->id,'recipient_user_id'=>$b->id,'document_version_id'=>$v,'submitted_at'=>now()]);
        $item=$listing->listing($b)['received'][0];
        self::assertSame('revoked',$item['state']);self::assertTrue($item['independent_submission']);
        foreach(['snapshot_html','events','images','digest','share_operation_key','email','label'] as $key) self::assertArrayNotHasKey($key,$item);
        self::assertStringNotContainsString('génesis',json_encode($item));
    }

    public function test_delivery_constraints_and_no_retroactive_legacy_link(): void
    {
        extract($this->fixture());
        $legacy=(new VersionSummaryCapabilities)->issue($a,$d->id,$v);
        $migration=require database_path('migrations/2026_10_19_000011_link_version_share_deliveries.php');
        $migration->down();
        $before=DB::table('version_summary_grants')->where('id',$legacy['grant']['id'])->first();
        $migration->up();
        $after=DB::table('version_summary_grants')->where('id',$legacy['grant']['id'])->first();
        self::assertSame($before->digest,$after->digest);self::assertNull($after->share_operation_key);
        self::assertSame(0,DB::table('version_share_deliveries')->count());
        $g=(new VersionShares)->issue($a,$d->id,$v,$input);
        foreach ([$b->id,$c->id] as $user) {
            try {
                DB::table('version_share_deliveries')->insert(['grant_id'=>$g['grant']['id'],'user_id'=>$user,'presented_at'=>now()]);
                self::fail('Expected duplicate or composite foreign key rejection');
            } catch (\Illuminate\Database\QueryException $e) {
                self::assertStringContainsString($user===$b->id?'UNIQUE':'FOREIGN KEY',$e->getMessage());
            }
        }
    }

    public function test_exact_version_boundary_and_image_pdf_are_rechecked(): void
    {
        extract($this->fixture());$s=new VersionShares;$gate=new VersionShareGate;
        $old=$s->issue($a,$d->id,$v,$input);
        $root=sys_get_temp_dir().'/m34a-image-'.Str::uuid();mkdir($root,0700);config(['veritas.media_path'=>$root]);
        $id=(string)Str::uuid();$file=$root.'/'.$id.'.png';
        $bytes=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5x8AAAAASUVORK5CYII=');file_put_contents($file,$bytes);
        try {
            $image=\App\Models\DocumentImage::create(['id'=>$id,'document_id'=>$d->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
            $later='<p>LATER PRIVATE</p><img src="'.$image->url().'">';
            $this->actingAs($a);
            $this->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sid,'events'=>[
                ['sequence'=>2,'event_type'=>'insert','elapsed_ms'=>2,'after_html'=>$later],
            ]])->assertOk();
            $lateEvent=(int)DB::table('writing_events')->max('id');
            $d->update(['content_html'=>$later]);
            $v2=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
            $new=$s->issue($a,$d->id,$v2,array_replace($input,['operation_key'=>(string)Str::uuid(),'recipient_emails'=>[$c->email]]));
            $r=$this->login($b);
            $page=$gate->deliveryResponse($r,$old['grant']['id'])->getData(true);
            self::assertSame($html,$page['snapshot_html']);self::assertCount(1,$page['events']);
            $this->denied(fn()=>$gate->deliveryResponse($r,$old['grant']['id'],'page',0,null,$lateEvent));
            $this->denied(fn()=>$gate->deliveryResponse($r,$old['grant']['id'],'image',0,$id));
            $this->denied(fn()=>$gate->deliveryResponse($r,$new['grant']['id']));
            $r=$this->login($c);
            self::assertSame($bytes,$gate->deliveryResponse($r,$new['grant']['id'],'image',0,$id)->getContent());
            $this->withHeader('Origin','http://localhost');
            $httpImage='/process-summary/share/deliveries/'.$new['grant']['id'].'/image';
            self::assertSame($bytes,$this->postJson($httpImage,['image'=>$id])->assertOk()->getContent());
            self::assertSame($later,$gate->deliveryResponse($r,$new['grant']['id'],'pdf')->getData(true)['snapshot_html']);
            // Original image URL remains a denied legacy shortcut for this nominal grant.
            $this->getJson($image->url().'?version_id='.$v2)->assertNotFound();
            (new VersionSummaryCapabilities)->revoke($a,$d->id,$v2,$new['grant']['id']);
            foreach(['page','pdf','image'] as $resource) $this->denied(fn()=>$gate->deliveryResponse($r,$new['grant']['id'],$resource,0,$id));
            $this->postJson($httpImage,['image'=>$id])->assertNotFound();
        } finally {unlink($file);rmdir($root);}
    }

    public function test_http_nominal_operation_and_secondary_revocation_matrix(): void
    {
        extract($this->fixture());
        $this->withHeader('Origin','http://localhost');
        $base='/process-summary/share/manage/'.$d->id.'/'.$v.'/grants';
        $grant=$this->postJson($base,$input)->assertCreated()->json('grant.id');
        $this->postJson($base,$input)->assertCreated()->assertJsonPath('replayed',true)->assertJsonPath('url',null);
        $this->postJson($base,array_replace($input,['days'=>2]))->assertStatus(409);
        $this->postJson($base,array_replace($input,['operation_key'=>(string)Str::uuid(),'recipient_emails'=>['absent@unified.test']]))->assertStatus(422);
        $this->getJson('/process-summary/share/deliveries/sent')->assertOk()->assertJsonCount(1,'items');
        $this->login($b);
        $this->getJson('/process-summary/share/deliveries/received')->assertOk()->assertJsonCount(1,'items');
        $read='/process-summary/share/deliveries/'.$grant;
        $this->postJson($read.'/page',[])->assertOk()->assertJsonPath('snapshot_html',$html);
        $this->postJson($read.'/pdf',[])->assertOk()->assertJsonPath('snapshot_html',$html);
        $event=(int)DB::table('writing_events')->min('id');
        $this->postJson($read.'/event',['event'=>$event])->assertOk();
        $this->postJson($read.'/event',['event'=>$event+100])->assertNotFound();
        $this->login($c);
        $this->getJson('/process-summary/share/deliveries/received')->assertOk()->assertJsonCount(0,'items');
        $this->postJson($read.'/page',[])->assertNotFound();
        $this->login($a);
        $this->postJson($base.'/'.$grant.'/revoke',[])->assertNoContent();
        $this->login($b);
        foreach (['page','pdf','event','image'] as $resource) {
            $this->postJson($read.'/'.$resource,['event'=>$event,'image'=>(string)Str::uuid()])->assertNotFound()
                ->assertHeader('Referrer-Policy','no-referrer');
        }
        $this->getJson('/process-summary/share/deliveries/received')->assertOk()->assertJsonPath('items.0.state','revoked');
        $this->withHeader('Origin','https://foreign.test')->postJson($read.'/page',[])->assertForbidden();
    }

    public function test_http_nominal_pages_are_bounded_and_expiry_rechecks_every_resource(): void
    {
        extract($this->fixture());
        $issued=(new VersionShares)->issue($a,$d->id,$v,$input);
        $original=(array)DB::table('version_summary_grants')->where('id',$issued['grant']['id'])->first();
        for ($n=0;$n<51;$n++) {
            $row=array_replace($original,['id'=>(string)Str::uuid(),'share_operation_key'=>(string)Str::uuid(),'digest'=>hash('sha256','synthetic-page-'.$n)]);
            DB::table('version_summary_grants')->insert($row);
            DB::table('version_share_recipients')->insert(['grant_id'=>$row['id'],'user_id'=>$b->id]);
            DB::table('version_share_deliveries')->insert(['grant_id'=>$row['id'],'user_id'=>$b->id,'presented_at'=>now()]);
        }
        $this->login($b);$this->withHeader('Origin','http://localhost');
        $path='/process-summary/share/deliveries/received';
        $first=$this->getJson($path)->assertOk()->assertJsonCount(50,'items')->json();
        $last=$this->getJson($path.'?cursor='.urlencode($first['next_cursor']))->assertOk()->assertJsonCount(2,'items')->json();
        self::assertNull($last['next_cursor']);
        self::assertCount(52,array_unique(array_column(array_merge($first['items'],$last['items']),'grant_id')));
        $this->getJson($path.'?cursor=invalid')->assertNotFound();
        $this->withHeader('X-InkGroove-User',(string)$a->id)->getJson($path)->assertUnauthorized();
        $this->withHeader('X-InkGroove-User',(string)$b->id);
        $this->travel(2)->days();
        $read='/process-summary/share/deliveries/'.$issued['grant']['id'];
        foreach (['page','event','image','pdf'] as $resource) {
            $this->postJson($read.'/'.$resource,['event'=>1,'image'=>(string)Str::uuid()])->assertNotFound();
        }
        $this->getJson($path)->assertOk()->assertJsonPath('items.0.state','expired');
        $this->travelBack();
    }

    public function test_registered_nominal_routes_enforce_csrf_origin_host_and_auth(): void
    {
        extract($this->fixture());
        $grant=(new VersionShares)->issue($a,$d->id,$v,$input)['grant']['id'];
        $this->login($b);$this->app['env']='production';
        try {
            $path='/process-summary/share/deliveries/'.$grant.'/page';
            $this->withHeader('Origin','http://localhost')->postJson($path,[])->assertStatus(419);
            $csrf='synthetic-m34b-csrf';
            $this->withSession(['_token'=>$csrf])->withHeader('X-CSRF-TOKEN',$csrf);
            $this->withHeader('Origin','https://foreign.test')->postJson($path,[])->assertForbidden();
            $this->withHeader('Origin','http://localhost')->withHeader('Host','foreign.test')->postJson('http://foreign.test'.$path,[])->assertForbidden();
            $this->withHeader('Host','localhost')->postJson('http://localhost'.$path,[])->assertOk();
            $this->app['auth']->forgetGuards();$this->flushSession();
            $this->withSession(['_token'=>$csrf])->postJson('http://localhost'.$path,[])->assertUnauthorized();
        } finally { $this->app['env']='testing'; }
    }

    public function test_http_new_public_levels_remain_fixed_and_have_no_nominal_entries(): void
    {
        extract($this->fixture());$this->login($a);$this->withHeader('Origin','http://localhost');
        $base='/process-summary/share/manage/'.$d->id.'/'.$v.'/grants';
        foreach ([1,2] as $level) {
            $value=$this->postJson($base,['operation_key'=>(string)Str::uuid(),'level'=>$level,'days'=>1])->assertCreated()->json();
            $secret=explode('#token=',$value['url'])[1];
            $this->postJson('/process-summary/share/query',['capability'=>$secret])->assertOk()->assertJsonPath('level',$level)->assertJsonMissingPath('reading');
            $this->postJson('/process-summary/share/deliveries/'.$value['grant']['id'].'/pdf',[])->assertNotFound();
        }
        self::assertSame(0,DB::table('version_share_deliveries')->count());
    }
    public function test_m34e_two_real_seals_have_distinct_complete_paginated_boundaries(): void
    {
        extract($this->fixture());
        $append=function (int $first,int $last) use ($a,$d,$sid,$html) {
            $events=[];
            for ($n=$first;$n<=$last;$n++) $events[]=['sequence'=>$n,'event_type'=>'insert','elapsed_ms'=>$n,'after_html'=>$html.'<p>event '.$n.'</p>'];
            $this->actingAs($a)->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sid,'events'=>$events])->assertOk();
        };
        $append(2,65);
        $d->update(['content_html'=>$html.'<p>A65</p>']);
        $va=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $append(66,79);
        $d->update(['content_html'=>$html.'<p>B79</p>']);
        $vb=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $s=new VersionShares; $gate=new VersionShareGate;
        $ga=$s->issue($a,$d->id,$va,array_replace($input,['operation_key'=>(string)Str::uuid()]));
        $gb=$s->issue($a,$d->id,$vb,array_replace($input,['operation_key'=>(string)Str::uuid()]));
        $before=[];
        foreach (['documents','document_versions','certificates','writing_events','writing_sessions'] as $table) $before[$table]=DB::table($table)->get()->toJson();
        $request=$this->login($b); $ids=[];
        foreach ([[$ga,65],[$gb,79]] as [$grant,$total]) {
            $after=0; $seen=[]; $pages=0;
            do {
                $page=$gate->deliveryResponse($request,$grant['grant']['id'],'page',$after)->getData(true);
                self::assertSame($total,$page['total_events']);
                self::assertLessThanOrEqual(32,count($page['events']));
                foreach ($page['events'] as $e) { self::assertGreaterThan($after,$e['id']); $seen[]=$e['id']; self::assertStringContainsString('génesis',$e['html']); }
                $next=$page['next_after']; if ($next!==null) self::assertGreaterThan($after,$next);
                $after=$next; $pages++;
            } while ($after!==null);
            self::assertSame(3,$pages); self::assertCount($total,array_unique($seen));
            $token=explode('#token=',$grant['url'])[1];
            $link=$gate->cardResponse($request,$token,0)->getData(true)['reading'];
            self::assertSame($total,$link['total_events']); self::assertSame(array_slice($seen,0,32),array_column($link['events'],'id'));
            $last=$gate->deliveryResponse($request,$grant['grant']['id'],'page',0,null,end($seen))->getData(true);
            self::assertSame(end($seen),$last['events'][0]['id']);
            $ids[]=$seen;
        }
        self::assertSame($ids[0],array_slice($ids[1],0,65));
        $this->denied(fn()=>$gate->deliveryResponse($request,$ga['grant']['id'],'page',0,null,$ids[1][65]));
        $this->login($a);
        foreach ([[$va,65],[$vb,79]] as [$version,$total]) {
            $this->getJson('/api/documents/'.$d->id.'/timeline?metadata=1&version_id='.$version)->assertOk()->assertJsonCount($total,'events');
        }
        foreach ($before as $table=>$bytes) self::assertSame($bytes,DB::table($table)->get()->toJson());
    }

    public function test_m34e_owner_pdf_and_public_qr_are_separate_authorization_paths(): void
    {
        extract($this->fixture());$s=new VersionShares;$gate=new VersionShareGate;
        foreach ([1,2] as $level) {
            $issued=$s->issue($a,$d->id,$v,['operation_key'=>(string)Str::uuid(),'level'=>$level,'days'=>1]);
            $this->login($a);
            $this->getJson('/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source')->assertOk()->assertJsonPath('snapshot_html',$html);
            $sent=(new \App\Support\VersionShareDeliveries)->page($a,'sent');
            self::assertContains($issued['grant']['id'],array_column($sent['items'],'grant_id'));
            $this->app['auth']->forgetGuards();$this->flushSession();
            $request=Request::create('/process-summary/share/query','POST');$request->setLaravelSession(app('session.store'));
            $token=explode('#token=',$issued['url'])[1];
            $card=$gate->cardResponse($request,$token)->getData(true);
            self::assertSame($level,$card['level']);
            foreach (['reading','snapshot_html','images','events','pdf','pdf_source'] as $key) self::assertArrayNotHasKey($key,$card);
            self::assertStringNotContainsString('pegado',json_encode($card));
            $this->denied(fn()=>$gate->deliveryResponse($request,$issued['grant']['id'],'pdf'),401);
        }
    }

    public function test_m34ev_anonymous_secondary_routes_and_owner_full_pdf_all_levels(): void
    {
        extract($this->fixture());
        $this->withHeader('Origin','http://localhost');
        $base='/process-summary/share/manage/'.$d->id.'/'.$v.'/grants';
        $before=[];
        foreach (['document_versions','certificates','writing_events'] as $table) $before[$table]=DB::table($table)->get()->toJson();
        foreach ([1,2,3] as $level) {
            $this->login($a);
            $issue=$this->postJson($base,['operation_key'=>(string)Str::uuid(),'level'=>$level,'days'=>1]+($level===3?['recipient_emails'=>[$b->email]]:[]))->assertCreated()->json();
            $this->getJson('/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source')->assertOk()->assertJsonPath('snapshot_html',$html);
            if ($level<3) {
                $this->app['auth']->forgetGuards();$this->flushSession();
                $token=explode('#token=',$issue['url'])[1];
                $card=$this->postJson('/process-summary/share/query',['capability'=>$token])->assertOk()->json();
                foreach (['snapshot_html','reading','images','events','pdf','pdf_source'] as $key) self::assertArrayNotHasKey($key,$card);
                self::assertStringNotContainsString('pegado',json_encode($card));
                foreach (['event','image'] as $resource) $this->postJson('/process-summary/share/'.$resource,['capability'=>$token,'event'=>1,'image'=>(string)Str::uuid()])->assertUnauthorized();
                foreach (['page','event','image','pdf'] as $resource) $this->postJson('/process-summary/share/deliveries/'.$issue['grant']['id'].'/'.$resource,[])->assertUnauthorized();
                $this->getJson('/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source')->assertUnauthorized();
            }
            $this->login($a);
            $this->postJson($base.'/'.$issue['grant']['id'].'/revoke',[])->assertNoContent();
        }
        foreach ($before as $table=>$bytes) self::assertSame($bytes,DB::table($table)->get()->toJson());
    }

    public function test_editorial_title_is_fixed_at_issue_and_withdrawn_from_reader(): void
    {
        extract($this->fixture());
        $d->update(['title'=>"Título á é\nExacto"]);
        $g=(new VersionShares)->issue($a,$d->id,$v,$input);
        $d->update(['title'=>'PRIVATE LATER DRAFT']);
        $listing=new \App\Support\VersionShareDeliveries;
        self::assertSame("Título á é\nExacto",$listing->page($b,'received')['items'][0]['document_title']);
        self::assertSame("Título á é\nExacto",$listing->page($a,'sent')['items'][0]['document_title']);
        (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);
        self::assertNull($listing->page($b,'received')['items'][0]['document_title']);
        self::assertSame([], $listing->page($c,'received')['items']);
        DB::table('version_summary_grants')->where('id',$g['grant']['id'])->update(['display_title_at_issue'=>null]);
        self::assertSame('PRIVATE LATER DRAFT',$listing->page($a,'sent')['items'][0]['document_title']);
        self::assertSame('current',$listing->page($a,'sent')['items'][0]['title_basis']);
        self::assertNull(DB::table('version_summary_grants')->where('id',$g['grant']['id'])->value('display_title_at_issue'));
        $fresh=(new VersionShares)->issue($a,$d->id,$v,array_replace($input,['operation_key'=>(string)Str::uuid()]));
        DB::table('version_share_recipients')->where('grant_id',$fresh['grant']['id'])->delete();
        foreach ($listing->page($b,'received')['items'] as $item) self::assertNull($item['document_title']);
        $this->denied(fn()=>(new VersionShareGate)->deliveryResponse($this->login($b),$fresh['grant']['id']));
    }

    public function test_never_expiry_all_levels_remain_scoped_revocable_and_rechecked(): void
    {
        extract($this->fixture());$gate=new VersionShareGate;$shares=new VersionShares;
        foreach ([1,2,3] as $level) {
            $data=['level'=>$level,'days'=>null,'operation_key'=>(string)Str::uuid()];
            if ($level === 3) $data['recipient_emails']=[$b->email];
            $this->withHeader('Origin','http://localhost')->actingAs($a)->postJson('/process-summary/share/manage/'.$d->id.'/'.$v.'/grants',$data)->assertCreated();
            $g=$shares->issue($a,$d->id,$v,array_replace($data,['operation_key'=>(string)Str::uuid()]));
            self::assertNull($g['grant']['expires_at']);
            $row=DB::table('version_summary_grants')->where('id',$g['grant']['id'])->first();
            self::assertSame(1,(int)$row->never_expires);self::assertNull($row->expires_at_epoch);
            $this->travel(100)->years();self::assertTrue(\App\Support\GrantTime::active($row));
            $token=explode('#token=',$g['url'])[1];$request=$this->login($b);
            $card=$gate->cardResponse($request,$token)->getData(true);
            self::assertSame($level,$card['level']);
            if ($level < 3) {self::assertArrayNotHasKey('reading',$card);self::assertStringNotContainsString($html,json_encode($card));}
            if ($level === 1) self::assertArrayNotHasKey('summary',$card);
            if ($level === 2) self::assertNotNull($card['summary']['counts']['value']);
            if ($level === 3) $this->denied(fn()=>$gate->cardResponse($this->login($c),$token));
            $request=$this->login($b);
            $method=new \ReflectionMethod($gate,'readDigest');
            $this->denied(fn()=>$method->invoke($gate,$request,hash('sha256',$token),$level,function () use ($a,$d,$v,$g) {
                (new VersionSummaryCapabilities)->revoke($a,$d->id,$v,$g['grant']['id']);
                return response()->json(['private'=>'must not return']);
            }));
            $this->denied(fn()=>$gate->cardResponse($request,$token));
            $this->travelBack();
        }
        unset($input['days']);$this->denied(fn()=>$shares->issue($a,$d->id,$v,$input),422);
        $bad=(object)['never_expires'=>0,'time_basis'=>'epoch','created_at_epoch'=>1,'expires_at_epoch'=>null];
        self::assertFalse(\App\Support\GrantTime::active($bad));
        $bad->never_expires=1;$bad->time_basis=null;
        self::assertFalse(\App\Support\GrantTime::active($bad));
    }
}
