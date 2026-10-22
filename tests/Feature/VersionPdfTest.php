<?php
namespace Tests\Feature;

use App\Models\{User, Document, DocumentVersion, DocumentImage, Submission};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Must run only under the existing testing + SQLite :memory: guard. */
class VersionPdfTest extends TestCase
{
    use RefreshDatabase;
    private array $files = [];
    protected function tearDown(): void
    {
        foreach ($this->files as $path) { if (is_file($path)) unlink($path); elseif (is_dir($path)) rmdir($path); }
        parent::tearDown();
    }
    private function fixture(int $format = 2): array
    {
        config(['veritas.public_origin'=>'https://canonical.example.test', 'veritas.seal_format'=>$format]);
        $a=User::create(['name'=>'PRIVATE OWNER','email'=>'m32a-owner@example.test','password'=>'Fictitious12345']);
        $b=User::create(['name'=>'PRIVATE RECIPIENT','email'=>'m32a-recipient@example.test','password'=>'Fictitious12345']);
        $x=User::create(['name'=>'PRIVATE THIRD','email'=>'m32a-third@example.test','password'=>'Fictitious12345']);
        $d=Document::create(['owner_id'=>$a->id,'title'=>'PRIVATE TITLE','content_html'=>'<p>á génesis ñ ü</p><p></p>','content_text'=>'á génesis ñ ü','word_count'=>4]);
        $root=sys_get_temp_dir().'/m32a-'.Str::uuid(); mkdir($root,0700);config(['veritas.media_path'=>$root]);
        $id=(string)Str::uuid();$filename=$id.'.png';
        $bytes=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
        file_put_contents($root.'/'.$filename,$bytes);$this->files[]= $root.'/'.$filename; $this->files[]=$root;
        $image=DocumentImage::create(['id'=>$id,'document_id'=>$d->id,'filename'=>$filename,'mime'=>'image/png','width'=>1,'height'=>1,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
        $html=$d->content_html.'<img src="'.$image->url().'">';$d->update(['content_html'=>$html]);
        $this->actingAs($a)->postJson('/api/documents/'.$d->id.'/events',['session_id'=>(string)Str::uuid(),'events'=>[['sequence'=>1,'event_type'=>'insert','after_html'=>$html,'elapsed_ms'=>1]]])->assertOk();
        $seal=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json();
        $v=DocumentVersion::findOrFail($seal['version']['id']);
        return [$a,$b,$x,$d,$v,$image];
    }
    private function path($d,$v): string { return '/api/documents/'.$d->id.'/versions/'.$v->id.'/pdf-source'; }
    public function test_exact_version_permissions_snapshot_images_and_no_writes_v2_and_v3(): void
    {
        foreach ([2,3] as $format) {
            [$a,$b,$x,$d,$v,$image]=$this->fixture($format);
            $path=$this->path($d,$v);
            $this->actingAs($b)->getJson($path)->assertNotFound();
            Submission::create(['document_version_id'=>$v->id,'sender_id'=>$a->id,'recipient_user_id'=>$b->id,'recipient_email'=>$b->email,'status'=>'sent','submitted_at'=>now()]);
            $d->update(['content_html'=>'<p>LATER PRIVATE DRAFT</p>']);
            $before=[];foreach(['documents','document_versions','certificates','version_evidence','writing_sessions','writing_events','document_images'] as $t)$before[$t]=DB::table($t)->get()->toJson();
            foreach([$a,$b] as $reader) {
                $r=$this->actingAs($reader)->withHeader('Host','attacker.example.test')->getJson($path)->assertOk()->assertHeader('Cache-Control','no-store, private');
                $this->assertSame($v->snapshot_html,$r->json('snapshot_html'));
                $this->assertSame($format,$r->json('format_version'));
                $this->assertSame('https://canonical.example.test/verify/'.$v->certificate->certificate_code,$r->json('public_url'));
                $this->assertSame(hash_file('sha256',$image->path()),hash('sha256',base64_decode(explode(',',$r->json('images')[$image->url()],2)[1])));
                $this->assertStringNotContainsString('LATER PRIVATE DRAFT',$r->getContent());
                foreach(['owner_id','title','sender_id','recipient_email','signature','signed_payload','filename'] as $key)$this->assertArrayNotHasKey($key,$r->json());
            }
            $this->actingAs($x)->getJson($path)->assertNotFound();
            auth()->forgetGuards();$this->getJson($path)->assertUnauthorized();
            $this->getJson('/api/verify/'.$v->certificate->certificate_code)->assertOk()->assertJson(['scope'=>'payload_signature']);
            $public=$this->get('/verify/'.$v->certificate->certificate_code)->assertOk();
            foreach([$v->snapshot_html,$v->id,$d->id,$a->email,$b->email,'LATER PRIVATE DRAFT'] as $secret)$this->assertStringNotContainsString($secret,$public->getContent());
            foreach($before as $t=>$rows)$this->assertSame($rows,DB::table($t)->get()->toJson());
            // Unique fixture accounts for the next format; transactions/RefreshDatabase clean all test data.
            $a->update(['email'=>'done-owner-'.$format.'@example.test']);$b->update(['email'=>'done-recipient-'.$format.'@example.test']);$x->update(['email'=>'done-third-'.$format.'@example.test']);
        }
    }
    public function test_public_html_and_json_are_minimal_hmac_only_and_corruption_fails(): void
    {
        [$a,$b,$x,$d,$v]=$this->fixture();$c=$v->certificate;$code=$c->certificate_code;
        auth()->forgetGuards();
        $r=$this->getJson('/api/verify/'.$code)->assertOk();
        $this->assertSame(['valid','scope','certificate_code','issued_at','content_hash'],array_keys($r->json()));
        $this->assertSame('payload_signature',$r->json('scope'));
        $page=$this->get('/verify/'.$code)->assertOk()->assertSee('No se ha evaluado la integridad completa',false)
            ->assertSee('Esta consulta no realiza una verificación integral del proceso.')
            ->assertSee('Firma del payload almacenado comprobada.')
            ->assertSee('Alcance histórico limitado.')->assertSee('v2')
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        $this->assertStringContainsString('no-store', $page->headers->get('Cache-Control'));
        $this->assertStringNotContainsString($v->content_hash, $page->getContent());
        foreach([$d->title,$a->name,$a->email,$b->name,$b->email,$v->id,$d->id,$v->snapshot_html,'signed_payload','history_boundary','complete=true'] as $secret) {
            $this->assertStringNotContainsString($secret,$page->getContent());$this->assertStringNotContainsString($secret,$r->getContent());
        }
        $this->get('/verify/'.$code.'?lang=en')->assertOk()->assertSee('Full process integrity has not been evaluated.')->assertSee('This lookup does not perform full process verification.')->assertSee('Stored payload signature checked.');
        $c->update(['signature'=>str_repeat('0',64)]);
        $this->getJson('/api/verify/'.$code)->assertStatus(409)->assertJson(['valid'=>false]);
        $this->get('/verify/'.$code)->assertStatus(409)->assertSee('No se ha podido validar');
        foreach (['es', 'en'] as $language) {
            $missing=$this->get('/verify/VRT-NONEXISTENT?lang='.$language)->assertNotFound()
                ->assertHeader('X-Robots-Tag', 'noindex, nofollow')
                ->assertHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
            $this->assertStringContainsString('no-store', $missing->headers->get('Cache-Control'));
            $missing->assertSee($language === 'en' ? 'Seal unavailable' : 'Sello no disponible');
        }$this->get('/verify/invalid')->assertNotFound();$this->getJson('/api/verify/invalid')->assertNotFound();
    }
    public function test_bad_snapshot_bad_image_origin_and_limits_fail_closed(): void
    {
        [$a,,$x,$d,$v,$image]=$this->fixture();$path=$this->path($d,$v);$this->actingAs($a);
        config(['veritas.public_origin'=>null]);$this->getJson($path)->assertStatus(503);
        foreach(['https://user:secret@host.test','https://host.test/?token=x','https://host.test/path','javascript:evil'] as $origin) {
            config(['veritas.public_origin'=>$origin]);$this->getJson($path)->assertStatus(503);
        }
        config(['veritas.public_origin'=>'https://canonical.example.test']);
        file_put_contents($image->path(),'changed');$this->getJson($path)->assertStatus(409);
        $v->update(['snapshot_html'=>'<p>tampered</p>']);$this->getJson($path)->assertStatus(409);
        $v->update(['snapshot_html'=>str_repeat('x',250001)]);$this->getJson($path)->assertStatus(413);
    }
    public function test_v3_image_export_requires_the_existing_manifest_gate_not_only_public_hmac(): void
    {
        [$a,,,$d,$v] = $this->fixture(3);
        DB::table('version_evidence')->where('document_version_id', $v->id)->update(['manifest_bytes'=>'{}']);
        $this->actingAs($a)->getJson($this->path($d,$v))->assertStatus(409);
        $this->getJson('/api/verify/'.$v->certificate->certificate_code)->assertOk()->assertJson(['valid'=>true,'scope'=>'payload_signature']);
    }

}
