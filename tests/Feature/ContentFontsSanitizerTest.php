<?php

namespace Tests\Feature;

use App\Support\DocumentSanitizer;
use PHPUnit\Framework\TestCase;

final class ContentFontsSanitizerTest extends TestCase
{
    public function test_catalog_roundtrip_is_literal_and_idempotent(): void
    {
        foreach (['literata', 'inter', 'ibmplexmono'] as $font) {
            $html = '<p data-content-font="literata" data-indent="2" data-line-height="2"><mark data-origin="paste"><span data-font="'.$font.'" data-size="16" data-color="#785191"><strong><em>á génesis</em></strong></span></mark><span data-provenance="paste-edited">ñ</span><br></p><p></p>';
            $saved = DocumentSanitizer::html($html);
            self::assertSame($saved, DocumentSanitizer::html($saved));
            foreach (['data-font="'.$font.'"', 'data-content-font="literata"', 'data-origin="paste"', 'data-provenance="paste-edited"', 'á génesis', '<strong><em>', '<br>', '<p></p>', 'data-size="16"', 'data-color="#785191"'] as $literal) self::assertStringContainsString($literal, $saved);
        }
    }

    public function test_untrusted_css_and_ids_are_removed_without_converting_legacy(): void
    {
        $saved = DocumentSanitizer::html('<p data-content-font="invented" style="background:url(https://example.test);text-align:right" onclick="bad()"><span data-font="invented" style="font-family:evil;background:url(x)" onmouseover="bad()">ñ</span></p>');
        foreach (['invented', 'url(', 'onclick', 'onmouseover', 'font-family'] as $bad) self::assertStringNotContainsString($bad, $saved);
        self::assertSame($saved, DocumentSanitizer::html($saved));
        self::assertSame('<p>viejo</p>', DocumentSanitizer::html('<p>viejo</p>'));
        self::assertStringContainsString('data-font="georgia"', DocumentSanitizer::html('<p><span data-font="georgia">viejo</span></p>'));
    }
}
