// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SealedPdfButton, { SealedPdfChoice } from './SealedPdfButton';
import { resetIdentity } from './api';
import { setLocale } from './i18n';
let container: HTMLDivElement; let root: Root;
let workers: FakeWorker[];
class FakeWorker {
  onmessage?: (e: { data: { bytes: ArrayBuffer } }) => void;
  onerror?: () => void; postMessage = vi.fn(); terminate = vi.fn();
  constructor() { workers.push(this); }
}
const source = { version_id: 'v1', version_number: 1, snapshot_html: '<p>SEALED</p>', page_settings: null, certificate_code: 'VRT-TEST', issued_at: null, format_version: 2, public_url: 'https://example.test/verify/VRT-TEST', images: {} };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  workers=[];setLocale('es');resetIdentity(7);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Worker',FakeWorker);
  URL.createObjectURL=vi.fn().mockReturnValue('blob:test');URL.revokeObjectURL=vi.fn();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{ await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();resetIdentity(); });
it('downloads only the exact authenticated source as application/pdf with safe filename',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(source)));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));
  await act(async()=>container.querySelector('button')!.click());
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/documents/d1/versions/v1/pdf-source');
  expect(JSON.stringify(workers[0].postMessage.mock.calls)).toContain('SEALED');
  await act(async()=>workers[0].onmessage!({data:{bytes:new TextEncoder().encode('%PDF-test').buffer}}));
  expect(URL.createObjectURL).toHaveBeenCalled();const blob=vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;expect(blob.type).toBe('application/pdf');
  const anchor=vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as HTMLAnchorElement;expect(anchor.download).toBe('VRT-TEST.pdf');
});
it('cancels worker and suppresses old download when version changes',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(source)));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));
  await act(async()=>container.querySelector('button')!.click());
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v2"/>));
  expect(workers[0].terminate).toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('suppresses render result after account changes',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(source)));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));await act(async()=>container.querySelector('button')!.click());
  resetIdentity(8);await act(async()=>workers[0].onmessage!({data:{bytes:new ArrayBuffer(1)}}));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('shows a clear error on unsupported HTML and never launches renderer',async()=>{
  setLocale('en');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({...source,snapshot_html:'<script>x</script>'})));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));await act(async()=>container.querySelector('button')!.click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Could not prepare');expect(workers).toHaveLength(0);
});

it('offers exact sealed versions and exports the selected historical version', async()=>{
  const version = (id: string, n: number) => ({ id, version_number:n, snapshot_html:'SEALED', snapshot_text:'SEALED', word_count:1, content_hash:'hash', sealed_at:'2026-10-14', certificate:{id:`c${n}`,certificate_code:`VRT-TEST${n}`,issued_at:'2026-10-14'} });
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(source)));
  await act(async()=>root.render(<SealedPdfChoice documentId="d1" versions={[version('v1',1),version('v2',2)]}/>));
  const select=container.querySelector('select')!;expect(select.value).toBe('v2');
  await act(async()=>{select.value='v1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>container.querySelector('button')!.click());
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/documents/d1/versions/v1/pdf-source');
});
it('ignores a late source response after changing versions',async()=>{
  let finish!: (response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve})));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));await act(async()=>container.querySelector('button')!.click());
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v2"/>));await act(async()=>finish(response(source)));
  expect(workers).toHaveLength(0);expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('explains the missing canonical origin without producing a partial download',async()=>{
  setLocale('en');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({message:'Unavailable'}),{status:503,headers:{'Content-Type':'application/json'}})));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));await act(async()=>container.querySelector('button')!.click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('public lookup origin');expect(workers).toHaveLength(0);expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('uses short labelled options and exposes only the selected full code in context', async()=>{
  const version = (id:string,n:number) => ({id,version_number:n,snapshot_html:'SEALED',snapshot_text:'SEALED',word_count:1,content_hash:'hash',sealed_at:'2026-10-15',certificate:{id:`c${n}`,certificate_code:`VRT-${'LONG'.repeat(20)}-${n}`,issued_at:'2026-10-15'}});
  const versions=[version('v1',1),version('v2',2)];
  await act(async()=>root.render(<SealedPdfChoice documentId="d1" versions={versions}/>));
  const select=container.querySelector('select')!;
  expect([...select.options].map(o=>o.textContent)).toEqual(['Versión 2','Versión 1']);
  expect(container.querySelector('label')!.htmlFor).toBe(select.id);
  expect(container.querySelector('code')!.textContent).toBe(versions[1].certificate.certificate_code);
  expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Descargar PDF · Versión 2');
  await act(async()=>{select.value='v1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.querySelector('code')!.textContent).toBe(versions[0].certificate.certificate_code);
  expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Descargar PDF · Versión 1');
  setLocale('en');
  await act(async()=>root.render(<SealedPdfChoice documentId="d1" versions={[versions[0]]}/>));
  expect(container.querySelector('option')!.textContent).toBe('Version 1');
  expect(container.querySelector('button')!.textContent).toBe('Download PDF');
});
it('disables the busy action, announces progress and performs no save request',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(source)));
  await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1" versionNumber={1}/>));
  await act(async()=>container.querySelector('button')!.click());
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(container.querySelector('[role=status]')!.textContent).toBe('Preparando el PDF…');
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  await act(async()=>workers[0].onmessage!({data:{bytes:new ArrayBuffer(1)}}));
  expect(container.querySelector('button')!.disabled).toBe(false);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
});

it('requires deliberate historical selection, sends replacements to worker and cancels without download',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response({...source,snapshot_html:'<p><span data-font="georgia">OLD</span></p>'})));
 await act(async()=>root.render(<SealedPdfButton documentId="d1" versionId="v1"/>));
 expect(container.querySelector('select')!.value).toBe('strict');
 await act(async()=>container.querySelector('button')!.click());expect(workers).toHaveLength(0);
 await act(async()=>{const select=container.querySelector('select')!;select.value='historical';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(container.textContent).toContain('aceptas expresamente');
 await act(async()=>container.querySelector('button')!.click());
 expect(JSON.stringify(workers[0].postMessage.mock.calls)).toContain('georgia → Literata');
 await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Cancelar PDF')!.click());
 expect(workers[0].terminate).toHaveBeenCalled();
 await act(async()=>workers[0].onmessage!({data:{bytes:new ArrayBuffer(1)}}));expect(URL.createObjectURL).not.toHaveBeenCalled();
});
