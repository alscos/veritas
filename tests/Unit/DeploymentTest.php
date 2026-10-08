<?php

declare(strict_types=1);

namespace Tests\Unit;

use InkGroove\Deploy\GitHubRelease;
use InkGroove\Deploy\SiteGroundUpdater;
use InkGroove\Deploy\UpdateSupport;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use ZipArchive;

require_once dirname(__DIR__, 2).'/deploy/lib/UpdateSupport.php';
require_once dirname(__DIR__, 2).'/deploy/lib/GitHubRelease.php';
require_once dirname(__DIR__, 2).'/deploy/lib/SiteGroundUpdater.php';

final class DeploymentTest extends TestCase
{
    private string $directory;
    private string $revision = '1234567890abcdef1234567890abcdef12345678';
    private string $secret = "APP_KEY=unchanged-private-key\nVERITAS_SIGNING_KEY=unchanged-seal-key\n";

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/inkgroove-deploy-test-'.bin2hex(random_bytes(5));
        UpdateSupport::privateDirectory($this->directory);
    }

    protected function tearDown(): void { UpdateSupport::removeTree($this->directory); }

    private function zip(array $files, ?string $specialPath = null, int $attributes = 0): string
    {
        $archive = $this->directory.'/package-'.bin2hex(random_bytes(3)).'.zip';
        $zip = new ZipArchive();
        $zip->open($archive, ZipArchive::CREATE);
        foreach ($files as $path => $body) $zip->addFromString($path, $body);
        if ($specialPath) $zip->setExternalAttributesName($specialPath, ZipArchive::OPSYS_UNIX, $attributes);
        $zip->close();
        return $archive;
    }

    private function package(): string
    {
        $base = dirname(__DIR__, 2);
        $files = [
            'BUILD-INFO.json' => json_encode(['profile' => 'siteground', 'revision' => $this->revision, 'candidate' => false]),
            'inkgroove/artisan' => '<?php // new version',
            'inkgroove/vendor/autoload.php' => '<?php',
            'inkgroove/deploy/siteground/htaccess-v1.txt' => file_get_contents($base.'/deploy/siteground/htaccess-v1.txt'),
            'public_html/index.php' => '<?php // new front controller',
            'public_html/.htaccess' => file_get_contents($base.'/public/.htaccess'),
            'public_html/favicon.svg' => '<svg/>',
            'public_html/build/manifest.json' => '{"new":true}',
            'public_html/build/assets/app-newhash.js' => 'new code',
        ];
        $manifest = '';
        foreach ($files as $path => $body) $manifest .= hash('sha256', $body).'  '.$path."\n";
        $files['FILES.sha256'] = $manifest;
        return $this->zip($files);
    }

    private function live(): string
    {
        $root = $this->directory.'/site';
        UpdateSupport::write($root.'/inkgroove/.env', $this->secret);
        UpdateSupport::write($root.'/inkgroove/artisan', 'old version');
        UpdateSupport::write($root.'/inkgroove/storage/app/private/images/drawing.png', 'private image');
        UpdateSupport::write($root.'/inkgroove/storage/framework/cache/data/.gitignore', 'cache');
        UpdateSupport::write($root.'/public_html/index.php', 'old index');
        $auth = "AuthType Basic\nAuthName \"Private demo\"\nAuthUserFile /private/.htpasswd\nRequire valid-user\n";
        $https = "# Hosting HTTPS rules\nRewriteRule ^ https://inkgroove.com%{REQUEST_URI} [R=301,L]\n";
        $legacy = file_get_contents(dirname(__DIR__, 2).'/deploy/siteground/htaccess-v1.txt');
        UpdateSupport::write($root.'/public_html/.htaccess', $auth.$legacy.$https);
        UpdateSupport::write($root.'/public_html/.htpasswd', 'hosting-managed-password-hash');
        UpdateSupport::write($root.'/public_html/.well-known/acme-challenge/token', 'TLS challenge');
        UpdateSupport::write($root.'/public_html/build/assets/VeritasEditor-oldhash.js', 'old chunk');
        UpdateSupport::write($root.'/public_html/build/manifest.json', '{"old":true}');
        return $root;
    }

    private function runner(array &$calls, ?string $fail = null): \Closure
    {
        return static function (array $command, string $cwd, string $log) use (&$calls, $fail): void {
            $step = $command[2] ?? '';
            $calls[] = $command;
            if (str_ends_with($command[1], 'snapshot-database.php')) {
                if ($fail === 'backup') throw new RuntimeException('Backup failed');
                UpdateSupport::write($command[3], 'SQL backup');
            } elseif ($step === 'down') {
                UpdateSupport::write($cwd.'/storage/framework/down', '{"status":503}');
            } elseif ($step === 'up') {
                UpdateSupport::removeTree($cwd.'/storage/framework/down');
            } elseif ($step === $fail) throw new RuntimeException('Migration failed');
        };
    }

    public function test_invalid_checksum_leaves_live_files_untouched(): void
    {
        $root = $this->live();
        $calls = [];
        try {
            (new SiteGroundUpdater($root, [], $this->runner($calls), static fn () => null))->install($this->package(), str_repeat('0', 64));
            $this->fail('Invalid checksum accepted');
        } catch (RuntimeException $error) { $this->assertStringContainsString('SHA256', $error->getMessage()); }
        $this->assertSame([], $calls);
        $this->assertSame('old version', file_get_contents($root.'/inkgroove/artisan'));
        $this->assertSame($this->secret, file_get_contents($root.'/inkgroove/.env'));
    }

    public function test_zip_traversal_is_rejected_before_extraction(): void
    {
        $archive = $this->zip(['../escape.txt' => 'unsafe']);
        $this->expectException(RuntimeException::class);
        UpdateSupport::extract($archive, hash_file('sha256', $archive), $this->directory.'/stage', 'siteground');
    }

    public function test_zip_symlinks_are_rejected(): void
    {
        $path = 'inkgroove/symlink';
        $archive = $this->zip([$path => '/etc/passwd'], $path, 0120777 << 16);
        $this->expectException(RuntimeException::class);
        UpdateSupport::extract($archive, hash_file('sha256', $archive), $this->directory.'/stage', 'siteground');
    }

    public function test_private_environment_cannot_be_in_release(): void
    {
        $archive = $this->zip(['inkgroove/.env' => 'secret']);
        $this->expectException(RuntimeException::class);
        UpdateSupport::extract($archive, hash_file('sha256', $archive), $this->directory.'/stage', 'siteground');
    }

    public function test_wrong_profile_is_rejected_and_stage_removed(): void
    {
        $archive = $this->package();
        try { UpdateSupport::extract($archive, hash_file('sha256', $archive), $this->directory.'/stage', 'alpine'); $this->fail(); }
        catch (RuntimeException $error) { $this->assertStringContainsString('perfil', $error->getMessage()); }
        $this->assertDirectoryDoesNotExist($this->directory.'/stage');
    }

    public function test_unlisted_or_corrupted_file_is_rejected(): void
    {
        $archive = $this->package();
        $zip = new ZipArchive(); $zip->open($archive); $zip->addFromString('inkgroove/artisan', 'corrupted'); $zip->close();
        $this->expectException(RuntimeException::class);
        UpdateSupport::extract($archive, hash_file('sha256', $archive), $this->directory.'/stage', 'siteground');
    }

    public function test_success_preserves_keys_images_hosting_wall_and_previous_chunks(): void
    {
        $root = $this->live();
        $archive = $this->package();
        $calls = [];
        $healthCalls = [];
        $updater = new SiteGroundUpdater($root, ['health_url' => 'https://inkgroove.com/up', 'drain_seconds' => false], $this->runner($calls), static function ($url, $config) use (&$healthCalls) { $healthCalls[] = $url; });
        $result = $updater->install($archive, hash_file('sha256', $archive));
        $this->assertStringContainsString('Instalada', $result);
        $this->assertSame($this->secret, file_get_contents($root.'/inkgroove/.env'));
        $this->assertSame(0600, fileperms($root.'/inkgroove/.env') & 0777);
        $this->assertSame('private image', file_get_contents($root.'/inkgroove/storage/app/private/images/drawing.png'));
        $rules = file_get_contents($root.'/public_html/.htaccess');
        $this->assertStringContainsString('Require valid-user', $rules);
        $this->assertStringContainsString('AuthUserFile /private/.htpasswd', $rules);
        $this->assertStringContainsString('# Hosting HTTPS rules', $rules);
        $this->assertStringContainsString('# BEGIN INKGROOVE', $rules);
        $this->assertStringContainsString('Header always set Cache-Control', $rules);
        $this->assertSame('hosting-managed-password-hash', file_get_contents($root.'/public_html/.htpasswd'));
        $this->assertSame('TLS challenge', file_get_contents($root.'/public_html/.well-known/acme-challenge/token'));
        $this->assertFileExists($root.'/public_html/build/assets/VeritasEditor-oldhash.js');
        $this->assertFileExists($root.'/public_html/build/assets/app-newhash.js');
        $this->assertFileDoesNotExist($root.'/inkgroove/storage/framework/down');
        $state = UpdateSupport::json($root.'/.inkgroove-updates/installed.json');
        $this->assertSame($this->revision, $state['revision']);
        $this->assertSame($this->secret, file_get_contents($state['backup'].'/inkgroove/.env'));
        $this->assertSame('SQL backup', file_get_contents($state['backup'].'/database.sql'));
        $this->assertCount(3, $healthCalls);
        $count = count($calls);
        $this->assertStringContainsString('ya está instalada', $updater->install($archive, hash_file('sha256', $archive)));
        $this->assertCount($count, $calls);
    }

    public function test_failed_backup_reopens_original_app_without_migrating(): void
    {
        $root = $this->live(); $archive = $this->package(); $calls = [];
        try { (new SiteGroundUpdater($root, ['drain_seconds' => false], $this->runner($calls, 'backup'), static fn () => null))->install($archive, hash_file('sha256', $archive)); $this->fail(); }
        catch (RuntimeException $error) { $this->assertStringContainsString('Backup failed', $error->getMessage()); }
        $this->assertSame('old version', file_get_contents($root.'/inkgroove/artisan'));
        $this->assertFileDoesNotExist($root.'/inkgroove/storage/framework/down');
        $this->assertNotContains('migrate', array_column($calls, 2));
    }

    public function test_migration_failure_keeps_maintenance_and_backup_without_database_rollback(): void
    {
        $root = $this->live(); $archive = $this->package(); $calls = [];
        try { (new SiteGroundUpdater($root, ['drain_seconds' => false], $this->runner($calls, 'migrate'), static fn () => null))->install($archive, hash_file('sha256', $archive)); $this->fail(); }
        catch (RuntimeException $error) { $this->assertStringContainsString('sigue en mantenimiento', $error->getMessage()); }
        $this->assertFileExists($root.'/inkgroove/storage/framework/down');
        $this->assertSame($this->secret, file_get_contents($root.'/inkgroove/.env'));
        $this->assertNotContains('up', array_column($calls, 2));
        $this->assertNotContains('migrate:rollback', array_column($calls, 2));
        $this->assertCount(1, glob($root.'/.inkgroove-updates/backups/*/database.sql'));
        $this->assertFileDoesNotExist($root.'/.inkgroove-updates/installed.json');
    }

    public function test_unrecognized_htaccess_stops_before_maintenance(): void
    {
        $root = $this->live(); UpdateSupport::write($root.'/public_html/.htaccess', 'Custom protection');
        $calls = []; $archive = $this->package();
        try { (new SiteGroundUpdater($root, [], $this->runner($calls), static fn () => null))->install($archive, hash_file('sha256', $archive)); $this->fail(); }
        catch (RuntimeException $error) { $this->assertStringContainsString('reglas antiguas', $error->getMessage()); }
        $this->assertSame([], $calls);
        $this->assertSame('Custom protection', file_get_contents($root.'/public_html/.htaccess'));
    }

    public function test_concurrent_install_is_rejected(): void
    {
        $root = $this->live(); UpdateSupport::privateDirectory($root.'/.inkgroove-updates');
        $lock = fopen($root.'/.inkgroove-updates/lock', 'c'); flock($lock, LOCK_EX);
        $calls = [];
        try { $this->expectException(RuntimeException::class); (new SiteGroundUpdater($root, [], $this->runner($calls), static fn () => null))->install($this->package(), str_repeat('0', 64)); }
        finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    public function test_second_htaccess_update_preserves_hosting_rules_outside_markers(): void
    {
        $block = file_get_contents(dirname(__DIR__, 2).'/public/.htaccess');
        $current = "AuthType Basic\nRequire valid-user\n".$block."# host footer\n";
        $this->assertSame($current, UpdateSupport::mergeHtaccess($current, $block, 'unused legacy'));
    }

    public function test_ambiguous_markers_are_rejected(): void
    {
        $block = file_get_contents(dirname(__DIR__, 2).'/public/.htaccess');
        $this->expectException(RuntimeException::class);
        UpdateSupport::mergeHtaccess($block.$block, $block, 'unused legacy');
    }

    public function test_private_release_download_does_not_forward_token_on_redirect(): void
    {
        $archive = $this->package(); $body = file_get_contents($archive); $checksum = hash('sha256', $body);
        $name = 'inkgroove-siteground-'.substr($this->revision, 0, 12).'.zip';
        $requests = [];
        $client = new GitHubRelease(['repository' => 'alscos/veritas', 'token' => 'private-test-token'], static function ($url, $headers) use (&$requests, $name, $checksum, $body) {
            $requests[] = [$url, $headers];
            if (str_ends_with($url, '/2')) return [200, [], $checksum.'  '.$name."\n"];
            if (str_ends_with($url, '/1')) return [302, ['Location: https://release-assets.githubusercontent.com/signed-file'], ''];
            return [200, [], $body];
        });
        $result = $client->download(['tag_name' => 'build-'.substr($this->revision, 0, 12), 'assets' => [['id' => 1, 'name' => $name, 'state' => 'uploaded', 'digest' => 'sha256:'.$checksum], ['id' => 2, 'name' => $name.'.sha256', 'state' => 'uploaded']]], 'siteground', $this->directory.'/downloads');
        $this->assertSame($checksum, hash_file('sha256', $result['archive']));
        $this->assertContains('Authorization: Bearer private-test-token', $requests[0][1]);
        $this->assertContains('Authorization: Bearer private-test-token', $requests[1][1]);
        $this->assertNotContains('Authorization: Bearer private-test-token', $requests[2][1]);
    }

    public function test_latest_release_ignores_drafts_and_unvalidated_tags(): void
    {
        $client = new GitHubRelease(['repository' => 'alscos/veritas', 'token' => 'test'], static fn () => [200, [], json_encode([
            ['draft' => true, 'tag_name' => 'build-ffffffffffff', 'published_at' => '2026-12-01'],
            ['draft' => false, 'tag_name' => 'v0.3.0-unchecked', 'published_at' => '2026-12-01'],
            ['draft' => false, 'tag_name' => 'build-1234567890ab', 'published_at' => '2026-10-08'],
            ['draft' => false, 'tag_name' => 'build-0987654321ab', 'published_at' => '2026-10-07'],
        ])]);
        $this->assertSame('build-1234567890ab', $client->release()['tag_name']);
    }
}
