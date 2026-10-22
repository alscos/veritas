<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Additive preparation only. Does not issue grants or enable level 3 routes. */
return new class extends Migration {
    public function up(): void {
        Schema::table('version_summary_grants', function (Blueprint $t): void {
            $t->unsignedTinyInteger('level')->default(2); // Old hashes/links remain level 2.
            $t->string('audience_mode', 24)->nullable();
            $t->string('label', 120)->nullable();
        });
        Schema::create('version_share_recipients', function (Blueprint $t): void {
            $t->foreignUuid('grant_id')->constrained('version_summary_grants')->cascadeOnDelete();
            $t->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $t->primary(['grant_id','user_id']);
        });
        Schema::create('version_share_accesses', function (Blueprint $t): void {
            $t->foreignUuid('grant_id')->constrained('version_summary_grants')->cascadeOnDelete();
            $t->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $t->timestamp('first_seen');
            $t->timestamp('last_seen');
            $t->unsignedBigInteger('access_count')->default(1);
            $t->primary(['grant_id','user_id']);
        });
    }
    public function down(): void {
        Schema::dropIfExists('version_share_accesses');
        Schema::dropIfExists('version_share_recipients');
        Schema::table('version_summary_grants', function (Blueprint $t): void {
            $t->dropColumn(['level','audience_mode','label']);
        });
    }
};
