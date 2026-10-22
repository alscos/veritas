// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import MobileEvidence, { EvidenceAccess, type EvidenceTab } from './MobileEvidence';
import { setLocale } from './i18n';
let host: HTMLDivElement, root: Root;
let mounts = 0, cleanups = 0;
function Reading() { useEffect(() => { mounts++; return () => { cleanups++; }; }, []); return <button>Timeline</button>; }
function Fixture() {
  const [tab, setTab] = useState<EvidenceTab | null>(null);
  return <main><section><textarea defaultValue={'á\nñ'}/><EvidenceAccess open={setTab}/></section><MobileEvidence tab={tab} setTab={setTab} activity={<Reading/>} versions={<select aria-label="Version"><option>v1</option><option>v2</option></select>}/></main>;
}
beforeEach(() => { mounts=0; cleanups=0; setLocale('es'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const click = async (el: HTMLElement) => { await act(async()=> { el.focus(); el.click(); }); };
it('opens either section, switches accessible tabs, traps focus and returns to trigger without remounting readers or draft',async()=>{
  await act(async()=>root.render(<Fixture/>));
  const draft=host.querySelector('textarea')!; const triggers=host.querySelectorAll<HTMLButtonElement>('.evidence-access button');
  for (const [index, name] of ['activity','versions'].entries()) {
    await click(triggers[index]);
    const dialog=host.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.id).toBe(`evidence-tab-${name}`);
    expect(host.querySelector('section')!.inert).toBe(true);
    const tabs=dialog.querySelectorAll<HTMLButtonElement>('[role=tab]');
    await click(tabs[1-index]); expect(tabs[1-index].getAttribute('aria-selected')).toBe('true');
    const close=dialog.querySelector<HTMLButtonElement>('[aria-label="Cerrar"]')!;
    await click(close);expect(document.activeElement).toBe(triggers[index]);
    expect(host.querySelector('textarea')).toBe(draft); expect(draft.value).toBe('á\nñ');
  }
  expect(mounts).toBe(1); expect(cleanups).toBe(0);
});
it('supports arrow tabs, Escape, composition safety and Tab wrap; localizes EN',async()=>{
  setLocale('en'); await act(async()=>root.render(<Fixture/>));
  const trigger=host.querySelector<HTMLButtonElement>('.evidence-access button')!;expect(trigger.textContent).toBe('Activity');await click(trigger);
  const tab=host.querySelector<HTMLButtonElement>('[role=tab]')!;
  await act(async()=>tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  expect(document.activeElement?.textContent).toBe('Versions');
  const select=host.querySelector('select')!;select.focus();
  await act(async()=>select.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
  await act(async()=>select.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  await act(async()=>select.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(host.querySelector('[role=dialog]')).toBeNull();expect(document.activeElement).toBe(trigger);expect(document.body.style.overflow).toBe('');
});
it('restores desktop sections, background and listeners on resize and unmount',async()=>{
  let change!:()=>void;
  const media={matches:true,addEventListener:vi.fn((_name:string,listener:()=>void)=>{change=listener;}),removeEventListener:vi.fn()};
  vi.stubGlobal('matchMedia',()=>media);
  await act(async()=>root.render(<Fixture/>));await click(host.querySelector('.evidence-access button')!);
  expect(document.body.style.overflow).toBe('hidden');
  await act(async()=>{media.matches=false;change();});
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelectorAll('#evidence-activity[hidden],#evidence-versions[hidden]')).toHaveLength(0);
  expect(host.querySelector('section')!.inert).not.toBe(true);expect(document.body.style.overflow).toBe('');
  await act(async()=>root.render(<div/>));
  expect(media.removeEventListener).toHaveBeenCalledWith('change',change);
  expect(cleanups).toBe(1);
});
