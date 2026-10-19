<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class DocumentContentFontProfileTest extends TestCase
{
    use RefreshDatabase;

    public function test_profile_is_server_owned_and_legacy_is_not_backfilled(): void
    {
        $owner = User::create(['name' => 'Synthetic', 'email' => 'profile@example.test', 'password' => 'synthetic-test-password']);
        $this->actingAs($owner);
        $legacy = Document::create(['owner_id' => $owner->id, 'title' => 'Legacy', 'content_html' => '<p>legacy</p>']);
        self::assertNull($legacy->fresh()->default_content_font_id);
        self::assertNotContains('default_content_font_id', $legacy->getFillable());
        $new = $this->postJson('/api/documents', ['title' => 'New', 'default_content_font_id' => 'inter'])->assertCreated()
            ->assertJsonPath('document.default_content_font_id', 'literata')->json('document');
        $url = '/api/documents/'.$new['id'];
        $this->patchJson($url, ['revision' => $new['revision'], 'content_html' => '<p>replacement</p>', 'default_content_font_id' => null])
            ->assertOk()->assertJsonPath('document.default_content_font_id', 'literata');
        $this->getJson($url)->assertOk()->assertJsonPath('document.default_content_font_id', 'literata');
        $this->patchJson('/api/documents/'.$legacy->id, ['revision' => $legacy->fresh()->revision, 'content_html' => '<p data-content-font="literata">HTML is not identity</p>', 'default_content_font_id' => 'literata'])
            ->assertOk()->assertJsonPath('document.default_content_font_id', null);
        $other = User::create(['name' => 'Other', 'email' => 'profile-other@example.test', 'password' => 'synthetic-test-password']);
        $this->actingAs($other);
        $this->getJson($url)->assertNotFound();
        $this->patchJson($url, ['revision' => 1, 'default_content_font_id' => 'inter'])->assertNotFound();
        self::assertSame('literata', Document::findOrFail($new['id'])->default_content_font_id);
    }
}
