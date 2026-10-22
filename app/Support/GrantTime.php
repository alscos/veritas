<?php
namespace App\Support;

use Carbon\CarbonImmutable;

/** SQL timestamps have no offset. New grants use UTC epoch integers; NULL is legacy Madrid. */
final class GrantTime
{
    public static function issuance(?int $days): array
    {
        $start = CarbonImmutable::now('UTC')->startOfSecond();
        $end = $days === null ? $start : $start->addSeconds($days * 86400);
        // Epoch integers are authoritative; TIMESTAMP's SQL session conversion
        // must never decide access. Old mandatory columns are compatibility shadows.
        return ['time_basis'=>'epoch', 'created_at_epoch'=>$start->getTimestamp(),
            'expires_at_epoch'=>$end->getTimestamp(),
            'created_at'=>$start->setTimezone('Europe/Madrid')->format('Y-m-d H:i:s'),
            'expires_at'=>$end->setTimezone('Europe/Madrid')->format('Y-m-d H:i:s')];
    }

    public static function instant(object $row, string $field): CarbonImmutable
    {
        if (($row->time_basis ?? null) === 'epoch' && in_array($field, ['created_at','expires_at'], true)) {
            $value = $row->{$field.'_epoch'} ?? null;
            if ((!is_int($value) && !is_string($value)) || !ctype_digit((string)$value)) throw new \LogicException('Invalid grant instant');
            return CarbonImmutable::createFromTimestampUTC((int)$value);
        }
        $raw = (string) $row->$field;
        $utc = CarbonImmutable::createFromFormat('!Y-m-d H:i:s', $raw, 'UTC');
        if (!$utc || $utc->format('Y-m-d H:i:s') !== $raw) throw new \LogicException('Invalid grant date');
        if (!in_array($row->time_basis ?? null, [null, 'epoch'], true)) throw new \LogicException('Unknown grant clock');
        // Historical application timezone is Madrid. Consider both offsets explicitly:
        // Carbon alone chooses only one occurrence of October's repeated hour.
        // UTC is included conservatively for rows from an unconfirmed SQL session zone.
        $candidates = [$utc];
        $validMadrid = false;
        foreach ([3600, 7200] as $offset) {
            $candidate = $utc->subSeconds($offset);
            if ($candidate->setTimezone('Europe/Madrid')->format('Y-m-d H:i:s') === $raw) {
                $candidates[] = $candidate; $validMadrid = true;
            }
        }
        // Nonexistent March wall time: never normalize forward and extend access.
        if (!$validMadrid) $candidates[] = $utc->subSeconds(7200);
        if ($field === 'expires_at') {
            // Legacy did not store N. Infer only the conservative whole civil-day
            // duration of the original 1..30-day issuer, then cap elapsed time too.
            // A malformed/shorter-than-one-day legacy duration fails closed.
            $createdRaw = (string) ($row->created_at ?? '');
            $createdCivil = CarbonImmutable::createFromFormat('!Y-m-d H:i:s', $createdRaw, 'UTC');
            if (!$createdCivil || $createdCivil->format('Y-m-d H:i:s') !== $createdRaw) throw new \LogicException('Invalid grant creation');
            $days = intdiv($utc->getTimestamp() - $createdCivil->getTimestamp(), 86400);
            if ($days < 1 || $days > 30) throw new \LogicException('Unknown legacy duration');
            $candidates[] = self::instant($row, 'created_at')->addSeconds($days * 86400);
        }
        usort($candidates, fn ($a, $b) => $a->getTimestamp() <=> $b->getTimestamp());
        return $candidates[0];
    }

    public static function active(object $row): bool
    {
        if (self::indefinite($row)) return true;
        try { return self::instant($row, 'expires_at')->greaterThan(CarbonImmutable::now('UTC')); }
        catch (\Throwable) { return false; }
    }

    public static function indefinite(object $row): bool
    {
        // Only explicitly marked new UTC rows. Missing/legacy NULL dates fail closed.
        return (int)($row->never_expires ?? 0) === 1 && ($row->time_basis ?? null) === 'epoch'
            && ($row->expires_at_epoch ?? null) === null && isset($row->created_at_epoch);
    }

    public static function iso(object $row, string $field): ?string
    {
        if ($field === 'expires_at' && self::indefinite($row)) return null;
        return self::instant($row, $field)->toIso8601String();
    }
}
