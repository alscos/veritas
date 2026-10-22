<?php
namespace App\Support;

use App\Models\{Document, DocumentVersion, User};
use Illuminate\Support\Facades\DB;

/** Internal policy candidate only; possession/TTL/revocation are separate mandatory checks.
 * Not routed. In a future HTTP adapter visitor MUST come from Request::user(), never link input.
 */
final class VersionShareAudience
{
    public function selection(User $owner, string $document, string $version, array $ids): array
    {
        abort_unless($owner->exists && Document::whereKey($document)->where('owner_id', $owner->getKey())->exists()
            && DocumentVersion::whereKey($version)->where('document_id', $document)->whereNotNull('sealed_at')->exists(), 404);
        abort_unless(count($ids) > 0 && count($ids) <= 100, 422);
        foreach ($ids as $id) abort_unless(is_int($id) && $id > 0, 422);
        $ids = array_values(array_unique($ids)); sort($ids, SORT_NUMERIC);
        $eligible = DB::table('submissions as s')->join('users as u', 'u.id', '=', 's.recipient_user_id')
            ->where('s.document_version_id', $version)->where('s.sender_id', $owner->getKey())
            ->whereIn('u.id', $ids)->distinct()->pluck('u.id')->map(fn ($id) => (int) $id)->all();
        sort($eligible, SORT_NUMERIC); abort_unless($ids === $eligible, 422);
        return $ids;
    }

    /** Only audience membership. Calling this is NOT sufficient authorization to read bytes. */
    public function permits(object $grant, ?User $visitor): bool
    {
        if (!$visitor || !$visitor->exists || (int) ($grant->level ?? 0) !== 3
            || !User::whereKey($visitor->getKey())->exists()) return false;
        if (($grant->audience_mode ?? null) === 'signed_in_link') return true;
        if (($grant->audience_mode ?? null) !== 'restricted') return false;
        if (!empty($grant->share_operation_key)) {
            return DB::table('version_share_recipients as r')->join('version_share_deliveries as d',function ($j) {
                $j->on('d.grant_id','=','r.grant_id')->on('d.user_id','=','r.user_id');
            })->where('r.grant_id',$grant->id)->where('r.user_id',$visitor->id)->exists();
        }
        return DB::table('version_share_recipients as r')
            ->join('submissions as s', 's.recipient_user_id', '=', 'r.user_id')
            ->where('r.grant_id', $grant->id)->where('r.user_id', $visitor->getKey())
            ->where('s.document_version_id', $grant->version_id)->where('s.sender_id', $grant->owner_id)->exists();
    }
}
