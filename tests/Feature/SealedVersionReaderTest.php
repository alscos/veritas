<?php
namespace Tests\Feature;

use App\Models\{User, Document, DocumentVersion, DocumentImage};
use App\Support\{SealedVersionReader, VersionSummaryCapabilities};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class SealedVersionReaderTest extends TestCase
{
    use DatabaseMigrations;
    private function fixture(int $count = 2, int $format = 2): array
    {
        config(['veritas.seal_format'=>$format]);
        $a=User::create(['name'=>'A','email'=>'sealed-a@example.test','password'=>'synthetic']);
        $b=User::create(['name'=>'B','email'=>'sealed-b@example.test','password'=>'synthetic']);
        $html='<p>á génesis  <mark data-origin="paste">pegado</mark><mark data-origin="paste-edited"> cambio</mark></p><p></p>';
        $d=Document::create(['owner_id'=>$a->id,'content_html'=>$html,'word_count'=>4]);
        $other=Document::create(['owner_id'=>$b->id,'content_html'=>'<p>otra</p>','word_count'=>1]);
        $path='/api/documents/'.$d->id; $sessions=[];
        $this->actingAs($a);
        for($session=0;$session<2;$session++) {
            $sid=(string)Str::uuid();$sessions[]=$sid;$batch=[];
            for($i=1;$i<=$count;$i++)$batch[]=['sequence'=>$i,'event_type'=>'insert','elapsed_ms'=>$i,'after_html'=>$html];
            $this->postJson($path.'/events',['session_id'=>$sid,'events'=>$batch])->assertOk();
        }
        $v=$this->postJson($path.'/seal')->assertCreated()->json('version.id');
        return [$a,$b,$d,$other,$v,$sessions,$html];
    }
    private function denied(callable $f, int $status=404): void {
        try {$f();self::fail('Unexpected read');}
        catch(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e){self::assertSame($status,$e->getStatusCode());}
    }
    private function resign(string $version, callable $change): void {
        $c=DocumentVersion::findOrFail($version)->certificate;$p=$change($c->signed_payload);ksort($p);
        $c->update(['signed_payload'=>$p,'signature'=>hash_hmac('sha256',(isset($p['payload_encoding']) ? \App\Support\CertificatePayload::encode($p) : json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)),config('veritas.signing_key'))]);
    }
    public function test_all_session_prefixes_pagination_literal_html_and_no_writes(): void {
        [$a,$b,$d,$other,$v,$sessions,$html]=$this->fixture(18);$s=new SealedVersionReader;
        $before=[];foreach(['documents','document_versions','writing_events','writing_sessions','certificates','version_evidence'] as $t)$before[$t]=DB::table($t)->get()->toJson();
        DB::enableQueryLog();$one=$s->page($a,$d->id,$v);$two=$s->page($a,$d->id,$v,$one['next_after']);$queries=DB::getQueryLog();DB::disableQueryLog();
        self::assertCount(32,$one['events']);self::assertCount(4,$two['events']);self::assertNull($two['next_after']);
        self::assertSame($html,$one['snapshot_html']);
        foreach(array_merge($one['events'],$two['events']) as $e)self::assertSame($html,$e['html']);
        self::assertSame('limited',$one['coverage']['status']);self::assertFalse($one['coverage']['complete']);
        foreach($before as $t=>$rows)self::assertSame($rows,DB::table($t)->get()->toJson());
        foreach($queries as $q){self::assertDoesNotMatchRegularExpression('/\b(insert|update|delete|for update)\b/i',$q['query']);self::assertStringNotContainsString('content_html',$q['query']);}
        $this->denied(fn()=>$s->page($b,$d->id,$v));$this->denied(fn()=>$s->page($a,$other->id,$v));
    }
    public function test_later_events_sessions_draft_and_second_seal_are_not_authority(): void {
        [$a,$b,$d,$other,$v,$sessions]=$this->fixture();$s=new SealedVersionReader;$before=$s->page($a,$d->id,$v);
        foreach([$sessions[0],(string)Str::uuid()] as $i=>$sid) {
            $this->postJson('/api/documents/'.$d->id.'/events',['session_id'=>$sid,'events'=>[['sequence'=>$i===0?3:1,'event_type'=>'insert','elapsed_ms'=>100,'after_html'=>'<p>LATER PRIVATE</p>']]])->assertOk();
        }
        $late=(int)DB::table('writing_events')->max('id');
        $d->update(['content_html'=>'<p>LATER PRIVATE</p>']);$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated();
        self::assertSame($before,$s->page($a,$d->id,$v));$this->denied(fn()=>$s->page($a,$d->id,$v,0,$late));
        self::assertSame([],$s->page($a,$d->id,$v,$late)['events']);
        DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'document_version_id'=>$v,'sender_id'=>$a->id,'recipient_user_id'=>$b->id,'submitted_at'=>now()]);
        $this->denied(fn()=>$s->page($b,$d->id,$v)); // This primitive never treats Entregas as a grant.
    }
    public function test_tamper_missing_boundary_foreign_session_and_budget_fail_closed(): void {
        [$a,$b,$d,$other,$v,$sessions,$html]=$this->fixture();$s=new SealedVersionReader;
        DocumentVersion::whereKey($v)->update(['snapshot_html'=>'<p>tampered</p>']);$this->denied(fn()=>$s->page($a,$d->id,$v),409);
        DocumentVersion::whereKey($v)->update(['snapshot_html'=>$html]);
        DB::table('writing_sessions')->where('id',$sessions[0])->update(['document_id'=>$other->id]);$this->denied(fn()=>$s->page($a,$d->id,$v),409);
        DB::table('writing_sessions')->where('id',$sessions[0])->update(['document_id'=>$d->id]);
        config(['veritas.verification.events'=>0]);$this->denied(fn()=>$s->page($a,$d->id,$v),409);config(['veritas.verification.events'=>100000]);
        DB::beginTransaction();try{$this->denied(fn()=>$s->page($a,$d->id,$v),503);}finally{DB::rollBack();}
        $this->resign($v,function($p){unset($p['history_boundary']);return $p;});$this->denied(fn()=>$s->page($a,$d->id,$v),409);
        $this->resign($v,fn($p)=>['content_hash'=>$p['content_hash'],'version_id'=>$p['version_id']]);$this->denied(fn()=>$s->page($a,$d->id,$v),409);
    }
    public function test_v3_requires_original_manifest_and_rejects_resigned_omissions(): void {
        [$a,,$d,,$v,$sessions]=$this->fixture(2,3);$s=new SealedVersionReader;
        self::assertTrue($s->page($a,$d->id,$v)['coverage']['complete']);
        $this->resign($v,function($p)use($sessions){unset($p['history_boundary'][$sessions[0]]);return $p;});
        $this->denied(fn()=>$s->page($a,$d->id,$v),409);
    }
    public function test_image_exact_bytes_commitment_foreign_ids_later_ids_and_symlinks(): void {
        [$a,$b,$d,$other,,$sessions]=$this->fixture();$s=new SealedVersionReader;
        $root=sys_get_temp_dir().'/m33d-'.Str::uuid();mkdir($root,0700);config(['veritas.media_path'=>$root]);
        $id=(string)Str::uuid();$file=$root.'/'.$id.'.png';
        $bytes=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5x8AAAAASUVORK5CYII=');file_put_contents($file,$bytes);
        try {
            $image=DocumentImage::create(['id'=>$id,'document_id'=>$d->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
            $html='<p>imagen</p><img src="'.$image->url().'">';$d->update(['content_html'=>$html]);
            $v=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
            self::assertSame(['mime'=>'image/png','bytes'=>$bytes],$s->image($a,$d->id,$v,$id));
            $this->denied(fn()=>$s->image($b,$d->id,$v,$id));$this->denied(fn()=>$s->image($a,$other->id,$v,$id));
            $this->denied(fn()=>$s->image($a,$d->id,$v,(string)Str::uuid()));
            $this->denied(fn()=>$s->image($a,$d->id,$v,$id,999999));
            $this->resign($v,fn($p)=>array_replace($p,['images'=>[]]));$this->denied(fn()=>$s->image($a,$d->id,$v,$id),409);
            $this->resign($v,fn($p)=>array_replace($p,['images'=>[$id=>hash('sha256',$bytes)]]));
            file_put_contents($file,'tampered');$this->denied(fn()=>$s->image($a,$d->id,$v,$id),409);file_put_contents($file,$bytes);
            $target=$root.'/target.png';rename($file,$target);symlink($target,$file);
            $this->denied(fn()=>$s->image($a,$d->id,$v,$id),409);unlink($file);rename($target,$file);
        } finally {if(is_file($file)||is_link($file))unlink($file);rmdir($root);}
    }
    public function test_additive_schema_preserves_legacy_grants_and_level_two_redeemer_rejects_other_levels(): void {
        [$a,,$d,,$v]=$this->fixture();$s=new VersionSummaryCapabilities;$tokens=[];
        for($i=0;$i<4;$i++)$tokens[]=$s->issue($a,$d->id,$v);
        $before=$s->redeem($tokens[0]['secret']);
        foreach([1,3,99] as $i=>$level) {
            DB::table('version_summary_grants')->where('id',$tokens[$i+1]['grant']['id'])->update(['level'=>$level]);
            $this->denied(fn()=>$s->redeem($tokens[$i+1]['secret']));
        }
        self::assertSame($before,$s->redeem($tokens[0]['secret']));
        self::assertSame(2,(int)DB::table('version_summary_grants')->where('id',$tokens[0]['grant']['id'])->value('level'));
        self::assertSame(0,DB::table('version_share_accesses')->count());
        self::assertSame(0,DB::table('version_share_recipients')->count());
        // No runtime adapter may expose this internal owner reader as level 3.
        foreach(app('router')->getRoutes() as $route) self::assertStringNotContainsString('SealedVersionReader',$route->getActionName());
    }
    public function test_runtime_does_not_silently_downgrade_level_three_and_legacy_insert_defaults_to_two(): void {
        [$a,,$d,,$v]=$this->fixture();config(['veritas.public_origin'=>'http://127.0.0.1:8084']);
        $path='/api/summary-grants/'.$d->id.'/'.$v;
        foreach([['level'=>3],['level'=>1],['audience_mode'=>'signed_in_link'],['recipient_ids'=>[1]]] as $body) {
            $this->withHeader('Origin','http://127.0.0.1:8084')->postJson($path,$body)->assertStatus(422)
                ->assertHeader('Referrer-Policy','no-referrer')->assertHeader('X-Robots-Tag','noindex, nofollow');
        }
        self::assertSame(0,DB::table('version_summary_grants')->count());
        $secret=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');$id=(string)Str::uuid();
        // The old schema's insert shape, with no new columns and no secret rewrite.
        $row=['id'=>$id,'owner_id'=>$a->id,'document_id'=>$d->id,'version_id'=>$v,
            'digest'=>hash('sha256',$secret),'created_at'=>now(),'expires_at'=>now()->addDays(7),'revoked_at'=>null];
        DB::table('version_summary_grants')->insert($row);
        $stored=DB::table('version_summary_grants')->where('id',$id)->first();
        self::assertSame(2,(int)$stored->level);self::assertNull($stored->audience_mode);self::assertNull($stored->label);
        self::assertSame($row['digest'],$stored->digest);
        self::assertSame('limited',(new VersionSummaryCapabilities)->redeem($secret)['coverage']['status']);
    }

    public function test_audience_policy_requires_explicit_accounts_from_exact_version_deliveries(): void {
        [$a,$b,$d,,$v]=$this->fixture();$p=new \App\Support\VersionShareAudience;
        $c=User::create(['name'=>'C','email'=>'sealed-c@example.test','password'=>'synthetic']);
        $e=User::create(['name'=>'D','email'=>'sealed-d@example.test','password'=>'synthetic']);
        $v2=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        foreach([[$v,$b->id],[$v,$c->id],[$v2,$e->id],[$v,null]] as [$version,$recipient]) {
            DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'document_version_id'=>$version,
                'sender_id'=>$a->id,'recipient_user_id'=>$recipient,'recipient_email'=>$recipient?null:'unregistered@example.test','submitted_at'=>now()]);
        }
        self::assertSame([$b->id],$p->selection($a,$d->id,$v,[$b->id,$b->id]));
        foreach([[],[$e->id],[999999],[(string)$b->id]] as $ids)$this->denied(fn()=>$p->selection($a,$d->id,$v,$ids),422);
        $this->denied(fn()=>$p->selection($b,$d->id,$v,[$b->id]));
        $s=new VersionSummaryCapabilities;$issued=$s->issue($a,$d->id,$v);
        DB::table('version_summary_grants')->where('id',$issued['grant']['id'])->update(['level'=>3,'audience_mode'=>'restricted']);
        $grant=DB::table('version_summary_grants')->where('id',$issued['grant']['id'])->first();
        DB::table('version_share_recipients')->insert(['grant_id'=>$grant->id,'user_id'=>$b->id]);
        self::assertTrue($p->permits($grant,$b));
        foreach([null,$a,$c,$e] as $visitor)self::assertFalse($p->permits($grant,$visitor));
        $open=clone $grant;$open->audience_mode='signed_in_link';
        self::assertTrue($p->permits($open,$c));self::assertFalse($p->permits($open,null));
        $open->audience_mode='unknown';self::assertFalse($p->permits($open,$b));
        // Policy membership alone cannot redeem the existing public endpoint at any level.
        $this->denied(fn()=>$s->redeem($issued['secret']));
        self::assertSame(0,DB::table('version_share_accesses')->count());
    }

}
