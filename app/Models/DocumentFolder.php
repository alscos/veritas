<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DocumentFolder extends Model
{
    use HasUuids;
    protected $fillable = ['owner_id', 'name'];
    public function documents() { return $this->hasMany(Document::class, 'folder_id'); }
}
