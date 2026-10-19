import { CONTENT_FONTS, contentFont } from './contentFonts';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
// URLs are bundled assets. Fetch only families used in this PDF, inside its cancelable Worker.
const assets = import.meta.glob('../fonts/content/*.ttf', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export async function loadPdfContentFonts(definition: TDocumentDefinitions) {
  const used = new Set<string>(['literata']); // ficha/footer/warnings
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'font' && typeof item === 'string') used.add(item);
      else if (item && typeof item === 'object') visit(item);
    }
  };
  visit(definition.content);
  const vfs: Record<string, string> = {};
  const fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }> = {};
  for (const id of used) {
    if (!contentFont(id)) throw new Error('Unsupported content font');
    const entry = CONTENT_FONTS[id as keyof typeof CONTENT_FONTS];
    fonts[id] = { normal: '', bold: '', italics: '', bolditalics: '' };
    // Sequential: avoid twelve concurrent ArrayBuffers/base64 conversions on small devices.
    for (const [slot, variant] of Object.entries(entry.variants)) {
      const response = await fetch(assets[`../fonts/content/${variant.file}`]);
      if (!response.ok) throw new Error('Content font unavailable');
      const buffer = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== variant.sha256) throw new Error('Content font integrity');
      const bytes = new Uint8Array(buffer); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      vfs[variant.file] = btoa(binary);
      fonts[id][slot as keyof typeof fonts[string]] = variant.file;
    }
  }
  return { fonts, vfs };
}
