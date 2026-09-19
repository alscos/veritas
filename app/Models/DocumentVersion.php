<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DocumentVersion extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['document_id', 'version_number', 'snapshot_html', 'snapshot_text', 'word_count', 'content_hash', 'process_hash', 'sealed_at'];
    protected function casts(): array { return ['sealed_at' => 'datetime']; }
    public function document() { return $this->belongsTo(Document::class); }
    public function certificate() { return $this->hasOne(Certificate::class); }
}
