<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Submission extends Model
{
    use HasUuids;
    protected $fillable = ['document_version_id', 'sender_id', 'recipient_user_id', 'recipient_email', 'assignment_id', 'note', 'status', 'submitted_at'];
    protected function casts(): array { return ['submitted_at' => 'datetime']; }
}
