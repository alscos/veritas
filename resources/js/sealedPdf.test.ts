// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sealedDefinition, preparePdfImages, PdfUnsupported, type PdfSource } from './sealedPdf';
const source: PdfSource = { version_id: 'version-test', version_number: 2, snapshot_html: '<h1>Título</h1><p>á ge\u0301nesis ñ ü ¿ ¡ € Ω <strong>negrita</strong><br>uno<br><br>dos<br><br><br><br><br>cinco</p><p></p><ul><li>Lista</li></ul><table><tr><th>Uno</th><th>Dos</th></tr><tr><td>A</td><td>B</td></tr></table>', page_settings: null, certificate_code: 'VRT-RENDERTESTUNSIGNED', issued_at: null, format_version: 2, public_url: 'https://example.test/verify/VRT-RENDERTESTUNSIGNED', images: {} };
describe('sealed PDF definition', () => {
 it('preserves raw Unicode, hard breaks, blanks, lists, tables and exact QR URL', () => {
  const definition = sealedDefinition(source);
  const json = JSON.stringify(definition);
  expect(json).toContain('génesis'); expect(json).toContain('á'); expect(json).toContain('"text":"\\n"');
  expect(json).toContain('"text":" "'); expect(json).toContain('"ul"'); expect(json).toContain('"table"');
  expect(json).toContain(`"qr":"${source.public_url}"`); expect(json).not.toContain('complete');
 });
 it('preserves paragraphs made entirely of hard breaks', () => {
  const definition = sealedDefinition({ ...source, snapshot_html: '<p><br><br><br></p>' });
  expect(JSON.stringify(definition.content).match(/\"text\":\"\\n\"/g)).toHaveLength(3);
 });
 it('shares bitmap data once for repeated images without carrying private URLs into the definition', () => {
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  const result = sealedDefinition({ ...source, snapshot_html: '<img src=\"/private/test\"><img src=\"/private/test\">', images: { '/private/test': data } });
  expect(Object.keys(result.images ?? {})).toHaveLength(1);
  expect(JSON.stringify(result).split(data)).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('/private/test');
 });
 it('rejects raw JPEG before metadata-safe preparation instead of embedding EXIF bytes', () => {
  expect(() => sealedDefinition({ ...source, snapshot_html: '<img src=\"/private/test\">', images: { '/private/test': 'data:image/jpeg;base64,/9j/' } })).toThrow(PdfUnsupported);
 });
 it('uses immutable source and distinguishes v2/v3 scope in ES/EN', () => {
  expect(JSON.stringify(sealedDefinition(source))).toContain('alcance limitado');
  expect(JSON.stringify(sealedDefinition({ ...source, format_version: 3 }, true))).toContain('authenticated service');
  expect(JSON.stringify(sealedDefinition(source))).not.toContain('snapshot_html');
 });
 it.each(['', '<script>alert(1)</script>', '<iframe src="https://example.test"></iframe>', '<table><tr><td colspan="2">a</td></tr></table>', '<p><sub>x</sub></p>', '<img src="https://example.test/a.png">'])('fails closed on unsupported/hostile HTML: %s', snapshot_html => {
  expect(() => sealedDefinition({ ...source, snapshot_html })).toThrow(PdfUnsupported);
 });
 it.each(['https://evil.test/verify/OTHER', 'https://a.test/verify/VRT-RENDERTESTUNSIGNED?token=x', 'https://user:pass@a.test/verify/VRT-RENDERTESTUNSIGNED'])('rejects mutable/token URLs', public_url => expect(() => sealedDefinition({ ...source, public_url })).toThrow());
 it('does not export user hyperlinks or image internal URLs', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const result = sealedDefinition({ ...source, snapshot_html: '<p><a href="https://a.test/?token=secret">Label</a></p><img src="/private/test">', images: { '/private/test': image } });
  expect(JSON.stringify(result)).not.toContain('/private/test'); expect(JSON.stringify(result)).not.toContain('secret');
 });
 it('bounds HTML, nodes, image bytes and rejects remote image data without fetching', async () => {
  expect(() => sealedDefinition({ ...source, snapshot_html: '<p>'+ 'a'.repeat(250001) +'</p>' })).toThrow();
  expect(() => sealedDefinition({ ...source, snapshot_html: '<p>a</p>'.repeat(5001) })).toThrow();
  await expect(preparePdfImages({ ...source, images: { x: 'https://example.test/private' } })).rejects.toThrow();
  await expect(preparePdfImages({ ...source, images: { x: 'data:image/png;base64,'+'A'.repeat(13000000) } })).rejects.toThrow();
 });
});
it('uses the persisted new block base without changing the sealed source', () => {
 const snapshot_html = '<p data-content-font="literata">á génesis <b><i>dos</i></b></p><p data-content-font="literata"></p>';
 const sealed = { ...source, snapshot_html }; const before = JSON.stringify(sealed);
 const result = JSON.stringify(sealedDefinition(sealed)); expect(result).toContain('"font":"literata"'); expect(result).toContain('"bold":true'); expect(result).toContain('"italics":true'); expect(JSON.stringify(sealed)).toBe(before);
});
it.each(['<blockquote><blockquote><p>nested</p></blockquote></blockquote>', '<table><tr><td data-indent="2"><p>indent</p></td></tr></table>', '<table><tr><td data-line-height="2"><p>spacing</p></td></tr></table>', '<p data-content-font="invented">bad</p>'])('explicitly rejects unrepresented layout or base: %s', snapshot_html => {
 expect(() => sealedDefinition({ ...source, snapshot_html })).toThrow(PdfUnsupported);
});
