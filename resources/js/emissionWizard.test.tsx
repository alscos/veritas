// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import VersionShareApp from './VersionShareApp';
import { sharePdf } from './sharePdf';
import { resetIdentity, SESSION_EXPIRED_EVENT } from './api';
vi.mock('./sharePdf', async original => ({...await original<typeof import('./sharePdf')>(), sharePdf: vi.fn()}));
afterEach(() => { resetIdentity(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([1,2,3] as const)('issues one grant at confirmation and retains full owner PDF/link before finishing, level %s', async level => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetIdentity(1); document.documentElement.lang='es';
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);const done=vi.fn();
  const issued:unknown[]=[]; const url='https://example.test/process-summary/share#token='+'S'.repeat(43);
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const fetch=vi.fn(async(path:string,init?:RequestInit)=>{
    if(path.endsWith('/pdf-source'))return json({version_id:'A',snapshot_html:'<p>á á PRIVATE A</p><p></p>',images:{},certificate_code:'VRT-TEST'});
    if(init?.method==='POST'){issued.push(JSON.parse(String(init.body)));return json({grant:{id:'g',level,expires_at:null},url});}
    return json({grants:[]});
  });vi.stubGlobal('fetch',fetch);vi.mocked(sharePdf).mockResolvedValue(new Blob(['%PDF-fixture']));
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:fixture')});
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const click=async(text:string)=>act(async()=>[...node.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());
  const change=async(el:HTMLSelectElement|HTMLTextAreaElement,value:string)=>act(async()=>{
    Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  });
  try {
    await act(async()=>root.render(<VersionShareApp documentId="doc" versionId="A" versionLabel="1 · VRT-TEST" initialSecret="" wizard onDone={done}/>));
    await click('Continuar'); await change(node.querySelector('select')!,String(level));await click('Continuar');
    await change(node.querySelectorAll('select')[1], 'never');
    if(level===3)await change(node.querySelector('textarea')!,'reader@example.test');
    await click('Continuar');expect(issued).toHaveLength(0);expect(node.textContent).toContain('El PDF incluye el texto íntegro');
    await act(async()=>{ const form=node.querySelector('form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); });
    expect(issued).toHaveLength(1);expect(issued[0]).toMatchObject({level,days:null,operation_key:expect.any(String)});
    expect(vi.mocked(sharePdf).mock.calls.at(-1)![0]).toMatchObject({snapshot_html:'<p>á á PRIVATE A</p><p></p>',share:{level,url,expires_at:null}});
    expect(node.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe(url);expect(done).not.toHaveBeenCalled();
    expect(fetch.mock.calls.every(([path])=>!path.endsWith('/query')&&!path.includes('/submissions'))).toBe(true);
    await click('PDF listo · Descargar documento completo');expect(done).toHaveBeenCalledOnce();
  } finally { await act(async()=>root.unmount());node.remove(); }
});

it('keeps a stable preparing state and retries only the PDF after a real Worker error', async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);resetIdentity(1);document.documentElement.lang='es';
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 let rejectPdf!:(error:Error)=>void,finishPdf!:(blob:Blob)=>void;
 vi.mocked(sharePdf).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectPdf=reject;})).mockImplementationOnce(()=>new Promise(resolve=>{finishPdf=resolve;}));
 const url='https://example.test/process-summary/share#token='+'S'.repeat(43);let grants=0;
 const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/pdf-source'))return json({version_id:'A',snapshot_html:'<p>synthetic</p>',images:{}});
  if(init?.method==='POST'){grants++;return json({grant:{id:'g',level:2,expires_at:null},url});}
  return json({grants:[]});
 }));
 const click=async(text:string)=>act(async()=>[...node.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());
 try {
  await act(async()=>root.render(<VersionShareApp documentId="doc" versionId="A" wizard initialSecret=""/>));
  await click('Continuar');await click('Continuar');await click('Continuar');
  await act(async()=>{const form=node.querySelector('form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(grants).toBe(1);expect(node.querySelector('.emission-pdf-status')?.getAttribute('aria-busy')).toBe('true');
  expect(node.textContent).not.toContain('Reintentar');expect(node.textContent).not.toContain('Cancelar PDF');expect(node.textContent).not.toContain('PDF listo');
  expect([...node.querySelectorAll('button')].find(b=>b.textContent==='Preparando PDF completo…')!.disabled).toBe(true);
  await act(async()=>rejectPdf(new Error('synthetic worker error')));
  expect(node.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe(url);expect(node.querySelector('[role=alert]')).toBeTruthy();
  await click('Reintentar PDF');expect(grants).toBe(1);
  await act(async()=>finishPdf(new Blob(['%PDF-synthetic'])));expect(node.textContent).toContain('PDF listo · Descargar');expect(grants).toBe(1);
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const close=new Event('inkgroove:modal-close',{cancelable:true});
  window.dispatchEvent(close);expect(close.defaultPrevented).toBe(true);expect(confirm).toHaveBeenCalledOnce();
 } finally {await act(async()=>root.unmount());node.remove();}
});

it('retains the issued capability through session expiry and retries PDF only after the same owner signs in', async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);resetIdentity(1);document.documentElement.lang='es';
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);let grants=0,sources=0,logins=0;
 const expired=vi.fn();window.addEventListener(SESSION_EXPIRED_EVENT,expired);
 const url='https://example.test/process-summary/share#token='+'S'.repeat(43);
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path==='/api/auth/login')return ++logins===1?json({message:'Synthetic invalid credentials'},401):json({user:{id:1}});
  if(path.endsWith('/pdf-source'))return ++sources===1?json({},401):json({version_id:'A',snapshot_html:'<p>synthetic</p>',images:{}});
  if(init?.method==='POST'){grants++;return json({grant:{id:'g',level:2,expires_at:null},url});}
  return json({grants:[]});
 }));vi.mocked(sharePdf).mockResolvedValue(new Blob(['%PDF-synthetic']));
 const click=async(text:string)=>act(async()=>[...node.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());
 try {
  await act(async()=>root.render(<VersionShareApp documentId="doc" versionId="A" wizard initialSecret=""/>));
  await click('Continuar');await click('Continuar');await click('Continuar');await click('Emitir / compartir');
  expect(node.querySelector('.auth-shell')).toBeTruthy();expect(node.querySelector('input[readonly]')).toBeNull();
  await act(async()=>node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(node.querySelector('.auth-shell')).toBeTruthy();expect(expired).not.toHaveBeenCalled();
  await act(async()=>node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(node.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe(url);
  expect(document.activeElement).toBe(node.querySelector('input[readonly]'));
  await click('Reintentar PDF');expect(expired).not.toHaveBeenCalled();window.removeEventListener(SESSION_EXPIRED_EVENT,expired);expect(grants).toBe(1);expect(sources).toBe(2);expect(node.textContent).toContain('PDF listo · Descargar');
 } finally {await act(async()=>root.unmount());node.remove();}
});
