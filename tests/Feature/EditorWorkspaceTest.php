<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentFolder;
use App\Models\DocumentImage;
use App\Models\User;
use App\Support\DocumentSanitizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class EditorWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    private array $paths = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['veritas.media_path' => sys_get_temp_dir().'/veritas-tests-'.Str::uuid()]);
    }
    protected function tearDown(): void
    {
        foreach ($this->paths as $path) if (is_file($path)) unlink($path);
        $directory = config('veritas.media_path');
        if (is_dir($directory)) rmdir($directory);
        parent::tearDown();
    }
    private function user(string $name = 'Autor'): User
    {
        return User::create(['name' => $name, 'email' => Str::uuid().'@example.test', 'password' => 'test-password-123']);
    }
    private function imageFile(): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'veritas-image-'); $this->paths[] = $path;
        file_put_contents($path, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII='));
        return new UploadedFile($path, 'prueba.png', 'image/png', null, true);
    }
    public function test_empty_documents_return_empty_strings_and_reopen_without_placeholder_text(): void
    {
        $this->actingAs($this->user());
        $document = $this->postJson('/api/documents', ['title' => 'Vacío'])->assertCreated()->json('document');
        $this->assertSame('', $document['content_html']);
        $this->assertSame('', $document['content_text']);
        $this->assertSame(0, $document['word_count']);
        $this->assertSame('draft', $document['status']);
        $this->getJson('/api/documents/'.$document['id'])->assertOk()
            ->assertJsonPath('document.content_html', '')
            ->assertJsonPath('document.content_text', '')
            ->assertJsonPath('document.word_count', 0);
        $this->assertDatabaseHas('documents', [
            'id' => $document['id'], 'content_html' => '', 'content_text' => '', 'word_count' => 0,
        ]);
    }
    public function test_folder_ownership_and_deleting_a_folder_preserves_documents(): void
    {
        $owner = $this->user(); $other = $this->user('Otra persona');
        $folder = $this->actingAs($owner)->postJson('/api/folders', ['name' => 'Ensayos'])->assertCreated()->json('folder');
        $this->postJson('/api/folders', ['name' => ' Ensayos '])->assertUnprocessable();
        $this->postJson('/api/folders', ['name' => '   '])->assertUnprocessable();
        $document = $this->postJson('/api/documents', ['title' => 'Texto', 'folder_id' => $folder['id']])->assertCreated()->json('document');
        $this->actingAs($other)->getJson('/api/folders')->assertJsonCount(0, 'folders');
        $this->patchJson('/api/folders/'.$folder['id'], ['name' => 'Ajena'])->assertNotFound();
        $this->postJson('/api/documents', ['title' => 'Texto ajeno', 'folder_id' => $folder['id']])->assertUnprocessable();
        $this->patchJson('/api/documents/'.$document['id'], ['folder_id' => null])->assertNotFound();
        $this->actingAs($owner)->deleteJson('/api/folders/'.$folder['id'])->assertOk();
        $this->assertDatabaseHas('documents', ['id' => $document['id'], 'folder_id' => null]);
    }
    public function test_layout_typography_and_sealed_versions_survive_saving(): void
    {
        $owner = $this->user(); $this->actingAs($owner);
        $id = $this->postJson('/api/documents', ['title' => 'Pingüino'])->assertCreated()->json('document.id');
        $page = ['format' => 'legal', 'orientation' => 'landscape', 'margin' => 20];
        $html = '<h1 style="text-align: center">Título</h1><p data-indent="2" data-line-height="2"><span data-font="arial" data-size="18" data-color="#2d6680">El pingüino llegó a Cádiz.</span></p><p></p><p></p><p><mark data-origin="paste">Antes </mark><mark data-origin="paste-edited">después</mark></p><div data-page-break="true"></div>';
        $saved = $this->patchJson('/api/documents/'.$id, ['content_html' => $html, 'page_settings' => $page])->assertOk()->json('document');
        $this->assertSame($page, $saved['page_settings']);
        $this->assertStringContainsString('El pingüino llegó a Cádiz.', $saved['content_html']);
        $this->assertStringContainsString('<p></p><p></p>', $saved['content_html']);
        $this->assertStringContainsString('data-size="18"', $saved['content_html']);
        $this->assertStringContainsString('data-origin="paste-edited"', $saved['content_html']);
        $sealed = $this->postJson('/api/documents/'.$id.'/seal')->assertCreated()->json();
        $this->assertSame($page, $sealed['version']['page_settings']);
        $this->patchJson('/api/documents/'.$id, ['page_settings' => ['format' => 'a5', 'orientation' => 'portrait', 'margin' => 15]])->assertOk();
        $this->getJson('/api/verify/'.$sealed['certificate']['certificate_code'])->assertOk()->assertJsonPath('valid', true);
        $this->assertDatabaseHas('document_versions', ['id' => $sealed['version']['id'], 'snapshot_html' => $saved['content_html']]);
        $this->patchJson('/api/documents/'.$id, ['page_settings' => ['format' => 'giant', 'orientation' => 'portrait', 'margin' => 999]])->assertUnprocessable();
    }
    public function test_uploaded_images_are_private_persistent_and_bound_to_their_document(): void
    {
        $owner = $this->user(); $other = $this->user();
        $document = Document::create(['owner_id' => $owner->id, 'title' => 'Imágenes']);
        $upload = $this->actingAs($owner)->post('/api/documents/'.$document->id.'/images', ['image' => $this->imageFile()], ['Accept' => 'application/json'])->assertCreated()->json();
        $image = DocumentImage::findOrFail($upload['image']['id']); $this->paths[] = $image->path();
        $this->assertFileExists($image->path());
        $this->assertSame(hash_file('sha256', $image->path()), $image->sha256);
        $this->get($upload['src'])->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->actingAs($other)->get($upload['src'])->assertNotFound();
        $this->post('/api/documents/'.$document->id.'/images', ['image' => $this->imageFile()], ['Accept' => 'application/json'])->assertNotFound();
        $ownDocument = Document::create(['owner_id' => $other->id]);
        $this->patchJson('/api/documents/'.$ownDocument->id, ['content_html' => '<p>Ajeno</p><img src="'.$upload['src'].'">'])->assertUnprocessable();
        $html = '<p>Imagen propia</p><img src="'.$upload['src'].'" data-image-sha256="'.$image->sha256.'" width="300" height="300">';
        $this->actingAs($owner)->patchJson('/api/documents/'.$document->id, ['content_html' => $html])->assertOk();
        $sealed = $this->postJson('/api/documents/'.$document->id.'/seal')->assertCreated()->json();
        $this->assertSame($image->sha256, $sealed['certificate']['signed_payload']['images'][$image->id]);
        $this->deleteJson('/api/documents/'.$document->id)->assertOk();
        $this->assertFileDoesNotExist($image->path());
        $this->assertDatabaseMissing('document_images', ['id' => $image->id]);
    }
    public function test_shared_images_only_expose_images_in_the_delivered_snapshot(): void
    {
        $owner = $this->user(); $recipient = $this->user();
        $document = Document::create(['owner_id' => $owner->id, 'title' => 'Entrega']);
        $this->actingAs($owner);
        $first = $this->post('/api/documents/'.$document->id.'/images', ['image' => $this->imageFile()], ['Accept' => 'application/json'])->assertCreated()->json();
        $this->paths[] = DocumentImage::find($first['image']['id'])->path();
        $this->patchJson('/api/documents/'.$document->id, ['content_html' => '<p>Texto entregado</p><img src="'.$first['src'].'">'])->assertOk();
        $version = $this->postJson('/api/documents/'.$document->id.'/seal')->assertCreated()->json('version');
        DB::table('submissions')->insert(['id' => Str::uuid(), 'document_version_id' => $version['id'], 'sender_id' => $owner->id, 'recipient_user_id' => $recipient->id, 'status' => 'submitted', 'submitted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $later = $this->post('/api/documents/'.$document->id.'/images', ['image' => $this->imageFile()], ['Accept' => 'application/json'])->assertCreated()->json();
        $this->paths[] = DocumentImage::find($later['image']['id'])->path();
        $this->actingAs($recipient)->get($first['src'])->assertOk();
        $this->get($later['src'])->assertNotFound();
    }
    public function test_sanitizer_preserves_new_formats_and_blocks_nested_active_content(): void
    {
        $html = '<section><p style="text-align: justify; background: url(javascript:x)" onclick="x()">Cádiz <a href="javascript:alert(1)">enlace</a></p><script>alert(2)</script><img src="https://tracker.invalid/x" onerror="x()"></section><table><tr><th colspan="2">A</th></tr><tr><td><p><sub>1</sub><sup>2</sup><s>3</s></p></td></tr></table>';
        $clean = DocumentSanitizer::html($html);
        foreach (['javascript:', 'onclick', 'onerror', '<script', 'tracker.invalid', 'background:'] as $unsafe) $this->assertStringNotContainsString($unsafe, $clean);
        $this->assertStringContainsString('text-align: justify', $clean);
        $this->assertStringContainsString('<sub>1</sub><sup>2</sup><s>3</s>', $clean);
        $this->assertSame('uno dos tres', DocumentSanitizer::text('<p>uno</p><p>dos</p><p>tres</p>'));
    }
}
