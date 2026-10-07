<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DocumentImage extends Model
{
    use HasUuids;
    protected $fillable = ['id', 'document_id', 'filename', 'mime', 'width', 'height', 'bytes', 'sha256'];
    protected $hidden = ['filename'];
    public function document() { return $this->belongsTo(Document::class); }
    public function url(): string { return '/api/documents/'.$this->document_id.'/images/'.$this->id; }
    public function path(): string { return rtrim((string) config('veritas.media_path'), '/').'/'.$this->filename; }
}
