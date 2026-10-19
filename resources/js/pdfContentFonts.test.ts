// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadPdfContentFonts } from './pdfContentFonts';
import { CONTENT_FONTS } from './contentFonts';
afterEach(() => vi.unstubAllGlobals());
it('loads only used families, verifies bytes and registers all four real binaries without Roboto VFS', async () => {
 const calls: string[] = [];
 vi.stubGlobal('fetch', async (url: string) => {
  calls.push(url);
  const filename = decodeURI(url).split('/').pop()!;
  const b = readFileSync(`resources/fonts/content/${filename}`);
  return new Response(b);
 });
 const result = await loadPdfContentFonts({ content: [{ text: [{ text: 'sample', font: 'inter', bold: true, italics: true }] }] });
 expect(calls).toHaveLength(8); expect(Object.keys(result.fonts)).toEqual(['literata', 'inter']);
 for (const id of ['literata', 'inter'] as const) for (const [slot, v] of Object.entries(CONTENT_FONTS[id].variants)) {
  expect(result.fonts[id][slot as 'normal']).toBe(v.file); expect(result.vfs[v.file]).toBe(readFileSync(`resources/fonts/content/${v.file}`).toString('base64'));
 }
 expect(JSON.stringify(result.fonts)).not.toContain('Roboto');
});
it('fails on missing or corrupted font assets', async () => {
 vi.stubGlobal('fetch', async () => new Response('corrupted'));
 await expect(loadPdfContentFonts({ content: [] })).rejects.toThrow('integrity');
 vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
 await expect(loadPdfContentFonts({ content: [] })).rejects.toThrow('unavailable');
});
