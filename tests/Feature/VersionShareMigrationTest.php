<?php
namespace Tests\Feature;

use App\Models\{Document, User};
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\{DB, Schema};
use Illuminate\Support\Str;
use Tests\TestCase;

final class VersionShareMigrationTest extends TestCase
{
    use DatabaseMigrations;

    public function test_000009_is_additive_over_000008_preserving_old_digest_and_relationship_constraints(): void
    {
        $a=User::create(['name'=>'Migration fixture','email'=>'migration@example.test','password'=>'synthetic']);
        $d=Document::create(['owner_id'=>$a->id,'content_html'=>'<p>synthetic</p>','word_count'=>1]);
        $version=$this->actingAs($a)->postJson('/api/documents/'.$d->id.'/seal')->assertCreated()->json('version.id');
        // The entire test uses TestCase's guarded SQLite :memory: connection.
        $migration=require database_path('migrations/2026_10_18_000009_extend_version_share_grants.php');
        $migration->down();
        self::assertFalse(Schema::hasColumn('version_summary_grants','level'));
        $id=(string)Str::uuid();$digest=hash('sha256','synthetic old shape');
        DB::table('version_summary_grants')->insert(['id'=>$id,'owner_id'=>$a->id,'document_id'=>$d->id,
            'version_id'=>$version,'digest'=>$digest,'created_at'=>now(),'expires_at'=>now()->addDays(7)]);
        $migration->up();$row=DB::table('version_summary_grants')->where('id',$id)->first();
        self::assertSame($digest,$row->digest);self::assertSame(2,(int)$row->level);
        self::assertNull($row->label);self::assertNull($row->audience_mode);
        self::assertTrue(Schema::hasTable('version_share_accesses'));self::assertTrue(Schema::hasTable('version_share_recipients'));
        foreach(['version_share_recipients','version_share_accesses'] as $table) {
            $extra=$table==='version_share_accesses'?['first_seen'=>now(),'last_seen'=>now(),'access_count'=>1]:[];
            foreach([['grant_id'=>(string)Str::uuid(),'user_id'=>$a->id],['grant_id'=>$id,'user_id'=>999999]] as $invalid) {
                try{DB::table($table)->insert($invalid+$extra);self::fail('Expected foreign key rejection');}
                catch(\Illuminate\Database\QueryException $e){self::assertStringContainsString('FOREIGN KEY',$e->getMessage());}
            }
            $valid=['grant_id'=>$id,'user_id'=>$a->id]+$extra;DB::table($table)->insert($valid);
            try{DB::table($table)->insert($valid);self::fail('Expected composite uniqueness rejection');}
            catch(\Illuminate\Database\QueryException $e){self::assertStringContainsString('UNIQUE',$e->getMessage());}
        }
        DB::table('version_summary_grants')->where('id',$id)->delete();
        self::assertSame(0,DB::table('version_share_accesses')->count());
        self::assertSame(0,DB::table('version_share_recipients')->count());
    }
}
