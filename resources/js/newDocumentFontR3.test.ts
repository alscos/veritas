// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { createVeritasExtensions, createVeritasEditorProps } from './VeritasEditor';
const open = (content: string) => new Editor({ element: document.createElement('div'), extensions: createVeritasExtensions(), editorProps: createVeritasEditorProps(), content });
const seed = '<p data-content-font="literata"></p>';
it('R3 diagnosis: table insertion loses the base; undo and redo reproduce the same result', () => {
 const e = open(seed);
 try {
  e.commands.insertContent('<strong><em>á ge\u0301nesis</em></strong>');
  const before = e.getHTML(); e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
  const table = e.getHTML(); const t = document.createElement('template'); t.innerHTML = table;
  expect(t.content.querySelectorAll('table p')).toHaveLength(4);
  expect(t.content.querySelectorAll('table p[data-content-font]')).toHaveLength(0);
  e.commands.undo(); e.commands.redo(); expect(e.getHTML()).toBe(table);
  const again = open(table); expect(again.getHTML()).toBe(table); again.destroy();
  expect(before).toContain('ge\u0301nesis');
 } finally { e.destroy(); }
});
it('R3 diagnosis: real paste handler keeps provenance and Unicode but creates blocks without the base', () => {
 const e = open(seed);
 try {
  e.view.someProp('handlePaste', fn => fn(e.view, { clipboardData: { files: [], getData: () => 'á\nge\u0301nesis\n\nfin' } } as unknown as ClipboardEvent, {} as never));
  const html = e.getHTML(); expect(html).toContain('data-origin="paste"'); expect(e.getText()).toContain('ge\u0301nesis');
  const t = document.createElement('template');t.innerHTML = html;
  expect(t.content.querySelectorAll('p:not([data-content-font])').length).toBeGreaterThan(0);
 } finally { e.destroy(); }
});
it('R3 diagnosis: block base is content, not persistent evidence of document origin', () => {
 // The same HTML can be inserted into a legacy document. No document-level origin reaches the factory.
 const fresh = open(seed); const legacy = open('<p>legacy</p>');
 try {
  legacy.commands.setContent(seed);
  expect(legacy.getJSON()).toEqual(fresh.getJSON());
  fresh.commands.insertTable({ rows: 2, cols: 2 });legacy.commands.insertTable({ rows: 2, cols: 2 });
  expect(legacy.getHTML()).toBe(fresh.getHTML());
 } finally {fresh.destroy();legacy.destroy();}
});
it('R3 split, heading, list and nested list retain literal marks without opening mutations', () => {
 const e = open('<p data-content-font="literata"><mark data-origin="paste"><strong><em>á ge\u0301nesis</em></strong></mark></p>');
 try {
  let writes = 0;e.on('update', () => writes++);expect(writes).toBe(0);
  e.commands.setTextSelection(e.state.doc.content.size - 1);e.commands.splitBlock();e.commands.insertContent('dos');
  e.commands.toggleHeading({level: 2});expect(e.getHTML()).toContain('<h2 data-content-font="literata">');
  e.commands.toggleBulletList();e.commands.splitListItem('listItem');e.commands.insertContent('tres');e.commands.sinkListItem('listItem');
  expect(e.getHTML()).toContain('data-origin="paste"');expect(e.getText()).toContain('ge\u0301nesis');
  const again = open(e.getHTML());expect(again.getHTML()).toBe(e.getHTML());again.destroy();
 } finally {e.destroy();}
});
it('R3 diagnosis: replacing the whole document with an unmarked block removes the only base evidence', () => {
 const e = open(seed);
 try {
  e.commands.insertContent('nuevo');e.commands.selectAll();
  e.commands.insertContent('<p>reemplazo</p>');
  const html=e.getHTML();expect(html).not.toContain('data-content-font');
  const legacy=open(html);expect(legacy.getJSON()).toEqual(e.getJSON());legacy.destroy();
 } finally {e.destroy();}
});
