<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
final class VersionEvidence extends Model
{
    protected $table = 'version_evidence';
    protected $primaryKey = 'document_version_id';
    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;
    protected $fillable = ['document_version_id','schema','manifest_bytes'];
    protected $hidden = ['manifest_bytes'];
    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Evidence is immutable'));
        static::deleting(fn () => throw new \LogicException('Evidence deletes only with its version/document'));
    }
}
