import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import inkwell from '../brand/InkGroove-logo-tinta-naranja.svg?raw';
import type { PageSettings } from './types';
import { DEFAULT_PAGE, PAGE_FORMATS } from './pageLayout';
import { contentFont, supportsText, pdfLineHeight } from './contentFonts';

export type PdfSource = {
  document_title?: string;
  version_id: string; version_number: number; snapshot_html: string; page_settings: PageSettings | null;
  certificate_code: string; issued_at: string | null; format_version: 2 | 3 | null;
  share?: { url: string; level: 1 | 2 | 3; expires_at: string | null };
  title_at_issue?: string | null;
  historical_counts?: { state: string; value: { direct: number; pasted: number; edited: number; total: number } | null; source: string | null; reason: string | null };
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
  if ([source.document_title, source.title_at_issue].some(title => title && !supportsText('literata', false, false, title))) throw new PdfFontUnsupported('Unsupported title glyph');
  const share = source.share;
  // M3.4E: owner-selected full PDF is separate from the public QR evidence.
  if (share) {
    const link = new URL(share.url);
    if (link.origin !== url.origin || link.pathname !== '/process-summary/share' || link.search || link.username || link.password
      || !/^#token=[A-Za-z0-9_-]{43}$/.test(link.hash) || ![1, 2, 3].includes(share.level) || (share.expires_at !== null && !Number.isFinite(Date.parse(share.expires_at)))) reject();
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
    if (node.tagName === 'MARK' && node.getAttribute('data-origin') === 'paste') { s.color = '#8a3b00'; s.background = '#ffeddb'; }
    if (node.tagName === 'MARK' && node.getAttribute('data-origin') === 'paste-edited') { s.color = '#1554aa'; s.background = '#e0edff'; }
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
    defaultStyle: { font: 'literata', fontSize: 12, color: '#12352d', lineHeight: pdfLineHeight('literata', false, false, 1.25), fontFeatures: { ccmp: false, liga: false, clig: false } as unknown as ContentText['fontFeatures'] },
    images: pdfImages,
    info: { title: 'InkGroove', author: '', subject: '', keywords: '', creator: 'InkGroove' },
    background: { canvas: [{ type: 'rect', x: 0, y: 0, w: (settings.orientation === 'landscape' ? dimensions.height : dimensions.width) * 72 / 25.4, h: (settings.orientation === 'landscape' ? dimensions.width : dimensions.height) * 72 / 25.4, color: '#fffefb' }] },
    content: [
      { svg: inkwell.replace(/<\?xml[^>]*>/, ''), width: Math.min(160, availableWidth), margin: [0, 0, 0, 10] },
      { text: english ? 'Sealed version record' : 'Constancia de versión sellada', fontSize: 16, bold: true, margin: [0, 0, 0, 8] },
      { text: source.title_at_issue ?? source.document_title ?? (english ? 'Historical title unavailable' : 'Título histórico no disponible'), fontSize: 20, margin: [0, 0, 0, 8] },
      { text: source.title_at_issue != null ? (english ? 'Title fixed at issue; outside the original seal.' : 'Título fijado a la emisión; ajeno al sello original.') : source.document_title ? (english ? 'Current title supplied by the owner; historical title not certified.' : 'Título actual aportado por el propietario; no se certifica el título histórico.') : '', fontSize: 9 },
      { text: `${english ? 'Version' : 'Versión'} ${source.version_number} · ${source.certificate_code}`, bold: true, margin: [0, 10, 0, 6] },
      { text: `${english ? 'Sealed' : 'Sellado'}: ${source.issued_at ? new Date(source.issued_at).toLocaleString(english ? 'en-GB' : 'es-ES', { timeZone: 'UTC' }) + ' UTC' : (english ? 'Date unavailable' : 'Fecha no disponible')}${share ? ` · ${english ? 'Level' : 'Nivel'} ${share.level} · ${share.expires_at === null ? (english ? 'Never expires automatically' : 'Nunca caduca automáticamente') : (english ? 'Expires' : 'Caduca') + ': ' + new Date(share.expires_at).toLocaleString(english ? 'en-GB' : 'es-ES', { timeZone: 'UTC' }) + ' UTC'}` : ''}`, fontSize: 10, margin: [0, 0, 0, 8] },
      { text: scope, fontSize: 9, margin: [0, 0, 0, 8] },
      ...(share?.level === 2 ? countPanel(source, english) : []),
      { text: english ? 'Reconstructed presentation; historical appearance not accredited. Recorded paste: orange; edited paste: blue. Unmarked text: Literata.' : 'Presentación reconstruida; apariencia histórica no acreditada. Pegado registrado: naranja; reelaborado: azul. Texto sin fuente explícita: Literata.', fontSize: 9, color: '#56615d', margin: [0, 0, 0, 10] },
      ...(policy === 'historical' ? [{ text: (english ? 'Historical PDF · approximate presentation' : 'PDF histórico · presentación aproximada') + '\n' + [...substitutions].sort().join('; '), fontSize: 9, margin: [0, 0, 0, 10] as [number, number, number, number] }] : []),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: availableWidth, y2: 0, lineWidth: 1, lineColor: '#12352d' }], margin: [0, 10, 0, 5] },
      { text: english ? 'START OF DOCUMENT' : 'INICIO DEL DOCUMENTO', bold: true, fontSize: 9, color: '#12352d', margin: [0, 0, 0, 12] },
      ...body,
      { text: english ? 'END OF DOCUMENT' : 'FIN DEL DOCUMENTO', bold: true, fontSize: 9, color: '#12352d', margin: [0, 8, 0, 5] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: availableWidth, y2: 0, lineWidth: 1, lineColor: '#12352d' }], margin: [0, 0, 0, 8] },
      { unbreakable: true, margin: [0, 14, 0, 0], stack: [
        { text: english ? 'InkGroove verification' : 'Verificación de InkGroove', fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
        { columns: [{ qr: consultationUrl, fit: 104, eccLevel: 'M', width: 114 }, { stack: [
          { text: /^(localhost|127\.|\[::1\])/.test(url.hostname) || url.hostname.endsWith('.test') ? (english ? 'LOCAL DEMONSTRATION · no external validity' : 'DEMOSTRACIÓN LOCAL · sin validez externa') : (english ? (share ? 'Check current access at the link.' : 'Checks the stored payload signature only.') : (share ? 'Consulta la vigencia actual en el enlace.' : 'Sólo comprueba la firma del registro almacenado.')), bold: true, fontSize: 9 },
          { text: share ? (english ? 'Levels 1/2: seal evidence only; level 3: authorized reader. Revocation stops future access; downloads and independent permissions remain.' : 'Niveles 1/2: sólo evidencia; nivel 3: lector autorizado. Revocar corta nuevas consultas; subsisten copias descargadas y permisos independientes.') : (english ? 'This public seal check does not evaluate access expiry or revocation. The downloaded copy cannot be revoked.' : 'La comprobación pública del sello no evalúa caducidad ni revocación de accesos. La copia descargada no se revoca.'), fontSize: 9, margin: [0, 6, 0, 6] },
          { text: english ? 'This PDF has no cryptographic signature. The QR does not verify its bytes or certify human authorship.' : 'Este PDF no incorpora firma criptográfica. El QR no verifica los bytes de este archivo ni acredita autoría humana.', fontSize: 9 },
          ...(share?.expires_at === null ? [{ text: english ? 'No automatic expiry; no guarantee of perpetual access or service.' : 'Sin expiración automática; sin garantía de acceso ni servicio perpetuos.', fontSize: 9 }] : []),
        ] }], columnGap: 10 },
        { text: consultationUrl, link: consultationUrl, fontSize: 8, margin: [0, 8, 0, 0] },
      ] },

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

function countPanel(source: PdfSource, english: boolean): Content[] {
  const h = source.historical_counts, c = h?.value;
  const valid = c && h?.source === 'sealed_snapshot_html' && ['verified', 'limited'].includes(h.state)
    && [c.direct, c.pasted, c.edited, c.total].every(n => Number.isSafeInteger(n) && n >= 0)
    && c.total === c.direct + c.pasted + c.edited;
  const labels = english ? ['Direct','Pasted unchanged','Reworked','Total'] : ['Directas','Pegadas sin modificar','Reelaboradas','Total'];
  return [{ unbreakable: true, margin: [0, 10, 0, 12], stack: [
    { text: english ? 'Authorized historical word counts' : 'Conteos históricos autorizados · palabras', bold: true, margin: [0, 0, 0, 6] },
    { table: { widths: ['*','*','*','*'], body: [labels.map(text => ({ text, fontSize: 9, fillColor: '#edf3ec' })), (valid ? [c.direct,c.pasted,c.edited,c.total] : ['—','—','—','—']).map(text => ({ text: String(text), fontSize: 19, bold: true }))] }, layout: 'noBorders' },
    { text: valid ? (english ? 'Source: verified sealed snapshot, never the current draft. Categories follow recorded word provenance; no proof of human authorship.' : 'Fuente: instantánea sellada verificada, nunca el borrador actual. Categorías según procedencia registrada de palabras; no prueba autoría humana.') : (english ? 'Data unavailable: no authorized historical breakdown.' : 'Dato no disponible: sin desglose histórico autorizado.'), fontSize: 9, margin: [0, 6, 0, 0] },
    ...(h?.state === 'limited' ? [{ text: english ? 'Limited coverage: historical session set not independently proven.' : 'Cobertura limitada: conjunto de sesiones histórico no acreditado de forma independiente.', fontSize: 9 }] : []),
    { text: english ? 'Direct: unmarked; pasted unchanged: paste; reworked: paste-edited. Mixed words follow the conservative historical counter.' : 'Directas: sin marca; pegadas sin modificar: paste; reelaboradas: paste-edited. Las palabras mixtas siguen el contador histórico conservador.', fontSize: 9 },
  ] }];
}
