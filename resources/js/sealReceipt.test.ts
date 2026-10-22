// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { receiptDefinition, type SealReceipt } from './sealReceipt';
import { sealedDefinition, type PdfSource } from './sealedPdf';
import { sharePdf } from './sharePdf';

const receipt = (level: 1 | 2): SealReceipt => ({ kind: 'seal-receipt',
  seal: { certificate_code: 'VRT-SYNTHETIC', issued_at: '2026-10-19T12:00:00Z', version_number: 7, valid: true, scope: 'payload_signature' },
  share: { url: 'https://example.test/process-summary/share#token=' + 'S'.repeat(43), level, expires_at: '2026-10-26T12:00:00Z' },
  counts: { direct: 1, pasted: 2, edited: 3, total: 6 },
});

it.each([1, 2] as const)('allowlists receipt level %s, including annotations, without traversing private inputs', level => {
  const source = { ...receipt(level), snapshot_html: '<p>PRIVATE á génesis</p>', images: { private: 'PRIVATE-BITMAP' },
    events: ['PRIVATE-EVENT'], page_settings: { private: 'PRIVATE-PAGE' }, author: 'PRIVATE-NAME' };
  const before = JSON.stringify(source);
  for (const english of [true, false]) {
    const definition = receiptDefinition(source, english); const json = JSON.stringify(definition);
    expect(json).not.toContain('PRIVATE'); expect(json).toContain('VRT-SYNTHETIC');
    expect(json).toContain(`"qr":"${source.share.url}"`); expect(json).toContain(`"link":"${source.share.url}"`);
    expect(json).not.toContain('snapshot'); expect(definition.images).toBeUndefined();
    expect(json.includes(english ? 'Authorized counts' : 'Conteos autorizados')).toBe(level === 2);
  }
  expect(JSON.stringify(source)).toBe(before);
});

it.each([1, 2] as const)('renders owner-selected complete PDF separately from public QR level %s', level => {
  const source: PdfSource = { version_id: 'v', version_number: 7, snapshot_html: '<p>PRIVATE</p>', images: {}, page_settings: null,
    certificate_code: 'VRT-SYNTHETIC', issued_at: null, public_url: 'https://example.test/verify/VRT-SYNTHETIC', format_version: 2, share: receipt(level).share };
  expect(JSON.stringify(sealedDefinition(source))).toContain('PRIVATE');
});

it('sends only receipt definition to the Worker and never prepares private images', async () => {
  let posted: unknown;
  class WorkerStub {
    onmessage?: (event: unknown) => void;
    terminate = vi.fn();
    postMessage(value: unknown) { posted = value; const bytes = new ArrayBuffer(9); new Uint8Array(bytes).set(new TextEncoder().encode('%PDF-test')); queueMicrotask(() => this.onmessage?.({ data: { bytes } })); }
  }
  vi.stubGlobal('Worker', WorkerStub);
  try {
    const source = Object.assign(receipt(2), { images: { get private() { throw Error('Must never read private image'); } } });
    const blob = await sharePdf(source, false, new AbortController().signal);
    expect(blob.type).toBe('application/pdf'); expect(JSON.stringify(posted)).not.toContain('private');
  } finally { vi.unstubAllGlobals(); }
});

it('rejects wrong scope, invalid counts, query secrets and level elevation', () => {
  const source = receipt(2);
  expect(() => receiptDefinition({ ...source, seal: { ...source.seal, valid: false } })).toThrow();
  expect(() => receiptDefinition({ ...source, counts: { direct: 1, pasted: 2, edited: 3, total: 9 } })).toThrow();
  expect(() => receiptDefinition({ ...source, share: { ...source.share, url: source.share.url.replace('#token=', '?token=') } })).toThrow();
  expect(() => receiptDefinition({ ...source, share: { ...source.share, level: 3 as 2 } })).toThrow();
});
