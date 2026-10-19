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
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => url.endsWith('pdf-source') ? response({ version_id: 'version' }, code === 'http' ? 403 : 200) : options.method === 'POST' ? response({ grant: { id: 'g', level: 2, expires_at: '2026-10-25' }, url: 'https://example.test/#token='+secret }) : response({ grants: [], recipients: [] })));
  vi.mocked(sharePdf).mockRejectedValue(new SharePdfError(code === 'http' ? 'worker' : code));
  try {
   await act(async () => root.render(<VersionShareApp documentId="doc" versionId="version" initialSecret="" />));
   await act(async () => node.querySelector('form button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
   const section = node.querySelector('section')!; const pdf = [...section.querySelectorAll('button')].find(b => b.textContent?.includes('PDF'))!;
   await act(async () => pdf.click());
   const error = section.querySelector('[role=alert]')!; expect(error).toBeTruthy(); expect(pdf.nextElementSibling).toBe(error);
   expect(error.textContent).not.toMatch(/SSSS|example|stack|version/);
   const words = { content: ['Contenido','Content'], worker: ['Worker','Worker'], timeout: ['tiempo','timed out'], cancelled: ['cancelada','cancelled'], download: ['no iniciada','not initiated'], http: ['HTTP','HTTP'] };
   expect(error.textContent).toContain(words[code][language === 'es' ? 0 : 1]);
  } finally { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); }
 }
});
