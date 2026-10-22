<?php
namespace Tests\Feature;
use App\Models\{User, Document, DocumentVersion};
use App\Support\{HistoricalVersionSummary, HistoricalWordCounts};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class HistoricalVersionSummaryTest extends TestCase
{
    use RefreshDatabase;
    private function fixture(): array
    {
        config(['veritas.seal_format'=>3]);
        $a=User::create(['name'=>'A','email'=>'summary-a@example.test','password'=>'synthetic']);
        $b=User::create(['name'=>'B','email'=>'summary-b@example.test','password'=>'synthetic']);
        $d=Document::create(['owner_id'=>$a->id,'word_count'=>2,'content_html'=>'<p>uno <mark data-origin="paste">dos</mark></p>']);
        $other=Document::create(['owner_id'=>$b->id,'word_count'=>1,'content_html'=>'<p></p>']);
        $sid=(string)Str::uuid(); $path='/api/documents/'.$d->id;
        $this->actingAs($a)->postJson($path.'/events',['session_id'=>$sid,'events'=>[['sequence'=>1,'event_type'=>'insert','elapsed_ms'=>1000,'after_html'=>$d->content_html]]])->assertOk();
        $v1=$this->postJson($path.'/seal')->assertCreated()->json('version.id');
        $d->update(['content_html'=>'<p><mark data-origin="paste-edited">tres cuatro cinco</mark></p>']);
        $this->postJson($path.'/events',['session_id'=>$sid,'events'=>[['sequence'=>2,'event_type'=>'paste_edit','elapsed_ms'=>20000,'after_html'=>$d->content_html]]])->assertOk();
        $v2=$this->postJson($path.'/seal')->assertCreated()->json('version.id');
        $v3=$this->actingAs($b)->postJson('/api/documents/'.$other->id.'/seal')->assertCreated()->json('version.id');
        $d->update(['content_html'=>'<p>PRIVATE LIVE DRAFT</p>']);
        return [$a,$b,$d,$other,$v1,$v2,$v3,$sid];
    }
    private function summary($u,$d,$v): array { return (new HistoricalVersionSummary)->summarize($u,$d->id,$v); }
    public function test_exact_historical_counts_zero_privacy_read_only_and_arrival_time(): void
    {
        [$a,$b,$d,$other,$v1,$v2,$v3,$sid]=$this->fixture();
        $before=[];foreach(['documents','document_versions','certificates','version_evidence','writing_events','writing_sessions'] as $t)$before[$t]=DB::table($t)->get()->toJson();
        DB::enableQueryLog();$r=$this->summary($a,$d,$v1);$queries=DB::getQueryLog();DB::disableQueryLog();
        self::assertSame(['direct'=>1,'pasted'=>1,'edited'=>0,'total'=>2],$r['counts']['value']);
        self::assertSame('verified',$r['counts']['state']);
        self::assertSame(1,$r['verification']['consumed']['events']);
        fwrite(STDOUT, PHP_EOL.'M33B synthetic budget: '.json_encode($r['verification']['consumed']).PHP_EOL);
        self::assertSame(3,$this->summary($a,$d,$v2)['counts']['value']['edited']);
        self::assertSame(0,$this->summary($b,$other,$v3)['counts']['value']['total']);
        foreach($before as $t=>$value)self::assertSame($value,DB::table($t)->get()->toJson());
        foreach($queries as $q){self::assertDoesNotMatchRegularExpression('/\b(insert|update|delete)\b/i',$q['query']);self::assertStringNotContainsString('content_html',$q['query']);}
        $json=json_encode($r);foreach(['PRIVATE','"snapshot_html":','certificate_code','summary-a@','uno','dos'] as $private)self::assertStringNotContainsString($private,$json);
        DB::table('writing_events')->where('writing_session_id',$sid)->update(['server_received_at'=>'2000-01-01 00:00:00']);
        $after=$this->summary($a,$d,$v1);
        self::assertSame($r['counts'],$after['counts']); self::assertSame('passed',$after['verification']['checks']['chains']);
        foreach(['times','ppm','last_ppm','pauses'] as $key){self::assertSame($r[$key],$after[$key]);self::assertNull($after[$key]['value']);}
    }
    public function test_identity_crosses_are_denied(): void
    {
        [$a,$b,$d,$other,$v1,,$v3]=$this->fixture();
        foreach([[$b,$d,$v1],[$a,$d,$v3],[$a,$other,$v1]] as [$u,$doc,$v]){
            try{$this->summary($u,$doc,$v);self::fail('Unauthorized');}catch(\Symfony\Component\HttpKernel\Exception\HttpException $e){self::assertSame(404,$e->getStatusCode());}catch(\Illuminate\Database\Eloquent\ModelNotFoundException){self::assertTrue(true);}
        }
    }
    public function test_integrity_missing_evidence_session_conflict_and_budget_fail_closed(): void
    {
        [$a,$b,$d,$other,$v1,,$v3,$sid]=$this->fixture();
        $v=DocumentVersion::findOrFail($v1);$html=$v->snapshot_html;
        $v->update(['snapshot_html'=>'<p>tampered</p>']);self::assertNull($this->summary($a,$d,$v1)['counts']['value']);$v->update(['snapshot_html'=>$html]);
        DB::table('writing_events')->where('writing_session_id',$sid)->where('sequence',1)->update(['data'=>'tampered']);
        self::assertSame('mismatch',$this->summary($a,$d,$v1)['verification']['status']);self::assertNull($this->summary($a,$d,$v1)['counts']['value']);
        DB::table('writing_events')->where('writing_session_id',$sid)->where('sequence',1)->update(['data'=>null]);
        DB::table('writing_sessions')->where('id',$sid)->update(['document_id'=>$other->id]);self::assertNull($this->summary($a,$d,$v1)['counts']['value']);
        DB::table('writing_sessions')->where('id',$sid)->update(['document_id'=>$d->id]);
        config(['veritas.verification.events'=>0]);$r=$this->summary($a,$d,$v1);self::assertContains('budget_exceeded',$r['verification']['reason_codes']);self::assertNull($r['counts']['value']);
        config(['veritas.verification.events'=>100000]);
        DB::table('writing_events')->where('writing_session_id',$sid)->where('sequence',1)->delete();
        $missing=$this->summary($a,$d,$v1);self::assertNull($missing['counts']['value']);self::assertContains('event_missing',$missing['verification']['reason_codes']);
        DB::table('version_evidence')->where('document_version_id',$v3)->delete();self::assertSame('unavailable',$this->summary($b,$other,$v3)['counts']['state']);
    }
    public function test_v2_is_limited_and_missing_boundary_is_unavailable(): void
    {
        [$a,,$d]=$this->fixture();config(['veritas.seal_format'=>2]);$this->actingAs($a);
        $id=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $r=$this->summary($a,$d,$id);self::assertSame('limited',$r['counts']['state']);self::assertFalse($r['verification']['complete']);
        $c=DocumentVersion::findOrFail($id)->certificate;$p=$c->signed_payload;unset($p['history_boundary']);ksort($p);
        $c->update(['signed_payload'=>$p,'signature'=>hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),config('veritas.signing_key'))]);
        self::assertNull($this->summary($a,$d,$id)['counts']['value']);
        $d->update(['content_html'=>str_repeat('a',250001)]);
        $large=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        self::assertSame('snapshot_byte_limit',$this->summary($a,$d,$large)['counts']['reason']);
    }
    public function test_parser_rejects_ambiguous_and_resource_excess(): void
    {
        foreach(['<p>broken','<mark data-origin="paste"/>texto','<!DOCTYPE x><p>x</p>','<table>outside<tr><td>x</td></tr></table>','<p><div>x</div></p>',str_repeat('<span>',65).'x'.str_repeat('</span>',65),str_repeat('a',250001),str_repeat('<br>',5001)] as $html){
            try{HistoricalWordCounts::analyze($html);self::fail('Accepted ambiguous input');}catch(\DomainException){self::assertTrue(true);}
        }
        self::assertSame(0,HistoricalWordCounts::analyze('')['total']);
    }
}
