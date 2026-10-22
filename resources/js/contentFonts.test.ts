// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONTENT_FONTS, supportsText, pdfLineHeight } from './contentFonts';
import { sealedDefinition, PdfFontUnsupported } from './sealedPdf';
const source = { version_id: 'synthetic', version_number: 1, snapshot_html: '<p>test</p>', page_settings: null, certificate_code: 'VRT-SYNTHETIC', issued_at: null, format_version: 3 as const, public_url: 'https://example.test/verify/VRT-SYNTHETIC', images: {} };
describe('verified content typography', () => {
 it('ships twelve distinct hashes, authentic weight/style metadata and generated CSS/PHP adapters', () => {
  const hashes = new Set<string>();
  const css = readFileSync('resources/fonts/content/catalog.css', 'utf8');
  const php = readFileSync('app/Support/ContentFonts.php', 'utf8');
  for (const [id, font] of Object.entries(CONTENT_FONTS)) {
   expect(php).toContain(`'${id}' => '${font.css}'`);
   for (const [slot, v] of Object.entries(font.variants)) {
    const bytes = readFileSync(`resources/fonts/content/${v.file}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(v.sha256);
    expect(v.weight).toBe(slot.startsWith('bold') ? 700 : 400); expect(v.italic).toBe(slot.endsWith('italics'));
    expect(css).toContain(`url("./${v.woff2}")`); hashes.add(v.sha256);
    expect(supportsText(id, v.weight === 700, v.italic, 'ñ ü ¿ ¡ € á ge\u0301nesis')).toBe(true);
   }
  }
  expect(hashes.size).toBe(12);
 });
 it.each(Object.keys(CONTENT_FONTS))('preserves four variants and literal Unicode in %s', id => {
  const definition = sealedDefinition({ ...source, snapshot_html: `<p><span data-font="${id}">á ge\u0301nesis <b>B</b> <i>I</i> <b><i>BI</i></b></span></p>` });
  const json = JSON.stringify(definition); expect(json).toContain(`"font":"${id}"`); expect(json).toContain('"bold":true,"italics":true'); expect(json).toContain('génesis'); expect(json).not.toContain('Roboto');
 });
 it.each(['georgia','serif','sans','mono','selectric','arial','untrusted'])('refuses silently substituting legacy/unknown %s', font => {
  expect(() => sealedDefinition({ ...source, snapshot_html: `<p><span data-font="${font}">x</span></p>` })).toThrow(PdfFontUnsupported);
 });
 it('rejects missing glyphs and arbitrary font CSS', () => {
  expect(() => sealedDefinition({ ...source, snapshot_html: '<p><span data-font="ibmplexmono">Ω</span></p>' })).toThrow(PdfFontUnsupported);
  expect(() => sealedDefinition({ ...source, snapshot_html: '<p>🦄</p>' })).toThrow(PdfFontUnsupported);
  expect(() => sealedDefinition({ ...source, snapshot_html: '<p style="font-family: Georgia">x</p>' })).toThrow(PdfFontUnsupported);
 });
 it('keeps quote structure, vector layout, inherited family/color, exact indent and cloneable Worker payload', () => {
  const def = sealedDefinition({ ...source, snapshot_html: '<blockquote><p><span data-font="inter">uno <b>dos</b></span></p><p>tres</p></blockquote><p data-indent="2"><u><s>both</s></u></p>' });
  expect(JSON.stringify(structuredClone(def))).toContain('contentQuote');
  const json = JSON.stringify(def); expect(json).toContain('#56615d'); expect(json).toContain('"underline","lineThrough"'); expect(json).toContain(String(10 * 72 / 25.4));
 });
 it('converts CSS line height from em units to each font metric box', () => {
  for (const [id,e] of Object.entries(CONTENT_FONTS)) for (const v of Object.values(e.variants)) expect(pdfLineHeight(id,v.weight===700,v.italic,1.5)*v.lineMetric*12).toBeCloseTo(18);
 });
 it('labels every export as reconstruction instead of attributing a profile to historical seals', () => {
  expect(JSON.stringify(sealedDefinition(source))).toContain('apariencia histórica no acreditada');
  expect(JSON.stringify(sealedDefinition(source, true))).toContain('historical appearance not accredited');
 });
});
