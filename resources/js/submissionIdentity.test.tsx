// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AcademicSubmissionsView as SubmissionsView } from './SubmissionsView';
import { resetIdentity } from './api';
import { setLocale, t } from './i18n';
let container: HTMLDivElement; let root: Root;
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const item = { id:'s1', sender_id:7, document_version_id:'v1', status:'submitted', submitted_at:'2026-10-14', recipient_email:'recipient@example.test', creator_account:{id:7,kind:'name',value:'<img src=x onerror=alert(1)>'}, sender_account:{id:7,kind:'email',value:'sender@example.test'} };
const version = { id:'v1', document_id:'d1', version_number:1, snapshot_html:'<p>Sealed</p>', word_count:1 };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); resetIdentity(7); container=document.createElement('div'); document.body.append(container); root=createRoot(container); });
afterEach(async () => { await act(async()=>root.unmount()); container.remove(); vi.unstubAllGlobals(); resetIdentity(); });
for (const locale of ['es','en'] as const) it(`renders separate list/detail roles as text and recipient only in sent (${locale})`, async()=>{
  setLocale(locale); vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({sent:[item],received:[]})).mockResolvedValueOnce(response({submission:item,version,history_available:false})));
  await act(async()=>root.render(<SubmissionsView/>));
  const list=container.querySelector('.submission-list')!;
  for (const text of [t('Creado por'),t('Enviado por'),t('Destinatario'),'sender@example.test','recipient@example.test',item.creator_account.value]) expect(list.textContent).toContain(text);
  expect(list.querySelector('img')).toBeNull();
  await act(async()=>container.querySelector<HTMLButtonElement>('[data-submission-id=s1]')!.click());
  const detail=container.querySelector('.submission-detail')!;
  expect(detail.textContent).toContain('sender@example.test'); expect(detail.textContent).toContain(t('Destinatario')); expect(detail.querySelector('img')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});
it('clears old identities during selection and ignores a late response; localizes missing/restricted values',async()=>{
  setLocale('en'); let finish!: (r: Response)=>void;
  const second={...item,id:'s2',creator_account:{id:42,kind:'restricted',value:null},sender_account:{id:null,kind:'unavailable',value:null}};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({sent:[],received:[item,second,{...item,id:'s3',creator_account:undefined,sender_account:undefined}]})).mockImplementationOnce(()=>new Promise<Response>(r=>finish=r)).mockResolvedValueOnce(response({submission:second,version:{...version,id:'v2'},history_available:false})));
  await act(async()=>root.render(<SubmissionsView/>));
  expect(container.textContent).toContain(t('Cuenta desconocida')); expect(container.textContent).toContain(t('Cuenta no disponible')); expect(container.textContent).toContain(t('Cuenta #{id} (perfil no autorizado)',{id:42}));
  expect(container.querySelector('.submission-list')?.textContent).not.toContain(t('Destinatario'));
  await act(async()=>container.querySelector<HTMLButtonElement>('[data-submission-id=s1]')!.click());
  expect(container.querySelector('.submission-detail')?.textContent).not.toContain('sender@example.test');
  await act(async()=>container.querySelector<HTMLButtonElement>('[data-submission-id=s2]')!.click());
  await act(async()=>finish(response({submission:item,version,history_available:false})));
  const detail=container.querySelector('.submission-detail')!;
  expect(detail.textContent).toContain(t('Cuenta no disponible')); expect(detail.textContent).not.toContain('sender@example.test'); expect(detail.textContent).not.toContain(t('Destinatario'));
});
