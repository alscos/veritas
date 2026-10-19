<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Preparation only. NULL preserves distinguishable legacy rows; no data rewrite.
return new class extends Migration {
    public function up(): void {
        Schema::table('version_summary_grants', function (Blueprint $t) {
            $t->string('time_basis', 8)->nullable();
            $t->unsignedBigInteger('created_at_epoch')->nullable();
            $t->unsignedBigInteger('expires_at_epoch')->nullable();
        });
    }
    public function down(): void {
        Schema::table('version_summary_grants', fn (Blueprint $t) => $t->dropColumn(['time_basis','created_at_epoch','expires_at_epoch']));
    }
};
