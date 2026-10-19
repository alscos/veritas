// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { expect, it } from 'vitest';
import { createVeritasExtensions, createVeritasEditorProps } from './VeritasEditor';
const open = (content = '<p></p>', profile: 'literata' | null = 'literata') => new Editor({element: document.createElement('div'), content, extensions: createVeritasExtensions({defaultContentFontId: profile}), editorProps: createVeritasEditorProps()});
const blocks = (e: Editor) => { const t = document.createElement('template');t.innerHTML=e.getHTML(); return [...t.content.querySelectorAll('p,h1,h2,h3')]; };
it('R4B profile independent from HTML: opening and typing never rewrite existing blocks; Enter creates a new block', () => {
 const e=open('<p>ge\u0301nesis</p>');try {
 let writes=0;e.on('update',()=>writes++);expect(writes).toBe(0);expect(blocks(e)[0].hasAttribute('data-content-font')).toBe(false);
 e.commands.setTextSelection(3);e.commands.insertContent('á');expect(blocks(e)[0].hasAttribute('data-content-font')).toBe(false);
 e.commands.setTextSelection(e.state.doc.content.size-1);e.commands.splitBlock();expect(blocks(e).map(p=>p.getAttribute('data-content-font'))).toEqual([null,'literata']);
 e.commands.toggleHeading({level:2});expect(blocks(e)[1].tagName).toBe('H2');expect(writes).toBe(3);
 }finally{e.destroy();}
});
it('R4B 2x2 table cells, cell Enter and exact undo/redo are one update per action',()=>{
 const e=open();try{let writes=0;e.on('update',()=>writes++);const before=e.getHTML();
 e.commands.insertTable({rows:2,cols:2,withHeaderRow:true});const table=e.getHTML();expect(writes).toBe(1);
 expect(blocks(e).filter(p=>p.closest('table')).map(p=>p.getAttribute('data-content-font'))).toEqual(Array(4).fill('literata'));
 e.commands.undo();expect(e.getHTML()).toBe(before);e.commands.redo();expect(e.getHTML()).toBe(table);
 e.commands.insertContent('ge\u0301nesis');e.commands.splitBlock();expect(blocks(e).filter(p=>p.closest('table')).every(p=>p.getAttribute('data-content-font')==='literata')).toBe(true);
 }finally{e.destroy();}
});
it('R4B real multiline paste preserves empty lines, literal NFD, provenance and cursor',()=>{
 const e=open();try{
 e.view.someProp('handlePaste',fn=>fn(e.view,{clipboardData:{files:[],getData:()=> 'á\nge\u0301nesis\n\nfin'}} as unknown as ClipboardEvent,{} as never));
 expect(blocks(e)).toHaveLength(4);expect(blocks(e).every(p=>p.getAttribute('data-content-font')==='literata')).toBe(true);
 expect(e.getText()).toBe('á\n\nge\u0301nesis\n\n\n\nfin');expect(e.getHTML()).toContain('data-origin="paste"');
 const pos=e.state.selection.from;e.commands.insertContent('Z');expect(e.state.selection.from).toBe(pos+1);expect(e.getHTML()).toContain('data-origin="paste"');
 const html=e.getHTML();const again=open(html);expect(again.getHTML()).toBe(html);again.destroy();
 }finally{e.destroy();}
});
it('R4B list wrapping preserves old block; split/nesting, structural replacement and replay retain new attributes',()=>{
 const e=open('<p>old</p>');try{
 e.commands.toggleBulletList();expect(blocks(e)[0].hasAttribute('data-content-font')).toBe(false);
 e.commands.setTextSelection(6);e.commands.splitListItem('listItem');e.commands.insertContent('nuevo');e.commands.sinkListItem('listItem');
 expect(blocks(e).some(p=>p.textContent==='nuevo'&&p.getAttribute('data-content-font')==='literata')).toBe(true);
 e.view.dispatch(closeHistory(e.state.tr));e.commands.selectAll();e.commands.insertContent('<blockquote><p>ge\u0301nesis</p><p></p></blockquote><p>fin</p>');
 const html=e.getHTML();expect(blocks(e).every(p=>p.getAttribute('data-content-font')==='literata')).toBe(true);
 e.commands.undo();e.commands.redo();expect(e.getHTML()).toBe(html);
 }finally{e.destroy();}
});
it.each([null] as const)('R4B legacy stays legacy despite an inline Literata seed', profile=>{
 const e=open('<p><span data-font="literata">old</span></p>',profile);try{e.commands.insertTable({rows:2,cols:2});expect(e.getHTML()).not.toContain('data-content-font');}finally{e.destroy();}
});
it('R4B explicit Georgia/Inter/Plex survive replacement; load setContent does not grant attributes',()=>{
 const e=open();try{
 e.commands.setContent('<p>loaded</p>',{emitUpdate:false});expect(e.getHTML()).toBe('<p>loaded</p>');
 e.commands.selectAll();e.commands.insertContent('<p><span data-font="georgia">old</span></p><p><span data-font="inter">inter</span></p><p><span data-font="ibmplexmono">mono</span></p>');
 expect(e.getHTML()).not.toContain('data-content-font');expect(e.getHTML()).toContain('data-font="georgia"');
 }finally{e.destroy();}
});
it('R4B composition keeps native text node and pasted marks until composition ends; formatting is not a write on opening',()=>{
 const e=open('<p><mark data-origin="paste">gnesis</mark></p>');try{
 e.commands.setTextSelection(2);const text=e.view.dom.querySelector('mark')!.firstChild;
 e.view.dispatch(e.state.tr.insertText('e\u0301').setMeta('composition',1));
 expect(e.view.dom.querySelector('mark')!.firstChild).toBe(text);expect(e.getHTML()).not.toContain('data-content-font');
 expect(e.getHTML()).not.toContain('paste-edited');
 e.view.dispatch(e.state.tr.setMeta('veritas:composition-end',true));
 expect(e.getText()).toBe('ge\u0301nesis');expect(e.getHTML()).toContain('data-origin="paste-edited"');
 expect(e.getHTML()).not.toContain('data-content-font');
 }finally{e.destroy();}
});
it('R4B page-break insertion creates only a new default paragraph and keeps the preceding text and selection',()=>{
 const e=open('<p>old</p>');try{e.commands.setTextSelection(4);e.commands.insertContent([{type:'pageBreak'},{type:'paragraph'}]);
 expect(blocks(e).map(p=>p.getAttribute('data-content-font'))).toEqual([null,'literata']);expect(e.getText()).toContain('old');
 const pos=e.state.selection.from;e.commands.insertContent('á');expect(e.state.selection.from).toBe(pos+1);
 }finally{e.destroy();}
});
it('R4B editing a pasted fragment changes only the introduced character and retains the block base',()=>{
 const e=open();try{
 e.view.someProp('handlePaste',fn=>fn(e.view,{clipboardData:{files:[],getData:()=> 'uno\nge\u0301nesis'}} as unknown as ClipboardEvent,{} as never));
 e.commands.setTextSelection({from:2,to:3});e.commands.insertContent('Z');
 expect(e.getHTML()).toContain('<mark data-origin="paste">u</mark><mark data-origin="paste-edited">Z</mark><mark data-origin="paste">o</mark>');
 expect(blocks(e).every(p=>p.getAttribute('data-content-font')==='literata')).toBe(true);expect(e.getText()).toContain('ge\u0301nesis');
 }finally{e.destroy();}
});
