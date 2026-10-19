<?php
require __DIR__.'/vendor/autoload.php';
$app=require __DIR__.'/lab-guard.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->call('migrate',['--force'=>true]);
use App\Models\{User, Document, DocumentImage};
use App\Http\Controllers\{EventController, SealController};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
$password=trim(stream_get_contents(STDIN));
if(strlen($password)<12) throw new LogicException('Synthetic password too short');
$users=[];
foreach(['author','other','one','two','three'] as $name)
    $users[$name]=User::create(['name'=>$name,'email'=>$name.'@fixture.test','password'=>$password]);
unset($password);
foreach(['author','other'] as $name) {
    $owner=$users[$name];
    $d=Document::create(['owner_id'=>$owner->id,'title'=>'Synthetic '.$name,'content_html'=>'<p>Inicial</p>','word_count'=>1]);
    $id=(string)Str::uuid();$bytes=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5x8AAAAASUVORK5CYII=');
    file_put_contents(config('veritas.media_path').'/'.$id.'.png',$bytes);
    $image=DocumentImage::create(['id'=>$id,'document_id'=>$d->id,'filename'=>$id.'.png','mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
    $html='<p>á NFC · génesis NFD · <mark data-origin="paste">pegado</mark></p><p></p><p>línea<br>literal</p><img src="'.$image->url().'">';
    $html.='<div data-page-break="true"></div><p>Segunda página sintética</p><div data-page-break="true"></div><p>Tercera página</p><span onclick="document.documentElement.dataset.hostile=1">Atributo hostil inerte</span><a href="javascript:document.documentElement.dataset.hostile=1">Enlace hostil como texto</a>';
    $events=[];for($i=1;$i<=40;$i++)$events[]=['sequence'=>$i,'event_type'=>'insert','elapsed_ms'=>$i*100,'after_html'=>$html.'<p>'.$i.'</p>'];
    $r=Request::create('/','POST',['session_id'=>(string)Str::uuid(),'events'=>$events]);$r->setUserResolver(fn()=>$owner);
    (new EventController)->store($r,$d);
    $d->update(['content_html'=>$html,'word_count'=>8]);
    for($i=0;$i<2;$i++) {
        $sealed=(new SealController)->store($r,$d)->getData(true);$v=$sealed['version']['id'];
        $summary=app(App\Support\HistoricalVersionSummary::class)->summarize($owner,$d->id,$v);
        if(!in_array($summary['verification']['status'],['verified','limited'],true))throw new LogicException('Seal invalid');
        foreach(($i===0?['one','two']:['three']) as $recipient)
            DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'document_version_id'=>$v,'sender_id'=>$owner->id,'recipient_user_id'=>$users[$recipient]->id,'submitted_at'=>now()]);
    }
}
echo "Fixture cryptographically verified; five synthetic accounts, four sealed versions, eighty events.\n";
