<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(config('database.connections.mysql.database')!=='inkgroove_backup'||!app()->environment('local')) throw new RuntimeException('Dev only');
$fixture=json_decode(file_get_contents(storage_path('app/privacy-fixture.json')),true,flags:JSON_THROW_ON_ERROR);
$doc=App\Models\Document::findOrFail($fixture['document_id']);
if($doc->owner_id!==$fixture['users']['A']['id']) throw new RuntimeException('Fixture mismatch');
$count=0;
foreach($doc->sessions()->get() as $session){
 $previous=null;$sequence=0;
 foreach($session->events()->orderBy('sequence')->get() as $event){
  if($event->sequence!==++$sequence || $event->previous_hash!==$previous)throw new RuntimeException('Chain/order mismatch');
  $canonical=json_encode(['session'=>$session->id,'sequence'=>$event->sequence,'type'=>$event->event_type,'input'=>$event->input_type,'data'=>$event->data,'after'=>$event->after_html,'elapsed'=>$event->elapsed_ms],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
  $hash=hash_hmac('sha256',($previous??'').$canonical,(string)config('veritas.signing_key'));
  if(!hash_equals($hash,$event->event_hash))throw new RuntimeException('HMAC mismatch');$previous=$hash;$count++;
 }
 if($session->last_sequence!==$sequence||$session->last_hash!==$previous)throw new RuntimeException('Head mismatch');
}
$versions=0;
foreach($doc->versions()->with('certificate')->get() as $version){
 $payload=$version->certificate->signed_payload;ksort($payload);
 $signature=hash_hmac('sha256',json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),(string)config('veritas.signing_key'));
 if(!hash_equals($version->certificate->signature,$signature)||!hash_equals($version->content_hash,hash('sha256',$version->snapshot_html)))throw new RuntimeException('Version/signature mismatch');
 if(($payload['format_version']??null)===2){
  $boundary=App\Support\VersionAccess::boundary($version);if($boundary===null)throw new RuntimeException('Invalid boundary');
  foreach($boundary as $session=>$head){
   $event=App\Models\WritingEvent::where('writing_session_id',$session)->where('sequence',$head['sequence'])->findOrFail($head['event_id']);
   if(!hash_equals($event->event_hash,$head['hash'])||!$doc->sessions()->whereKey($session)->exists())throw new RuntimeException('Boundary mismatch');
  }
 }
 $versions++;
}
$state=[]; foreach(['users','document_folders','documents','document_images','writing_sessions','writing_events','document_versions','certificates','submissions','migrations'] as $table) { $rows=Illuminate\Support\Facades\DB::table($table)->orderBy('id')->get(); $state[$table]=hash('sha256',json_encode($rows,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)); } foreach($doc->images()->get() as $image) { if(hash_file('sha256',$image->path())!==$image->sha256) throw new RuntimeException('Image hash mismatch'); $state['image:'.$image->id]=hash_file('sha256',$image->path()); } ksort($state); echo json_encode(['state_hashes'=>$state]); echo PHP_EOL; echo json_encode(['document_id'=>$doc->id,'events_verified'=>$count,'revision'=>$doc->revision,'hmac_and_heads_valid'=>true,'versions_and_boundaries_verified'=>$versions]).PHP_EOL;
