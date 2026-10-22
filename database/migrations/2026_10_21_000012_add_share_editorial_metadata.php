<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// No legacy backfill. Mandatory SQL expiry remains a compatibility shadow only.
return new class extends Migration {
    public function up(): void {
        Schema::table('version_summary_grants', function (Blueprint $t) {
            $t->boolean('never_expires')->default(false);
            $t->text('display_title_at_issue')->nullable();
        });
    }
    public function down(): void {
        Schema::table('version_summary_grants', fn (Blueprint $t) => $t->dropColumn(['never_expires','display_title_at_issue']));
    }
};
