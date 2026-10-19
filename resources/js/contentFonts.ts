import catalog from '../fonts/content/catalog.json';
/** Stable explicit content IDs; legacy IDs retain their previous meaning. */
export const CONTENT_FONTS = catalog;
export type ContentFontId = keyof typeof catalog;
export function contentFont(id: string) {
  return Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id as ContentFontId] : undefined;
}
export function supportsText(font: string, bold: boolean, italic: boolean, text: string): boolean {
  const entry = contentFont(font);
  if (!entry) return false;
  const variant = entry.variants[bold ? (italic ? 'bolditalics' : 'bold') : (italic ? 'italics' : 'normal')];
  return [...text].every(c => /[\n\r\t]/.test(c) || variant.coverage.some(([a, b]) => c.codePointAt(0)! >= a && c.codePointAt(0)! <= b));
}

/** pdfmake multiplies the font ascender/descender box, CSS uses the em size. */
export function pdfLineHeight(font: string, bold: boolean, italic: boolean, cssFactor: number): number {
  const entry = contentFont(font);
  if (!entry) throw new Error('Unsupported content font');
  return cssFactor / entry.variants[bold ? (italic ? 'bolditalics' : 'bold') : (italic ? 'italics' : 'normal')].lineMetric;
}
