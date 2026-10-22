<?php
namespace App\Support;
final class EventIntegrity
{
    public static function matches(string $sid, object $e, string $key, VerificationBudget $budget): bool
    {
        // Older HMAC inputs may contain integer JSON values or decimal strings;
        // SQL integer columns discard their JSON type. Try those exact encodings;
        // a match authenticates the candidate bytes, never a normalized HMAC.
        // TrimStrings runs before validation/signing; FILTER_VALIDATE_INT rejects
        // leading zeros. Preserve the remaining encodings, including +n strings,
        // boolean true and negative floating zero. No stored bytes are rewritten.
        $elapsedCandidates = [(int) $e->elapsed_ms, (string) $e->elapsed_ms, '+'.(string) $e->elapsed_ms];
        if ((int) $e->elapsed_ms === 0) { $elapsedCandidates[] = '-0'; $elapsedCandidates[] = -0.0; }
        if ((int) $e->elapsed_ms === 1) $elapsedCandidates[] = true;
        foreach ([(int) $e->sequence, (string) $e->sequence] as $sequence) {
            foreach ($elapsedCandidates as $elapsed) {
                $budget->guard();
                $canonical = json_encode(['session' => $sid, 'sequence' => $sequence, 'type' => $e->event_type, 'input' => $e->input_type, 'data' => $e->data, 'after' => $e->after_html, 'elapsed' => $elapsed], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                if (hash_equals($e->event_hash, hash_hmac('sha256', ($e->previous_hash ?? '').$canonical, $key))) return true;
            }
        }
        return false;
    }

}
