<?php
namespace App\Support;

/** Canonical UTF-8 JSON. Objects remain objects; lists remain lists. */
final class EvidenceCanon
{
    public const SCHEMA = 'inkgroove-evidence-1';
    public static function encode(mixed $value): string
    {
        return json_encode(self::sort($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR, 64);
    }
    private static function sort(mixed $v): mixed
    {
        if ($v instanceof \stdClass) {
            $a = get_object_vars($v); ksort($a, SORT_STRING); $o = new \stdClass;
            foreach ($a as $k => $x) $o->{(string) $k} = self::sort($x);
            return $o;
        }
        if (is_array($v) && array_is_list($v)) return array_map(self::sort(...), $v);
        if (is_string($v) || is_int($v) || is_bool($v) || $v === null) return $v;
        throw new \InvalidArgumentException('Ambiguous evidence type');
    }
    public static function decode(string $bytes): \stdClass
    {
        $v = json_decode($bytes, false, 64, JSON_THROW_ON_ERROR);
        // Re-encoding also rejects duplicate keys, whitespace, alternate escapes,
        // floating numbers and every noncanonical textual representation.
        if (!$v instanceof \stdClass || self::encode($v) !== $bytes) throw new \InvalidArgumentException('Noncanonical evidence');
        self::validate($v);
        return $v;
    }
    public static function validate(\stdClass $v): void
    {
        self::keys($v, ['schema','document_id','version_id','snapshot_hash','heads','event_count','images']);
        if ($v->schema !== self::SCHEMA) throw new \InvalidArgumentException('Unknown evidence schema');
        self::uuid($v->document_id); self::uuid($v->version_id); self::hash($v->snapshot_hash);
        if (!is_int($v->event_count) || $v->event_count < 0 || !$v->heads instanceof \stdClass || !$v->images instanceof \stdClass) throw new \InvalidArgumentException('Invalid evidence types');
        $total = 0;
        foreach (get_object_vars($v->heads) as $id => $head) {
            self::uuid($id); self::keys($head, ['sequence','event_id','hash']);
            if (!is_int($head->sequence) || $head->sequence < 1 || !is_int($head->event_id) || $head->event_id < 1) throw new \InvalidArgumentException('Invalid head');
            self::hash($head->hash); $total += $head->sequence;
        }
        if ($total !== $v->event_count) throw new \InvalidArgumentException('Invalid total');
        foreach (get_object_vars($v->images) as $id => $image) {
            self::uuid($id); self::keys($image, ['sha256','bytes']); self::hash($image->sha256);
            if (!is_int($image->bytes) || $image->bytes < 0) throw new \InvalidArgumentException('Invalid image size');
        }
    }
    private static function keys(mixed $o, array $expected): void
    {
        if (!$o instanceof \stdClass) throw new \InvalidArgumentException('Object required');
        $keys = array_keys(get_object_vars($o)); sort($keys); sort($expected);
        if ($keys !== $expected) throw new \InvalidArgumentException('Invalid evidence fields');
    }
    private static function uuid(mixed $v): void { if (!is_string($v) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/D', $v)) throw new \InvalidArgumentException('Invalid UUID'); }
    private static function hash(mixed $v): void { if (!is_string($v) || !preg_match('/^[a-f0-9]{64}$/D', $v)) throw new \InvalidArgumentException('Invalid hash'); }
}
