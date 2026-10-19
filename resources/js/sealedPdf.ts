import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { PageSettings } from './types';
import { DEFAULT_PAGE, PAGE_FORMATS } from './pageLayout';
import { contentFont, supportsText, pdfLineHeight } from './contentFonts';

export type PdfSource = {
  version_id: string; version_number: number; snapshot_html: string; page_settings: PageSettings | null;
  certificate_code: string; issued_at: string | null; format_version: 2 | 3 | null;
  share?: { url: string; level: 1 | 2 | 3; expires_at: string };
  public_url: string; images: Record<string, string>;
};
export class PdfUnsupported extends Error {}
export class PdfFontUnsupported extends PdfUnsupported {}
const reject = (): never => { throw new PdfUnsupported('Unsupported sealed PDF content'); };
const allowed = new Set('P DIV BR STRONG B EM I U S DEL SUB SUP H1 H2 H3 UL OL LI BLOCKQUOTE MARK SPAN A IMG HR TABLE TBODY THEAD TR TH TD'.split(' '));

export const HISTORICAL_FONTS: Record<string, { target: string; css: string }> = {
  serif: { target: 'literata', css: 'Georgia, "Times New Roman", serif' },
  georgia: { target: 'literata', css: 'Georgia, "Times New Roman", serif' },
  times: { target: 'literata', css: '"Times New Roman", Times, serif' },
  garamond: { target: 'literata', css: 'Garamond, "EB Garamond", Georgia, serif' },
  selectric: { target: 'literata', css: '"InkGroove Type Clean", Georgia, serif' },
  sans: { target: 'inter', css: 'Arial, Helvetica, sans-serif' },
  arial: { target: 'inter', css: 'Arial, Helvetica, sans-serif' },
  verdana: { target: 'inter', css: 'Verdana, sans-serif' },
  mono: { target: 'ibmplexmono', css: '"Courier New", monospace' },
  courier: { target: 'ibmplexmono', css: '"Courier New", monospace' },
};
export type PdfPolicy = 'strict' | 'historical';
/** Parse inertly; no insertion into the live DOM, no resource fetching or HTML rendering. */
export function sealedDefinition(source: PdfSource, english = false, policy: PdfPolicy = 'strict'): TDocumentDefinitions {
  if (!source.snapshot_html || new TextEncoder().encode(source.snapshot_html).length > 250000) reject();
  if (!/^VRT-[A-Z0-9]{1,64}$/.test(source.certificate_code)) reject();
  const url = new URL(source.public_url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== `/verify/${source.certificate_code}`) reject();
  const share = source.share;
  if (share) {
    const link = new URL(share.url);
    if (link.origin !== url.origin || link.pathname !== '/process-summary/share' || link.search || link.username || link.password
      || !/^#token=[A-Za-z0-9_-]{43}$/.test(link.hash) || ![1, 2, 3].includes(share.level) || !Number.isFinite(Date.parse(share.expires_at))) reject();
  }
  const consultationUrl = share?.url ?? source.public_url;
  const settings = source.page_settings ?? DEFAULT_PAGE;
  if (!(settings.format in PAGE_FORMATS) || !['portrait', 'landscape'].includes(settings.orientation) || ![15, 20, 25, 30].includes(settings.margin)) reject();
  const dimensions = PAGE_FORMATS[settings.format];
  const availableWidth = ((settings.orientation === 'landscape' ? dimensions.height : dimensions.width) - settings.margin * 2) * 72 / 25.4;
  const availableHeight = ((settings.orientation === 'landscape' ? dimensions.width : dimensions.height) - settings.margin * 2) * 72 / 25.4;
  const root = document.createElement('template'); root.innerHTML = source.snapshot_html;
  const nodes = root.content.querySelectorAll('*');
  if (nodes.length > 5000) reject();
  for (const el of nodes) {
    if (['TD', 'TH'].includes(el.tagName) && (el.hasAttribute('data-indent') || el.hasAttribute('data-line-height'))) reject();
    if (!allowed.has(el.tagName)) reject();
    // Discard event handlers only on this inert, derived PDF tree. Never mutate the seal.
    for (const attribute of [...el.attributes]) {
      if (attribute.name.startsWith('on')) el.removeAttribute(attribute.name);
    }
    if ((el.hasAttribute('colspan') && el.getAttribute('colspan') !== '1') || (el.hasAttribute('rowspan') && el.getAttribute('rowspan') !== '1')) reject();
  }
  const substitutions = new Set<string>();
  const fontError = () => { throw new PdfFontUnsupported(english ? 'Content font unavailable or missing glyphs. Historical appearance cannot be accredited.' : 'Fuente de contenido no disponible o sin glifos. No se puede acreditar la apariencia histórica.'); };
  const inheritedStyle = (node: Element, style: Partial<ContentText>) => {
    const s = { ...style };
    const alignment = (node as HTMLElement).style?.textAlign;
    if (alignment && ['left', 'right', 'center', 'justify'].includes(alignment)) s.alignment = alignment as ContentText['alignment'];
    const baseFont = node.getAttribute('data-content-font');
    if (baseFont) { if (baseFont !== 'literata') fontError(); s.font = baseFont; }
    const font = node.getAttribute('data-font');
    const legacy = font && Object.prototype.hasOwnProperty.call(HISTORICAL_FONTS, font) ? HISTORICAL_FONTS[font] : undefined;
    if (font) {
      if (contentFont(font)) s.font = font;
      else if (policy === 'historical' && legacy) {
        s.font = legacy.target; substitutions.add(`${font} → ${contentFont(legacy.target)!.label}`);
      } else fontError();
    }
    const cssFont = (node as HTMLElement).style?.fontFamily;
    const normalize = (value: string) => value.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    const expected = legacy && policy === 'historical' ? legacy.css : contentFont(font ?? '')?.label;
    if (cssFont && (!expected || normalize(cssFont) !== normalize(expected))) fontError();
    const color = node.getAttribute('data-color'); if (color && /^#[a-f0-9]{6}$/i.test(color)) s.color = color;
    const size = node.getAttribute('data-size');
    if (size) { if (!/^\d+$/.test(size) || +size < 8 || +size > 72) reject(); s.fontSize = +size; }
    return s;
  };
  const inline = (node: Node, style: Partial<ContentText> = {}): ContentText[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!supportsText(style.font ?? 'literata', !!style.bold, !!style.italics, text)) fontError();
      return [{ text, ...style, lineHeight: pdfLineHeight(style.font ?? 'literata', !!style.bold, !!style.italics, style.lineHeight ?? 1.5) }];
    }
    if (!(node instanceof Element)) return [];
    if (node.tagName === 'BR') return [{ text: '\n', ...style, lineHeight: pdfLineHeight(style.font ?? 'literata', !!style.bold, !!style.italics, style.lineHeight ?? 1.5) }];
    if (node.tagName === 'IMG') reject(); // Block images handled below; inline image layout is unsupported.
    const s = inheritedStyle(node, style);
    if (['STRONG', 'B'].includes(node.tagName)) s.bold = true;
    if (['EM', 'I'].includes(node.tagName)) s.italics = true;
    const decorations = Array.isArray(s.decoration) ? [...s.decoration] : s.decoration ? [s.decoration] : [];
    if (node.tagName === 'U') decorations.push('underline');
    if (['S', 'DEL'].includes(node.tagName)) decorations.push('lineThrough');
    if (decorations.length) s.decoration = decorations;
    if (['SUB', 'SUP'].includes(node.tagName)) reject();
    if (node.tagName === 'A') { s.color = '#29658b'; s.decoration = [...decorations, 'underline']; }
    // Links are text only: private/internal hyperlinks and user tokens never become PDF annotations.
    return [...node.childNodes].flatMap(n => inline(n, s));
  };
  const pdfImages: Record<string, string> = {};
  const imageKeys = new Map<string, string>();
  const block = (node: Node, inherited: Partial<ContentText> = {}): Content[] => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ? [{ ...inherited, text: inline(node, inherited), preserveLeadingSpaces: true }] : [];
    if (!(node instanceof HTMLElement)) return [];
    const tag = node.tagName;
    const style = inheritedStyle(node, inherited);
    const children = (parent: Node, extra = style) => [...parent.childNodes].flatMap(n => block(n, extra));
    if (tag === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      const data = source.images[src];
      if (!data || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)) reject();
      // Clone each bitmap only once, even if the snapshot repeats the same image.
      if (!imageKeys.has(src)) { const key = `sealedImage${imageKeys.size}`; imageKeys.set(src, key); pdfImages[key] = data; }
      const width = Math.min(availableWidth, Math.max(1, Number(node.getAttribute('width') || availableWidth / .75)) * .75);
      return [{ image: imageKeys.get(src)!, fit: [width, availableHeight], margin: [0, 4, 0, 4] }];
    }
    if (tag === 'DIV' && node.getAttribute('data-page-break') === 'true') return [{ text: ' ', pageBreak: 'after' }];
    if (tag === 'BLOCKQUOTE' && node.querySelector('blockquote')) reject();
    if (['TD', 'TH'].includes(tag) && (node.hasAttribute('data-indent') || node.hasAttribute('data-line-height'))) reject();
    if (tag === 'BLOCKQUOTE') return [{
      table: { widths: ['*'], body: [[{ stack: children(node, { ...style, color: '#56615d' }), border: [true, false, false, false] }]], dontBreakRows: false },
      layout: 'contentQuote',
      margin: [30, 12, 30, 12],
    }];
    if (tag === 'DIV') return children(node);
    if (tag === 'TABLE') {
      const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].map(cell => ({ stack: children(cell, inheritedStyle(cell, { ...style, bold: cell.tagName === 'TH' })), fillColor: cell.tagName === 'TH' ? '#edf3ec' : undefined })));
      if (!rows.length || !rows[0].length || rows[0].length > 20 || rows.some(r => r.length !== rows[0].length)) reject();
      if (node.querySelector('[colwidth]')) reject(); // Resized/merged tables need a separate layout contract.
      return [{ table: { widths: rows[0].map(() => '*'), body: rows }, margin: [0, 12, 0, 12],
        layout: 'contentTable' }];
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = [...node.children].map(el => ({ stack: children(el) }));
      if (node.children.length === 0 || [...node.children].some(el => el.tagName !== 'LI')) reject();
      return tag === 'UL' ? [{ ul: items }] : [{ ol: items, start: Number(node.getAttribute('start') || 1) }];
    }
    if (tag === 'HR') return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: availableWidth, y2: 0, lineWidth: .75, lineColor: '#bac7b9' }], margin: [0, 15, 0, 15] }];
    if (node.querySelector('img')) {
      if (node.children.length === 1 && node.firstElementChild?.tagName === 'IMG' && !node.textContent?.trim()) return block(node.firstElementChild);
      reject();
    }
    if (node.querySelector('p,table,ul,ol,div')) return children(node);
    const heading = /^H[1-3]$/.test(tag);
    const textStyle = heading ? { ...style, bold: true, fontSize: tag === 'H1' ? 24 : tag === 'H2' ? 18 : 14 } : style;
    const alignment = node.style.textAlign;
    const indent = Number(node.getAttribute('data-indent') || 0);
    const lineHeight = Number(node.getAttribute('data-line-height') || (heading ? 1.2 : 1.5));
    const runs = inline(node, { ...textStyle, lineHeight });
    const empty = runs.every(r => !String(r.text).length);
    return [{ ...textStyle, text: empty ? ' ' : runs, preserveLeadingSpaces: true,
      ...( ['left', 'right', 'center', 'justify'].includes(alignment) ? { alignment: alignment as ContentText['alignment'] } : {}),
      lineHeight: pdfLineHeight(textStyle.font ?? 'literata', !!textStyle.bold, !!textStyle.italics, lineHeight),
      margin: [Math.min(6, Math.max(0, indent)) * 5 * 72 / 25.4, 0, 0, heading ? 12 : 6],
    }];
  };
  const scope = source.format_version === 3
    ? (english ? 'Seal v3. Full process verification requires the authenticated service; it is not performed by this PDF or QR.' : 'Sello v3. La verificación integral requiere el servicio autenticado; este PDF y el QR no la realizan.')
    : (english ? 'Historical/v2 seal: limited scope; no claim of full process verification.' : 'Sello histórico/v2: alcance limitado; no acredita verificación integral del proceso.');
  const body = [...root.content.childNodes].flatMap(n => block(n));
  if (policy === 'historical' && !substitutions.size) fontError();
  return {
    pageSize: settings.format.toUpperCase() as TDocumentDefinitions['pageSize'], pageOrientation: settings.orientation,
    pageMargins: Array(4).fill(settings.margin * 72 / 25.4) as [number, number, number, number],
    // Disable glyph composition/ligatures so ToUnicode preserves NFC and NFD separately.
    // fontkit supports feature objects; pdfmake's declaration only lists arrays.
    defaultStyle: { font: 'literata', fontSize: 12, color: '#17231f', lineHeight: pdfLineHeight('literata', false, false, 1.5), fontFeatures: { ccmp: false, liga: false, clig: false } as unknown as ContentText['fontFeatures'] },
    images: pdfImages,
    info: { title: 'InkGroove', author: '', subject: '', keywords: '', creator: 'InkGroove' },
    content: [
      { text: english ? 'Reconstructed presentation · historical appearance not accredited. Unmarked text uses Literata. Provenance is rendered as plain text.' : 'Presentación reconstruida · apariencia histórica no acreditada. Texto sin fuente explícita: Literata. La procedencia se representa como texto sin decoración.', fontSize: 9, color: '#56615d', margin: [0, 0, 0, 12] },
      ...(policy === 'historical' ? [{ text: (english ? 'Historical PDF · approximate presentation' : 'PDF histórico · presentación aproximada') + '\n' + [...substitutions].sort().join('; '), fontSize: 11, margin: [0, 0, 0, 12] as [number, number, number, number] }] : []),
      ...body,
      { text: english ? 'Sealed version' : 'Versión sellada', pageBreak: 'before', fontSize: 16, bold: true },
      { text: `${source.certificate_code} · ${english ? 'Version' : 'Versión'} ${source.version_number}`, margin: [0, 12, 0, 8] },
      { text: source.issued_at ?? (english ? 'Date unavailable' : 'Fecha no disponible') },
      { text: scope, margin: [0, 12, 0, 8] },
      { text: share ? (english ? `Forwardable bearer QR · fixed level ${share.level} · expires ${share.expires_at}. Level 3 requires a web account and the selected audience. Revocation affects this grant; it does not invalidate the seal or remove downloaded copies.` : `QR portador reenviable · nivel fijo ${share.level} · caduca ${share.expires_at}. Nivel 3 exige cuenta web y la audiencia elegida. Revocar afecta esta concesión; no invalida el sello ni retira copias descargadas.`) : english ? 'The QR only checks the stored payload HMAC. It does not evaluate revocation, civil identity, human authorship or AI use. It is not a qualified electronic signature.' : 'El QR sólo comprueba el HMAC del payload almacenado. No evalúa revocación, identidad civil, autoría humana o uso de IA. No es una firma electrónica cualificada.', margin: [0, 0, 0, 12] },
      { text: english ? 'The PDF has no cryptographic signature of its own. The QR does not verify the bytes of this file.' : 'El PDF no incorpora una firma criptográfica propia. El QR no verifica los bytes de este archivo.', fontSize: 9, margin: [0, 0, 0, 12] },
      { text: consultationUrl, link: consultationUrl, fontSize: 9, margin: [0, 0, 0, 18] },
      { qr: consultationUrl, fit: 120, eccLevel: 'M' },
    ],
  };
}

export async function preparePdfImages(source: PdfSource): Promise<PdfSource> {
  const images: Record<string, string> = {}; let total = 0;
  for (const [key, data] of Object.entries(source.images)) {
    total += data.length;
    if (total > 12 * 1024 * 1024 || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) reject();
    // JPEG is rasterized to PNG so EXIF/GPS/private filenames never enter PDF objects.
    // PNG embedding in pdfkit uses pixel streams rather than ancillary metadata chunks.
    if (/^data:image\/png;/.test(data)) { images[key] = data; continue; }
    const image = new Image(); image.src = data; await image.decode();
    if (image.width * image.height > 12000000) reject();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); if (!context) return reject();
    context.drawImage(image, 0, 0); images[key] = canvas.toDataURL('image/png');
  }
  if (Object.values(images).reduce((bytes, data) => bytes + data.length, 0) > 12 * 1024 * 1024) reject();
  return { ...source, images };
}
