<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WritingEvent extends Model
{
    public $timestamps = false;
    protected $fillable = ['writing_session_id', 'sequence', 'event_type', 'input_type', 'data', 'after_html', 'elapsed_ms', 'client_created_at', 'server_received_at', 'previous_hash', 'event_hash'];
    protected function casts(): array { return ['client_created_at' => 'datetime', 'server_received_at' => 'datetime']; }
}
