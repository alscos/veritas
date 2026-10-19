<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Support\DocumentSanitizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class NewDocumentFontPersistenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_base_and_catalog_survive_save_reopen_resave_while_legacy_is_unchanged(): void
    {
        $owner = User::create(['name' => 'Synthetic', 'email' => 'r2@example.test', 'password' => 'synthetic-test-password']);
        $this->actingAs($owner);
        $created = $this->postJson('/api/documents', ['title' => 'Synthetic'])->assertCreated()->json('document');
        self::assertSame('<p data-content-font="literata"></p>', $created['content_html']);
        $html = '<p data-content-font="literata">á génesis <mark data-origin="paste"><span data-font="inter"><strong><em>ñ</em></strong></span></mark><span data-font="ibmplexmono">mono</span></p><p data-content-font="literata"></p>';
        $url = '/api/documents/'.$created['id'];
        $saved = $this->patchJson($url, ['revision' => $created['revision'], 'content_html' => $html])->assertOk()->json('document');
        self::assertSame(DocumentSanitizer::html($html), $saved['content_html']);
        $this->getJson($url)->assertOk()->assertJsonPath('document.content_html', $saved['content_html']);
        $again = $this->patchJson($url, ['revision' => $saved['revision'], 'content_html' => $saved['content_html']])->assertOk()->json('document');
        self::assertSame($saved['content_html'], $again['content_html']);
        foreach (['<p>legacy</p>', '<p><span data-font="georgia">legacy</span></p>'] as $old) {
            $legacy = Document::create(['owner_id' => $owner->id, 'title' => 'Legacy', 'content_html' => $old]);
            $this->getJson('/api/documents/'.$legacy->id)->assertOk()->assertJsonPath('document.content_html', $old);
            self::assertSame($old, $legacy->fresh()->content_html);
        }
    }
}
