// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { SESSION_EXPIRED_EVENT, resetIdentity } from './api';
vi.mock('./VeritasEditor',async()=>{
 const React=await import('react');
 return {default:React.forwardRef(function Boundary({defaultContentFontId,initialHtml}:{defaultContentFontId?:string|null;initialHtml:string},ref){
 React.useImperativeHandle(ref,()=>({getHTML:()=>initialHtml,waitForUploads:async()=>true}));
 return <div data-profile={defaultContentFontId??'legacy'}>{initialHtml}</div>;
 })};
});
vi.mock('./DocumentsWorkspace',()=>({default:({documents,onOpen}:{documents:{id:string}[];onOpen:(d:unknown)=>void})=><div data-archive>{documents.map(d=><button key={d.id} onClick={()=>void onOpen(d)}>{d.id}</button>)}</div>}));
let host:HTMLDivElement,root:Root;
const docs=[{id:'new',default_content_font_id:'literata'},{id:'old',default_content_font_id:null}].map(d=>({...d,owner_id:7,title:d.id,content_html:'<p>same HTML</p>',content_text:'same HTML',revision:0,word_count:2,status:'draft',created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',versions:[]}));
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const click=async(s:string)=>act(async()=>host.querySelector<HTMLButtonElement>(s)!.click());
beforeEach(()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 localStorage.clear();resetIdentity(7);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
 const p=String(input);return response(p==='/api/me'?{user:{id:7,name:'Synthetic',email:'synthetic@example.test'}}:p==='/api/documents'?{documents:docs}:p==='/api/folders'?{folders:[]}:p.includes('/timeline')?{events:[],next_cursor:null}:p.endsWith('/events')?{accepted:1}:{document:docs.find(d=>p.endsWith(d.id))});
 }));host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();resetIdentity();localStorage.clear();});
it('R4B simulated API passes persisted profile by document identity and clears it on expiry',async()=>{
 await act(async()=>root.render(<App/>));await click('[data-archive] button');await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(host.querySelector('[data-profile]')?.getAttribute('data-profile')).toBe('literata');
 await click('.document-context .back-link');await click('[data-archive] button:nth-child(2)');
 expect(host.querySelector('[data-profile]')?.getAttribute('data-profile')).toBe('legacy');
 await act(async()=>window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)));expect(host.querySelector('[data-profile]')).toBeNull();
});
it('R4B late document response cannot replace the latest selected identity/profile',async()=>{
 await act(async()=>root.render(<App/>));
 const original=vi.mocked(fetch).getMockImplementation()!;let finish!:(r:Response)=>void;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/documents/new'?new Promise(resolve=>{finish=resolve;}):original(input,init));
 await click('[data-archive] button');await click('[data-archive] button:nth-child(2)');
 await act(async()=>{finish(response({document:docs[0]}));});
 expect(host.querySelector('[data-profile]')?.getAttribute('data-profile')).toBe('legacy');
});
it('R4B mismatched owner in a synthetic detail cannot establish editor identity',async()=>{
 await act(async()=>root.render(<App/>));const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/documents/new'?Promise.resolve(response({document:{...docs[0],owner_id:8}})):original(input,init));
 await click('[data-archive] button');expect(host.querySelector('[data-profile]')).toBeNull();
});
