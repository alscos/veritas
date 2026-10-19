import { preparePdfImages, sealedDefinition, type PdfSource } from './sealedPdf';
export type SharePdfFailure = 'content' | 'worker' | 'timeout' | 'cancelled' | 'download';
export class SharePdfError extends Error {
  constructor(public code: SharePdfFailure) { super(code); }
}
export async function sharePdf(source: PdfSource, english: boolean, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw new SharePdfError('cancelled');
  let definition;
  try { definition = sealedDefinition(await preparePdfImages(source), english); }
  catch { throw new SharePdfError(signal.aborted ? 'cancelled' : 'content'); }
  if (signal.aborted) throw new SharePdfError('cancelled');
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./sealedPdf.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new SharePdfError('worker')); return; }
    let settled = false;
    const finish = (code?: SharePdfFailure, bytes?: ArrayBuffer) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort);
      if (code) reject(new SharePdfError(code));
      else resolve(new Blob([bytes!], { type: 'application/pdf' }));
    };
    const abort = () => finish('cancelled');
    const timer = setTimeout(() => finish('timeout'), 30000);
    signal.addEventListener('abort', abort, { once: true });
    // Suppress raw diagnostics that may contain document data; report a bounded error in UI.
    worker.onerror = event => { event.preventDefault(); finish('worker'); };
    worker.onmessageerror = () => finish('worker');
    worker.onmessage = e => {
      const bytes = e.data?.bytes;
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 5
        || new TextDecoder().decode(new Uint8Array(bytes, 0, 5)) !== '%PDF-') finish('worker');
      else finish(undefined, bytes);
    };
    if (signal.aborted) { abort(); return; }
    try { worker.postMessage(definition); } catch { finish('worker'); }
  });
}

/** Dispatch a download from a connected anchor; browsers do not expose receipt on disk. */
export function downloadSharePdf(blob: Blob, filename: string, signal: AbortSignal): void {
  if (signal.aborted) throw new SharePdfError('cancelled');
  let url: string;
  try { url = URL.createObjectURL(blob); } catch { throw new SharePdfError('download'); }
  const a = document.createElement('a');
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => { clearTimeout(timer); a.remove(); URL.revokeObjectURL(url); signal.removeEventListener('abort', cleanup); };
  try {
    a.href = url; a.download = filename; a.hidden = true; document.body.append(a);
    signal.addEventListener('abort', cleanup, { once: true });
    timer = setTimeout(cleanup, 10000);
    a.click();
  } catch { cleanup(); throw new SharePdfError('download'); }
}
