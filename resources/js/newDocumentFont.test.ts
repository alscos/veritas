// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { createVeritasExtensions } from './VeritasEditor';
const open = (content: string) => new Editor({ element: document.createElement('div'), extensions: createVeritasExtensions(), content });
it('persists the explicit new-document base through typing, split, heading, save and reopen', () => {
 const editor = open('<p data-content-font="literata"></p>');
 let reopened: Editor | undefined;
 try {
  editor.commands.insertContent('á ge\u0301nesis'); editor.commands.splitBlock(); editor.commands.insertContent('dos');
  editor.commands.toggleHeading({ level: 2 });
  const html = editor.getHTML(); expect(html.match(/data-content-font="literata"/g)).toHaveLength(2);
  reopened = open(html); expect(reopened.getHTML()).toBe(html); expect(reopened.getText()).toContain('ge\u0301nesis');
  reopened.commands.setTextSelection(reopened.state.doc.content.size - 1); reopened.commands.insertContent(' más'); const saved = reopened.getHTML();
  const again = open(saved); expect(again.getHTML()).toBe(saved); again.destroy();
 } finally { editor.destroy(); reopened?.destroy(); }
});
it.each(['<p></p>', '<p>á ge\u0301nesis</p>', '<p><span data-font="georgia" style="font-family: Georgia, serif;">viejo</span></p>'])('opens legacy without adding a new default: %s', html => {
 const editor = open(html); try { expect(editor.getHTML()).toBe(html); expect(editor.getHTML()).not.toContain('data-content-font'); } finally { editor.destroy(); }
});
it('records the remaining boundary: newly inserted table paragraphs do not inherit the block base', () => {
 const editor = open('<p data-content-font="literata">nuevo</p>');
 try {
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
  const template = document.createElement('template'); template.innerHTML = editor.getHTML();
  expect(template.content.querySelector('table p')).not.toBeNull();
  expect(template.content.querySelector('table p')!.hasAttribute('data-content-font')).toBe(false);
 } finally { editor.destroy(); }
});
