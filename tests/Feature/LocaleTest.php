<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LocaleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    public function test_entry_metadata_and_html_language_follow_the_supported_language(): void
    {
        $this->get('/?lang=en')->assertOk()->assertSee('<html lang="en">', false)
            ->assertSee('Preserve your writing process');
        $this->get('/?lang=es')->assertOk()->assertSee('<html lang="es">', false)
            ->assertSee('Conserva el proceso de escritura');
        $this->withHeader('Accept-Language', 'es')->get('/?lang=unsupported')->assertOk()->assertSee('<html lang="es">', false);
        $this->withUnencryptedCookie('inkgroove_locale', 'en')->get('/')->assertOk()->assertSee('<html lang="en">', false);
    }

    public function test_validation_and_login_errors_follow_the_request_language(): void
    {
        $this->withHeader('Accept-Language', 'es')->postJson('/api/auth/login', [])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', 'El campo correo electrónico es obligatorio.');
        $this->withHeader('Accept-Language', 'en')->postJson('/api/auth/login', [])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', 'The email field is required.');
        $this->withHeader('Accept-Language', 'en')->postJson('/api/auth/login', ['email' => 'missing@example.test', 'password' => 'test-password-123'])
            ->assertUnprocessable()->assertJsonPath('message', 'The credentials are incorrect.');
    }

    public function test_switching_language_does_not_translate_or_rewrite_a_document(): void
    {
        $author = User::create(['name' => 'Autor', 'email' => 'author@example.test', 'password' => 'test-password-123']);
        $this->actingAs($author);
        $html = '<p>Génesis habíamos pingüino niño ge'."\u{0301}".'nesis</p><p></p><p>Final</p>';
        $document = $this->withHeader('Accept-Language', 'es')->postJson('/api/documents', ['title' => 'Mi manuscrito'])->assertCreated()->json('document');
        $this->patchJson('/api/documents/'.$document['id'], ['content_html' => $html])->assertOk();
        $this->withHeader('Accept-Language', 'en')->getJson('/api/documents/'.$document['id'])->assertOk()
            ->assertJsonPath('document.title', 'Mi manuscrito')->assertJsonPath('document.content_html', $html);
    }
}
