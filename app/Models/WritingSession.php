<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class WritingSession extends Model
{
    use HasUuids;
    protected $fillable = ['id', 'document_id', 'user_id', 'client_started_at', 'ended_at', 'last_sequence', 'last_hash'];
    protected function casts(): array { return ['client_started_at' => 'datetime', 'ended_at' => 'datetime']; }
    public function events() { return $this->hasMany(WritingEvent::class)->orderBy('sequence'); }
}
