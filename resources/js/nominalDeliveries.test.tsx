// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NominalDeliveries from './NominalDeliveries';
import VersionShareApp from './VersionShareApp';
import { resetIdentity, SESSION_EXPIRED_EVENT } from './api';
import { nominalRoute } from './nominalTransport';
import { setLocale } from './i18n';
let node: HTMLDivElement, root: Root;
const grant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const item = (n = 1) => ({ grant_id: n === 1 ? grant : `grant-${n}`, document_id: 'doc', version_id: 'version-a', version_number: 1, recipient_user_id: n, sender: 'Author fixture', recipient: 'Recipient fixture', state: 'active', expires_at: '2099-01-01T00:00:00Z', independent_submission: true });
const page = (next: number | null = null) => ({ version: { number: 1, sealed_at: '2026-10-19' }, snapshot_html: '<p>á á</p><p></p><p><span data-origin="paste">pegado</span><span data-origin="paste-edited">x</span></p>', events: [{ id: next === null ? 2 : 1, sequence: 1, html: `<p>${next === null ? 'segundo' : 'primero'}</p><p></p>` }], next_after: next });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const click = async (text: string) => { await act(async () => { const b = [...node.querySelectorAll('button')].find(b => b.textContent === text); expect(b, text).toBeTruthy(); b!.click(); }); };
const change = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); };
beforeEach(() => { window.history.replaceState(null, '', '/'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetIdentity(1); setLocale('es'); document.documentElement.lang = 'es'; node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); resetIdentity(); vi.useRealTimers(); });
it('uses real replay, follows sealed event cursors and preserves Unicode/empty paragraphs/provenance', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/received')) return json({ items: [item()], next_cursor: null });
    const body = JSON.parse(String(init?.body));
    if (url.endsWith('/event')) return json({ ...page(), events: [{ id: body.event, sequence: 1, html: `<p>frame ${body.event}</p><p></p>` }] });
    return json(page(body.after === 0 ? 1 : null));
  }); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<NominalDeliveries />)); await click('Leer versión');
  expect(node.textContent).toContain('á á'); expect(node.querySelector('.origin-paste')).toBeTruthy(); expect(node.querySelector('.origin-paste-edited')).toBeTruthy(); expect(node.querySelectorAll('.sealed-reading p').length).toBeGreaterThan(3);
  expect(node.querySelector('.submission-process')).toBeTruthy(); expect(node.textContent).toContain('primero'); await click('Más historial sellado');
  await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Evento siguiente"]')!.click()); expect(node.textContent).toContain('segundo');
  expect(fetch.mock.calls.some(([u, o]) => u.endsWith('/page') && JSON.parse(String(o?.body)).after === 1)).toBe(true);
  expect(fetch.mock.calls.every(([u]) => !u.includes('/api/documents') && !u.includes('/submissions'))).toBe(true);
  expect(fetch.mock.calls.filter(([,o]) => o?.method === 'POST').every(([u]) => /\/(page|event)$/.test(u))).toBe(true);
});
it('paginates 50+2, distinguishes sent/received and revokes without deleting independent permissions', async () => {
  let revoked = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/revoke')) { revoked = true; return json({}); }
    if (url.includes('cursor=')) return json({ items: [item(51), item(52)], next_cursor: null });
    return json({ items: Array.from({length: 50}, (_, n) => ({...item(n+1), state: revoked ? 'revoked' : 'active'})), next_cursor: 'cursor-two' });
  }));
  await act(async () => root.render(<NominalDeliveries />)); expect(node.querySelectorAll('li')).toHaveLength(50); await click('Más comparticiones'); expect(node.querySelectorAll('li')).toHaveLength(52);
  await click('Enviadas'); expect(node.textContent).toContain('Recipient fixture'); expect(node.textContent).toContain('Entrega académica independiente'); await click('Revocar'); expect(node.textContent).toContain('Revocada'); expect(node.querySelectorAll('li')).toHaveLength(50);
});
it('discards a late page after session change and aborts the pending request', async () => {
  let release!: (value: Response) => void; let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/received')) return json({ items: [item()], next_cursor: null });
    signal = init?.signal as AbortSignal; return new Promise<Response>(r => { release = r; });
  }));
  await act(async () => root.render(<NominalDeliveries />)); await click('Leer versión');
  await act(async () => { resetIdentity(2); window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); }); expect(signal?.aborted).toBe(true);
  await act(async () => release(json(page()))); expect(node.textContent).not.toContain('pegado'); expect(node.querySelector('.sealed-reading')).toBeNull();
});
it('withdrawal during load clears the snapshot and history', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/received') ? json({items:[item()],next_cursor:null}) : JSON.parse(String(init?.body)).after === 0 ? json(page(1)) : json({},404)));
  await act(async () => root.render(<NominalDeliveries />)); await click('Leer versión'); await click('Más historial sellado'); expect(node.querySelector('.sealed-reading')).toBeNull(); expect(node.textContent).toContain('Acceso no disponible');
});
it('expired and withdrawn rows expose metadata only', async () => {
  const fetch = vi.fn(async () => json({ items: [{ ...item(), state: 'expired' }, { ...item(2), state: 'revoked' }], next_cursor: null })); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<NominalDeliveries />)); expect(node.textContent).toContain('Caducada'); expect(node.textContent).toContain('Revocada'); expect(node.textContent).not.toContain('Leer versión'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps one UUID through a failed attempt, double submit and replay with no bearer', async () => {
  const bodies: Record<string, unknown>[] = []; let release!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.body) return json({ grants: [], recipients: [] });
    bodies.push(JSON.parse(String(init.body))); if (bodies.length === 1) return json({},422);
    return new Promise<Response>(r => { release = r; });
  }));
  await act(async () => root.render(<VersionShareApp documentId="doc" versionId="version-a" initialSecret="" />));
  await change(node.querySelectorAll('select')[1], '3'); await change(node.querySelector('textarea')!, 'fixture@example.test');
  const submit = () => node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await act(async () => { submit(); }); expect(node.textContent).toContain('deben tener una cuenta existente');
  await act(async () => { submit(); submit(); }); expect(bodies).toHaveLength(2); expect(bodies[0].operation_key).toBe(bodies[1].operation_key); expect(bodies[0].recipient_emails).toEqual(['fixture@example.test']);
  await act(async () => release(json({ grant: {id:grant,level:3}, replayed:true,url:null },201)));
  expect(node.textContent).toContain('no se puede recuperar'); expect(node.querySelector('input[aria-label="Enlace"]')).toBeNull();
});
it.each(['/deliveries/received','/deliveries/received/'+grant])('accepts only local nominal return %s', path => expect(nominalRoute(path)).toBe(path));
it.each(['//evil.test','https://evil.test','/deliveries/received?next=https://evil.test','/deliveries/received/%2f%2fevil.test','/deliveries/received/../outside','/deliveries/received#token=secret'])('rejects open return %s', path => expect(nominalRoute(path)).toBeNull());

import App, { SealedShareOffer } from './App';
it('offers optional sharing of the exact just-sealed version without an automatic request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const dismiss = vi.fn();
  await act(async () => root.render(<SealedShareOffer documentId="document" version={{ id: 'version-a', version_number: 1 } as never} onDismiss={dismiss} />));
  expect([...node.querySelectorAll('button')].some(b => b.textContent === 'Compartir esta versión')).toBe(true); expect(fetch).not.toHaveBeenCalled(); await click('Ahora no'); expect(dismiss).toHaveBeenCalledOnce();
});
it('returns automatically through the real login screen to a local grant route with no next or persistent return', async () => {
  window.history.replaceState(null, '', `/deliveries/received/${grant}`); vi.stubGlobal('FormData', window.FormData);
  const storage = vi.spyOn(Storage.prototype, 'setItem'); let signedIn = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/auth/login')) { signedIn = true; return json({ user: { id: 1, name: 'Fixture', email: 'fixture@example.test' } }); }
    if (url.endsWith('/me')) return signedIn ? json({user:{id:1,name:'Fixture'}}) : json({},401);
    if (url.endsWith('/documents')) return json({documents:[]}); if (url.endsWith('/folders')) return json({folders:[]});
    if (url.endsWith('/received')) return json({items:[item()],next_cursor:null}); if (url.endsWith('/submissions')) return json({received:[],sent:[]});
    return json(page());
  }));
  try {
    await act(async () => root.render(<App />)); expect(node.querySelector('input[name="password"]')).toBeTruthy();
    await change(node.querySelector('input[name="email"]')!, 'fixture@example.test'); await change(node.querySelector('input[name="password"]')!, 'FixturePass123');
    await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(node.textContent).toContain('Versión sellada'); expect(node.textContent).toContain('á á'); expect(location.pathname).toBe(`/deliveries/received/${grant}`); expect(location.search).toBe('');
    expect(storage.mock.calls.every(([key]) => key === 'veritas:auth-generation')).toBe(true);
  } finally { window.history.replaceState(null, '', '/'); storage.mockRestore(); }
});
it('loads images through the nominal transport and destroys object URLs on refresh', async () => {
  const create = vi.fn(() => 'blob:fixture'), revoke = vi.fn(); vi.stubGlobal('URL', URL);
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create}); Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke});
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/received')) return json({items:[item()],next_cursor:null});
    if (url.endsWith('/image')) return new Response('fixture', {headers:{'Content-Type':'image/png'}});
    return json({...page(),events:[],snapshot_html:'<p>imagen</p><img src="/api/documents/00000000-0000-0000-0000-000000000000/images/11111111-1111-1111-1111-111111111111">'});
  }); vi.stubGlobal('fetch',fetch);
  await act(async () => root.render(<NominalDeliveries />)); await click('Leer versión'); expect(node.querySelector('img')!.getAttribute('src')).toBe('blob:fixture');
  const call = fetch.mock.calls.find(([url]) => url.endsWith('/image')); expect(call).toBeTruthy(); await click('Volver a Entregas'); await click('Actualizar'); expect(revoke).toHaveBeenCalledWith('blob:fixture'); expect(node.querySelector('img')).toBeNull();
});
it.each([1,2,3])('omits recipient presentations for public levels and advanced link (level %s)', async level => {
  const bodies: Record<string,unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { if (!init?.body) return json({grants:[],recipients:[]}); bodies.push(JSON.parse(String(init.body))); return json({grant:{id:grant,level},url:null,replayed:true}); }));
  await act(async () => root.render(<VersionShareApp documentId="doc" versionId="version-a" initialSecret="" />)); await change(node.querySelectorAll('select')[1], String(level));
  if (level === 3) { await act(async () => node.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click()); await act(async () => node.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()); }
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(bodies).toHaveLength(1); expect(bodies[0].recipient_emails).toBeUndefined(); if (level === 3) expect(bodies[0].audience_mode).toBe('signed_in_link');
});
it('uses nominal PDF source and revalidates the same grant before downloading the full immutable version', async () => {
  const source = {version_id:'version-a',version_number:1,snapshot_html:'<p>Exact sealed fixture</p>',page_settings:null,certificate_code:'VRT-FIXTURE',issued_at:'2026-10-19',format_version:3,public_url:'https://example.test/verify/VRT-FIXTURE',images:{}};
  const download = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:pdf')}); Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  vi.stubGlobal('Worker', class { onmessage?: (e: unknown) => void; onerror?: unknown; terminate() {} postMessage() { queueMicrotask(() => this.onmessage?.({data:{bytes:new TextEncoder().encode('%PDF-fixture').buffer}})); } });
  const fetch = vi.fn(async (url: string) => url.endsWith('/received') ? json({items:[item()],next_cursor:null}) : url.endsWith('/pdf') ? json(source) : json({...page(),events:[]})); vi.stubGlobal('fetch',fetch);
  try {
    await act(async () => root.render(<NominalDeliveries />)); await click('Leer versión'); await click('Descargar PDF');
    expect(download).toHaveBeenCalledOnce(); expect(fetch.mock.calls.filter(([u])=>u.endsWith('/pdf'))).toHaveLength(1); expect(fetch.mock.calls.filter(([u])=>u.endsWith('/page'))).toHaveLength(2); expect(fetch.mock.calls.every(([u])=>!u.includes('/api/documents'))).toBe(true);
    expect(node.textContent).toContain('puede copiarse');
  } finally { download.mockRestore(); }
});
it('expires an already visible reading and clears its actual replay', async () => {
  vi.useFakeTimers(); const expiry = new Date(Date.now()+1000).toISOString();
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>url.endsWith('/received')?json({items:[{...item(),expires_at:expiry}],next_cursor:null}):json(page())));
  await act(async()=>root.render(<NominalDeliveries/>)); await click('Leer versión'); expect(node.querySelector('.sealed-reading')).toBeTruthy();
  await act(async()=>vi.advanceTimersByTime(1001)); expect(node.querySelector('.sealed-reading')).toBeNull(); expect(node.querySelector('.submission-process')).toBeNull();
});
it('plays the actual replay across a paginated boundary without a draft write', async () => {
  vi.useFakeTimers(); const calls: string[] = [];
  vi.stubGlobal('fetch',vi.fn(async (url:string,init?:RequestInit)=>{
    calls.push(url); if(url.endsWith('/received'))return json({items:[item()],next_cursor:null});
    const body=JSON.parse(String(init?.body)); if(url.endsWith('/event'))return json({...page(),events:[{id:body.event,sequence:body.event,html:`<p>playing ${body.event}</p>`}]});
    return json(page(body.after===0?1:null));
  }));
  await act(async()=>root.render(<NominalDeliveries/>)); await click('Leer versión'); await click('Reproducir'); await act(async()=>vi.advanceTimersByTime(801)); expect(node.textContent).toContain('segundo'); expect(calls.every(url=>!url.includes('/documents/'))).toBe(true);
});
it('sends the expected identity and rejects a discordant server identity', async () => {
  const fetch=vi.fn(async()=>new Response(JSON.stringify({items:[item()],next_cursor:null}),{headers:{'Content-Type':'application/json','X-InkGroove-User':'2'}}));vi.stubGlobal('fetch',fetch);
  await act(async()=>root.render(<NominalDeliveries/>)); expect((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].headers).toMatchObject({'X-InkGroove-User':'1'});expect(node.textContent).not.toContain('Author fixture');
});
it('one author operation refreshes Sent without calling the academic submission endpoint', async () => {
  let issued = false; const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url:string,init?:RequestInit)=>{
    calls.push(url);
    if (url.endsWith('/sent') || url.endsWith('/received')) return json({items:issued?[item()]:[],next_cursor:null});
    if (init?.method==='POST') { issued=true;return json({grant:{id:grant,level:3},url:null,replayed:true}); }
    return json({grants:[],recipients:[]});
  }));
  await act(async()=>root.render(<><VersionShareApp documentId="doc" versionId="version-a" initialSecret=""/><NominalDeliveries/></>));await click('Enviadas');
  await change(node.querySelectorAll('select')[1],'3');await change(node.querySelector('textarea')!,'fixture@example.test');
  await act(async()=>node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(node.querySelector('.nominal-deliveries')!.textContent).toContain('Recipient fixture');expect(calls.filter(u=>u.endsWith('/sent'))).toHaveLength(2);expect(calls.every(u=>!u.includes('/submissions'))).toBe(true);
});
it('switching grants aborts and rejects a late snapshot from the previous document', async () => {
  let release!: (r:Response)=>void; let priorSignal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/received'))return json({items:[item(),{...item(2),document_id:'other-doc',version_id:'version-b',version_number:2}],next_cursor:null});
    if(url.includes(`/${grant}/`)){priorSignal=init?.signal as AbortSignal;return new Promise<Response>(r=>{release=r;});}
    return json({...page(),version:{number:2,sealed_at:'2026-10-19'},snapshot_html:'<p>Second sealed document</p>',events:[]});
  }));
  await act(async()=>root.render(<NominalDeliveries/>));await click('Leer versión');
  await act(async()=>[...node.querySelectorAll<HTMLButtonElement>('button')].filter(b=>b.textContent==='Leer versión')[1].click());expect(priorSignal?.aborted).toBe(true);
  await act(async()=>release(json(page())));expect(node.textContent).toContain('Second sealed document');expect(node.textContent).not.toContain('pegado');
});
import SubmissionsView from './SubmissionsView';
it('keeps independent academic deliveries usable alongside a withdrawn nominal entry', async () => {
  const fetch=vi.fn(async(url:string)=>{
    if(url.endsWith('/received'))return json({items:[{...item(),state:'revoked'}],next_cursor:null});
    if(url.endsWith('/submissions'))return json({received:[{id:'academic',sender_id:2,document_version_id:'version-a',status:'submitted',submitted_at:'2026-10-19'}],sent:[]});
    if(url.endsWith('/submissions/academic'))return json({version:{id:'version-a',document_id:'doc',version_number:1,snapshot_html:'<p>Independent academic copy</p>',sealed_at:'2026-10-19'},history_available:false});
    throw Error('Unexpected endpoint');
  });vi.stubGlobal('fetch',fetch);
  await act(async()=>root.render(<SubmissionsView/>));expect(node.textContent).toContain('Revocada');expect(node.querySelector('.nominal-deliveries')!.textContent).not.toContain('Leer versión');
  await act(async()=>node.querySelector<HTMLButtonElement>('[data-submission-id="academic"]')!.click());expect(node.textContent).toContain('Independent academic copy');expect(fetch.mock.calls.some(([url])=>url.endsWith('/submissions/academic'))).toBe(true);
});
it('keeps only 64 cached snapshots and uses nominal event transport after eviction', async () => {
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    calls.push(url);if(url.endsWith('/received'))return json({items:[item()],next_cursor:null});
    const body=JSON.parse(String(init?.body));if(url.endsWith('/event'))return json({...page(),events:[{id:body.event,sequence:body.event,html:`<p>Fetched evicted ${body.event}</p>`}]});
    const start=body.after??0;return json({...page(),events:Array.from({length:32},(_,n)=>({id:start+n+1,sequence:start+n+1,html:`<p>Cached ${start+n+1}</p>`})),next_after:start<64?start+32:null});
  }));
  await act(async()=>root.render(<NominalDeliveries/>));await click('Leer versión');await click('Más historial sellado');await click('Más historial sellado');
  const slider=node.querySelector<HTMLInputElement>('input[type=range]')!;
  await change(slider,'95');await change(slider,'0');expect(node.textContent).toContain('Fetched evicted 1');expect(calls.filter(url=>url.endsWith('/event'))).toHaveLength(1);
});
it('waits on the existing rate limit and can abort the retry without restoring content', async () => {
  vi.useFakeTimers();let calls=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/received')?json({items:[item()],next_cursor:null}):(++calls===1?json({},429):json(page()))));
  await act(async()=>root.render(<NominalDeliveries/>));await click('Leer versión');expect(calls).toBe(1);
  await act(async()=>{resetIdentity(2);window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));});await act(async()=>vi.advanceTimersByTime(60001));expect(calls).toBe(1);expect(node.querySelector('.sealed-reading')).toBeNull();
});

it('M3.4E: Next traverses 32/64 boundaries to the real end of two distinct sealed versions', async () => {
  const calls: {url:string; after?:number}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/received'))return json({items:[item(),{...item(2),version_id:'version-b',version_number:2}],next_cursor:null});
    const body=JSON.parse(String(init?.body));calls.push({url,after:body.after});
    const total=url.includes('/grant-2/')?79:65;
    if(url.endsWith('/event'))return json({...page(),events:[{id:body.event,sequence:body.event,html:`<p>sealed ${total} event ${body.event} á á</p><p></p>`}]});
    const after=body.after??0,end=Math.min(after+32,total);
    return json({...page(),version:{number:total===79?2:1,sealed_at:'2026-10-19'},total_events:total,events:Array.from({length:end-after},(_,i)=>({id:after+i+1,sequence:after+i+1,html:`<p>sealed ${total} event ${after+i+1} á á</p><p></p>`})),next_after:end<total?end:null});
  }));
  await act(async()=>root.render(<NominalDeliveries/>));await click('Leer versión');
  for(let i=1;i<65;i++)await act(async()=>node.querySelector<HTMLButtonElement>('[aria-label="Evento siguiente"]')!.click());
  expect(node.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('64');
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Evento siguiente"]')!.disabled).toBe(true);
  expect(node.textContent).toContain('sealed 65 event 65');
  expect(calls.filter(c=>c.url.endsWith('/page')).map(c=>c.after)).toEqual([0,32,64]);
  await click('Volver a Entregas');
  await act(async()=>[...node.querySelectorAll<HTMLButtonElement>('button')].filter(b=>b.textContent==='Leer versión')[1].click());
  expect(node.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('0');
  await click('Más historial sellado');
  await change(node.querySelector('input[type=range]')!,'78');expect(node.textContent).toContain('sealed 79 event 79');
  expect(node.textContent).not.toContain('sealed 65 event 65');
  expect(node.querySelectorAll('.event-list button').length).toBeLessThanOrEqual(41);
  await act(async()=>node.querySelector<HTMLButtonElement>('[aria-label="Evento anterior"]')!.click());
  expect(node.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('77');
  expect(calls.every(c=>c.url.includes('/share/deliveries/'))).toBe(true);
});
it('M3.4E: real replay component autoplays 65 frames across three controlled API pages', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/received'))return json({items:[item()],next_cursor:null});
    const body=JSON.parse(String(init?.body)),after=body.after??0,end=Math.min(after+32,65);
    if(url.endsWith('/event'))return json({...page(),events:[{id:body.event,sequence:body.event,html:`<p>frame ${body.event}</p>`}]});
    return json({...page(),total_events:65,events:Array.from({length:end-after},(_,i)=>({id:after+i+1,sequence:after+i+1,html:`<p>frame ${after+i+1}</p>`})),next_after:end<65?end:null});
  }));
  await act(async()=>root.render(<NominalDeliveries/>));await click('Leer versión');await click('Reproducir');
  for(let n=0;n<68;n++)await act(async()=>vi.advanceTimersByTime(801));
  expect(node.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('64');
  expect(node.querySelector('.submission-process')!.textContent).toContain('frame 65');
  expect(node.querySelector('.submission-process')!.textContent).toContain('Fin del historial sellado disponible');
});
it('M3.4E: link replay retains autoplay after page 32 and refetches evicted frames through its Gate endpoint', async () => {
  vi.useFakeTimers();const calls:{url:string;after?:number}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));calls.push({url,after:body.after});
    const after=body.after??0,end=Math.min(after+32,65);
    const reading={version:{number:1,sealed_at:'2026-10-20'},snapshot_html:'<p>sealed snapshot</p>',coverage:{status:'limited',complete:false},total_events:65,
      events:url.endsWith('/event')?[{id:body.event,sequence:body.event,html:`<p>link frame ${body.event}</p>`}]:Array.from({length:end-after},(_,i)=>({id:after+i+1,sequence:after+i+1,html:`<p>link frame ${after+i+1}</p>`})),next_after:end<65?end:null};
    return json(url.endsWith('/event')?reading:{level:3,seal:{certificate_code:'VRT-TEST',version_number:1,valid:true},reading});
  }));
  await act(async()=>root.render(<VersionShareApp initialSecret={'S'.repeat(43)}/>));await click('Reproducir');
  for(let n=0;n<70;n++)await act(async()=>vi.advanceTimersByTime(1001));
  expect(node.textContent).toContain('link frame 65');expect([...new Set(calls.filter(c=>c.url.endsWith('/query')).map(c=>c.after))]).toEqual([0,32,64]);
  await change(node.querySelector('input[type=range]')!,'0');expect(node.textContent).toContain('link frame 1');
  expect(calls.some(c=>c.url.endsWith('/event'))).toBe(true);expect(calls.every(c=>c.url.includes('/process-summary/share/'))).toBe(true);
});

it('labels the author current title separately from a fixed issue title', async () => {
 window.history.replaceState(null,'','/deliveries/sent');
 vi.stubGlobal('fetch',vi.fn(async()=>json({items:[{...item(),document_title:'Prueba_4',title_basis:'current'}],next_cursor:null})));
 await act(async()=>root.render(<NominalDeliveries/>));
 expect(node.querySelector('h3')?.textContent).toBe('Prueba_4');
 expect(node.textContent).toContain('Título actual (no fijado en esta emisión)');
});

it('keeps the header route and selected inbox consistent after visiting Sent', async () => {
 window.history.replaceState(null,'','/deliveries/sent');
 const fetch = vi.fn(async (url:string)=>json(url.endsWith('/me') ? {user:{id:1,name:'Fixture'}} : url.endsWith('/documents') ? {documents:[]} : url.endsWith('/folders') ? {folders:[]} : url.endsWith('/submissions') ? {received:[],sent:[]} : {items:[{...item(),document_title:'Prueba_4'}],next_cursor:null}));
 vi.stubGlobal('fetch',fetch);
 await act(async()=>root.render(<App/>));
 expect(node.querySelector('.nominal-deliveries [aria-pressed=true]')?.textContent).toBe('Enviadas');
 await act(async()=>{ [...node.querySelectorAll<HTMLButtonElement>('.topbar nav button')].find(b=>b.textContent==='Entregas')!.click(); });
 expect(location.pathname).toBe('/deliveries/received');
 expect(node.querySelector('.nominal-deliveries [aria-pressed=true]')?.textContent).toBe('Recibidas');
 expect(fetch.mock.calls.some(([url])=>url.endsWith('/received'))).toBe(true);
 expect(node.querySelectorAll('.nominal-deliveries')).toHaveLength(1);
});

it('post-seal dialog focuses sharing, supports Escape and restores the trigger', async () => {
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const dismiss=vi.fn();
 await act(async()=>root.render(<SealedShareOffer documentId="doc" version={{id:'sealed-a',version_number:1} as never} onDismiss={dismiss}/>));
 expect(document.activeElement?.textContent).toBe('Compartir esta versión');
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(dismiss).toHaveBeenCalledOnce();
 await act(async()=>root.render(null));expect(document.activeElement).toBe(trigger);trigger.remove();
});

it('styles the inbox controls while keeping native keyboard buttons, labels and synchronized directions', async () => {
 vi.stubGlobal('fetch',vi.fn(async()=>json({items:[item()],next_cursor:null})));
 await act(async()=>root.render(<NominalDeliveries/>));
 const nav=node.querySelector('.delivery-navigation')!;
 expect(nav.getAttribute('aria-label')).toBe('Bandejas');
 expect(nav.querySelector('[aria-pressed=true]')?.textContent).toBe('Recibidas');
 expect(node.querySelectorAll('.delivery-filters label')).toHaveLength(2);
 await click('Enviadas'); expect(location.pathname).toBe('/deliveries/sent');
 expect(nav.querySelector('[aria-pressed=true]')?.textContent).toBe('Enviadas');
 await change(node.querySelector('input')!, 'no match'); expect(node.querySelectorAll('.delivery-inbox li')).toHaveLength(0);
 await change(node.querySelector('input')!, ''); await change(node.querySelector('select')!, 'revoked');
 expect(node.querySelectorAll('.delivery-inbox li')).toHaveLength(0);
 await change(node.querySelector('select')!, 'active'); expect(node.querySelectorAll('.delivery-inbox li')).toHaveLength(1);
});
