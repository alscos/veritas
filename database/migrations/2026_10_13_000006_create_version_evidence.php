<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void { Schema::create('version_evidence', function (Blueprint $t) {
        $t->uuid('document_version_id')->primary();
        $t->foreign('document_version_id')->references('id')->on('document_versions')->cascadeOnDelete();
        $t->string('schema', 64); $t->longText('manifest_bytes');
    }); }
    public function down(): void { Schema::dropIfExists('version_evidence'); }
};
