<?php
namespace Tests\Feature;
use App\Models\{User, Document, DocumentVersion, DocumentImage, WritingEvent, WritingSession, VersionEvidence, Certificate};
use App\Support\{EvidenceCanon, EvidenceFailure, V3Capture, VersionVerifier, VersionAccess, VerificationBudgetExceeded};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class V3EvidenceTest extends TestCase
{
    use RefreshDatabase;
    private array $files = [];
    protected function tearDown(): void { foreach ($this->files as $p) { if (is_file($p)) unlink($p); elseif (is_dir($p)) rmdir($p); } parent::tearDown(); }
    private function fixture(bool $seal = true, bool $images = true): array
    {
        $a=User::create(['name'=>'A','email'=>'v3-a@example.test','password'=>'Fictitious12345']);
        $b=User::create(['name'=>'B','email'=>'v3-b@example.test','password'=>'Fictitious12345']);
        $d=Document::create(['owner_id'=>$a->id,'content_html'=>'<p>á génesis</p><p></p>','content_text'=>'á génesis','word_count'=>2]);
        $path='/api/documents/'.$d->id; $im=[];
        if ($images) {
            $root=sys_get_temp_dir().'/v3-'.Str::uuid();mkdir($root,0700);config(['veritas.media_path'=>$root]);
            foreach (['historical','snapshot'] as $data) {
                $id=(string)Str::uuid();$file=$root.'/'.$id.'.png';file_put_contents($file,$data);$this->files[]=$file;
                $im[]=DocumentImage::create(['id'=>$id,'document_id'=>$d->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($data),'sha256'=>hash('sha256',$data)]);
            } $this->files[]=$root;
        }
        $sids=[(string)Str::uuid(),(string)Str::uuid()];$this->actingAs($a);
        foreach($sids as $i=>$sid) {
            $html=$d->content_html.($images?'<img src="'.$im[$i]->url().'" data-image-sha256="'.$im[$i]->sha256.'">':'');
            $this->postJson($path.'/events',['session_id'=>$sid,'events'=>[['sequence'=>1,'event_type'=>'insert','after_html'=>$html,'elapsed_ms'=>$i?true:'+3']]])->assertOk();
        }
        if($images) $d->update(['content_html'=>$d->content_html.'<img src="'.$im[1]->url().'" data-image-sha256="'.$im[1]->sha256.'">']);
        config(['veritas.seal_format'=>3]);$v=null;
        if($seal) $v=DocumentVersion::findOrFail($this->postJson($path.'/seal')->assertCreated()->json('version.id'));
        return [$a,$b,$d,$v,$sids,$im,$path];
    }
    private function verify(DocumentVersion $v): array { return (new VersionVerifier)->verify($v->id); }
    private function resign(DocumentVersion $v, callable $fn): void
    {
        $c=$v->certificate; $p=$fn($c->signed_payload);ksort($p);$c->update(['signed_payload'=>$p,'signature'=>hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),config('veritas.signing_key'))]);$v->unsetRelation('certificate');
    }
    public function test_complete_original_cut_includes_retired_image_and_excludes_future_data_read_only(): void
    {
        [$a,,$d,$v,$sids,$images,$path]=$this->fixture();
        $before=[];foreach(['documents','document_versions','version_evidence','certificates','writing_sessions','writing_events','document_images'] as $t)$before[$t]=DB::table($t)->get()->toJson();
        DB::enableQueryLog();$r=$this->verify($v);$queries=DB::getQueryLog();DB::disableQueryLog();
        $this->assertSame('verified',$r['status']);$this->assertTrue($r['complete']);$this->assertSame(2,$r['consumed']['events']);$this->assertSame(2,$r['consumed']['images']);
        foreach($before as $t=>$value)$this->assertSame($value,DB::table($t)->get()->toJson());
        foreach($queries as $q)$this->assertDoesNotMatchRegularExpression('/\b(insert|update|delete|for update)\b/i',$q['query']);
        $m=EvidenceCanon::decode(DB::table('version_evidence')->value('manifest_bytes'));$this->assertSame($d->content_html,$v->snapshot_html);$this->assertCount(2,get_object_vars($m->images));
        $this->postJson($path.'/events',['session_id'=>$sids[0],'events'=>[['sequence'=>2,'event_type'=>'insert','after_html'=>'<p>later private</p>','elapsed_ms'=>4]]])->assertOk();
        $this->postJson($path.'/events',['session_id'=>(string)Str::uuid(),'events'=>[['sequence'=>1,'event_type'=>'insert','after_html'=>'<p>new private</p>','elapsed_ms'=>1]]])->assertOk();
        $d->update(['content_html'=>'<p>live private</p>']);$r=$this->verify($v);$this->assertSame('verified',$r['status']);$this->assertSame(2,$r['consumed']['events']);
    }
    public function test_resigned_omissions_cannot_replace_original_reference(): void
    {
        [,,,$v,$sids,$images]=$this->fixture();$original=DB::table('version_evidence')->value('manifest_bytes');
        $this->resign($v,function($p)use($sids,$images){unset($p['history_boundary'][$sids[0]],$p['images'][$images[0]->id]);return $p;});
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('evidence_boundary_mismatch',$r['reason_codes']);$this->assertContains('evidence_images_mismatch',$r['reason_codes']);$this->assertFalse($r['complete']);
        $this->assertSame($original,DB::table('version_evidence')->value('manifest_bytes'));$this->assertNull(VersionAccess::boundary($v));
    }
    public function test_missing_reference_is_incomplete_and_never_reconstructed(): void
    {
        [,,,$v]=$this->fixture();DB::table('version_evidence')->delete();$r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('evidence_missing',$r['reason_codes']);$this->assertSame(0,DB::table('version_evidence')->count());
    }
    public function test_digest_alteration_and_canonical_type_error_keep_mismatch_priority(): void
    {
        [,,,$v]=$this->fixture();$row=DB::table('version_evidence')->first();$m=EvidenceCanon::decode($row->manifest_bytes);$m->event_count='2';
        DB::table('version_evidence')->update(['manifest_bytes'=>EvidenceCanon::encode($m)]);
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('evidence_digest_mismatch',$r['reason_codes']);$this->assertContains('evidence_canon_invalid',$r['reason_codes']);
    }
    public function test_other_version_link_and_unknown_schema_are_rejected(): void
    {
        [,,,$v]=$this->fixture();$m=EvidenceCanon::decode(DB::table('version_evidence')->value('manifest_bytes'));$m->version_id=(string)Str::uuid();$bytes=EvidenceCanon::encode($m);DB::table('version_evidence')->update(['manifest_bytes'=>$bytes]);
        $this->resign($v,fn($p)=>array_replace($p,['evidence_digest'=>hash('sha256',$bytes)]));$this->assertContains('evidence_relationship_mismatch',$this->verify($v)['reason_codes']);
        DB::table('version_evidence')->update(['schema'=>'future']);$this->assertSame('unsupported',$this->verify($v)['status']);
    }
    public function test_uniqueness_and_normal_write_immutability(): void
    {
        [,,,$v]=$this->fixture();$e=VersionEvidence::firstOrFail();
        try{$e->update(['manifest_bytes'=>'{}']);$this->fail('Mutable evidence');}catch(\LogicException){$this->assertSame(1,VersionEvidence::count());}
        try{DB::table('version_evidence')->insert($e->getAttributes());$this->fail('Duplicate evidence');}catch(\Illuminate\Database\QueryException){$this->assertSame(1,VersionEvidence::count());}
    }
    public function test_corrupt_snapshot_event_and_missing_file_preserve_all_causes(): void
    {
        [,,,$v,$sids,$images]=$this->fixture();$v->update(['snapshot_html'=>$v->snapshot_html.' ']);WritingEvent::where('writing_session_id',$sids[0])->update(['data'=>'corrupt']);unlink($images[1]->path());
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);foreach(['snapshot_hash_mismatch','event_hmac_mismatch','image_file_unavailable'] as $code)$this->assertContains($code,$r['reason_codes']);
    }
    public function test_changed_file_bytes_mismatch_original_commitment(): void
    {
        [,,,$v,,$images]=$this->fixture();file_put_contents($images[0]->path(),'corrupted');$r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('evidence_image_bytes_mismatch',$r['reason_codes']);
    }
    public function test_preparation_then_edit_event_or_empty_session_conflicts_without_partial_writes(): void
    {
        [$a,,$d,,$sids,,$path]=$this->fixture(false,false);$capture=new V3Capture;
        foreach(['edit','event','session','settings'] as $change) {
            $p=$capture->prepare($d->id);
            if($change==='edit')$d->update(['content_html'=>'<p>changed</p>']);
            if($change==='event')$this->postJson($path.'/events',['session_id'=>$sids[0],'events'=>[['sequence'=>2,'event_type'=>'insert','after_html'=>'<p>event</p>','elapsed_ms'=>2]]])->assertOk();
            if($change==='session')WritingSession::create(['id'=>(string)Str::uuid(),'document_id'=>$d->id,'user_id'=>$a->id]);
            if($change==='settings')$d->update(['page_settings'=>['format'=>'a5','orientation'=>'portrait','margin'=>20]]);
            try{$capture->commit($p);$this->fail('Expected conflict');}catch(\Symfony\Component\HttpKernel\Exception\HttpException $e){$this->assertSame(409,$e->getStatusCode());}
            foreach(['document_versions','version_evidence','certificates'] as $t)$this->assertSame(0,DB::table($t)->count());
        }
    }
    public function test_exception_between_writes_rolls_back_all_three_entities(): void
    {
        [,, $d]=$this->fixture(false,false);$capture=new V3Capture;$p=$capture->prepare($d->id);
        Certificate::creating(fn()=>throw new \RuntimeException('Injected certificate failure'));
        try{$capture->commit($p);$this->fail('Expected failure');}catch(\RuntimeException $e){$this->assertSame('Injected certificate failure',$e->getMessage());}
        foreach(['document_versions','version_evidence','certificates'] as $t)$this->assertSame(0,DB::table($t)->count());
        Certificate::flushEventListeners();
    }
    public function test_quotas_preparation_capture_and_verification_never_succeed_partially(): void
    {
        [,, $d,$v]=$this->fixture();
        foreach(['events'=>1,'sessions'=>1,'images'=>1,'manifest_bytes'=>1,'rows'=>1,'image_bytes'=>1] as $k=>$limit){$old=config('veritas.verification.'.$k);config(['veritas.verification.'.$k=>$limit]);$r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertFalse($r['complete']);config(['veritas.verification.'.$k=>$old]);}
        $capture=new V3Capture;$p=$capture->prepare($d->id);config(['veritas.capture.seconds'=>0]);
        try{$capture->commit($p);$this->fail('Expected budget');}catch(VerificationBudgetExceeded){$this->assertSame(1,DocumentVersion::count());}
        config(['veritas.verification.events'=>0]);try{$capture->prepare($d->id);$this->fail('Expected preparation budget');}catch(VerificationBudgetExceeded){$this->assertSame(1,VersionEvidence::count());}
    }
    public function test_routes_boundary_images_and_delivery_authorization_keep_exact_scope(): void
    {
        [$a,$b,$d,$v,$sids,$images,$path]=$this->fixture();$base=$path.'/versions/'.$v->id;
        $this->getJson($base)->assertOk()->assertHeader('Cache-Control','no-store, private');$this->postJson($base.'/verification')->assertOk()->assertJsonPath('status','verified');
        $this->actingAs($b)->getJson($base.'?assignment_id=1')->assertNotFound();$this->postJson($base.'/verification')->assertNotFound();
        $this->actingAs($a)->postJson('/api/submissions',['document_version_id'=>$v->id,'recipient_email'=>$b->email])->assertCreated();$this->actingAs($b);
        $this->getJson($base)->assertOk();$this->postJson($base.'/verification')->assertOk()->assertJsonPath('complete',true);
        $timeline=$this->getJson($path.'/timeline?metadata=1&version_id='.$v->id)->assertOk();$this->assertCount(2,$timeline->json('events'));
        foreach($images as $image)$this->get($image->url().'?version_id='.$v->id)->assertOk()->assertHeader('Cache-Control','no-store, private');
        $c=User::create(['name'=>'C','email'=>'v3-c@example.test','password'=>'Fictitious12345']);$this->actingAs($c)->getJson($base)->assertNotFound();
        $public=$this->getJson('/api/verify/'.$v->certificate->certificate_code)->assertOk();$this->assertEqualsCanonicalizing(['valid','scope','certificate_code','issued_at','content_hash'],array_keys($public->json()));$this->assertSame('payload_signature',$public->json('scope'));
    }
    public function test_default_v2_and_client_cannot_select_v3(): void
    {
        [,, $d,,,,$path]=$this->fixture(false,false);config(['veritas.seal_format'=>2]);$this->postJson($path.'/seal',['format_version'=>3])->assertCreated()->assertJsonPath('certificate.signed_payload.format_version',2);$this->assertSame(0,VersionEvidence::count());
    }
    public function test_canon_vectors_unicode_nested_objects_empty_lists_and_duplicate_keys(): void
    {
        $vectors=[(object)['z'=>(object)['β'=>'génesis','a'=>'á'],'a'=>[], 'n'=>3], (object)['text'=>'génesis'],(object)['text'=>'génesis']];
        $bytes=array_map(EvidenceCanon::encode(...),$vectors);$this->assertSame('{"a":[],"n":3,"z":{"a":"á","β":"génesis"}}',$bytes[0]);$this->assertNotSame(hash('sha256',$bytes[1]),hash('sha256',$bytes[2]));
        $m=(object)['schema'=>EvidenceCanon::SCHEMA,'document_id'=>'00000000-0000-0000-0000-000000000001','version_id'=>'00000000-0000-0000-0000-000000000002','snapshot_hash'=>hash('sha256','<p>á génesis</p><p></p>'),'heads'=>(object)[],'event_count'=>0,'images'=>(object)[]];
        $encoded=EvidenceCanon::encode($m);$this->assertSame($encoded,EvidenceCanon::encode(EvidenceCanon::decode($encoded)));
        foreach([$encoded.' ',str_replace('"event_count":0','"event_count":0,"event_count":0',$encoded),str_replace('"event_count":0','"event_count":"0"',$encoded)] as $bad)try{EvidenceCanon::decode($bad);$this->fail('Noncanonical accepted');}catch(\InvalidArgumentException){$this->assertTrue(true);}
        fwrite(STDOUT,PHP_EOL.'V3 canon vectors: '.json_encode(['vectors'=>array_map(fn($b)=>['bytes'=>$b,'sha256'=>hash('sha256',$b)],array_merge($bytes,[$encoded]))],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES).PHP_EOL);
    }
    public function test_incompatible_attribute_blocks_preparation_and_no_artifacts(): void
    {
        [,, $d,,,$images]=$this->fixture(false);$d->update(['content_html'=>str_replace($images[1]->sha256,str_repeat('0',64),$d->content_html)]);
        try{(new V3Capture)->prepare($d->id);$this->fail('Expected attribute conflict');}catch(EvidenceFailure $e){$this->assertSame('image_attribute_mismatch',$e->reason);$this->assertSame(0,DocumentVersion::count());}
    }
    public function test_manifest_count_heads_references_and_supported_type_changes_are_detected(): void
    {
        [,,,$v,$sids,$images]=$this->fixture();$raw=DB::table('version_evidence')->value('manifest_bytes');
        foreach(['count','head','image','empty_map_as_list'] as $change){
            $m=EvidenceCanon::decode($raw);
            if($change==='count')$m->event_count++;
            if($change==='head')$m->heads->{$sids[0]}->hash=str_repeat('0',64);
            if($change==='image')unset($m->images->{$images[0]->id});
            if($change==='empty_map_as_list')$m->images=[];
            $bytes=EvidenceCanon::encode($m);DB::table('version_evidence')->update(['manifest_bytes'=>$bytes]);
            $this->resign($v,fn($p)=>array_replace($p,['evidence_digest'=>hash('sha256',$bytes)]));
            $r=$this->verify($v);$this->assertFalse($r['complete']);$this->assertContains($r['status'],['unsupported','mismatch']);
        }
    }
    public function test_no_sessions_or_images_is_a_valid_complete_original_manifest(): void
    {
        $u=User::create(['name'=>'Empty','email'=>'v3-empty@example.test','password'=>'Fictitious12345']);
        $html='<p>á génesis</p><p></p>';$d=Document::create(['owner_id'=>$u->id,'content_html'=>$html,'content_text'=>'á génesis','word_count'=>2]);
        $c=new V3Capture;[$v]=$c->commit($c->prepare($d->id));$r=$this->verify($v);$this->assertSame('verified',$r['status']);$this->assertTrue($r['complete']);$this->assertSame(0,$r['consumed']['events']);$this->assertSame($html,$v->snapshot_html);
        $m=EvidenceCanon::decode(DB::table('version_evidence')->value('manifest_bytes'));$this->assertSame('{}',EvidenceCanon::encode($m->heads));$this->assertSame('{}',EvidenceCanon::encode($m->images));
    }
    public function test_missing_prefix_event_and_absent_metadata_are_incomplete(): void
    {
        [,,,$v,$sids,$images]=$this->fixture();WritingEvent::where('writing_session_id',$sids[0])->delete();DB::table('document_images')->where('id',$images[1]->id)->delete();
        $r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('event_missing',$r['reason_codes']);$this->assertContains('image_metadata_missing',$r['reason_codes']);
    }
    public function test_noncanonical_duplicate_keys_with_resigned_digest_are_unsupported(): void
    {
        [,,,$v]=$this->fixture();$raw=DB::table('version_evidence')->value('manifest_bytes');$raw=str_replace('"event_count":2','"event_count":2,"event_count":2',$raw);DB::table('version_evidence')->update(['manifest_bytes'=>$raw]);
        $this->resign($v,fn($p)=>array_replace($p,['evidence_digest'=>hash('sha256',$raw)]));$this->assertSame('unsupported',$this->verify($v)['status']);
    }

}
