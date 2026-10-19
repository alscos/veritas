<?php
namespace Tests\Feature;

use App\Models\{Document, User};
use App\Support\{GrantTime, VersionShares, VersionSummaryCapabilities, VersionShareGate};
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Auth, DB};
use Tests\TestCase;

final class GrantTimeTest extends TestCase
{
    use DatabaseMigrations;

    public function test_exact_elapsed_days_sql_roundtrip_across_both_dst_transitions_and_timezones(): void
    {
        config(['veritas.seal_format'=>2,'veritas.public_origin'=>'http://127.0.0.1:8084']);
        $a=User::create(['name'=>'Clock','email'=>'clock@example.test','password'=>'synthetic']);
        $s=new VersionShares; $old=new VersionSummaryCapabilities; $gate=new VersionShareGate;
        try {
            foreach(['UTC','Europe/Madrid'] as $zone) {
                config(['app.timezone'=>$zone]); date_default_timezone_set($zone);
                $d=Document::create(['owner_id'=>$a->id,'content_html'=>'<p>á é</p><p></p>','word_count'=>2]);
                $v=$this->actingAs($a)->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
                DB::table('submissions')->insert(['id'=>(string)\Illuminate\Support\Str::uuid(),'document_version_id'=>$v,
                    'sender_id'=>$a->id,'recipient_user_id'=>$a->id,'submitted_at'=>now()]);
                foreach(['2026-10-24T01:30:00Z','2027-03-27T01:30:00Z','2027-02-01T12:00:00Z'] as $date) {
                    foreach([1,7,30] as $days) {
                        $start=CarbonImmutable::parse($date);$this->travelTo($start);
                        $this->app['auth']->forgetGuards();app('session.store')->start();Auth::guard('web')->login($a);
                        $request=Request::create('/','POST');$request->setLaravelSession(app('session.store'));
                        $grants=[];
                        foreach([1,2,3] as $level) {
                            $g=$s->issue($a,$d->id,$v,['level'=>$level,'days'=>$days]+($level===3?['recipient_ids'=>[$a->id]]:[]));
                            $grants[]=[$g['grant']['id'],explode('#token=',$g['url'])[1],$level];
                        }
                        $g=$old->issue($a,$d->id,$v,$days);$grants[]=[$g['grant']['id'],$g['secret'],2];
                        foreach($grants as [$id,$token,$level]) {
                            $row=DB::table('version_summary_grants')->where('id',$id)->first();
                            self::assertSame('epoch',$row->time_basis);
                            self::assertSame($days*86400,GrantTime::instant($row,'expires_at')->getTimestamp()-$start->getTimestamp());
                            $shadow=clone $row; $shadow->expires_at='2099-01-01 00:00:00';
                            self::assertSame(GrantTime::iso($row,'expires_at'),GrantTime::iso($shadow,'expires_at'));
                            $this->travelTo($start->addSeconds($days*86400-1));
                            self::assertTrue(GrantTime::active($row));
                            self::assertSame(1,GrantTime::instant($row,'expires_at')->getTimestamp()-now('UTC')->getTimestamp());
                            self::assertSame($level,$gate->cardResponse($request,$token)->getData(true)['level']);
                            $this->travelTo($start->addSeconds($days*86400));
                            self::assertFalse(GrantTime::active($row));
                            $this->denied(fn()=>$gate->cardResponse($request,$token));
                            if($level===3) {
                                $this->denied(fn()=>$gate->page($request,$token));
                                $this->denied(fn()=>$gate->event($request,$token,1));
                                $this->denied(fn()=>$gate->image($request,$token,'synthetic'));
                            }
                        }
                        self::assertSame('expired',collect($old->listing($a,$d->id,$v))->firstWhere('id',$g['grant']['id'])['state']);
                        $this->travelTo($start);
                        $old->revoke($a,$d->id,$v,$grants[0][0]);
                        $this->denied(fn()=>$gate->cardResponse($request,$grants[0][1]));
                        self::assertSame(2,$gate->cardResponse($request,$grants[1][1])->getData(true)['level']);
                    }
                }
            }
        } finally {$this->travelBack();config(['app.timezone'=>'Europe/Madrid']);date_default_timezone_set('Europe/Madrid');}
    }

    public function test_legacy_repeated_hour_uses_earliest_possible_instant_and_default_level_two(): void
    {
        config(['veritas.seal_format'=>2,'veritas.public_origin'=>'http://127.0.0.1:8084']);
        $a=User::create(['name'=>'Legacy','email'=>'legacy@example.test','password'=>'synthetic']);
        $d=Document::create(['owner_id'=>$a->id,'content_html'=>'<p>legacy</p>','word_count'=>1]);
        $v=$this->actingAs($a)->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $secret=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
        $id=(string)\Illuminate\Support\Str::uuid();
        DB::table('version_summary_grants')->insert(['id'=>$id,'owner_id'=>$a->id,'document_id'=>$d->id,
            'version_id'=>$v,'digest'=>hash('sha256',$secret),'created_at'=>'2026-10-18 02:30:00','expires_at'=>'2026-10-25 02:30:00']);
        $row=DB::table('version_summary_grants')->where('id',$id)->first();
        self::assertSame(2,(int)$row->level); self::assertNull($row->time_basis);
        self::assertSame('2026-10-25T00:30:00+00:00',GrantTime::iso($row,'expires_at'));
        $s=new VersionSummaryCapabilities;
        try {
            $this->travelTo(CarbonImmutable::parse('2026-10-25T00:29:59Z'));self::assertTrue(GrantTime::active($row));
            self::assertSame(1,$s->redeem($secret)['counts']['value']['total']);
            $this->travelTo(CarbonImmutable::parse('2026-10-25T00:30:00Z'));self::assertFalse(GrantTime::active($row));
            $this->denied(fn()=>$s->redeem($secret));
            self::assertSame('expired',$s->listing($a,$d->id,$v)[0]['state']);
            $this->travelTo(CarbonImmutable::parse('2026-10-25T01:15:00Z'));
            $this->denied(fn()=>$s->redeem($secret)); // No reactivation in the second occurrence.
            $cross=(object)['created_at'=>'2026-10-19 02:30:00','expires_at'=>'2026-10-26 02:30:00','time_basis'=>null];
            self::assertSame('2026-10-26T00:30:00+00:00',GrantTime::iso($cross,'expires_at'));
            $row->time_basis='unknown';self::assertFalse(GrantTime::active($row));
            $gap=(object)['created_at'=>'2027-03-27 02:30:00','expires_at'=>'2027-03-28 02:30:00','time_basis'=>null];
            self::assertSame('2027-03-28T00:30:00+00:00',GrantTime::iso($gap,'expires_at'));
        } finally {$this->travelBack();}
    }
    private function denied(callable $f): void
    {
        try {$f();self::fail('Unexpected access');}
        catch(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e){self::assertSame(404,$e->getStatusCode());}
    }
}
