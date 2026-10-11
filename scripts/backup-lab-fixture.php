<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (config('database.connections.mysql.database') !== 'inkgroove_backup' || !app()->environment('local')) throw new RuntimeException('Backup lab only');
$manifest=storage_path('app/privacy-fixture.json');
if (($argv[1] ?? '') === 'clean') {
    $ids=json_decode(file_get_contents($manifest),true,flags:JSON_THROW_ON_ERROR);
    Illuminate\Support\Facades\DB::transaction(function () use ($ids) {
        foreach ($ids['users'] as $record) {
            $user=App\Models\User::where('email',$record['email'])->findOrFail($record['id']);
            if (!str_starts_with($user->email,'privacy-fixture-')) throw new RuntimeException('Identity mismatch');
            $docs=App\Models\Document::where('owner_id',$user->id)->get();
            foreach ($docs as $doc) Illuminate\Support\Facades\DB::table('submissions')->whereIn('document_version_id', $doc->versions()->pluck('id'))->delete();
            foreach ($docs as $doc) foreach ($doc->images()->get() as $image) if (is_file($image->path())) unlink($image->path());
            Illuminate\Support\Facades\DB::table('sessions')->where('user_id',$user->id)->delete();
            $user->delete();
        }
    });
    if (App\Models\User::whereIn('id', array_column($ids['users'], 'id'))->exists() || App\Models\Document::whereKey($ids['document_id'])->exists()) throw new RuntimeException('Fixture cleanup incomplete');
    unlink($manifest); echo json_encode(['remaining_fixture_users'=>0,'remaining_fixture_documents'=>0,'cleaned'=>$ids]).PHP_EOL; exit;
}
if (file_exists($manifest)) throw new RuntimeException('Existing manifest; clean explicitly');
$ids=Illuminate\Support\Facades\DB::transaction(function () {
    $users=[];
    foreach (['A','B','C','D'] as $name) {
        $u=App\Models\User::create(['name'=>'Privacy '.$name,'email'=>'privacy-fixture-'.Illuminate\Support\Str::uuid().'@example.test','password'=>'Fictitious12345']);
        $users[$name]=['id'=>$u->id,'email'=>$u->email];
    }
    $doc=App\Models\Document::create(['owner_id'=>$users['A']['id'],'title'=>'Privacy fixture','content_html'=>'<p>Initial fixture</p>','word_count'=>2]);
    $sealedAt=now();
    $version=App\Models\DocumentVersion::create(['document_id'=>$doc->id,'version_number'=>1,'snapshot_html'=>'<p>LEGACY SNAPSHOT</p>','snapshot_text'=>'LEGACY SNAPSHOT','word_count'=>2,'content_hash'=>hash('sha256','<p>LEGACY SNAPSHOT</p>'),'sealed_at'=>$sealedAt]);
    $payload=['version_id'=>$version->id,'document_id'=>$doc->id,'version'=>1,'content_hash'=>$version->content_hash,'process_hash'=>null,'sealed_at'=>$sealedAt->toIso8601String(),'page_settings'=>null,'images'=>[]];ksort($payload);
    $certificate=App\Models\Certificate::create(['document_version_id'=>$version->id,'certificate_code'=>'VRT-'.strtoupper(Illuminate\Support\Str::random(20)),'signed_payload'=>$payload,'signature'=>hash_hmac('sha256',json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),(string)config('veritas.signing_key')),'issued_at'=>$sealedAt]);
    $folder=App\Models\DocumentFolder::create(['owner_id'=>$users['A']['id'],'name'=>'Carpeta ñ é 漢字']); $doc->update(['folder_id'=>$folder->id]);
    return ['users'=>$users,'document_id'=>$doc->id,'legacy_version_id'=>$version->id,'legacy_certificate_code'=>$certificate->certificate_code];
});
file_put_contents($manifest,json_encode($ids)); chmod($manifest,0600); echo json_encode($ids).PHP_EOL;
