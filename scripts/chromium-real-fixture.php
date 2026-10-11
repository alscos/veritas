<?php
// Dedicated, inventoried fixture. No migrations; no access to other documents.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use App\Models\{User, Document, WritingSession, WritingEvent};
if (!app()->environment('local') || config('database.connections.mysql.database') !== 'inkgroove_dev') throw new RuntimeException('Dev only');
$path = storage_path('app/chromium-real.json');
$m = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
if (!preg_match('/^[a-f0-9-]{36}$/', $m['run']) || $m['email'] !== 'chromium-real-'.$m['run'].'@example.test') throw new RuntimeException('Invalid inventory');
$persist = function () use (&$m, $path) { file_put_contents($path, json_encode($m, JSON_THROW_ON_ERROR)); chmod($path, 0600); };
$action = $argv[1] ?? '';
if ($action === 'seed') {
    if (isset($m['user_id']) || User::where('email', $m['email'])->exists() || Document::whereKey($m['document_id'])->exists()) throw new RuntimeException('Fixture exists');
    DB::transaction(function () use (&$m, $persist) {
        $u = User::create(['name'=>'Chromium real fixture', 'email'=>$m['email'], 'password'=>'Fictitious12345']);
        $m['user_id'] = $u->id; $persist(); // Record before committing owned rows.
        $html = '<p>'.str_repeat('El pingüino llegó. génesis ', 150).'</p><p></p><p><mark data-origin="paste">Texto pegado</mark> <mark data-origin="paste-edited">revisión</mark></p>';
        Document::forceCreate(['id'=>$m['document_id'], 'owner_id'=>$u->id, 'title'=>'Chromium real 1800', 'content_html'=>$html.'<p>1800</p>']);
        foreach ($m['seed_sessions'] as $index=>$id) {
            $s = WritingSession::create(['id'=>$id, 'document_id'=>$m['document_id'], 'user_id'=>$u->id]);
            $previous = null; $rows = [];
            for ($seq=1; $seq<=900; $seq++) {
                $after = $html.'<p>'.($index*900+$seq).'</p>'; $type = $seq===1 ? 'start' : 'insert';
                $canonical = json_encode(['session'=>$id,'sequence'=>$seq,'type'=>$type,'input'=>'insertText','data'=>null,'after'=>$after,'elapsed'=>$seq*200], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
                $hash = hash_hmac('sha256', ($previous??'').$canonical, (string)config('veritas.signing_key'));
                $rows[] = ['writing_session_id'=>$id,'sequence'=>$seq,'event_type'=>$type,'input_type'=>'insertText','data'=>null,'after_html'=>$after,'elapsed_ms'=>$seq*200,'server_received_at'=>now()->subMinutes(10-$index)->startOfMinute(),'previous_hash'=>$previous,'event_hash'=>$hash];
                $previous=$hash;
                if (count($rows)===50) { DB::table('writing_events')->insert($rows); $rows=[]; }
            }
            $s->update(['last_sequence'=>900,'last_hash'=>$previous]);
        }
    });
    echo json_encode(['seeded_events'=>1800,'user_id'=>$m['user_id'],'document_id'=>$m['document_id']]).PHP_EOL; exit;
}
$u = User::where('email',$m['email'])->first();
if ($u && (!isset($m['user_id']) || $u->id!==$m['user_id'])) throw new RuntimeException('Owner mismatch');
$doc = Document::find($m['document_id']);
if ($doc && (!$u || $doc->owner_id!==$u->id)) throw new RuntimeException('Document mismatch');
if ($action==='integrity') {
    if (!$doc) throw new RuntimeException('Missing fixture');
    $n=0;
    foreach ($doc->sessions()->get() as $s) {
        $previous=null; $sequence=0;
        foreach ($s->events()->orderBy('sequence')->get() as $e) {
            $canonical=json_encode(['session'=>$s->id,'sequence'=>$e->sequence,'type'=>$e->event_type,'input'=>$e->input_type,'data'=>$e->data,'after'=>$e->after_html,'elapsed'=>$e->elapsed_ms],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            $hash=hash_hmac('sha256',($previous??'').$canonical,(string)config('veritas.signing_key'));
            if ($e->sequence!==++$sequence || $e->previous_hash!==$previous || !hash_equals($e->event_hash,$hash)) throw new RuntimeException('HMAC/order mismatch');
            $previous=$hash; $n++;
        }
        if ($s->last_hash!==$previous || $s->last_sequence!==$sequence) throw new RuntimeException('Head mismatch');
    }
    if ($n>2000) throw new RuntimeException('Event ceiling exceeded');
    $versions=0;
    foreach ($doc->versions()->with('certificate')->get() as $v) {
        $p=$v->certificate->signed_payload; ksort($p);
        if (!hash_equals($v->content_hash,hash('sha256',$v->snapshot_html)) || !hash_equals($v->certificate->signature,hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),(string)config('veritas.signing_key')))) throw new RuntimeException('Seal mismatch');
        $b=App\Support\VersionAccess::boundary($v); if ($b===null) throw new RuntimeException('Boundary missing');
        foreach ($b as $sid=>$head) {
            $e=WritingEvent::where('writing_session_id',$sid)->where('sequence',$head['sequence'])->findOrFail($head['event_id']);
            if (!$doc->sessions()->whereKey($sid)->exists() || $e->event_hash!==$head['hash']) throw new RuntimeException('Boundary mismatch');
        }
        $versions++;
    }
    $m['all_session_ids']=$doc->sessions()->pluck('id')->all();
    $m['version_ids']=$doc->versions()->pluck('id')->all(); $persist();
    echo json_encode(['events_verified'=>$n,'hmac_heads_valid'=>true,'versions_boundaries_verified'=>$versions,'revision'=>$doc->revision,'saved_marker_present'=>str_contains($doc->content_html,'recorrido real á génesis')]).PHP_EOL; exit;
}
if ($action==='clean') {
    $hashes=[];
    if (is_file($m['session_registry'])) foreach (file($m['session_registry'],FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
        $h=json_decode($line,true,flags:JSON_THROW_ON_ERROR)['sha256'];
        if (!preg_match('/^[a-f0-9]{64}$/',$h)) throw new RuntimeException('Invalid session inventory'); $hashes[]=$h;
    }
    $hashes=array_values(array_unique($hashes));
    $sids=$doc ? $doc->sessions()->pluck('id')->all() : ($m['all_session_ids']??$m['seed_sessions']);
    $vids=$doc ? $doc->versions()->pluck('id')->all() : ($m['version_ids']??[]);
    if ($doc && $doc->images()->exists()) throw new RuntimeException('Unplanned image: preserve and inspect');
    $anonymous=$hashes ? DB::table('sessions')->whereNull('user_id')->whereIn(DB::raw('SHA2(id,256)'),$hashes)->count() : 0;
    DB::transaction(function () use ($u,$hashes,$vids) {
        if ($hashes) DB::table('sessions')->whereIn(DB::raw('SHA2(id,256)'),$hashes)->where(function($q)use($u){$q->whereNull('user_id');if($u)$q->orWhere('user_id',$u->id);})->delete();
        if ($u) { DB::table('submissions')->whereIn('document_version_id',$vids)->delete(); DB::table('sessions')->where('user_id',$u->id)->delete(); $u->delete(); }
    });
    $remaining = User::where('email',$m['email'])->count()+Document::whereKey($m['document_id'])->count()+WritingSession::whereIn('id',$sids)->count()+WritingEvent::whereIn('writing_session_id',$sids)->count()+App\Models\DocumentVersion::whereIn('id',$vids)->count();
    if (isset($m['user_id'])) $remaining+=DB::table('sessions')->where('user_id',$m['user_id'])->count();
    if ($hashes) $remaining+=DB::table('sessions')->whereIn(DB::raw('SHA2(id,256)'),$hashes)->count();
    if ($remaining) throw new RuntimeException('Cleanup incomplete');
    echo json_encode(['remaining_inventoried_rows'=>0,'anonymous_sessions_removed'=>$anonymous,'tracked_session_hashes'=>count($hashes),'user_id'=>$m['user_id']??null,'document_id'=>$m['document_id'],'removed_editorial_sessions'=>count($sids),'removed_versions'=>count($vids)]).PHP_EOL;
    unlink($path); exit;
}
throw new RuntimeException('Unknown action');
