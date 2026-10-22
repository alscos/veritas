<?php
namespace App\Support;

/** Conservative, read-only subset of analyzeHtml. Ambiguous HTML is unavailable. */
final class HistoricalWordCounts
{
    public static function analyze(string $html): array
    {
        if (strlen($html) > 250000) throw new \DomainException('snapshot_byte_limit');
        if (!mb_check_encoding($html, 'UTF-8') || preg_match('/<\s*[!?]/', $html)) throw new \DomainException('html_unsupported');
        if (preg_match_all('~<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?/>~', $html, $voids)) foreach ($voids[1] as $tag) {
            if (!in_array($tag, ['br','hr','img'], true)) throw new \DomainException('html_ambiguous');
        }
        // XML requires explicit void ends and numeric named entities. Never rewrite storage.
        $xml = preg_replace_callback('/&([a-zA-Z][a-zA-Z0-9]+);/', function ($m) {
            $decoded = html_entity_decode($m[0], ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if ($decoded === $m[0]) return $m[0];
            return implode('', array_map(fn ($c) => '&#'.mb_ord($c, 'UTF-8').';', mb_str_split($decoded)));
        }, $html);
        $xml = preg_replace('~<(br|hr|img)\b([^>]*?)(?<!/)>~i', '<$1$2/>', $xml);
        $dom = new \DOMDocument('1.0', 'UTF-8');
        $old = libxml_use_internal_errors(true);
        try { $ok = $dom->loadXML('<summary-root>'.$xml.'</summary-root>', LIBXML_NONET); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($old); }
        if (!$ok) throw new \DomainException('html_ambiguous');
        $source = ''; $ranges = []; $nodes = 0;
        $append = function (string $text, string $origin) use (&$source, &$ranges): void {
            $start = strlen($source); $source .= $text;
            if ($text !== '') $ranges[] = [$start, strlen($source), $origin];
        };
        $visit = function (\DOMNode $node, string $origin, int $depth) use (&$visit, &$nodes, $append): void {
            if (++$nodes > 5000 || $depth > 64) throw new \DomainException('tree_limit');
            if ($node instanceof \DOMText) { $append($node->textContent, $origin); return; }
            if (!$node instanceof \DOMElement) throw new \DomainException('html_unsupported');
            $tag = $node->tagName;
            if ($node->namespaceURI !== null) throw new \DomainException('html_unsupported');
            if (!in_array($tag, ['p','div','br','strong','b','em','i','u','s','del','sub','sup','h1','h2','h3','ul','ol','li','blockquote','mark','span','a','img','hr','table','tbody','thead','tr','th','td'], true)) throw new \DomainException('html_unsupported');
            $parent = $node->parentNode instanceof \DOMElement ? $node->parentNode->tagName : '';
            $blocks = ['p','div','h1','h2','h3','ul','ol','li','blockquote','table','tbody','thead','tr','td','th','hr'];
            for ($ancestor = $node->parentNode; $ancestor instanceof \DOMElement; $ancestor = $ancestor->parentNode) {
                if (in_array($ancestor->tagName, ['p','h1','h2','h3','mark','span','a','strong','b','em','i','u','s','del','sub','sup'], true)
                    && in_array($tag, $blocks, true)) throw new \DomainException('html_ambiguous');
                if (($tag === 'a' && $ancestor->tagName === 'a') || ($tag === 'li' && $ancestor->tagName === 'li' && $parent === 'li') || (in_array($tag, ['h1','h2','h3'], true) && in_array($ancestor->tagName, ['h1','h2','h3'], true))) throw new \DomainException('html_ambiguous');
            }
            $parents = ['li'=>['ul','ol'], 'tbody'=>['table'], 'thead'=>['table'], 'tr'=>['table','tbody','thead'], 'td'=>['tr'], 'th'=>['tr']];
            if (isset($parents[$tag]) && !in_array($parent, $parents[$tag], true)) throw new \DomainException('html_ambiguous');
            $children = ['table'=>['tbody','thead','tr'], 'tbody'=>['tr'], 'thead'=>['tr'], 'tr'=>['td','th'], 'ul'=>['li'], 'ol'=>['li']];
            if (isset($children[$tag])) foreach ($node->childNodes as $child) {
                if ($child instanceof \DOMText && trim($child->textContent) === '') continue;
                if (!$child instanceof \DOMElement || !in_array($child->tagName, $children[$tag], true)) throw new \DomainException('html_ambiguous');
            }
            if ($tag === 'mark' && in_array($node->getAttribute('data-origin'), ['paste','paste-edited'], true)) $origin = $node->getAttribute('data-origin');
            if ($tag === 'br') { $append("\n", $origin); return; }
            foreach ($node->childNodes as $child) $visit($child, $origin, $depth + 1);
            if (in_array($tag, ['div','p','h1','h2','h3','li','blockquote','ul','ol','td','th','tr'], true)) $append("\n", $origin);
        };
        foreach ($dom->documentElement->childNodes as $child) $visit($child, 'direct', 1);
        $counts = ['direct'=>0,'pasted'=>0,'edited'=>0,'total'=>0];
        if (preg_match_all("/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/u", $source, $matches, PREG_OFFSET_CAPTURE) === false) throw new \DomainException('tokenization_failed');
        $cursor = 0;
        foreach ($matches[0] as [$word, $start]) {
            $end = $start + strlen($word); $origins = [];
            while (isset($ranges[$cursor]) && $ranges[$cursor][1] <= $start) $cursor++;
            for ($i=$cursor; isset($ranges[$i]) && $ranges[$i][0] < $end; $i++) $origins[$ranges[$i][2]] = true;
            $counts['total']++;
            $counts[isset($origins['paste-edited']) ? 'edited' : (isset($origins['paste']) ? 'pasted' : 'direct')]++;
        }
        return $counts;
    }
}
