<?php

namespace App\Support;

use App\Models\Certificate;

/** Only the stored payload's HMAC, never an integral process verification. */
final class PublicCertificate
{
    public static function find(string $code): ?Certificate
    {
        if (!preg_match('/^VRT-[A-Z0-9]{1,64}$/D', $code)) return null;
        $length = \Illuminate\Support\Facades\DB::connection()->getDriverName() === 'sqlite'
            ? 'length(CAST(signed_payload AS BLOB))' : 'OCTET_LENGTH(signed_payload)';
        $size = Certificate::query()->where('certificate_code', $code)->select(['id'])->selectRaw($length.' AS bytes')->first();
        if (!$size || (int) $size->bytes > 262144) return null;
        return Certificate::query()->find($size->id);
    }

    public static function valid(Certificate $certificate): bool
    {
        $payload = $certificate->signed_payload;
        $key = config('veritas.signing_key');
        if (!is_array($payload) || !is_string($key) || $key === '') return false;
        ksort($payload);
        try { $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
        catch (\JsonException) { return false; }
        return hash_equals((string) $certificate->signature, hash_hmac('sha256', $encoded, $key));
    }

    public static function summary(Certificate $certificate): array
    {
        $payload = $certificate->signed_payload;
        $hash = is_array($payload) ? ($payload['content_hash'] ?? null) : null;
        return [
            'valid' => self::valid($certificate),
            'scope' => 'payload_signature',
            'certificate_code' => $certificate->certificate_code,
            'issued_at' => $certificate->issued_at,
            'content_hash' => is_string($hash) && preg_match('/^[a-f0-9]{64}$/D', $hash) ? $hash : null,
        ];
    }

    public static function url(string $code): string
    {
        $origin = config('veritas.public_origin');
        $parts = is_string($origin) ? parse_url($origin) : false;
        abort_unless($parts && in_array($parts['scheme'] ?? '', ['https', 'http'], true)
            && !empty($parts['host']) && strlen($origin) <= 300
            && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['query']) && !isset($parts['fragment'])
            && in_array($parts['path'] ?? '', ['', '/'], true)
            && !preg_match('/[\x00-\x20\\\\]/', $origin)
            && filter_var($origin, FILTER_VALIDATE_URL), 503, __('inkgroove.pdf_unavailable'));
        abort_unless(preg_match('/^VRT-[A-Z0-9]{1,64}$/D', $code), 409, __('inkgroove.pdf_unavailable'));
        return rtrim($origin, '/').'/verify/'.$code;
    }
}
