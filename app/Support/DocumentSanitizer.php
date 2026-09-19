<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

final class DocumentSanitizer
{
    private const TAGS = ['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'MARK', 'SPAN'];

    public static function html(string $input): string
    {
        if ($input === '') return '';
        $document = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        // DOMDocument otherwise interprets an HTML fragment as ISO-8859-1 and
        // corrupts valid UTF-8 text (for example, "á" becomes "Ã¡").
        $document->loadHTML('<?xml encoding="UTF-8"><div id="veritas-root">'.$input.'</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        $root = $document->getElementById('veritas-root');
        if (!$root) return htmlspecialchars(strip_tags($input), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        self::clean($root);
        $result = '';
        foreach ($root->childNodes as $child) $result .= $document->saveHTML($child);
        return $result;
    }

    private static function clean(DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $child) {
            if (!$child instanceof DOMElement) continue;
            $tag = strtoupper($child->tagName);
            if (!in_array($tag, self::TAGS, true)) {
                while ($child->firstChild) $child->parentNode?->insertBefore($child->firstChild, $child);
                $child->parentNode?->removeChild($child);
                continue;
            }
            foreach (iterator_to_array($child->attributes) as $attribute) {
                $allowedOrigin = $tag === 'MARK' && $attribute->name === 'data-origin' && in_array($attribute->value, ['paste', 'paste-edited'], true);
                $allowedProvenance = $tag === 'SPAN' && $attribute->name === 'data-provenance' && in_array($attribute->value, ['typed', 'paste-edited'], true);
                if (!$allowedOrigin && !$allowedProvenance) $child->removeAttribute($attribute->name);
            }
            self::clean($child);
        }
    }

    public static function text(string $html): string
    {
        return trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
    }

    public static function wordCount(string $text): int
    {
        if ($text === '') return 0;
        preg_match_all('/[\p{L}\p{N}][\p{L}\p{N}\p{M}\'’_-]*/u', $text, $matches);
        return count($matches[0]);
    }
}
