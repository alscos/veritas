<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Document extends Model
{
    use HasUuids;
    protected $fillable = ['owner_id', 'folder_id', 'page_settings', 'title', 'content_html', 'content_text', 'word_count', 'status', 'last_session_at'];
    protected function casts(): array { return ['last_session_at' => 'datetime', 'page_settings' => 'array']; }
    public function owner() { return $this->belongsTo(User::class, 'owner_id'); }
    public function sessions() { return $this->hasMany(WritingSession::class); }
    public function versions() { return $this->hasMany(DocumentVersion::class); }
    public function images() { return $this->hasMany(DocumentImage::class); }
    public function folder() { return $this->belongsTo(DocumentFolder::class); }
}
