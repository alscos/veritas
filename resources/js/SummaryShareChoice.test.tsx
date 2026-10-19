// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SummaryShareChoice from './SummaryShareChoice';
import { setLocale } from './i18n';
it('selects an exact sealed version, changes the management destination and translates without API writes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  const versions=[1,2].map(n=>({id:`v${n}`,version_number:n,snapshot_html:'',snapshot_text:'',word_count:2,content_hash:'hash',sealed_at:'2026-10-17',certificate:{id:`c${n}`,certificate_code:`VRT-${n}`,issued_at:'2026-10-17'}}));
  try {
    setLocale('es');await act(async()=>root.render(<SummaryShareChoice documentId="d1" versions={[...versions,{...versions[1],id:"draft",version_number:3,sealed_at:""}]}/>));
    expect(node.querySelector('a')!.getAttribute('href')).toBe('/process-summary/share/manage/d1/v2');
    expect(node.querySelector('a')!.rel).toContain('noreferrer');expect(node.textContent).toContain('Compartir versión sellada');
    const select=node.querySelector('select')!;await act(async()=>{select.value='v1';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(node.querySelector('a')!.getAttribute('href')).toBe('/process-summary/share/manage/d1/v1');
    await act(async()=>setLocale('en'));expect(node.textContent).toContain('Share sealed version');
    await act(async()=>root.render(<SummaryShareChoice documentId="d1" versions={[]}/>));expect(node.textContent).toBe('');
  } finally {await act(async()=>root.unmount());node.remove();setLocale('es');vi.unstubAllGlobals();}
});
