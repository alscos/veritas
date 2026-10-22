<?php
namespace App\Support;

use App\Models\{Certificate, Document, DocumentVersion, User};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Fixed independent scopes; operation keys deduplicate retries without retaining bearer secrets.
 * The HTTP adapter accepts nominal operations; UI integration remains separate.
 */
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
            ->get(['id','level','audience_mode','label','created_at','expires_at','revoked_at','time_basis','created_at_epoch','expires_at_epoch','never_expires','display_title_at_issue']);
        $this->own($owner, $document, $version);
        return $rows->map(fn ($r) => $this->metadata($r))->all();
    }

    private function metadata(object $r): array
    {
        return ['id'=>$r->id, 'level'=>(int)$r->level, 'audience_mode'=>$r->audience_mode,
            'display_title_at_issue'=>$r->display_title_at_issue ?? null,
            'label'=>$r->label, 'created_at'=>GrantTime::iso($r, 'created_at'),
            'expires_at'=>GrantTime::iso($r, 'expires_at'),
            'revoked_at'=>$r->revoked_at === null ? null : GrantTime::iso($r, 'revoked_at'),
            'state'=>$r->revoked_at !== null ? 'revoked' : (GrantTime::active($r) ? 'active' : 'expired')];
    }

    public function issue(User $owner, string $document, string $version, array $input): array
    {
        $this->own($owner, $document, $version);
        abort_unless(array_key_exists('days', $input),422);
        $level=$input['level']; $days=$input['days']; $mode=$level===3 ? ($input['audience_mode'] ?? 'restricted') : null;
        abort_unless(is_int($level) && in_array($level,[1,2,3],true) && ($days === null || (is_int($days) && $days>=1 && $days<=30)),422);
        abort_unless($level===3 || (!isset($input['audience_mode']) && empty($input['recipient_ids'])),422);
        abort_unless($level!==3 || in_array($mode,['restricted','signed_in_link'],true),422);
        abort_unless($mode!=='signed_in_link' || (($input['forwardable_accepted'] ?? false)===true && empty($input['recipient_ids'])),422);
        $operation=$input['operation_key'] ?? null;
        abort_unless($operation === null || (is_string($operation) && Str::isUuid($operation)),422);
        $ids=[];
        if ($operation !== null) {
            // Exact addresses supplied by the author; no global account directory.
            $emails=$input['recipient_emails'] ?? [];
            abort_unless(is_array($emails) && count($emails)<=100 && empty($input['recipient_ids']),422);
            abort_unless($mode==='restricted' || count($emails)===0,422);
            foreach ($emails as $email) abort_unless(is_string($email) && strlen($email)<=255 && filter_var($email,FILTER_VALIDATE_EMAIL),422);
            $emails=array_values(array_unique(array_map(fn($email)=>mb_strtolower(trim($email)),$emails))); sort($emails);
            if ($mode==='restricted') {
                abort_unless(count($emails)>0,422);
                $users=User::whereIn('email',$emails)->where('id','!=',$owner->id)->get(['id','email']);
                // Same bounded failure for nonexistent/self/mixed selections. No invitations sent.
                abort_unless($users->count()===count($emails),422);
                $ids=$users->pluck('id')->map(fn($id)=>(int)$id)->all();sort($ids,SORT_NUMERIC);
            }
        } else {
            abort_unless(empty($input['recipient_emails']),422);
            $ids=$mode==='restricted' ? app(VersionShareAudience::class)->selection($owner,$document,$version,$input['recipient_ids'] ?? []) : [];
        }
        $fingerprint=hash('sha256',json_encode([$document,$version,$level,$days,$mode,$ids,$input['label'] ?? null],JSON_THROW_ON_ERROR));
        // Level 3 must be readable before it can be issued. No draft fallback.
        if ($level===3) app(SealedVersionReader::class)->page($owner,$document,$version);
        $s=app(HistoricalVersionSummary::class)->summarize($owner,$document,$version);
        abort_unless(in_array($s['verification']['status'],['limited','verified'],true),409);
        $secret=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
        // Validate configured canonical origin before any issuance.
        $c=Certificate::where('document_version_id',$version)->firstOrFail();
        $origin=substr(PublicCertificate::url($c->certificate_code),0,-strlen('/verify/'.$c->certificate_code));
        return DB::transaction(function () use ($owner,$document,$version,$input,$level,$days,$mode,$ids,$secret,$origin,$operation,$fingerprint) {
            Document::whereKey($document)->where('owner_id',$owner->id)->lockForUpdate()->firstOrFail(['id']);
            $title = Document::whereKey($document)->value('title');
            DocumentVersion::whereKey($version)->where('document_id',$document)->whereNotNull('sealed_at')->lockForUpdate()->firstOrFail(['id']);
            if ($operation !== null) {
                $previous=DB::table('version_summary_grants')->where('owner_id',$owner->id)->where('share_operation_key',$operation)->lockForUpdate()->first();
                if ($previous) {
                    abort_unless(hash_equals($previous->share_operation_fingerprint,$fingerprint),409);
                    // Secret intentionally unrecoverable. Retry never creates another grant.
                    return ['grant'=>$this->metadata($previous),'url'=>null,'replayed'=>true];
                }
                abort_unless(User::whereIn('id',$ids)->where('id','!=',$owner->id)->count()===count($ids),422);
            }
            // Revalidate exact Entregas within the issuance cut, not just a UI list.
            if ($mode==='restricted' && $operation===null) app(VersionShareAudience::class)->selection($owner,$document,$version,$ids);
            $row=['id'=>(string)Str::uuid(),'owner_id'=>$owner->id,'document_id'=>$document,'version_id'=>$version,
                'level'=>$level,'audience_mode'=>$mode,'label'=>$input['label'] ?? null,'digest'=>hash('sha256',$secret),
                'revoked_at'=>null,'never_expires'=>$days === null,'display_title_at_issue'=>$title] + GrantTime::issuance($days);
            if ($days === null) $row['expires_at_epoch'] = null;
            if ($operation !== null) $row+=['share_operation_key'=>$operation,'share_operation_fingerprint'=>$fingerprint];
            DB::table('version_summary_grants')->insert($row);
            foreach($ids as $id) {
                DB::table('version_share_recipients')->insert(['grant_id'=>$row['id'],'user_id'=>$id]);
                if ($operation !== null) DB::table('version_share_deliveries')->insert(['grant_id'=>$row['id'],'user_id'=>$id,'presented_at'=>now()]);
            }
            return ['grant'=>$this->metadata((object)$row),'url'=>$origin.'/process-summary/share#token='.$secret];
        });
    }
}
