<?php
namespace Tests\Unit;

use App\Support\CertificatePayload;
use PHPUnit\Framework\TestCase;

final class CertificatePayloadTest extends TestCase
{
    private function payload(int $format): array
    {
        return ['format_version'=>$format, 'history_boundary'=>[
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'=>['sequence'=>2,'event_id'=>45,'hash'=>str_repeat('a',64)],
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'=>['sequence'=>1,'event_id'=>46,'hash'=>str_repeat('b',64)],
        ], 'page_settings'=>['orientation'=>'portrait','format'=>'a4','margin'=>20],
            'images'=>[], 'content_hash'=>str_repeat('c',64), 'sealed_at'=>'2026-10-22T00:00:00+00:00'];
    }
    private function reordered(array $p): array
    {
        foreach ($p as &$v) if (is_array($v)) $v = $this->reordered($v);
        unset($v); krsort($p, SORT_STRING); return $p;
    }
    public function test_new_profiles_survive_object_reordering_and_preserve_types_and_lists(): void
    {
        foreach ([2,3] as $format) {
            $p=$this->payload($format)+['payload_encoding'=>CertificatePayload::ENCODING];
            $signature=hash_hmac('sha256',CertificatePayload::encode($p),'synthetic');
            self::assertTrue(CertificatePayload::matches($this->reordered($p),$signature,'synthetic'));
            foreach (['content_hash','history_boundary','page_settings','images','payload_encoding'] as $field) {
                $bad=$p;$bad[$field]=null;
                self::assertFalse(CertificatePayload::matches($bad,$signature,'synthetic'));
            }
            $bad=$p;$bad['page_settings']['margin']='20';
            self::assertFalse(CertificatePayload::matches($bad,$signature,'synthetic'));
            self::assertFalse(CertificatePayload::matches($p,str_repeat('0',64),'synthetic'));
            self::assertFalse(CertificatePayload::matches($p,$signature,'other'));
        }
        $p=['payload_encoding'=>CertificatePayload::ENCODING,'list'=>['a','b']];
        $sig=hash_hmac('sha256',CertificatePayload::encode($p),'synthetic');
        $p['list']=['b','a'];self::assertFalse(CertificatePayload::matches($p,$sig,'synthetic'));
    }
    public function test_only_demonstrated_historical_head_order_is_reconstructed(): void
    {
        foreach ([2,3] as $format) {
            $p=$this->payload($format);ksort($p);
            $sig=hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'synthetic');
            foreach ($p['history_boundary'] as &$head) ksort($head);
            unset($head);$p['history_boundary']=array_reverse($p['history_boundary'],true);
            self::assertTrue(CertificatePayload::matches($p,$sig,'synthetic'));
            $p['history_boundary'][array_key_first($p['history_boundary'])]['extra']=1;
            self::assertFalse(CertificatePayload::matches($p,$sig,'synthetic'));
        }
        // No speculative recovery for page settings or unordered historical images.
        $p=$this->payload(2);ksort($p);
        $sig=hash_hmac('sha256',json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'synthetic');
        $p['page_settings']=array_reverse($p['page_settings'],true);
        self::assertFalse(CertificatePayload::matches($p,$sig,'synthetic'));
    }
}
