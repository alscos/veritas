// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { CONTENT_FONTS } from './contentFonts';
import { createVeritasExtensions } from './VeritasEditor';
it.each(Object.keys(CONTENT_FONTS))('round trips explicit %s without changing literal text or paste provenance', font => {
 const create = (content: string) => new Editor({ element: document.createElement('div'), extensions: createVeritasExtensions(), content });
 const first = create('<p><mark data-origin="paste">á ge\u0301nesis</mark></p>');let reopened: Editor | undefined;
 try {
  const before = first.getText();first.commands.selectAll();first.chain().setMark('veritasTypography', { font, size: '12' }).setBold().setItalic().run();
  const html = first.getHTML(); expect(html).toContain(`data-font="${font}"`);expect(html).toContain('data-origin="paste"');
  reopened = create(html);expect(reopened.getHTML()).toBe(html);expect(reopened.getText()).toBe(before);
  const marks = reopened.getJSON().content![0].content![0].marks!.map(m => m.type);
  expect(marks).toContain('bold');expect(marks).toContain('italic');expect(marks).toContain('veritasProvenance');
 } finally {first.destroy();reopened?.destroy();}
});
