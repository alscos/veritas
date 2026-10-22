<?php
namespace Tests\Feature;

use App\Models\{Document, User};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class EditorialPdfTest extends TestCase
{
    use DatabaseMigrations;

    public function test_owner_pdf_counts_are_verified_exact_version_and_never_expand_recipient_source(): void
    {
        $this->withoutVite();
        config(['veritas.seal_format'=>2,'veritas.public_origin'=>'http://localhost']);
        $author=User::create(['name'=>'Author','email'=>'editorial-author@example.test','password'=>'synthetic']);
        $reader=User::create(['name'=>'Reader','email'=>'editorial-reader@example.test','password'=>'synthetic']);
        $html='<p>á génesis <mark data-origin="paste">pegado</mark> <mark data-origin="paste-edited">azul</mark></p><p></p>';
        $d=Document::create(['owner_id'=>$author->id,'title'=>'Título de emisión','content_html'=>$html,'word_count'=>4]);
        $this->actingAs($author)->postJson('/api/documents/'.$d->id.'/events',['session_id'=>(string)Str::uuid(),'events'=>[
            ['sequence'=>1,'event_type'=>'insert','elapsed_ms'=>1,'after_html'=>$html],
        ]])->assertOk();
        $v=$this->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        $d->update(['title'=>'PRIVATE LATER TITLE','content_html'=>'<p>PRIVATE LATER DRAFT extra words words words</p>']);
        $url='/api/documents/'.$d->id.'/versions/'.$v.'/pdf-source';
        $this->getJson($url)->assertOk()->assertJsonPath('snapshot_html',$html)
            ->assertJsonPath('historical_counts.source','sealed_snapshot_html')
            ->assertJsonPath('historical_counts.value',['direct'=>2,'pasted'=>1,'edited'=>1,'total'=>4]);
        DB::table('submissions')->insert(['id'=>(string)Str::uuid(),'sender_id'=>$author->id,'recipient_user_id'=>$reader->id,'document_version_id'=>$v,'submitted_at'=>now()]);
        $response=$this->actingAs($reader)->getJson($url)->assertOk()->assertJsonPath('snapshot_html',$html)->assertJsonPath('document_title',null);
        self::assertArrayNotHasKey('historical_counts',$response->json());
        self::assertStringNotContainsString('PRIVATE LATER',$response->getContent());
    }
}
