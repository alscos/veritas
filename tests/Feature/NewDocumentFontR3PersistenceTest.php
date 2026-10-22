<?php
namespace Tests\Feature;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
final class NewDocumentFontR3PersistenceTest extends TestCase
{
    use RefreshDatabase;
    public function test_create_save_reopen_edit_save_in_memory(): void
    {
        $owner = User::create(['name' => 'Synthetic R3', 'email' => 'r3@example.test', 'password' => 'synthetic-test-password']);
        $this->actingAs($owner);
        $created = $this->postJson('/api/documents', ['title' => 'Synthetic R3'])->assertCreated()->json('document');
        self::assertSame('<p data-content-font="literata"></p>', $created['content_html']);
        $url = '/api/documents/'.$created['id'];
        $html = '<p data-content-font="literata"><mark data-origin="paste"><strong><em>á génesis</em></strong></mark></p><p data-content-font="literata"></p>';
        $saved = $this->patchJson($url, ['revision' => $created['revision'], 'content_html' => $html])->assertOk()->json('document');
        $opened = $this->getJson($url)->assertOk()->json('document');
        self::assertSame($html, $opened['content_html']);
        $edited = str_replace('</em>', ' ñ</em>', $opened['content_html']);
        $resaved = $this->patchJson($url, ['revision' => $opened['revision'], 'content_html' => $edited])->assertOk()->json('document');
        self::assertSame($edited, $resaved['content_html']);
        self::assertGreaterThan($saved['revision'], $resaved['revision']);
        $this->getJson($url)->assertOk()->assertJsonPath('document.content_html', $edited);
    }
}
