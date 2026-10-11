<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::table('documents', fn (Blueprint $table) => $table->unsignedBigInteger('revision')->default(0));
        Schema::table('writing_events', fn (Blueprint $table) => $table->char('request_hash', 64)->nullable());
    }
    public function down(): void { Schema::table('documents', fn (Blueprint $table) => $table->dropColumn('revision')); Schema::table('writing_events', fn (Blueprint $table) => $table->dropColumn('request_hash')); }
};
