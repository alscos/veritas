<?php
namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

/** Read-only counterpart of analyzeHtml's direct word count. No normalization. */
final class HistoryWords
{
    public static function direct(string $html): int
    {
        if ($html === '') return 0;
        $dom = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="UTF-8"><div id="history-root">'.$html.'</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors(); libxml_use_internal_errors($previous);
        $text = ''; $ranges = [];
        $append = function (string $value, bool $external) use (&$text, &$ranges): void {
            if ($external) $ranges[] = [strlen($text), strlen($text) + strlen($value)];
            $text .= $value;
        };
        $visit = function (DOMNode $node, bool $external) use (&$visit, $append): void {
            if ($node->nodeType === XML_TEXT_NODE) { $append($node->textContent, $external); return; }
            if (!$node instanceof DOMElement) return;
            $tag = strtoupper($node->tagName);
            if ($tag === 'MARK' && in_array($node->getAttribute('data-origin'), ['paste', 'paste-edited'], true)) $external = true;
            if ($tag === 'BR') { $append("\n", $external); return; }
            foreach ($node->childNodes as $child) $visit($child, $external);
            if (in_array($tag, ['DIV','P','H1','H2','H3','LI','BLOCKQUOTE','UL','OL','TD','TH','TR'], true)) $append("\n", $external);
        };
        foreach ($dom->getElementById('history-root')?->childNodes ?? [] as $child) $visit($child, false);
        preg_match_all("/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/u", $text, $matches, PREG_OFFSET_CAPTURE);
        $direct = 0; $rangeIndex = 0;
        foreach ($matches[0] as [$word, $start]) {
            $end = $start + strlen($word);
            while (isset($ranges[$rangeIndex]) && $ranges[$rangeIndex][1] <= $start) $rangeIndex++;
            if (!isset($ranges[$rangeIndex]) || $ranges[$rangeIndex][0] >= $end) $direct++;
        }
        return $direct;
    }
}
