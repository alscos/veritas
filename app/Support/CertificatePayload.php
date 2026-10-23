<?php

namespace App\Support;

/** Shared signature bytes. Never consults live state to repair a commitment. */
final class CertificatePayload
{
    public const ENCODING = 'sorted-json-v1';

    public static function encode(array $payload): string
    {
        if (($payload['payload_encoding'] ?? null) !== self::ENCODING) {
            throw new \InvalidArgumentException('Unsupported certificate encoding');
        }
        return json_encode(self::ordered($payload), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function ordered(mixed $value): mixed
    {
        // Emitted payloads contain only arrays, strings, integers, booleans and null.
        // Do not silently canonize floats whose representation a JSON DB may change.
        if (is_float($value) || is_object($value)) throw new \InvalidArgumentException('Unsupported certificate value');
        if (!is_array($value)) return $value;
        if (!array_is_list($value)) ksort($value, SORT_STRING);
        foreach ($value as &$child) $child = self::ordered($child);
        return $value;
    }

    public static function matches(array $payload, string $signature, string $key): bool
    {
        if ($key === '' || array_is_list($payload)) return false;
        try {
            if (array_key_exists('payload_encoding', $payload)) {
                return hash_equals($signature, hash_hmac('sha256', self::encode($payload), $key));
            }
            ksort($payload);
            $matches = fn (array $p) => hash_equals($signature, hash_hmac('sha256', json_encode($p, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), $key));
            if ($matches($payload)) return true; // Historical bytes as read (including v1).
            if (!in_array($payload['format_version'] ?? null, [2, 3], true)
                || !is_array($payload['history_boundary'] ?? null)) return false;
            // Both historical emitters query sessions ORDER BY id and construct
            // exactly these three head fields in this insertion order. MySQL JSON
            // does not preserve that order. No other ordering is guessed.
            $boundary = $payload['history_boundary'];
            ksort($boundary, SORT_STRING);
            foreach ($boundary as &$head) {
                if (!is_array($head) || count($head) !== 3
                    || !array_key_exists('sequence', $head) || !array_key_exists('event_id', $head) || !array_key_exists('hash', $head)) return false;
                $head = ['sequence' => $head['sequence'], 'event_id' => $head['event_id'], 'hash' => $head['hash']];
            }
            unset($head);
            $payload['history_boundary'] = $boundary;
            return $matches($payload);
        } catch (\JsonException | \InvalidArgumentException) {
            return false;
        }
    }
}
