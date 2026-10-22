<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('version_summary_grants', function (Blueprint $t): void {
            $t->uuid('share_operation_key')->nullable();
            $t->char('share_operation_fingerprint', 64)->nullable();
            $t->unique(['owner_id', 'share_operation_key'], 'share_owner_operation_unique');
        });
        // Separate from academic submissions: never grants VersionAccess::exact.
        // Exact version/owner/expiry are derived from the single parent grant.
        Schema::create('version_share_deliveries', function (Blueprint $t): void {
            $t->uuid('grant_id');
            $t->unsignedBigInteger('user_id');
            $t->timestamp('presented_at');
            $t->primary(['grant_id', 'user_id']);
            $t->foreign(['grant_id', 'user_id'])->references(['grant_id', 'user_id'])
                ->on('version_share_recipients')->cascadeOnDelete();
            $t->index(['user_id', 'presented_at']);
        });
    }
    public function down(): void {
        Schema::dropIfExists('version_share_deliveries');
        Schema::table('version_summary_grants', function (Blueprint $t): void {
            $t->dropUnique('share_owner_operation_unique');
            $t->dropColumn(['share_operation_key', 'share_operation_fingerprint']);
        });
    }
};
