// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import VersionShareApp from './VersionShareApp';
import SealedReading from './SealedReading';
import { sealedDefinition, type PdfSource } from './sealedPdf';
let node: HTMLDivElement; let root: Root;
const secret = 'S'.repeat(43);
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
const card = (level = 3) => ({ level, seal: { certificate_code: 'VRT-SYNTHETIC', valid: true, issued_at: '2026-10-18' }, ...(level >= 2 ? { summary: { coverage: { status: 'limited', complete: false }, counts: { value: { direct: 1, pasted: 2, edited: 3, total: 6 } } } } : {}), ...(level === 3 ? { reading: { snapshot_html: '<p>á génesis  </p><p></p><p><br><br></p>', coverage: { status: 'limited', complete: false }, events: [{ id: 1, sequence: 1, html: '<p>antes</p>' }], next_after: null } } : {}) });
const click = async (text: string) => { const b = [...node.querySelectorAll('button')].find(b => b.textContent === text); expect(b).toBeTruthy(); await act(async () => b!.click()); };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); document.documentElement.lang = 'es'; document.head.innerHTML = '<meta name="csrf-token" content="synthetic">'; node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders exact NFC/NFD, empty paragraphs and breaks, no editor/source attributes/navigation/resources', async () => {
  const read = vi.fn(); const html = '<p id="evil" style="background:url(https://evil.test/x)" contenteditable="true" onclick="bad()">á génesis  <a href="https://evil.test/?secret=x">enlace</a></p><p></p><p><br><br></p><mark data-origin="paste">pegado</mark>';
  await act(async () => root.render(<SealedReading html={html} read={read} />));
  expect(node.querySelector('article')!.textContent).toBe('á génesis  enlacepegado');
  expect(node.querySelectorAll('p')).toHaveLength(3); expect(node.querySelectorAll('br')).toHaveLength(2);
  expect(node.querySelectorAll('[contenteditable],a,[style],[onclick],#evil,[src]')).toHaveLength(0); expect(read).not.toHaveBeenCalled(); expect(node.querySelector('mark')!.className).toBe('origin-paste');
  await act(async () => root.render(<SealedReading html='<p>texto</p><iframe src="https://evil.test" />' read={read} />));
  expect(node.querySelector('article')).toBeNull(); expect(node.querySelector('[role=alert]')).toBeTruthy();
});
it('authorizes images through callback, cleans blobs and ignores bytes arriving after frame changes', async () => {
  const create = vi.fn(() => 'blob:synthetic'); const revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const image = '<img src="/api/documents/00000000-0000-0000-0000-000000000000/images/11111111-1111-1111-1111-111111111111" alt="prueba">';
  let finish!: (blob: Blob) => void; const read = vi.fn((_id: string, _signal: AbortSignal) => new Promise<Blob>(resolve => { finish = resolve; }));
  await act(async () => root.render(<SealedReading html={image} read={read} />)); expect(node.querySelector('img')).toBeNull();
  await act(async () => finish(new Blob(['synthetic'], { type: 'image/png' }))); expect(node.querySelector('img')!.src).toBe('blob:synthetic');
  await act(async () => root.render(<SealedReading html="<p>next</p>" read={read} />)); expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  await act(async () => root.render(<SealedReading html={image} read={read} />)); const signal = read.mock.calls[1][1];
  await act(async () => root.render(<SealedReading html="<p>next</p>" read={read} />)); expect(signal.aborted).toBe(true);
  await act(async () => finish(new Blob(['late'], { type: 'image/png' }))); expect(create).toHaveBeenCalledTimes(1);
});
it('anonymous level3 login retry keeps secret in JSON memory, renews CSRF and never storage/query', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem'); let tries = 0;
  const fetch = vi.fn(async (url: string) => { if (url === '/api/csrf-token') return response({ csrf_token: 'renewed' }); return ++tries === 1 ? response({}, 401) : tries === 2 ? response({}, 419) : response(card()); }); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<VersionShareApp initialSecret={secret} />));
  expect(fetch).not.toHaveBeenCalled(); expect(node.textContent).toContain('primera/última respuesta');
  await click('Consultar / Reintentar'); expect(node.querySelector('[role=alert]')!.textContent).toContain('otra pestaña');
  const login = node.querySelector('a')!; expect(login.getAttribute('href')).toBe('/'); expect(login.target).toBe('_blank');
  await click('Consultar / Reintentar'); expect(node.querySelector('article')!.textContent).toBe('á génesis  '); expect(node.textContent).toContain('complete=false');
  expect(storage).not.toHaveBeenCalled(); expect(fetch.mock.calls.every(([url]) => !url.includes(secret))).toBe(true);
  const calls = fetch.mock.calls as unknown as [string, RequestInit][];
  const last = calls.at(-1)![1]; expect(JSON.parse(last.body as string).capability).toBe(secret); expect((last.headers as Record<string, string>)['X-CSRF-TOKEN']).toBe('renewed');
  await click('Siguiente evento'); expect(node.querySelector('article')!.textContent).toBe('antes'); await click('Texto sellado'); expect(node.querySelector('article')!.textContent).toBe('á génesis  ');
  expect(calls.every(([url]) => !url.includes('/events'))).toBe(true);
});
it('does not restore card or secret from a response after pagehide', async () => {
  let finish!: (r: unknown) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
  await act(async () => root.render(<VersionShareApp initialSecret={secret} />)); await click('Consultar / Reintentar');
  await act(async () => window.dispatchEvent(new Event('pagehide'))); await act(async () => finish(response(card()))); expect(node.querySelector('article')).toBeNull(); expect(node.textContent).not.toContain('VRT-SYNTHETIC');
});
it.each([1, 2])('shows only the projection actually received at level %s', async level => {
  vi.stubGlobal('fetch', vi.fn(async () => response(card(level)))); await act(async () => root.render(<VersionShareApp initialSecret={secret} />)); await click('Consultar / Reintentar');
  expect(node.querySelector('article')).toBeNull(); expect(node.textContent!.includes('Directas: 1')).toBe(level === 2);
});
it('owner defaults to restricted, emits selected integer accounts, copies once and revokes exact grant', async () => {
  const grant = { id: 'g1', level: 3, audience_mode: 'restricted', label: null, state: 'active', created_at: '2026-10-18', expires_at: '2026-10-25' };
  let issued = false; let revoked = false;
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/revoke')) { revoked = true; return response({}, 204); }
    if (options.method === 'POST') { issued = true; return response({ grant, url: `https://example.test/process-summary/share#token=${secret}` }, 201); }
    return response({ grants: issued ? [{ ...grant, state: revoked ? 'revoked' : 'active' }] : [], recipients: [{ id: 7, name: 'selected', email: 'synthetic@example.test' }] });
  }); vi.stubGlobal('fetch', fetch); const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  await act(async () => root.render(<VersionShareApp documentId="doc" versionId="version" initialSecret="" />));
  const select = node.querySelectorAll('select')[1]; await act(async () => { select.value = '3'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect((node.querySelector('input[type=radio]') as HTMLInputElement).checked).toBe(true); expect([...node.querySelectorAll('button')].find(b => b.textContent === 'Emitir concesión')!.disabled).toBe(true);
  await act(async () => (node.querySelector('input[type=checkbox]') as HTMLInputElement).click()); await click('Emitir concesión');
  const issueCall = fetch.mock.calls.find(([, options]) => options.method === 'POST')!; expect(JSON.parse(issueCall[1].body as string).recipient_ids).toEqual([7]);
  await click('Copiar enlace'); expect(copy).toHaveBeenCalledWith(`https://example.test/process-summary/share#token=${secret}`); expect(node.textContent).toContain('Copiado');
  expect(node.textContent).toContain('Secreto no recuperable'); await click('Revocar'); expect(node.querySelector('input[readonly]')).toBeNull(); expect(node.textContent).toContain('revoked'); expect(fetch.mock.calls.some(([url]) => url.endsWith('/g1/revoke'))).toBe(true);
});
it.each([1, 2, 3] as const)('builds PDF exact sealed source and independent grant QR at level %s', level => {
  const source: PdfSource = { version_id: 'exact', version_number: 2, snapshot_html: '<p>á génesis SELLADA</p><p></p>', page_settings: null, certificate_code: 'VRT-SYNTHETIC', issued_at: '2026-10-18', format_version: 2, public_url: 'https://example.test/verify/VRT-SYNTHETIC', images: {}, share: { url: `https://example.test/process-summary/share#token=${String(level).repeat(43)}`, level, expires_at: '2026-10-25' } };
  const before = JSON.stringify(source); const definition = sealedDefinition(source); const out = JSON.stringify(definition);
  expect(out).toContain(`"qr":"${source.share!.url}"`); expect(out).toContain('SELLADA'); expect(out).toContain('génesis'); expect(out).toContain('nivel fijo '+level); expect(out).toContain('no verifica los bytes'); expect(JSON.stringify(source)).toBe(before);
  expect(() => sealedDefinition({ ...source, share: { ...source.share!, url: 'https://foreign.test/process-summary/share#token=' + secret } })).toThrow();
});
