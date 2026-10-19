// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { expect, it, vi } from 'vitest';
import EditorToolbar from './EditorToolbar';
import { createVeritasExtensions, createVeritasEditorProps } from './VeritasEditor';
import { fontSelector } from './fontSelector';
import { DEFAULT_PAGE, FONT_FAMILIES } from './pageLayout';
import { setLocale } from './i18n';
const open = (html: string, profile: 'literata' | null = 'literata') => new Editor({ element: document.createElement('div'), content: html, extensions: createVeritasExtensions({defaultContentFontId: profile}), editorProps: createVeritasEditorProps() });
const catalogue = ['literata','inter','ibmplexmono'];
it('uses the persistent profile, including identical HTML and unmarked old blocks', () => {
 const e = open('<p data-content-font="literata">á</p>');
 try {
 expect(fontSelector(e,'literata')).toEqual({keys:catalogue,showDefault:false,value:'literata'});
 expect(fontSelector(e,null).keys).toEqual(Object.keys(FONT_FAMILIES));
 e.commands.setContent('<p>ge\u0301nesis</p>', {emitUpdate:false});
 expect(fontSelector(e,'literata')).toEqual({keys:catalogue,showDefault:true,value:''});
 } finally {e.destroy();}
});
it('includes only legacy families actually intersecting the selection and indicates mixed fonts', () => {
 const e=open('<p data-content-font="literata"><span data-font="georgia">abc</span><span data-font="selectric">def</span>ghi</p>');
 try {
 e.commands.setTextSelection(2);expect(fontSelector(e,'literata').keys).toEqual([...catalogue,'georgia']);
 e.commands.setTextSelection({from:1,to:7});expect(fontSelector(e,'literata')).toEqual({keys:[...catalogue,'georgia','selectric'],showDefault:false,value:'__mixed'});
 e.commands.setTextSelection(8);expect(fontSelector(e,'literata').keys).toEqual(catalogue);
 e.commands.setMark('veritasTypography',{font:'courier'});expect(fontSelector(e,'literata').value).toBe('courier');
 } finally {e.destroy();}
});
it('Enter, tables and real paste keep the catalogue without changing Unicode or provenance by inspection',()=>{
 const e=open('<p data-content-font="literata">á ge\u0301nesis</p>');
 try {
 e.commands.setTextSelection(e.state.doc.content.size-1);e.commands.splitBlock();expect(fontSelector(e,'literata').keys).toEqual(catalogue);
 e.commands.insertTable({rows:2,cols:2});expect(fontSelector(e,'literata').keys).toEqual(catalogue);
 e.view.someProp('handlePaste',fn=>fn(e.view,{clipboardData:{files:[],getData:()=> 'á ge\u0301nesis\n\nfin'}} as unknown as ClipboardEvent,{} as never));
 const before=e.getHTML();let writes=0;e.on('update',()=>writes++);
 fontSelector(e,'literata');fontSelector(e,null);fontSelector(e,'literata');
 expect(e.getHTML()).toBe(before);expect(writes).toBe(0);expect(before).toContain('ge\u0301nesis');expect(before).toContain('data-origin="paste"');
 } finally {e.destroy();}
});
it('real React toolbar changes profile and locale without mutations; menu tabs keep selection; choosing a family works',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const e=open('<p data-content-font="literata"><mark data-origin="paste">á ge\u0301nesis</mark></p>');
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=async(profile:'literata'|null)=>act(async()=>root.render(<EditorToolbar defaultContentFontId={profile} editor={e} title="Synthetic" page={DEFAULT_PAGE} onPageChange={()=>{}} onImage={()=>{}} beforeExport={async()=>true} busy={false} zoom={1} onZoom={()=>{}} onError={()=>{}}/>));
 const options=()=>[...host.querySelectorAll<HTMLSelectElement>('select')[1].options].map(o=>o.value);
 try {
 const before=e.getHTML();let writes=0;e.on('update',()=>writes++);
 await render('literata');expect(options()).toEqual(catalogue);
 await act(async()=>host.querySelector<HTMLButtonElement>('#tab-insert')!.click());
 await act(async()=>host.querySelector<HTMLButtonElement>('#tab-format')!.click());expect(options()).toEqual(catalogue);
 await render(null);expect(options()).toContain('selectric');
 setLocale('en');await render('literata');expect(host.querySelector('[aria-label="Font family"]')).not.toBeNull();expect(options()).toEqual(catalogue);
 expect(e.getHTML()).toBe(before);expect(writes).toBe(0);
 const select=host.querySelectorAll('select')[1];await act(async()=>{select.value='inter';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(e.getAttributes('veritasTypography').font).toBe('inter');expect(e.getText()).toContain('ge\u0301nesis');
 } finally {await act(async()=>root.unmount());host.remove();e.destroy();setLocale('es');vi.unstubAllGlobals();}
});
