<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Database\MySqlConnection;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class HostingTest extends TestCase
{
    use RefreshDatabase;

    public function test_mysql_document_migration_uses_expression_defaults_for_long_text(): void
    {
        // Compile the actual migration with MySQL's grammar. SQLite accepts
        // literal TEXT defaults, so SQLite migrations alone miss MySQL 1101.
        $connection = new MySqlConnection(
            fn () => throw new \LogicException('DDL compilation must not connect to a database'),
            'migration_ddl_test',
            '',
            ['charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'version' => '8.0.13'],
        );
        $originalSchema = Schema::getFacadeRoot();
        try {
            Schema::swap($connection->getSchemaBuilder());
            $migration = require database_path('migrations/2026_09_19_000002_create_document_tables.php');
            $queries = $connection->pretend(fn () => $migration->up());
        } finally {
            Schema::swap($originalSchema);
        }
        $ddl = collect($queries)->pluck('query')->first(fn ($sql) => str_starts_with($sql, 'create table `documents`'));
        $this->assertNotNull($ddl);
        foreach (['content_html', 'content_text'] as $column) {
            $this->assertMatchesRegularExpression('/`'.$column.'` longtext not null default\s+\(/i', $ddl);
        }
    }

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
