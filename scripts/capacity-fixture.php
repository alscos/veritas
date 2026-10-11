<?php
// Measurement fixtures only: refuses installed databases and existing manifests.
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use App\Models\{User,Document};
if(config('database.connections.mysql.database')!=='inkgroove_dev'||!app()->environment('local'))throw new RuntimeException('Dev only');
$file=storage_path('app/capacity-fixture.json');$action=$argv[1]??'';
if($action==='seed'){
 if(file_exists($file))throw new RuntimeException('Existing manifest');
 $m=DB::transaction(function(){
  $users=[];$run=Illuminate\Support\Str::uuid();
  // Thirty writers plus teacher. Higher levels require a new, explicitly sized run.
  for($i=0;$i<31;$i++){
   $u=User::create(['name'=>'Capacity '.$i,'email'=>'capacity-'.$run.'-'.$i.'@example.test','password'=>'Fictitious12345']);
   $d=$i<30?Document::create(['owner_id'=>$u->id,'title'=>'Capacity '.$i,'content_html'=>'<p>Inicio ficticio pingüino génesis</p>','content_text'=>'Inicio ficticio pingüino génesis','word_count'=>4]):null;
   $users[]=['id'=>$u->id,'email'=>$u->email,'document'=>$d?->id];
  }
  return ['run'=>(string)$run,'users'=>$users];
 });file_put_contents($file,json_encode($m));chmod($file,0600);echo json_encode(['accounts'=>31,'run'=>$m['run']]).PHP_EOL;exit;
}
if($action==='anonymous-audit'){
 $counts=[];
 foreach(['http-preparation-failed'=>'Python-urllib/%','browser'=>'%Chrome/151.%'] as $name=>$agent){
  $data=json_decode(file_get_contents(base_path('.dev-private/capacity-results/'.$name.'.json')),true,flags:JSON_THROW_ON_ERROR);$samples=$data['samples']??$data['host'];
  $from=(int)floor($samples[0]['time'])-5;$to=(int)ceil(end($samples)['time'])+5;
  $counts[$name]=DB::table('sessions')->whereNull('user_id')->where('user_agent','like',$agent)->whereBetween('last_activity',[$from,$to])->count();
 }
 echo json_encode(['anonymous_candidates_by_metadata_only'=>$counts,'not_safe_to_delete_without_inventory'=>true]).PHP_EOL;exit;
}
if($action==='allocation'){echo json_encode(DB::select('SELECT TABLE_NAME, DATA_LENGTH, INDEX_LENGTH, DATA_FREE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')).PHP_EOL;exit;}
$m=json_decode(file_get_contents($file),true,flags:JSON_THROW_ON_ERROR);
foreach($m['users'] as $u)if(!User::where('email',$u['email'])->whereKey($u['id'])->exists()||!str_starts_with($u['email'],'capacity-'.$m['run'].'-'))throw new RuntimeException('Identity mismatch');
if($action==='clean'){
 $removedDocs=Document::whereIn('owner_id',array_column($m['users'],'id'))->pluck('id')->all();
 $removedImagePaths=App\Models\DocumentImage::whereIn('document_id',$removedDocs)->get()->map(fn($im)=>$im->path())->all();
 $hashes=[];$sessionLog='/tmp/inkgroove-capacity-sessions.jsonl';
 if(is_file($sessionLog))foreach(file($sessionLog,FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line){$hash=json_decode($line,true,flags:JSON_THROW_ON_ERROR)['sha256'];if(!preg_match('/^[a-f0-9]{64}$/',$hash))throw new RuntimeException('Invalid session registry');$hashes[]=$hash;}
 $hashes=array_values(array_unique($hashes));
 $trackedAnonymous=$hashes?DB::table('sessions')->whereNull('user_id')->whereIn(DB::raw('SHA2(id,256)'),$hashes)->count():0;
 DB::transaction(function()use($m,$hashes){if($hashes)DB::table('sessions')->whereIn(DB::raw('SHA2(id,256)'),$hashes)->where(fn($q)=>$q->whereNull('user_id')->orWhereIn('user_id',array_column($m['users'],'id')))->delete();foreach($m['users'] as $u){
  $docs=Document::where('owner_id',$u['id'])->get();
  foreach($docs as $d){DB::table('submissions')->whereIn('document_version_id',$d->versions()->pluck('id'))->delete();foreach($d->images()->get() as $im)if(is_file($im->path()))unlink($im->path());}
  DB::table('sessions')->where('user_id',$u['id'])->delete();User::findOrFail($u['id'])->delete();
 }});
 if(User::whereIn('id',array_column($m['users'],'id'))->exists()||Document::whereIn('id',$removedDocs)->exists()||array_filter($removedImagePaths,'is_file'))throw new RuntimeException('Cleanup failed');
 if(is_file(storage_path('app/capacity-export.sql.gz')))unlink(storage_path('app/capacity-export.sql.gz'));
 unlink($file);echo json_encode(['removed_user_ids'=>array_column($m['users'],'id'),'removed_document_ids'=>$removedDocs,'images_removed'=>count($removedImagePaths),'tracked_anonymous_sessions_removed'=>$trackedAnonymous,'remaining'=>0]).PHP_EOL;exit;
}
if($action==='storage'){
 $rows=[];
 foreach(Document::whereIn('owner_id',array_column($m['users'],'id'))->get() as $d){
  $events=DB::table('writing_events')->whereIn('writing_session_id',$d->sessions()->pluck('id'));
  $rows[]=['document'=>$d->id,'events'=>(clone $events)->count(),'snapshot_bytes'=>(int)(clone $events)->sum(DB::raw('OCTET_LENGTH(after_html)')),'live_bytes'=>strlen($d->content_html),'revision'=>$d->revision];
 }
 $tables=DB::select('SELECT TABLE_NAME, DATA_LENGTH, INDEX_LENGTH, DATA_FREE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
 echo json_encode(['documents'=>$rows,'tables'=>$tables,'images_bytes'=>(int)App\Models\DocumentImage::whereIn('document_id',array_column($rows,'document'))->sum('bytes'),'php_peak_allocated'=>memory_get_peak_usage(true)]).PHP_EOL;exit;
}
if($action==='export'){
 $out=storage_path('app/capacity-export.sql.gz');$gz=gzopen($out,'wb1');$logical=0;
 $docs=Document::whereIn('owner_id',array_column($m['users'],'id'))->get();
 $sessions=App\Models\WritingSession::whereIn('document_id',$docs->pluck('id'))->pluck('id');
 $versions=App\Models\DocumentVersion::whereIn('document_id',$docs->pluck('id'))->pluck('id');
 $pdo=DB::connection()->getPdo();$buffered=$pdo->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);$pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,false);
 foreach(['users'=>User::whereIn('id',array_column($m['users'],'id')),'documents'=>Document::whereIn('id',$docs->pluck('id')),'writing_sessions'=>App\Models\WritingSession::whereIn('id',$sessions),'writing_events'=>App\Models\WritingEvent::whereIn('writing_session_id',$sessions),'document_images'=>App\Models\DocumentImage::whereIn('document_id',$docs->pluck('id')),'document_versions'=>App\Models\DocumentVersion::whereIn('id',$versions),'certificates'=>App\Models\Certificate::whereIn('document_version_id',$versions),'submissions'=>App\Models\Submission::whereIn('document_version_id',$versions)] as $table=>$query){
  foreach($query->cursor() as $row){$values=$row->getAttributes();$columns=implode(',',array_map(fn($name)=>'`'.$name.'`',array_keys($values)));$encoded=implode(',',array_map(fn($value)=>$value===null?'NULL':$pdo->quote((string)$value),array_values($values)));$line='INSERT INTO `'.$table.'` ('.$columns.') VALUES ('.$encoded.');'.PHP_EOL;$logical+=strlen($line);gzwrite($gz,$line);}
 }
 $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,$buffered);
 gzclose($gz);chmod($out,0600);echo json_encode(['export_logical_bytes'=>$logical,'gzip_bytes'=>filesize($out),'php_peak_allocated'=>memory_get_peak_usage(true),'format'=>'fixture rows SQL INSERT; schema/config/files excluded; not an installation backup']).PHP_EOL;exit;
}
if($action==='verify-expected'){
 $expected=json_decode(file_get_contents(base_path('.dev-private/capacity-results/expected.json')),true,flags:JSON_THROW_ON_ERROR);$checked=0;
 foreach($expected as $row){if($row['sequence']===0)continue;
  $doc=Document::whereIn('owner_id',array_column($m['users'],'id'))->findOrFail($row['document']);
  $session=$doc->sessions()->findOrFail($row['session']);
  if($doc->content_html!==$row['html']||(int)$doc->revision!==$row['revision']||$session->last_sequence!==$row['sequence'])throw new RuntimeException('Offered/processed content or revision mismatch');$checked++;
 }echo json_encode(['offered_content_revision_heads_checked'=>$checked,'valid'=>true]).PHP_EOL;exit;
}
if($action==='integrity'){
 $n=0;$v=0;$revisions=0;$contentChecked=0;
 foreach(Document::whereIn('owner_id',array_column($m['users'],'id'))->get() as $d){$revisions+=(int)$d->revision;
 $last=App\Models\WritingEvent::whereIn('writing_session_id',$d->sessions()->pluck('id'))->orderByDesc('id')->first();
 if($last){if($last->after_html!==$d->content_html)throw new RuntimeException('Live content differs from final accepted event');$contentChecked++;}
 foreach($d->sessions()->get() as $s){$prev=null;$seq=0;
  $pdo=DB::connection()->getPdo();$buffered=$pdo->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);$pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,false);
  foreach($s->events()->orderBy('sequence')->cursor() as $e){
   $canonical=json_encode(['session'=>$s->id,'sequence'=>$e->sequence,'type'=>$e->event_type,'input'=>$e->input_type,'data'=>$e->data,'after'=>$e->after_html,'elapsed'=>$e->elapsed_ms],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
   $hash=hash_hmac('sha256',($prev??'').$canonical,(string)config('veritas.signing_key'));
   if($e->sequence!==++$seq||$e->previous_hash!==$prev||!hash_equals($e->event_hash,$hash))throw new RuntimeException('Chain mismatch');$prev=$hash;$n++;
  }$pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,$buffered);if($s->last_sequence!==$seq||$s->last_hash!==$prev)throw new RuntimeException('Head mismatch');
 }
 foreach($d->versions()->with('certificate')->get() as $version){$p=$version->certificate->signed_payload;ksort($p);
  if(!hash_equals($version->content_hash,hash('sha256',$version->snapshot_html))||!hash_equals($version->certificate->signature,hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),(string)config('veritas.signing_key'))))throw new RuntimeException('Seal mismatch');
  $boundary=App\Support\VersionAccess::boundary($version);if($boundary===null)throw new RuntimeException('Missing boundary');
  foreach($boundary as $id=>$head){$e=App\Models\WritingEvent::where('writing_session_id',$id)->where('sequence',$head['sequence'])->findOrFail($head['event_id']);if($e->event_hash!==$head['hash']||!$d->sessions()->whereKey($id)->exists())throw new RuntimeException('Boundary mismatch');}$v++;
 }
 }echo json_encode(['events'=>$n,'revisions'=>$revisions,'content_checked'=>$contentChecked,'versions'=>$v,'valid'=>true,'php_peak_allocated'=>memory_get_peak_usage(true)]).PHP_EOL;exit;
}
throw new RuntimeException('Unknown action');
