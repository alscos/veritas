<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Expression;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('title', 180)->default('Documento sin título');
            $table->longText('content_html')->default(new Expression("('')"));
            $table->longText('content_text')->default(new Expression("('')"));
            $table->unsignedInteger('word_count')->default(0);
            $table->string('status', 24)->default('draft')->index();
            $table->timestamp('last_session_at')->nullable();
            $table->timestamps();
            $table->index(['owner_id', 'updated_at']);
        });

        Schema::create('writing_sessions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_id')->constrained('documents')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('client_started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->unsignedInteger('last_sequence')->default(0);
            $table->char('last_hash', 64)->nullable();
            $table->timestamps();
            $table->index(['document_id', 'created_at']);
        });

        Schema::create('writing_events', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignUuid('writing_session_id')->constrained('writing_sessions')->cascadeOnDelete();
            $table->unsignedInteger('sequence');
            $table->string('event_type', 32);
            $table->string('input_type', 64)->nullable();
            $table->text('data')->nullable();
            $table->longText('after_html');
            $table->unsignedInteger('elapsed_ms');
            $table->timestamp('client_created_at')->nullable();
            $table->timestamp('server_received_at');
            $table->char('previous_hash', 64)->nullable();
            $table->char('event_hash', 64);
            $table->unique(['writing_session_id', 'sequence']);
            $table->index(['writing_session_id', 'elapsed_ms']);
        });

        Schema::create('document_versions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_id')->constrained('documents')->cascadeOnDelete();
            $table->unsignedInteger('version_number');
            $table->longText('snapshot_html');
            $table->longText('snapshot_text');
            $table->unsignedInteger('word_count');
            $table->char('content_hash', 64);
            $table->char('process_hash', 64)->nullable();
            $table->timestamp('sealed_at');
            $table->unique(['document_id', 'version_number']);
        });

        Schema::create('certificates', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_version_id')->unique()->constrained('document_versions')->cascadeOnDelete();
            $table->string('certificate_code', 32)->unique();
            $table->char('signature', 64);
            $table->json('signed_payload');
            $table->timestamp('issued_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('certificates');
        Schema::dropIfExists('document_versions');
        Schema::dropIfExists('writing_events');
        Schema::dropIfExists('writing_sessions');
        Schema::dropIfExists('documents');
    }
};
