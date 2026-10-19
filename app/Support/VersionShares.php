<?php
namespace App\Support;

use App\Models\{Certificate, Document, DocumentVersion, User};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Unified issuer. No update operation: every issuance creates a fixed independent scope. */
final class VersionShares
{
    private function own(User $owner, string $document, string $version): void
    {
        abort_unless(DB::transactionLevel() === 0 && $owner->exists, 503);
        abort_unless(Document::whereKey($document)->where('owner_id', $owner->id)->exists()
            && DocumentVersion::whereKey($version)->where('document_id', $document)->whereNotNull('sealed_at')->exists(), 404);
    }

    public function recipients(User $owner, string $document, string $version): array
    {
        $this->own($owner, $document, $version);
        $rows = DB::table('submissions as s')->join('users as u', 'u.id', '=', 's.recipient_user_id')
            ->where('s.document_version_id', $version)->where('s.sender_id', $owner->id)
            ->distinct()->orderBy('u.id')->limit(101)->get(['u.id','u.name','u.email']);
        // No silent truncation of the eligible selection.
        abort_if(count($rows) > 100, 413);
        $this->own($owner, $document, $version);
        return $rows->all();
    }

    public function listing(User $owner, string $document, string $version): array
    {
        $this->own($owner, $document, $version);
        $rows = DB::table('version_summary_grants')->where('owner_id', $owner->id)
            ->where('document_id', $document)->where('version_id', $version)->orderByDesc('created_at')
            ->get(['id','level','audience_mode','label','created_at','expires_at','revoked_at','time_basis','created_at_epoch','expires_at_epoch']);
        $this->own($owner, $document, $version);
        return $rows->map(fn ($r) => $this->metadata($r))->all();
    }

    private function metadata(object $r): array
    {
        return ['id'=>$r->id, 'level'=>(int)$r->level, 'audience_mode'=>$r->audience_mode,
            'label'=>$r->label, 'created_at'=>GrantTime::iso($r, 'created_at'),
            'expires_at'=>GrantTime::iso($r, 'expires_at'),
            'revoked_at'=>$r->revoked_at === null ? null : GrantTime::iso($r, 'revoked_at'),
            'state'=>$r->revoked_at !== null ? 'revoked' : (GrantTime::active($r) ? 'active' : 'expired')];
    }

    public function issue(User $owner, string $document, string $version, array $input): array
    {
        $this->own($owner, $document, $version);
        $level=$input['level']; $days=$input['days']; $mode=$level===3 ? ($input['audience_mode'] ?? 'restricted') : null;
        abort_unless(is_int($level) && in_array($level,[1,2,3],true) && is_int($days) && $days>=1 && $days<=30,422);
        abort_unless($level===3 || (!isset($input['audience_mode']) && empty($input['recipient_ids'])),422);
        abort_unless($level!==3 || in_array($mode,['restricted','signed_in_link'],true),422);
        abort_unless($mode!=='signed_in_link' || (($input['forwardable_accepted'] ?? false)===true && empty($input['recipient_ids'])),422);
        $ids=$mode==='restricted' ? app(VersionShareAudience::class)->selection($owner,$document,$version,$input['recipient_ids'] ?? []) : [];
        // Level 3 must be readable before it can be issued. No draft fallback.
        if ($level===3) app(SealedVersionReader::class)->page($owner,$document,$version);
        $s=app(HistoricalVersionSummary::class)->summarize($owner,$document,$version);
        abort_unless(in_array($s['verification']['status'],['limited','verified'],true),409);
        $secret=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
        // Validate configured canonical origin before any issuance.
        $c=Certificate::where('document_version_id',$version)->firstOrFail();
        $origin=substr(PublicCertificate::url($c->certificate_code),0,-strlen('/verify/'.$c->certificate_code));
        return DB::transaction(function () use ($owner,$document,$version,$input,$level,$days,$mode,$ids,$secret,$origin) {
            Document::whereKey($document)->where('owner_id',$owner->id)->lockForUpdate()->firstOrFail(['id']);
            DocumentVersion::whereKey($version)->where('document_id',$document)->whereNotNull('sealed_at')->lockForUpdate()->firstOrFail(['id']);
            // Revalidate exact Entregas within the issuance cut, not just a UI list.
            if ($mode==='restricted') app(VersionShareAudience::class)->selection($owner,$document,$version,$ids);
            $row=['id'=>(string)Str::uuid(),'owner_id'=>$owner->id,'document_id'=>$document,'version_id'=>$version,
                'level'=>$level,'audience_mode'=>$mode,'label'=>$input['label'] ?? null,'digest'=>hash('sha256',$secret),
                'revoked_at'=>null] + GrantTime::issuance($days);
            DB::table('version_summary_grants')->insert($row);
            foreach($ids as $id) DB::table('version_share_recipients')->insert(['grant_id'=>$row['id'],'user_id'=>$id]);
            return ['grant'=>$this->metadata((object)$row),'url'=>$origin.'/process-summary/share#token='.$secret];
        });
    }
}
