<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class HostingTest extends TestCase
{
    use RefreshDatabase;

    public function test_session_pages_and_api_responses_cannot_be_stored_in_shared_caches(): void
    {
        $this->withoutVite();
        foreach (['/', '/api/csrf-token', '/api/me'] as $url) {
            $response = $this->get($url, ['Accept' => 'application/json']);
            $this->assertTrue($response->headers->hasCacheControlDirective('private'), $url);
            $this->assertTrue($response->headers->hasCacheControlDirective('no-store'), $url);
            $response->assertHeader('X-Content-Type-Options', 'nosniff');
        }
    }

    public function test_expired_csrf_errors_also_bypass_shared_caches(): void
    {
        Route::get('/api/test-expired-session', fn () => abort(419));
        $response = $this->getJson('/api/test-expired-session')->assertStatus(419);
        $this->assertTrue($response->headers->hasCacheControlDirective('private'));
        $this->assertTrue($response->headers->hasCacheControlDirective('no-store'));
    }
}
