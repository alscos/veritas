<?php
namespace Tests\Feature;

use App\Models\{User, Document, DocumentVersion, Certificate, DocumentImage, WritingEvent};
use App\Support\VersionVerifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class VersionVerifierTest extends TestCase
{
    use RefreshDatabase;
    private function fixture(int $events = 2): array
    {
        $a = User::create(['name'=>'A','email'=>'verifier-a@example.test','password'=>'Fictitious12345']);
        $b = User::create(['name'=>'B','email'=>'verifier-b@example.test','password'=>'Fictitious12345']);
        $html = '<p>á génesis  </p><p></p>';
        $doc = Document::create(['owner_id'=>$a->id,'content_html'=>$html,'content_text'=>'á génesis','word_count'=>2]);
        $path = '/api/documents/'.$doc->id; $sid = (string) Str::uuid();
        $batch = [];
        for ($i=1;$i<=$events;$i++) $batch[] = ['sequence'=>$i,'event_type'=>'insert','data'=>'á génesis','after_html'=>$html,'elapsed_ms'=>$i];
        $this->actingAs($a)->postJson($path.'/events',['session_id'=>$sid,'events'=>$batch])->assertOk();
        $seal = $this->postJson($path.'/seal')->assertCreated()->json();
        $v = DocumentVersion::findOrFail($seal['version']['id']);
        return [$a,$b,$doc,$v,$sid,$path];
    }
    private function verify(DocumentVersion $v): array { return app(VersionVerifier::class)->verify($v->id); }
    private function resign(DocumentVersion $v, callable $change): void
    {
        $c = $v->certificate()->firstOrFail(); $p = $change($c->signed_payload); ksort($p);
        $c->update(['signed_payload'=>$p,'signature'=>hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),(string)config('veritas.signing_key'))]);
    }
    public function test_v2_is_limited_read_only_and_ignores_later_sessions_events_and_draft(): void
    {
        [$a,$b,$doc,$v,$sid,$path] = $this->fixture();
        $before = [];
        foreach (['documents','document_versions','certificates','writing_sessions','writing_events'] as $table) $before[$table] = DB::table($table)->get()->toJson();
        DB::enableQueryLog();
        $r = $this->verify($v); $queries = DB::getQueryLog(); DB::disableQueryLog();
        $this->assertSame('limited',$r['status']); $this->assertFalse($r['complete']);
        $this->assertSame(2,$r['consumed']['events']); $this->assertSame('passed',$r['checks']['chains']);
        foreach ($before as $table=>$rows) $this->assertSame($rows,DB::table($table)->get()->toJson());
        foreach ($queries as $q) $this->assertDoesNotMatchRegularExpression('/\b(insert|update|delete|for update)\b/i',$q['query']);
        $this->postJson($path.'/events',['session_id'=>$sid,'events'=>[['sequence'=>3,'event_type'=>'insert','after_html'=>'<p>later</p>','elapsed_ms'=>3]]])->assertOk();
        $this->postJson($path.'/events',['session_id'=>(string)Str::uuid(),'events'=>[['sequence'=>1,'event_type'=>'insert','after_html'=>'<p>secret new session</p>','elapsed_ms'=>4]]])->assertOk();
        $doc->update(['content_html'=>'<p>secret live draft</p>']);
        $r2 = $this->verify($v); $this->assertSame('limited',$r2['status']); $this->assertSame(2,$r2['consumed']['events']);
        $this->assertStringNotContainsString('secret',json_encode($r2));
    }
    public function test_historical_present_fields_are_checked_without_inventing_history(): void
    {
        [,,$doc,$v] = $this->fixture();
        $this->resign($v,fn($p)=>['version_id'=>$p['version_id'],'content_hash'=>$p['content_hash']]);
        $r = $this->verify($v); $this->assertSame('limited',$r['status']); $this->assertSame('limited',$r['checks']['chains']); $this->assertSame(0,$r['consumed']['events']);
        $this->assertEqualsCanonicalizing(['version_id','content_hash'],$r['checks']['committed_fields']);
        $this->resign($v,fn($p)=>$p+['format_version'=>1]); $this->assertSame('limited',$this->verify($v)['status']);
    }
    public function test_snapshot_bytes_signature_and_committed_fields_detect_changes(): void
    {
        [,,$doc,$v] = $this->fixture();
        $v->update(['snapshot_html'=>str_replace('génesis','génesis',$v->snapshot_html)]);
        $r=$this->verify($v); $this->assertSame('mismatch',$r['status']); $this->assertContains('snapshot_hash_mismatch',$r['reason_codes']);
        $v->update(['snapshot_html'=>$doc->content_html.' ']); $this->assertSame('mismatch',$this->verify($v)['status']);
        $v->update(['snapshot_html'=>$doc->content_html,'version_number'=>22]); $this->assertContains('signed_field_mismatch_version',$this->verify($v)['reason_codes']);
        $v->certificate()->update(['signature'=>str_repeat('0',64)]); $this->assertContains('payload_signature_mismatch',$this->verify($v)['reason_codes']);
    }
    public function test_unknown_format_and_missing_key_are_explicit_without_traversal(): void
    {
        [,,,$v]=$this->fixture();
        foreach ([99,'2',null] as $format) {
            $this->resign($v,fn($p)=>array_replace($p,['format_version'=>$format]));
            $r=$this->verify($v);$this->assertSame('unsupported',$r['status']);$this->assertSame(0,$r['consumed']['events']);
        }
        $this->resign($v,fn($p)=>array_replace($p,['format_version'=>2]));
        config(['veritas.signing_key'=>null]);$r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('signing_key_unavailable',$r['reason_codes']);
    }
    public function test_missing_event_is_incomplete_and_link_hmac_and_terminal_discrepancies_are_mismatch(): void
    {
        [,,,$v,$sid]=$this->fixture(3);
        $e=WritingEvent::where('writing_session_id',$sid)->where('sequence',2)->firstOrFail();$attributes=$e->getAttributes();$e->delete();
        $r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('event_missing',$r['reason_codes']);
        DB::table('writing_events')->insert($attributes);
        WritingEvent::whereKey($e->id)->update(['previous_hash'=>str_repeat('a',64)]);
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('event_link_mismatch',$r['reason_codes']);$this->assertContains('event_hmac_mismatch',$r['reason_codes']);
        DB::table('writing_events')->where('id',$e->id)->update($attributes);
        $this->resign($v,function($p)use($sid){$p['history_boundary'][$sid]['hash']=str_repeat('f',64);return $p;});
        $this->assertContains('terminal_hash_mismatch',$this->verify($v)['reason_codes']);
    }
    public function test_sequence_membership_and_terminal_id_are_checked(): void
    {
        [$a,,$doc,$v,$sid]=$this->fixture();
        $this->resign($v,function($p)use($sid){$p['history_boundary'][$sid]['event_id']+=100;return $p;});
        $this->assertContains('terminal_id_mismatch',$this->verify($v)['reason_codes']);
        $foreign=Document::create(['owner_id'=>$a->id]);DB::table('writing_sessions')->where('id',$sid)->update(['document_id'=>$foreign->id]);
        $this->assertContains('session_membership_mismatch',$this->verify($v)['reason_codes']);
        DB::table('writing_sessions')->where('id',$sid)->update(['document_id'=>$doc->id]);
        $first=WritingEvent::where('writing_session_id',$sid)->where('sequence',1)->firstOrFail();
        $second=WritingEvent::where('writing_session_id',$sid)->where('sequence',2)->firstOrFail();
        DB::table('writing_events')->where('id',$first->id)->update(['sequence'=>99]);
        DB::table('writing_events')->where('id',$second->id)->update(['sequence'=>1]);
        DB::table('writing_events')->where('id',$first->id)->update(['sequence'=>2]);
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('event_hmac_mismatch',$r['reason_codes']);
    }
    public function test_budget_exhaustion_is_never_partial_success_and_connection_remains_usable(): void
    {
        [,,,$v]=$this->fixture();
        foreach (['events'=>1,'seconds'=>0,'data_bytes'=>1,'row_bytes'=>1,'sessions'=>0,'manifest_bytes'=>1,'memory_bytes'=>0] as $name=>$limit) {
            $old=config('veritas.verification.'.$name);config(['veritas.verification.'.$name=>$limit]);
            $r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('budget_exceeded',$r['reason_codes']);$this->assertFalse($r['complete']);
            $this->assertSame(1,DB::table('document_versions')->count());config(['veritas.verification.'.$name=>$old]);
        }
    }
    public function test_mismatch_has_priority_over_later_incompleteness(): void
    {
        [,,,$v,$sid]=$this->fixture();
        WritingEvent::where('writing_session_id',$sid)->where('sequence',1)->update(['previous_hash'=>str_repeat('a',64)]);
        WritingEvent::where('writing_session_id',$sid)->where('sequence',2)->delete();
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('event_hmac_mismatch',$r['reason_codes']);$this->assertContains('event_missing',$r['reason_codes']);
    }
    public function test_private_routes_owner_recipient_third_party_foreign_version_and_public_minimum(): void
    {
        [$a,$b,$doc,$v,,$path]=$this->fixture();$base=$path.'/versions/'.$v->id;
        $this->getJson($base)->assertOk()->assertHeader('Cache-Control','no-store, private')->assertJsonPath('version.snapshot_html',$v->snapshot_html)->assertJsonMissingPath('document');
        $this->postJson($base.'/verification')->assertOk()->assertHeader('Cache-Control','no-store, private')->assertJsonPath('status','limited');
        $this->actingAs($b)->getJson($base.'?assignment_id=1')->assertNotFound();$this->postJson($base.'/verification')->assertNotFound();
        $this->actingAs($a)->postJson('/api/submissions',['document_version_id'=>$v->id,'recipient_email'=>$b->email])->assertCreated();
        $this->actingAs($b)->getJson($base)->assertOk();$this->postJson($base.'/verification')->assertOk()->assertJsonPath('status','limited');
        $other=Document::create(['owner_id'=>$a->id]);$this->getJson('/api/documents/'.$other->id.'/versions/'.$v->id)->assertNotFound();
        $this->getJson($path.'/versions/'.Str::uuid())->assertNotFound();
        $c=User::create(['name'=>'C','email'=>'verifier-c@example.test','password'=>'Fictitious12345']);$this->actingAs($c)->getJson($base)->assertNotFound();
        DB::enableQueryLog();$public=$this->getJson('/api/verify/'.$v->certificate->certificate_code)->assertOk()->assertJsonPath('scope','payload_signature');$queries=DB::getQueryLog();DB::disableQueryLog();
        $this->assertEqualsCanonicalizing(['valid','scope','certificate_code','issued_at','content_hash'],array_keys($public->json()));
        foreach ($queries as $q) $this->assertStringNotContainsString('writing_events',$q['query']);
        config(['veritas.signing_key'=>'']);$this->getJson('/api/verify/'.$v->certificate->certificate_code)->assertStatus(409)->assertJsonPath('valid',false);
    }
    public function test_throttle_is_shared_across_versions_by_user_and_configured_only_on_server(): void
    {
        [,,,$v,,$path]=$this->fixture();$base=$path.'/versions/'.$v->id.'/verification';
        $other=$this->postJson($path.'/seal')->assertCreated()->json('version.id');
        for($i=0;$i<6;$i++) $this->postJson($i<3?$base:$path.'/versions/'.$other.'/verification',['events'=>999999,'seconds'=>1000])->assertOk()->assertJsonPath('status','limited');
        $this->postJson($base)->assertStatus(429);
    }
    public function test_image_bytes_commitment_metadata_missing_file_and_unsafe_paths(): void
    {
        [$a,,$doc,$v]=$this->fixture();
        $root=sys_get_temp_dir().'/verifier-'.Str::uuid();mkdir($root,0700);config(['veritas.media_path'=>$root]);
        $id=(string)Str::uuid();$bytes='small image fixture';$file=$root.'/'.$id.'.png';file_put_contents($file,$bytes);
        try {
            $img=DocumentImage::create(['id'=>$id,'document_id'=>$doc->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
            $html='<p>image</p><img src="'.$img->url().'" data-image-sha256="'.str_repeat('0',64).'">';
            $v->update(['snapshot_html'=>$html,'content_hash'=>hash('sha256',$html)]);
            $this->resign($v,fn($p)=>array_replace($p,['content_hash'=>$v->content_hash,'images'=>[$id=>$img->sha256]]));
            $r=$this->verify($v);$this->assertSame('limited',$r['status']);$this->assertSame(strlen($bytes),$r['consumed']['image_bytes']);
            foreach(['image_bytes','image_file_bytes','images'] as $limit){
                $old=config('veritas.verification.'.$limit);config(['veritas.verification.'.$limit=>0]);
                $limited=$this->verify($v);$this->assertSame('incomplete',$limited['status']);$this->assertContains('budget_exceeded',$limited['reason_codes']);
                config(['veritas.verification.'.$limit=>$old]);
            }
            $this->resign($v,fn($p)=>array_replace($p,['images'=>[$id=>null]]));
            $this->assertContains('image_commitment_invalid',$this->verify($v)['reason_codes']);
            $this->resign($v,fn($p)=>array_replace($p,['images'=>[$id=>$img->sha256]]));
            file_put_contents($file,'tampered');$r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('image_signed_hash_mismatch',$r['reason_codes']);
            unlink($file);$this->assertSame('incomplete',$this->verify($v)['status']);
            $img->update(['filename'=>'../outside.png']);$this->assertContains('image_file_unavailable',$this->verify($v)['reason_codes']);
        } finally { if(is_file($file))unlink($file);rmdir($root); }
    }
    public function test_historical_process_image_has_diagnostic_without_signed_byte_claim(): void
    {
        [,, $doc,$v,$sid]=$this->fixture();
        $root=sys_get_temp_dir().'/verifier-'.Str::uuid();mkdir($root,0700);config(['veritas.media_path'=>$root]);
        $id=(string)Str::uuid();$file=$root.'/'.$id.'.png';file_put_contents($file,'bytes');
        try {
            $img=DocumentImage::create(['id'=>$id,'document_id'=>$doc->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>5,'sha256'=>hash('sha256','bytes')]);
            $e=WritingEvent::where('writing_session_id',$sid)->where('sequence',2)->firstOrFail();
            $html='<img src="'.$img->url().'">';
            $canonical=json_encode(['session'=>$sid,'sequence'=>2,'type'=>$e->event_type,'input'=>$e->input_type,'data'=>$e->data,'after'=>$html,'elapsed'=>2],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            $h=hash_hmac('sha256',$e->previous_hash.$canonical,(string)config('veritas.signing_key'));$e->update(['after_html'=>$html,'event_hash'=>$h]);
            $this->resign($v,function($p)use($sid,$h){$p['history_boundary'][$sid]['hash']=$h;return $p;});
            $r=$this->verify($v);$this->assertSame('limited',$r['status']);$this->assertContains('historical_image_unsigned',$r['reason_codes']);
            $this->assertSame('unsigned_unless_snapshot_committed',$r['scope']['historical_image_bytes']);
        }finally{unlink($file);rmdir($root);}
    }
    public function test_original_json_integer_and_numeric_string_types_are_preserved_in_event_hmac(): void
    {
        [$a,,$doc,$v,$sid,$path]=$this->fixture();
        $this->postJson($path.'/events',['session_id'=>$sid,'events'=>[['sequence'=>3,'event_type'=>'insert','after_html'=>'<p>á génesis</p>','elapsed_ms'=>'3']]])->assertOk();
        $sealed=$this->postJson($path.'/seal')->assertCreated()->json('version');
        $this->assertSame('limited',app(VersionVerifier::class)->verify($sealed['id'])['status']);
    }
    public function test_streaming_keeps_html_memory_bounded_and_does_not_change_pdo_attributes(): void
    {
        [$a,,$doc,$v,$sid,$path]=$this->fixture();
        // 20 MiB of persisted snapshots, read one at a time, no large fixture array.
        $html='<p>'.str_repeat('x',160000).'</p>';
        $batch=[];for($i=3;$i<=130;$i++) $batch[]=['sequence'=>$i,'event_type'=>'insert','after_html'=>$html,'elapsed_ms'=>$i];
        $this->postJson($path.'/events',['session_id'=>$sid,'events'=>$batch])->assertOk();
        $sealed=$this->postJson($path.'/seal')->assertCreated()->json('version');
        unset($html,$batch);gc_collect_cycles();memory_reset_peak_usage();$baseline=memory_get_usage();
        $pdo=DB::connection()->getPdo();$errorMode=$pdo->getAttribute(\PDO::ATTR_ERRMODE);
        $r=app(VersionVerifier::class)->verify($sealed['id']);
        $delta=memory_get_peak_usage()-$baseline;
        fwrite(STDOUT, PHP_EOL.'Bounded verifier: '.json_encode(['events'=>$r['consumed']['events'],'data_bytes'=>$r['consumed']['data_bytes'],'elapsed_ms'=>$r['consumed']['elapsed_ms'],'php_peak_increment_bytes'=>$delta]).PHP_EOL);
        $this->assertSame('limited',$r['status']);$this->assertSame(130,$r['consumed']['events']);
        $this->assertLessThan(32*1024*1024,$delta);$this->assertSame($errorMode,$pdo->getAttribute(\PDO::ATTR_ERRMODE));
        config(['veritas.verification.data_bytes'=>100]);$this->assertSame('incomplete',app(VersionVerifier::class)->verify($sealed['id'])['status']);
        $this->assertSame($errorMode,$pdo->getAttribute(\PDO::ATTR_ERRMODE));$this->assertSame(130,DB::table('writing_events')->where('writing_session_id',$sid)->count());
    }
    public function test_missing_certificate_and_oversized_private_get_are_explicit(): void
    {
        [,,,$v,,$path]=$this->fixture();$v->certificate()->delete();
        $r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('certificate_missing',$r['reason_codes']);
        config(['veritas.verification.row_bytes'=>1]);$this->getJson($path.'/versions/'.$v->id)->assertStatus(413);
    }
    public function test_duplicate_sequence_in_isolated_sqlite_fixture_is_rejected(): void
    {
        [,,,$v,$sid]=$this->fixture();
        DB::statement('DROP INDEX writing_events_writing_session_id_sequence_unique');
        $attributes=WritingEvent::where('writing_session_id',$sid)->where('sequence',1)->firstOrFail()->getAttributes();unset($attributes['id']);
        $id=DB::table('writing_events')->insertGetId($attributes);
        $this->resign($v,function($p)use($sid,$id){$p['history_boundary'][$sid]['event_id']=$id;return $p;});
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('event_sequence_mismatch',$r['reason_codes']);
    }
    public function test_invalid_image_manifest_does_not_silently_pass(): void
    {
        [,,,$v]=$this->fixture();
        foreach([null,'invalid'] as $value){
            $this->resign($v,fn($p)=>array_replace($p,['images'=>$value]));
            $r=$this->verify($v);$this->assertSame('incomplete',$r['status']);$this->assertContains('image_manifest_invalid',$r['reason_codes']);
        }
    }
    public function test_public_invalid_payload_has_no_internal_diagnostic_or_unvalidated_hash(): void
    {
        [,,,$v]=$this->fixture();$c=$v->certificate;
        $c->update(['signed_payload'=>['content_hash'=>['private_text'=>'never publish']]]);
        $r=$this->getJson('/api/verify/'.$c->certificate_code)->assertStatus(409)->assertJsonPath('content_hash',null);
        $this->assertStringNotContainsString('never publish',$r->getContent());
        DB::table('certificates')->where('id',$c->id)->update(['signed_payload'=>'null']);
        $this->getJson('/api/verify/'.$c->certificate_code)->assertStatus(409)->assertJsonPath('valid',false)->assertJsonPath('scope','payload_signature')->assertJsonMissingPath('exception');
    }
    public function test_operational_database_failure_is_not_returned_as_a_verification_result(): void
    {
        [,,,$v]=$this->fixture();$before=DB::transactionLevel();
        DB::statement('DROP TABLE writing_events');
        try{$this->verify($v);$this->fail('Operational failure was swallowed');}
        catch(\Illuminate\Database\QueryException){$this->assertSame($before,DB::transactionLevel());$this->assertSame(1,DB::table('document_versions')->count());}
    }
    public function test_ingestion_numeric_serializations_are_verified_exactly_and_altered_bytes_mismatch(): void
    {
        [,,,$v,$sid,$path]=$this->fixture();
        $sequence=3;
        foreach([' 3 ','+3',true,3.0,-0.0,'-0','+0','0'] as $elapsed){
            $body=['session_id'=>$sid,'events'=>[['sequence'=>$sequence,'event_type'=>'insert','after_html'=>'<p>Exact</p>','elapsed_ms'=>$elapsed]]];
            $this->call('POST',$path.'/events',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json'],json_encode($body,JSON_PRESERVE_ZERO_FRACTION|JSON_THROW_ON_ERROR))->assertOk();
            $sequence++;
        }
        $sealed=$this->postJson($path.'/seal')->assertCreated()->json('version');
        $r=app(VersionVerifier::class)->verify($sealed['id']);$this->assertSame('limited',$r['status']);
        WritingEvent::where('writing_session_id',$sid)->where('sequence',1)->update(['data'=>'different bytes']);
        $r=$this->verify($v);$this->assertSame('mismatch',$r['status']);$this->assertContains('event_hmac_mismatch',$r['reason_codes']);
    }
    public function test_obtained_private_results_keep_http_200_for_each_failure_state(): void
    {
        [,,,$v,,$path]=$this->fixture();$base=$path.'/versions/'.$v->id.'/verification';
        $c=$v->certificate;$original=$c->signature;$c->update(['signature'=>str_repeat('0',64)]);
        $this->postJson($base)->assertOk()->assertJsonPath('status','mismatch')->assertHeader('Cache-Control','no-store, private');
        $c->update(['signature'=>$original]);$key=config('veritas.signing_key');config(['veritas.signing_key'=>null]);
        $this->postJson($base)->assertOk()->assertJsonPath('status','incomplete');config(['veritas.signing_key'=>$key]);
        $this->resign($v,fn($p)=>array_replace($p,['format_version'=>99]));
        $this->postJson($base)->assertOk()->assertJsonPath('status','unsupported');
    }
}
