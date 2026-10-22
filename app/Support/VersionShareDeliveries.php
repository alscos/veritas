<?php
namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Presentation records only. This listing never authorizes content access. */
final class VersionShareDeliveries
{
    /** Keyset pagination over immutable grant/account identity; no offset drift. */
    public function page(User $user, string $box, ?string $cursor = null): array
    {
        abort_unless(DB::transactionLevel() === 0 && $user->exists && User::whereKey($user->id)->exists(),404);
        abort_unless(in_array($box,['sent','received'],true),404);
        $cut=null;
        if ($cursor !== null) {
            abort_unless(strlen($cursor)<=160,404);
            $cut=json_decode(base64_decode($cursor,true) ?: '',true);
            abort_unless(is_array($cut) && count($cut)===2 && is_string($cut[0]) && \Illuminate\Support\Str::isUuid($cut[0]) && is_int($cut[1]) && $cut[1]>0,404);
        }
        if ($box === 'sent') return $this->sentPage($user, $cut);
        $q=DB::table('version_share_deliveries as d')
            ->join('version_summary_grants as g','g.id','=','d.grant_id')
            ->join('document_versions as v',fn($j)=>$j->on('v.id','=','g.version_id')->on('v.document_id','=','g.document_id'))
            ->join('documents as doc','doc.id','=','g.document_id')
            ->leftJoin('certificates as cert','cert.document_version_id','=','v.id')
            ->join('users as owner','owner.id','=','g.owner_id')
            ->join('users as recipient','recipient.id','=','d.user_id')
            ->where('g.level',3)->where('g.audience_mode','restricted')->whereNotNull('g.share_operation_key')
            ->where($box==='sent'?'g.owner_id':'d.user_id',$user->id);
        if ($cut) $q->where(fn($q)=>$q->where('g.id','>',$cut[0])->orWhere(fn($q)=>$q->where('g.id',$cut[0])->where('d.user_id','>',$cut[1])));
        $rows=$q->orderBy('g.id')->orderBy('d.user_id')->limit(51)
            ->select(['g.id','g.document_id','g.version_id','g.expires_at','g.revoked_at','g.time_basis','g.created_at_epoch','g.expires_at_epoch','g.never_expires','g.display_title_at_issue','d.user_id','v.version_number','cert.certificate_code','g.level','g.audience_mode','g.created_at','owner.name as sender','recipient.name as recipient'])
            ->selectRaw('EXISTS (SELECT 1 FROM version_share_recipients r WHERE r.grant_id = g.id AND r.user_id = d.user_id) AND doc.owner_id = g.owner_id AND v.sealed_at IS NOT NULL as recipient_authorized')
            ->selectRaw('EXISTS (SELECT 1 FROM submissions s WHERE s.document_version_id = g.version_id AND s.recipient_user_id = d.user_id) as independent_submission')->get();
        $more=$rows->count()>50;$rows=$rows->take(50);$last=$rows->last();
        return ['items'=>$rows->map(fn($r)=>[
            'grant_id'=>$r->id,'document_id'=>$r->document_id,'version_id'=>$r->version_id,'version_number'=>(int)$r->version_number,
            'document_title'=>$r->recipient_authorized && $r->revoked_at === null && GrantTime::active($r) ? $r->display_title_at_issue : null,'certificate_code'=>$r->certificate_code,'level'=>(int)$r->level,'audience_mode'=>$r->audience_mode,'created_at'=>GrantTime::iso($r,'created_at'),
            'sender'=>$r->sender,'recipient'=>$r->recipient,'recipient_user_id'=>(int)$r->user_id,
            'expires_at'=>GrantTime::iso($r,'expires_at'),'state'=>$r->revoked_at!==null?'revoked':(GrantTime::active($r)?'active':'expired'),
            'independent_submission'=>(bool)$r->independent_submission,
        ])->values()->all(),'next_cursor'=>$more?base64_encode(json_encode([$last->id,(int)$last->user_id])):null];
    }

    /** All owner's grants, including public and advanced links, without secret recovery. */
    private function sentPage(User $user, ?array $cut): array
    {
        $q=DB::table('version_summary_grants as g')
            ->join('document_versions as v',fn($j)=>$j->on('v.id','=','g.version_id')->on('v.document_id','=','g.document_id'))
            ->join('documents as doc','doc.id','=','g.document_id')
            ->leftJoin('certificates as cert','cert.document_version_id','=','v.id')
            ->where('g.owner_id',$user->id);
        if ($cut) $q->where('g.id','>',$cut[0]);
        $rows=$q->orderBy('g.id')->limit(51)->get(['g.id','g.document_id','g.version_id','g.level','g.audience_mode','g.label',
            'g.created_at','g.expires_at','g.revoked_at','g.time_basis','g.created_at_epoch','g.expires_at_epoch','g.never_expires','g.display_title_at_issue','v.version_number','cert.certificate_code','doc.title','doc.owner_id as current_owner_id']);
        $more=$rows->count()>50; $rows=$rows->take(50); $last=$rows->last();
        $accounts=DB::table('version_share_recipients as r')->join('users as u','u.id','=','r.user_id')->whereIn('r.grant_id',$rows->pluck('id'))->orderBy('u.id')->get(['r.grant_id','u.name'])->groupBy('grant_id');
        $academic=DB::table('submissions')->whereIn('document_version_id',$rows->pluck('version_id'))->pluck('document_version_id')->flip();
        $items=$rows->map(function ($r) use ($accounts,$academic,$user) {
            $recipients=$accounts->get($r->id,collect());
            $independent=$academic->has($r->version_id);
            return ['grant_id'=>$r->id,'document_id'=>$r->document_id,'version_id'=>$r->version_id,'version_number'=>(int)$r->version_number,
                'document_title'=>$r->display_title_at_issue ?? ((int)$r->current_owner_id === (int)$user->id ? $r->title : null),'title_basis'=>$r->display_title_at_issue !== null ? 'issue' : ((int)$r->current_owner_id === (int)$user->id ? 'current' : null),'certificate_code'=>$r->certificate_code,'level'=>(int)$r->level,'audience_mode'=>$r->audience_mode,'label'=>$r->label,
                'recipient_user_id'=>0,'recipient'=>$recipients->pluck('name')->implode(', '),'sender'=>'',
                'created_at'=>GrantTime::iso($r,'created_at'),'expires_at'=>GrantTime::iso($r,'expires_at'),
                'state'=>$r->revoked_at!==null?'revoked':(GrantTime::active($r)?'active':'expired'),'independent_submission'=>$independent];
        })->values()->all();
        return ['items'=>$items,'next_cursor'=>$more?base64_encode(json_encode([$last->id,1])):null];
    }

    public function listing(User $user): array
    {
        abort_unless(DB::transactionLevel() === 0 && $user->exists && User::whereKey($user->id)->exists(),404);
        $rows=DB::table('version_share_deliveries as d')
            ->join('version_summary_grants as g','g.id','=','d.grant_id')
            ->join('document_versions as v',fn($j)=>$j->on('v.id','=','g.version_id')->on('v.document_id','=','g.document_id'))
            ->where('g.level',3)->where('g.audience_mode','restricted')->whereNotNull('g.share_operation_key')
            ->where(fn($q)=>$q->where('g.owner_id',$user->id)->orWhere('d.user_id',$user->id))
            ->orderByDesc('d.presented_at')->get(['g.id','g.owner_id','g.document_id','g.version_id','g.level',
                'g.created_at','g.expires_at','g.revoked_at','g.time_basis','g.created_at_epoch','g.expires_at_epoch','g.never_expires','g.display_title_at_issue',
                'd.user_id','d.presented_at','v.version_number']);
        $result=['sent'=>[],'received'=>[]];
        foreach ($rows as $r) {
            $independent=DB::table('submissions')->where('document_version_id',$r->version_id)->where('recipient_user_id',$r->user_id)->exists();
            $item=['grant_id'=>$r->id,'version_id'=>$r->version_id,'version_number'=>(int)$r->version_number,
                'level'=>3,'owner_id'=>(int)$r->owner_id,'recipient_user_id'=>(int)$r->user_id,
                'presented_at'=>$r->presented_at,'expires_at'=>GrantTime::iso($r,'expires_at'),
                'state'=>$r->revoked_at!==null?'revoked':(GrantTime::active($r)?'active':'expired'),
                'independent_submission'=>$independent];
            if ((int)$r->owner_id===$user->id) $result['sent'][]=$item;
            if ((int)$r->user_id===$user->id) $result['received'][]=$item;
        }
        return $result;
    }
}
