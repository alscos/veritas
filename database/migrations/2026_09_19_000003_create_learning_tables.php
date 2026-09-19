<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('courses', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('join_code', 16)->unique();
            $table->timestamps();
        });
        Schema::create('course_memberships', function (Blueprint $table): void {
            $table->id();
            $table->foreignUuid('course_id')->constrained('courses')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 24)->default('student');
            $table->timestamps();
            $table->unique(['course_id', 'user_id']);
        });
        Schema::create('assignments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('course_id')->nullable()->constrained('courses')->nullOnDelete();
            $table->foreignId('creator_id')->constrained('users')->cascadeOnDelete();
            $table->string('title', 180);
            $table->text('prompt')->nullable();
            $table->timestamp('due_at')->nullable();
            $table->json('policy')->nullable();
            $table->timestamps();
        });
        Schema::create('submissions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_version_id')->constrained('document_versions')->restrictOnDelete();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('recipient_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('recipient_email')->nullable();
            $table->foreignUuid('assignment_id')->nullable()->constrained('assignments')->nullOnDelete();
            $table->text('note')->nullable();
            $table->string('status', 24)->default('submitted');
            $table->timestamp('submitted_at');
            $table->timestamps();
            $table->index(['recipient_user_id', 'submitted_at']);
            $table->index(['sender_id', 'submitted_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('submissions');
        Schema::dropIfExists('assignments');
        Schema::dropIfExists('course_memberships');
        Schema::dropIfExists('courses');
    }
};
