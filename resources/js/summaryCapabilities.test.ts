// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const recipient = readFileSync('public/summary-capability.js', 'utf8');
const owner = readFileSync('public/summary-capability-owner.js', 'utf8');
const secret = 'A'.repeat(43);
const dto = { version: { number: 1, sealed_at: '2026-10-17' }, coverage: { status: 'limited', complete: false }, counts: { state: 'unavailable', value: null } };
const listeners: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
const tick = async () => { for (let i=0;i<10;i++) await Promise.resolve(); };
beforeEach(() => {
  const original=window.addEventListener.bind(window);
  vi.spyOn(window,'addEventListener').mockImplementation((type,listener,options)=>{
    if(listener)listeners.push([type,listener,options]);original(type,listener,options);
  });
  document.documentElement.lang='es';
  document.head.innerHTML='<meta name="csrf-token" content="synthetic-csrf">';
  document.body.innerHTML='<h1 id="heading"></h1><select id="language"><option value="es">ES</option><option value="en">EN</option></select><p id="notice"></p><p id="status" role="status"></p><dl id="summary"></dl>';
});
afterEach(() => {for(const [type,listener,options] of listeners)window.removeEventListener(type,listener,options);listeners.length=0;vi.unstubAllGlobals();vi.restoreAllMocks();});
it('removes fragment before POST, uses CSRF and same origin; missing counts never render as zero',async()=>{
  history.replaceState(null,'','/process-summary#token='+secret);
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>dto});vi.stubGlobal('fetch',fetch);
  const storage=vi.spyOn(Storage.prototype,'setItem');
  window.eval(recipient);
  expect(location.hash).toBe('');expect(location.search).toBe('');await tick();
  expect(fetch).toHaveBeenCalledOnce();const [url,options]=fetch.mock.calls[0];
  expect(url).toBe('/process-summary/query');expect(url).not.toContain(secret);
  expect(JSON.parse(options.body)).toEqual({capability:secret});
  expect(options.credentials).toBe('same-origin');expect(options.referrerPolicy).toBe('no-referrer');
  expect(options.headers['X-CSRF-TOKEN']).toBe('synthetic-csrf');expect(options.cache).toBe('no-store');
  expect(storage).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain(secret);
  expect(document.getElementById('summary')!.textContent).toContain('No disponible');
  expect([...document.querySelectorAll('#summary dd')].slice(-4).map(n=>n.textContent)).toEqual(Array(4).fill('No disponible'));
  const lang=document.getElementById('language') as HTMLSelectElement;lang.value='en';lang.dispatchEvent(new Event('change'));
  expect(document.getElementById('notice')!.textContent).toContain('complete=false');
  expect(document.getElementById('summary')!.textContent).toContain('Unavailable');
  dispatchEvent(new Event('pagehide'));expect(document.getElementById('summary')!.textContent).toBe('');
});
it('requires received link on reload and shows neutral failure without fetching',async()=>{
  history.replaceState(null,'','/process-summary');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  window.eval(recipient);await tick();expect(fetch).not.toHaveBeenCalled();
  expect(document.getElementById('status')!.textContent).toContain('Abre de nuevo');
});
it('real zero is displayed only from an available count object; errors contain no private response',async()=>{
  history.replaceState(null,'','/process-summary#token='+secret);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({...dto,counts:{value:{direct:0,pasted:0,edited:0,total:0}}})}));
  window.eval(recipient);await tick();expect(document.getElementById('summary')!.textContent).toContain('Total0');
  history.replaceState(null,'','/process-summary#token='+secret);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({private:'PRIVATE ERROR'})}));
  window.eval(recipient);await tick();expect(document.body.textContent).not.toContain('PRIVATE ERROR');
  expect(document.getElementById('summary')!.textContent).toBe('');
});
it('owner emits one relative fragment link, lists metadata, copies and revokes without storage',async()=>{
  history.replaceState(null,'','/process-summary/manage/doc/version');
  document.body.innerHTML='<h1 id="heading"></h1><select id="language"><option value="es">ES</option><option value="en">EN</option></select><p id="notice"></p><label id="days-label" for="days"></label><form id="create"><input id="days" value="7"><button id="generate"></button></form><p id="status"></p><div id="once"></div><ul id="grants"></ul>';
  let revoked=false;
  const fetch=vi.fn(async(url:string,options:any)=>({ok:true,status:url.endsWith('revoke')?204:200,json:async()=>options.method==='POST'?{url:'/process-summary#token='+secret,grant:{id:'one'}}:{grants:[{id:'one',state:revoked?'revoked':'active',expires_at:'2026-10-24'}]}}));
  vi.stubGlobal('fetch',fetch);const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  window.eval(owner);await tick();
  expect(document.getElementById('notice')!.textContent).toContain('solo local');
  document.getElementById('create')!.dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  const input=document.querySelector('#once input') as HTMLInputElement;expect(input.value).toContain('#token='+secret);
  (document.querySelector('#once button') as HTMLButtonElement).click();await tick();expect(writeText).toHaveBeenCalledWith(input.value);
  revoked=true;(document.querySelector('#grants button') as HTMLButtonElement).click();await tick();expect(document.getElementById('grants')!.textContent).toContain('Revocado');
  dispatchEvent(new Event('pagehide'));expect(document.getElementById('once')!.textContent).toBe('');
  expect(fetch.mock.calls.every(([url])=>!url.includes(secret))).toBe(true);
});
it('does not repopulate a summary from a response arriving after pagehide',async()=>{
  history.replaceState(null,'','/process-summary#token='+secret);
  let finish!: (value:unknown)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finish=resolve;})));
  window.eval(recipient);dispatchEvent(new Event('pagehide'));
  finish({ok:true,json:async()=>dto});await tick();
  expect(document.getElementById('summary')!.textContent).toBe('');
});
it('does not restore an issued secret after leaving the owner page',async()=>{
  history.replaceState(null,'','/process-summary/manage/doc/version');
  document.body.innerHTML='<h1 id="heading"></h1><select id="language"><option value="es">ES</option><option value="en">EN</option></select><p id="notice"></p><label id="days-label"></label><form id="create"><input id="days" value="7"><button id="generate"></button></form><p id="status"></p><div id="once"></div><ul id="grants"></ul>';
  let finish!: (value:unknown)=>void;
  vi.stubGlobal('fetch',vi.fn((_url,options)=>options.method==='POST'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,status:200,json:async()=>({grants:[]})})));
  window.eval(owner);await tick();
  document.getElementById('create')!.dispatchEvent(new Event('submit',{cancelable:true}));
  dispatchEvent(new Event('pagehide'));finish({ok:true,status:201,json:async()=>({url:'/process-summary#token='+secret})});await tick();
  expect(document.querySelector('#once input')).toBeNull();expect(document.body.textContent).not.toContain(secret);
});
