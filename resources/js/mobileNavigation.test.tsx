// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { SESSION_EXPIRED_EVENT, resetIdentity } from './api';
import { setLocale } from './i18n';
const lifecycle=vi.hoisted(()=>({mounts:0,unmounts:0}));
vi.mock('./VeritasEditor',async()=>{
  const React=await import('react');
  return {default:React.forwardRef(function Stub({initialHtml}:{initialHtml:string},ref){
    React.useEffect(()=>{lifecycle.mounts++;return ()=>{lifecycle.unmounts++;};},[]);
    React.useImperativeHandle(ref,()=>({getHTML:()=>initialHtml,waitForUploads:async()=>true}));
    return <div data-editor="synthetic" dangerouslySetInnerHTML={{__html:initialHtml}}/>;
  })};
});
vi.mock('./DocumentsWorkspace',()=>({default:({documents,onOpen}:{documents:{id:string;title:string}[];onOpen:(d:unknown)=>void})=><div data-archive="synthetic">{documents.map(d=><button key={d.id} onClick={()=>onOpen(d)}>{d.title}</button>)}</div>}));
let host:HTMLDivElement,root:Root;
const documents=['d1','d2'].map((id,i)=>({id,owner_id:7,title:id,content_html:`<p>á é ñ<br>draft ${i}</p>`,content_text:'draft',word_count:3,status:'draft',revision:0,created_at:'2026-10-15T10:00:00Z',updated_at:'2026-10-15T10:00:00Z',versions_count:i?0:2,versions:i?[]:[1,2].map(n=>({id:'v'+n,version_number:n,certificate:{id:'c'+n,certificate_code:'VRT-SYNTHETIC-'+n,issued_at:'2026-10-15T10:00:00Z'}}))}));
const click=async(selector:string)=>act(async()=>{const el=host.querySelector<HTMLButtonElement>(selector)!;el.focus();el.click();});
beforeEach(()=>{
  lifecycle.mounts=0;lifecycle.unmounts=0;localStorage.clear();setLocale('es');resetIdentity(7);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
    const url=new URL(input,'http://localhost');const path=url.pathname;
    const payload=path==='/api/me'?{user:{id:7,name:'Synthetic',email:'synthetic@example.test'}}:path==='/api/folders'?{folders:[]}:path==='/api/documents'?{documents}:path.endsWith('/timeline')?{events:[],next_cursor:null}:path.endsWith('/events')?{accepted:1}:{document:documents.find(d=>path.endsWith(d.id))};
    return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
  }));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();resetIdentity();localStorage.clear();});
it('keeps the workspace editor and single history reader through panel tabs and moviola; clears panel on session expiry',async()=>{
  await act(async()=>root.render(<App/>));await click('[data-archive] button');
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  const editor=host.querySelector('[data-editor]')!;const html=editor.innerHTML;
  const historyCalls=()=>vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/timeline')).length;
  expect(historyCalls()).toBe(1);expect(lifecycle.mounts).toBe(1);
  const before=vi.mocked(fetch).mock.calls.length;
  await click('.evidence-access button');await click('#evidence-tab-versions');await click('.evidence-mobile-heading button');
  expect(host.querySelector('[data-editor]')).toBe(editor);expect(editor.innerHTML).toBe(html);
  expect(vi.mocked(fetch).mock.calls.length).toBe(before);expect(historyCalls()).toBe(1);
  expect(host.querySelectorAll('.sealed-pdf-choice')).toHaveLength(1);expect(host.querySelector('.save-state')?.textContent).toBe('Todo guardado');
  await click('.evidence-access button');await click('.process-card');
  expect(host.querySelector('.timeline-view')).not.toBeNull();expect(host.querySelector('[data-editor]')).toBe(editor);
  expect(host.querySelector<HTMLElement>('.editor-layout')!.style.display).toBe('none');
  const afterOpen=vi.mocked(fetch).mock.calls.length;
  await click('.timeline-view button');
  expect(host.querySelector('.timeline-view')).toBeNull();expect(vi.mocked(fetch).mock.calls.length).toBe(afterOpen);
  expect(lifecycle.unmounts).toBe(0);expect(editor.innerHTML).toBe(html);
  expect(vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(0);
  await click('.evidence-access button:nth-child(2)');
  await act(async()=>window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)));
  expect(host.querySelector('#mobile-evidence')).toBeNull();expect(host.textContent).not.toContain('VRT-SYNTHETIC');expect(document.body.style.overflow).toBe('');
});
it('replaces document identity and shows localized empty versions without previous codes',async()=>{
  await act(async()=>root.render(<App/>));await click('[data-archive] button');await click('.evidence-access button:nth-child(2)');
  await click('.evidence-mobile-heading button');await click('.document-context .back-link');
  await click('[data-archive] button:nth-child(2)');await click('.evidence-access button:nth-child(2)');
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('Todavía no hay versiones selladas.');expect(host.textContent).not.toContain('VRT-SYNTHETIC');
  await act(async()=>setLocale('en'));
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('No sealed versions yet.');
});

it('opens management for the exact selected sealed version from ordinary Versiones without editor writes',async()=>{
  const original=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async(...args)=>{
    const response=await original(...args);const data=await response.json();
    if(data.document?.versions) data.document.versions=data.document.versions.map((v:object)=>({...v,sealed_at:'2026-10-18T10:00:00Z'}));
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  });
  await act(async()=>root.render(<App/>));await click('[data-archive] button');
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  const editor=host.querySelector('[data-editor]');const html=editor?.innerHTML;
  const before=vi.mocked(fetch).mock.calls.length;
  await click('.evidence-access button:nth-child(2)');
  const link=host.querySelector<HTMLAnchorElement>('a[href^="/process-summary/share/manage/"]')!;
  expect(link.getAttribute('href')).toBe('/process-summary/share/manage/d1/v2');
  expect(link.target).toBe('_blank');expect(link.rel).toContain('noreferrer');
  const select=link.parentElement!.querySelector('select')!;
  await act(async()=>{select.value='v1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(link.getAttribute('href')).toBe('/process-summary/share/manage/d1/v1');
  await act(async()=>setLocale('en'));expect(link.textContent).toBe('Share sealed version');
  expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  expect(host.querySelector('[data-editor]')).toBe(editor);expect(editor?.innerHTML).toBe(html);
  expect(lifecycle.mounts).toBe(1);expect(lifecycle.unmounts).toBe(0);
});
