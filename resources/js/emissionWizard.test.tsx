// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import VersionShareApp from './VersionShareApp';
import { sharePdf } from './sharePdf';
import { resetIdentity } from './api';
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
