<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('document_folders', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('name', 100);
            $table->timestamps();
            $table->unique(['owner_id', 'name']);
        });
        Schema::table('documents', function (Blueprint $table): void {
            $table->foreignUuid('folder_id')->nullable()->constrained('document_folders')->nullOnDelete();
            $table->json('page_settings')->nullable();
        });
        Schema::table('document_versions', function (Blueprint $table): void {
            $table->json('page_settings')->nullable();
        });
        Schema::create('document_images', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_id')->constrained('documents')->cascadeOnDelete();
            $table->string('filename', 255);
            $table->string('mime', 40);
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->unsignedInteger('bytes');
            $table->char('sha256', 64);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_images');
        Schema::table('document_versions', fn (Blueprint $table) => $table->dropColumn('page_settings'));
        Schema::table('documents', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('folder_id');
            $table->dropColumn('page_settings');
        });
        Schema::dropIfExists('document_folders');
    }
};
