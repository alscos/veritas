import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

/** Public projection only. Never accepts HTML, page settings, images or an author profile. */
export type SealReceipt = {
  kind: 'seal-receipt';
  seal: { certificate_code: string; version_number: number | null; issued_at: string; valid: boolean; scope: string };
  share: { url: string; level: 1 | 2; expires_at: string };
  counts?: { direct: number; pasted: number; edited: number; total: number } | null;
};

export function receiptDefinition(source: SealReceipt, english = false): TDocumentDefinitions {
  const { seal, share } = source;
  const url = new URL(share.url);
  if (source.kind !== 'seal-receipt' || ![1, 2].includes(share.level)
    || !/^VRT-[A-Z0-9]{1,64}$/.test(seal.certificate_code) || seal.valid !== true || seal.scope !== 'payload_signature'
    || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search
    || url.pathname !== '/process-summary/share' || !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)
    || !Number.isFinite(Date.parse(share.expires_at)) || !Number.isFinite(Date.parse(seal.issued_at))
    || !Number.isSafeInteger(seal.version_number) || seal.version_number! < 1) throw new Error('Invalid receipt');
  const text = (es: string, en: string) => english ? en : es;
  const content: Content[] = [
    { text: 'InkGroove', fontSize: 24, color: '#12352d' },
    { text: text('Constancia de sello', 'Seal receipt'), fontSize: 18, margin: [0, 16, 0, 12] },
    { text: seal.certificate_code, bold: true },
    { text: `${text('Versión', 'Version')} ${seal.version_number} · ${seal.issued_at}` },
    { text: text('No contiene el documento privado. Alcance: firma del registro recibido; no acredita autoría humana ni verifica los bytes de este PDF.', 'Contains no private document. Scope: signature of the received record; does not certify human authorship or verify this PDF’s bytes.'), margin: [0, 12, 0, 12] },
    { text: `${text('Nivel fijo', 'Fixed level')} ${share.level} · ${text('Caduca', 'Expires')} ${share.expires_at}` },
    { text: text('La vigencia se consulta en el enlace. Revocar retira consultas futuras, pero no copias descargadas ni permisos independientes.', 'Check current validity at the link. Revocation withdraws future consultations, but cannot recall downloads or independent permissions.'), margin: [0, 12, 0, 12] },
  ];
  // Explicit allowlist, including at runtime: ignore all extra input properties.
  if (share.level === 2 && source.counts) {
    const c = source.counts;
    if (![c.direct, c.pasted, c.edited, c.total].every(n => Number.isSafeInteger(n) && n >= 0)
      || c.total !== c.direct + c.pasted + c.edited) throw new Error('Invalid counts');
    content.push({ text: text(`Conteos autorizados: directas ${c.direct}, pegadas ${c.pasted}, reelaboradas ${c.edited}, total ${c.total}.`, `Authorized counts: direct ${c.direct}, pasted ${c.pasted}, edited ${c.edited}, total ${c.total}.`) });
  }
  content.push({ text: share.url, link: share.url, fontSize: 9, margin: [0, 18, 0, 12] }, { qr: share.url, fit: 120, eccLevel: 'M' });
  return { pageSize: 'A4', pageMargins: 50, defaultStyle: { font: 'literata', fontSize: 11, color: '#12352d' },
    info: { title: text('Constancia de sello · InkGroove', 'Seal receipt · InkGroove'), author: '', subject: '', keywords: '', creator: 'InkGroove' }, content };
}
