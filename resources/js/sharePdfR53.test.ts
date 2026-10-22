// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sealedDefinition, type PdfSource } from './sealedPdf';
import { readFileSync } from 'node:fs';
const seed = readFileSync('scripts/m33d-r5/seed.php', 'utf8');
const hostile = seed.match(/<span onclick=.*?<\/a>/)![0];
export const source: PdfSource = { version_id: 'synthetic', version_number: 1, certificate_code: 'VRT-SYNTHETIC', snapshot_html: '<p>á ge\u0301nesis <mark data-origin="paste">pegado</mark><br><br></p><p></p>' + hostile, page_settings: null, issued_at: null, format_version: 2, public_url: 'https://example.test/verify/VRT-SYNTHETIC', images: {} };
it('exports the exact hostile seed literal as inert text without modifying source', () => {
 const before = JSON.stringify(source);
 const json = JSON.stringify(sealedDefinition(source));
 expect(json).toContain('Atributo hostil inerte'); expect(json).toContain('Enlace hostil como texto');
 expect(json).not.toMatch(/javascript:|onclick|dataset.hostile/); expect(JSON.stringify(source)).toBe(before);
 expect(json).toContain('génesis'); expect(json).toContain('á'); expect(json).toContain('pegado');
});

import { vi, afterEach } from 'vitest';
import { sharePdf, downloadSharePdf } from './sharePdf';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each([1, 2, 3] as const)('renders owner-authorized full content with an independently scoped QR at level %s', level => {
 const url = 'https://example.test/process-summary/share#token=' + 'A'.repeat(43);
 const json = JSON.stringify(sealedDefinition({ ...source, share: { url, level, expires_at: '2026-10-25' } }));
 expect(json).toContain('pegado'); expect(json).toContain(`"qr":"${url}"`); expect(json).toContain(`Nivel ${level}`);
 expect(json).not.toContain(`"qr":"${source.public_url}"`);
});
it('ignores hostile styles/events without executing or exporting resources', () => {
 const json = JSON.stringify(sealedDefinition({ ...source, snapshot_html: '<p onmouseover="bad()" style="background:url(https://evil.test);position:fixed">literal</p>' }));
 expect(json).not.toMatch(/evil|bad|fixed/); expect(json).toContain('literal');
});
class FakeWorker {
 static current: FakeWorker;
 onerror?: (event: { preventDefault: () => void }) => void; onmessageerror?: () => void; onmessage?: (e: unknown) => void;
 terminate = vi.fn(); postMessage = vi.fn();
 constructor() { FakeWorker.current = this; }
}
async function start() {
 vi.stubGlobal('Worker', FakeWorker);
 const controller = new AbortController();
 const result = sharePdf(source, false, controller.signal);
 await Promise.resolve(); await Promise.resolve();
 return { result, controller, worker: FakeWorker.current };
}
it('accepts PDF bytes and terminates Worker', async () => {
 const { result, worker } = await start(); const bytes = new ArrayBuffer(18); new Uint8Array(bytes).set(new TextEncoder().encode('%PDF-1.7 synthetic')); worker.onmessage!({ data: { bytes } });
 expect((await result).type).toBe('application/pdf'); expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each(['error', 'messageerror', 'invalid', 'reported', 'abort', 'timeout'] as const)('fails closed with bounded classification: %s', async kind => {
 vi.useFakeTimers(); const { result, worker, controller } = await start();
 const expected = expect(result).rejects.toMatchObject({ code: kind === 'abort' ? 'cancelled' : kind === 'timeout' ? 'timeout' : 'worker' });
 if (kind === 'error') worker.onerror!({ preventDefault: vi.fn() });
 if (kind === 'messageerror') worker.onmessageerror!();
 if (kind === 'invalid') worker.onmessage!({ data: { bytes: new ArrayBuffer(8) } });
 if (kind === 'reported') worker.onmessage!({ data: { error: true } });
 if (kind === 'abort') controller.abort();
 if (kind === 'timeout') vi.advanceTimersByTime(30000);
 await expected; expect(worker.terminate).toHaveBeenCalledOnce();
});
it('distinguishes unavailable Worker and already cancelled', async () => {
 vi.stubGlobal('Worker', class { constructor() { throw Error('synthetic secret'); } });
 await expect(sharePdf(source, false, new AbortController().signal)).rejects.toMatchObject({ code: 'worker', message: 'worker' });
 const c = new AbortController(); c.abort();
 await expect(sharePdf(source, false, c.signal)).rejects.toMatchObject({ code: 'cancelled' });
});
it('connects the download anchor and cleans URL on abort', () => {
 const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:synthetic', revokeObjectURL: revoke });
 const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.isConnected).toBe(true); });
 const c = new AbortController(); downloadSharePdf(new Blob(['%PDF-']), 'synthetic.pdf', c.signal);
 expect(click).toHaveBeenCalledOnce(); c.abort(); expect(revoke).toHaveBeenCalledWith('blob:synthetic'); expect(document.querySelector('a')).toBeNull();
});
it('reports a download dispatch failure and releases its Blob', () => {
 const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:synthetic', revokeObjectURL: revoke });
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw Error('synthetic private data'); });
 expect(() => downloadSharePdf(new Blob(['%PDF-']), 'synthetic.pdf', new AbortController().signal)).toThrow('download');
 expect(revoke).toHaveBeenCalledOnce(); expect(document.querySelector('a')).toBeNull();
});
it('terminates if posting to Worker fails without exposing the raw exception', async () => {
 vi.stubGlobal('Worker', class extends FakeWorker { postMessage = vi.fn(() => { throw Error('synthetic secret'); }); });
 await expect(sharePdf(source, false, new AbortController().signal)).rejects.toMatchObject({ code: 'worker', message: 'worker' });
 expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
});
