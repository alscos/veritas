<?php

namespace Tests\Feature;

use App\Models\{Document, User};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Env;
use Tests\TestCase;

class SealFormatConfigurationTest extends TestCase
{
    use RefreshDatabase;

    public function test_server_environment_accepts_only_supported_formats(): void
    {
        $env = Env::getRepository();
        $before = $env->get('INKGROOVE_SEAL_FORMAT');
        try {
            $env->clear('INKGROOVE_SEAL_FORMAT');
            $this->assertSame(2, (require base_path('config/veritas.php'))['seal_format']);
            foreach (['2' => 2, '3' => 3, '4' => 2, '03' => 2, '3.0' => 2, '' => 2, 'invalid' => 2] as $value => $expected) {
                $env->set('INKGROOVE_SEAL_FORMAT', (string) $value);
                $this->assertSame($expected, (require base_path('config/veritas.php'))['seal_format']);
            }
        } finally {
            if ($before === null) $env->clear('INKGROOVE_SEAL_FORMAT');
            else $env->set('INKGROOVE_SEAL_FORMAT', $before);
        }
    }

    public function test_client_cannot_override_the_server_format_in_either_direction(): void
    {
        $user = User::create(['name' => 'Selector fixture', 'email' => 'selector@example.test', 'password' => 'Fictitious12345']);
        $document = Document::create(['owner_id' => $user->id, 'content_html' => '<p>á génesis</p><p></p>', 'content_text' => 'á génesis', 'word_count' => 2]);
        $this->actingAs($user);
        foreach ([2 => 3, 3 => 2] as $server => $client) {
            config(['veritas.seal_format' => $server]);
            $this->withHeader('X-Seal-Format', (string) $client)
                ->withCookie('seal_format', (string) $client)
                ->postJson('/api/documents/'.$document->id.'/seal?seal_format='.$client.'&format_version='.$client,
                    ['seal_format' => $client, 'format_version' => $client, 'INKGROOVE_SEAL_FORMAT' => $client])
                ->assertCreated()->assertJsonPath('certificate.signed_payload.format_version', $server);
        }
    }
}
