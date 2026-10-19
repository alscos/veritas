<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('version_summary_grants', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $t->foreignUuid('document_id')->constrained('documents')->cascadeOnDelete();
            $t->foreignUuid('version_id')->constrained('document_versions')->cascadeOnDelete();
            $t->char('digest', 64)->unique();
            $t->timestamp('created_at');
            $t->timestamp('expires_at');
            $t->timestamp('revoked_at')->nullable();
            $t->index(['owner_id','document_id','version_id','expires_at'], 'summary_grants_owner_version_expiry');
        });
    }
    public function down(): void { Schema::dropIfExists('version_summary_grants'); }
};
