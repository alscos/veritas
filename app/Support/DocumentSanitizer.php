<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;
use App\Models\DocumentImage;
use Illuminate\Validation\ValidationException;

final class DocumentSanitizer
{
    private const TAGS = ['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'SUB', 'SUP', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'MARK', 'SPAN', 'A', 'IMG', 'HR', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TH', 'TD'];
    private const FONTS = ['serif', 'sans', 'mono', 'georgia', 'times', 'garamond', 'arial', 'verdana', 'courier'];
    private const SIZES = ['small', 'normal', 'large', 'x-large', '8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];
    private const IMAGE_URL = '~^/api/documents/([a-f0-9-]{36})/images/([a-f0-9-]{36})$~D';

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
            if (in_array($tag, ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'], true)) {
                $child->parentNode?->removeChild($child);
                continue;
            }
            if (!in_array($tag, self::TAGS, true)) {
                self::clean($child);
                while ($child->firstChild) $child->parentNode?->insertBefore($child->firstChild, $child);
                $child->parentNode?->removeChild($child);
                continue;
            }
            foreach (iterator_to_array($child->attributes) as $attribute) {
                $allowedOrigin = $tag === 'MARK' && $attribute->name === 'data-origin' && in_array($attribute->value, ['paste', 'paste-edited'], true);
                $allowedProvenance = $tag === 'SPAN' && $attribute->name === 'data-provenance' && in_array($attribute->value, ['typed', 'paste-edited'], true);
                $allowedFont = $tag === 'SPAN' && $attribute->name === 'data-font' && in_array($attribute->value, self::FONTS, true);
                $allowedSize = $tag === 'SPAN' && $attribute->name === 'data-size' && in_array($attribute->value, self::SIZES, true);
                $allowedColor = $tag === 'SPAN' && $attribute->name === 'data-color' && preg_match('/^#[a-f0-9]{6}$/D', $attribute->value);
                $block = in_array($tag, ['P', 'H1', 'H2', 'H3', 'TD', 'TH'], true);
                $allowedLayout = $block && (($attribute->name === 'data-indent' && preg_match('/^[0-6]$/D', $attribute->value)) || ($attribute->name === 'data-line-height' && in_array($attribute->value, ['1', '1.15', '1.5', '2'], true)));
                $allowedLink = $tag === 'A' && (($attribute->name === 'href' && self::safeLink($attribute->value)) || ($attribute->name === 'title' && mb_strlen($attribute->value) <= 200));
                $allowedImage = $tag === 'IMG' && (($attribute->name === 'src' && preg_match(self::IMAGE_URL, $attribute->value)) || ($attribute->name === 'alt' && mb_strlen($attribute->value) <= 300) || ($attribute->name === 'width' && ctype_digit($attribute->value) && (int) $attribute->value >= 40 && (int) $attribute->value <= 1600) || ($attribute->name === 'height' && ctype_digit($attribute->value) && (int) $attribute->value >= 1 && (int) $attribute->value <= 12000) || ($attribute->name === 'data-image-sha256' && preg_match('/^[a-f0-9]{64}$/D', $attribute->value)));
                $allowedTable = in_array($tag, ['TD', 'TH'], true) && ((in_array($attribute->name, ['colspan', 'rowspan'], true) && ctype_digit($attribute->value) && (int) $attribute->value >= 1 && (int) $attribute->value <= 20) || ($attribute->name === 'colwidth' && preg_match('/^\d{1,4}(,\d{1,4}){0,19}$/D', $attribute->value)));
                $allowedBreak = $tag === 'DIV' && $attribute->name === 'data-page-break' && $attribute->value === 'true';
                $allowedStart = $tag === 'OL' && $attribute->name === 'start' && ctype_digit($attribute->value) && (int) $attribute->value <= 10000;
                if ($attribute->name === 'style' && $block) {
                    $style = self::safeBlockStyle($attribute->value);
                    if ($style) $child->setAttribute('style', $style);
                    else $child->removeAttribute('style');
                    continue;
                }
                if (!$allowedOrigin && !$allowedProvenance && !$allowedFont && !$allowedSize && !$allowedColor && !$allowedLayout && !$allowedLink && !$allowedImage && !$allowedTable && !$allowedBreak && !$allowedStart) $child->removeAttribute($attribute->name);
            }
            if ($tag === 'A') { $child->setAttribute('target', '_blank'); $child->setAttribute('rel', 'noopener noreferrer'); }
            if ($tag === 'SPAN') {
                $styles = [];
                $font = match ($child->getAttribute('data-font')) {
                    'serif', 'georgia' => 'Georgia, "Times New Roman", serif',
                    'sans', 'arial' => 'Arial, Helvetica, sans-serif',
                    'mono', 'courier' => '"Courier New", monospace',
                    'times' => '"Times New Roman", Times, serif',
                    'garamond' => 'Garamond, "EB Garamond", Georgia, serif',
                    'verdana' => 'Verdana, sans-serif',
                    default => null,
                };
                if ($font) $styles[] = 'font-family: '.$font;
                $size = $child->getAttribute('data-size');
                if (ctype_digit($size) && in_array($size, self::SIZES, true)) $styles[] = 'font-size: '.$size.'pt';
                if ($child->hasAttribute('data-color')) $styles[] = 'color: '.$child->getAttribute('data-color');
                if ($styles) $child->setAttribute('style', implode('; ', $styles));
            }
            if ($tag === 'IMG' && !$child->hasAttribute('src')) { $child->parentNode?->removeChild($child); continue; }
            self::clean($child);
        }
    }

    private static function safeLink(string $value): bool
    {
        return !preg_match('/[\x00-\x20]/', $value) && (bool) preg_match('~^(https?://[^/\s]+|mailto:[^\s@]+@[^\s@]+|#[\w-]+)~i', $value);
    }

    private static function safeBlockStyle(string $value): string
    {
        $styles = [];
        foreach (explode(';', $value) as $declaration) {
            [$name, $setting] = array_pad(explode(':', $declaration, 2), 2, '');
            $name = strtolower(trim($name)); $setting = strtolower(trim($setting));
            if ($name === 'text-align' && in_array($setting, ['left', 'center', 'right', 'justify'], true)) $styles[$name] = $setting;
        }
        return implode('; ', array_map(fn ($name) => $name.': '.$styles[$name], array_keys($styles)));
    }

    public static function validateImages(string $html, string $documentId): void
    {
        preg_match_all('~src="(/api/documents/([a-f0-9-]{36})/images/([a-f0-9-]{36}))"~', $html, $matches, PREG_SET_ORDER);
        if (!$matches) return;
        $images = DocumentImage::where('document_id', $documentId)->whereIn('id', array_column($matches, 3))->pluck('id')->all();
        foreach ($matches as $match) if ($match[2] !== $documentId || !in_array($match[3], $images, true)) {
            throw ValidationException::withMessages(['content_html' => 'Una imagen no pertenece a este documento.']);
        }
    }

    public static function text(string $html): string
    {
        $separated = preg_replace('~<(?:br|hr)\b[^>]*>|</(?:p|div|h[1-3]|li|td|th|tr|blockquote)>~i', ' ', $html) ?? $html;
        return trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($separated), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
    }

    public static function wordCount(string $text): int
    {
        if ($text === '') return 0;
        preg_match_all('/[\p{L}\p{N}][\p{L}\p{N}\p{M}\'’_-]*/u', $text, $matches);
        return count($matches[0]);
    }
}
