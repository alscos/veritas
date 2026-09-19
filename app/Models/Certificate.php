<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Certificate extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['document_version_id', 'certificate_code', 'signature', 'signed_payload', 'issued_at'];
    protected function casts(): array { return ['signed_payload' => 'array', 'issued_at' => 'datetime']; }
}
