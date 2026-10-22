import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { contentFont } from './contentFonts';
import { FONT_FAMILIES } from './pageLayout';

/** Read selection only. The persistent profile decides the available catalogue. */
export function fontSelector(editor: Editor, profile: 'literata' | null | undefined) {
  const { from, to, empty, $from } = editor.state.selection;
  const fonts = new Set<string>();
  const effective = (marks: readonly Mark[], base: unknown) =>
    marks.find(mark => mark.type.name === 'veritasTypography')?.attrs.font || (base === 'literata' ? 'literata' : '');
  if (empty) fonts.add(effective(editor.state.storedMarks ?? $from.marks(), $from.parent.attrs.contentFont));
  else editor.state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.isText && pos < to && pos + node.nodeSize > from) fonts.add(effective(node.marks, parent?.attrs.contentFont));
    if (node.isTextblock && !node.content.size) fonts.add(node.attrs.contentFont === 'literata' ? 'literata' : '');
  });
  if (!fonts.size) fonts.add(effective($from.marks(), $from.parent.attrs.contentFont));
  const keys = Object.keys(FONT_FAMILIES).filter(key => profile !== 'literata' || contentFont(key) || fonts.has(key));
  return { keys, showDefault: profile !== 'literata' || fonts.has(''), value: fonts.size === 1 ? [...fonts][0] : '__mixed' };
}
