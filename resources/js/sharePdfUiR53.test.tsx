// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import VersionShareApp from './VersionShareApp';
import { sharePdf, SharePdfError } from './sharePdf';
vi.mock('./sharePdf', async original => ({ ...await original<typeof import('./sharePdf')>(), sharePdf: vi.fn() }));
it.each(['content','worker','timeout','cancelled','download','http'] as const)('shows bounded %s failure next to PDF button in ES and EN', async code => {
 for (const language of ['es','en']) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); document.documentElement.lang = language;
  const secret = 'S'.repeat(43); const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => url.endsWith('/pdf-source') ? response({ version_id:'version', certificate_code: 'VRT-SYNTHETIC', snapshot_html:'<p>PRIVATE</p>' }, code === 'http' ? 403 : 200) : options.method === 'POST' ? response({ grant: { id: 'g', level: 2, expires_at: '2026-10-25' }, url: 'https://example.test/#token='+secret }) : response({ grants: [], recipients: [] })));
  vi.mocked(sharePdf).mockRejectedValue(new SharePdfError(code === 'http' ? 'worker' : code));
  try {
   await act(async () => root.render(<VersionShareApp documentId="doc" versionId="version" initialSecret="" />));
   await act(async () => node.querySelector('form button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
   const section = node.querySelector('section')!; const pdf = [...section.querySelectorAll('button')].find(b => b.textContent?.includes('PDF'))!;
   await act(async () => pdf.click());
   expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/pdf-source'))).toBe(true);
   const error = section.querySelector('[role=alert]')!; expect(error).toBeTruthy(); expect(pdf.nextElementSibling).toBe(error);
   expect(error.textContent).not.toMatch(/SSSS|example|stack|version/);
   const words = { content: ['Contenido','Content'], worker: ['Worker','Worker'], timeout: ['tiempo','timed out'], cancelled: ['cancelada','cancelled'], download: ['no iniciada','not initiated'], http: ['HTTP','HTTP'] };
   expect(error.textContent).toContain(words[code][language === 'es' ? 0 : 1]);
  } finally { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); }
 }
});

it.each([1, 2] as const)('downloads owner full text at level %s without reading public QR for content', async level => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); document.documentElement.lang = 'es';
 const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
 const secret = 'S'.repeat(43), url = 'https://example.test/process-summary/share#token=' + secret;
 const seal = { certificate_code: 'VRT-SYNTHETIC', issued_at: '2026-10-19T12:00:00Z', version_number: 1, scope: 'payload_signature', valid: true };
 const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
 vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
  if (path.endsWith('/pdf-source')) return response({version_id:'version',certificate_code:'VRT-SYNTHETIC',snapshot_html:'<p>PRIVATE á á</p><p></p>',images:{}});
  if (path.endsWith('/query')) return response({ level, seal, summary: level === 2 ? { counts: { value: { direct: 1, pasted: 0, edited: 0, total: 1 } } } : undefined });
  return response(options.method === 'POST' ? { grant: { id: 'g', level, expires_at: '2026-10-26' }, url } : { grants: [], recipients: [] });
 }));
 vi.mocked(sharePdf).mockResolvedValue(new Blob(['%PDF-test'], { type: 'application/pdf' }));
 const OriginalURL = URL; vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL() { return 'blob:synthetic'; } static revokeObjectURL() {} });
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
 try {
  await act(async () => root.render(<VersionShareApp documentId="doc" versionId="version" initialSecret="" />));
  const select = node.querySelectorAll('select')[1];
  await act(async () => { select.value = String(level); select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => node.querySelector('form button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const pdf = [...node.querySelector('section')!.querySelectorAll('button')].find(b => b.textContent?.includes('PDF'))!;
  expect(pdf.textContent).toContain('PDF completo');
  await act(async () => pdf.click());
  const source = vi.mocked(sharePdf).mock.calls.at(-1)![0];
  expect(source).toMatchObject({snapshot_html:'<p>PRIVATE á á</p><p></p>',share:{url,level}});
  expect(source).toHaveProperty('snapshot_html'); expect(source).toHaveProperty('images');
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('pdf-source'))).toBe(true);
 } finally { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
