import { Mapping } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export const BlockLayout = Extension.create({
  name: "veritasBlockLayout",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading"], attributes: {
      contentFont: { default: null, parseHTML: element => element.getAttribute("data-content-font") === "literata" ? "literata" : null, renderHTML: attributes => attributes.contentFont === "literata" ? { "data-content-font": "literata" } : {} },
      indent: { default: 0, parseHTML: element => Math.min(6, Math.max(0, Number(element.getAttribute("data-indent")) || 0)), renderHTML: attributes => attributes.indent ? { "data-indent": attributes.indent } : {} },
      lineHeight: { default: null, parseHTML: element => ["1", "1.15", "1.5", "2"].includes(element.getAttribute("data-line-height") ?? "") ? element.getAttribute("data-line-height") : null, renderHTML: attributes => attributes.lineHeight ? { "data-line-height": attributes.lineHeight } : {} },
    } }];
  },
});
export type SearchMatch = { from: number; to: number };
export const findMatches = (document: PMNode, query: string): SearchMatch[] => {
  const matches: SearchMatch[] = []; if (!query) return matches;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  document.descendants((node, position) => {
    if (!node.isTextblock) return;
    const haystack = node.textBetween(0, node.content.size, "", "\ufffc");
    for (const match of haystack.matchAll(pattern)) { if (matches.length >= 1000) break; matches.push({ from: position + 1 + match.index!, to: position + 1 + match.index! + match[0].length }); }
    return false;
  });
  return matches;
};
export const searchKey = new PluginKey<{ query: string; index: number }>("veritasSearch");
export const SearchHighlights = Extension.create({
  name: "veritasSearch",
  addProseMirrorPlugins() { return [new Plugin({
    key: searchKey,
    state: { init: () => ({ query: "", index: 0 }), apply: (transaction, previous) => transaction.getMeta(searchKey) ?? previous },
    props: { decorations(state) { const search = searchKey.getState(state)!; return DecorationSet.create(state.doc, findMatches(state.doc, search.query).map((match, index) => Decoration.inline(match.from, match.to, { class: index === search.index ? "find-match current" : "find-match" }))); } },
  })]; },
});

// The profile belongs to this editor's document identity, never to its HTML.
// Only inspect inserted ranges. Existing block boundaries survive the mapping,
// including ReplaceAroundStep list wrapping; they must never receive a default.
export const NewBlockContentFont = Extension.create<{ font: "literata" | null }>({
  name: "veritasNewBlockContentFont",
  addOptions: () => ({ font: null }),
  addProseMirrorPlugins() {
    const font = this.options.font;
    return [new Plugin({
      appendTransaction(transactions, oldState, newState) {
        if (font !== "literata") return null;
        const mapping = new Mapping();
        transactions.forEach(tr => mapping.appendMapping(tr.mapping));
        const inverse = mapping.invert();
        const candidates = new Set<number>();
        transactions.forEach((tr, ti) => {
          if (!tr.docChanged || tr.getMeta("preventUpdate") || isHistoryTransaction(tr)
            || tr.getMeta("veritas:new-block-font")) return;
          tr.mapping.maps.forEach((map, si) => {
            const later = new Mapping(tr.mapping.maps.slice(si + 1));
            transactions.slice(ti + 1).forEach(next => later.appendMapping(next.mapping));
            map.forEach((_a, _b, from, to) => {
              if (from === to) return;
              const start = later.map(from, -1), end = later.map(to, 1);
              newState.doc.nodesBetween(start, end, (node, pos) => {
                if ((node.type.name === "paragraph" || node.type.name === "heading")
                  && !node.attrs.contentFont) {
                  const before = inverse.mapResult(pos, 1);
                  if (before.deleted || !oldState.doc.nodeAt(before.pos)?.isTextblock) candidates.add(pos);
                }
              });
            });
          });
        });
        const correction = newState.tr;
        candidates.forEach(pos => {
          const node = newState.doc.nodeAt(pos)!;
          let explicit = false;
          node.descendants(child => { if (child.marks.some(mark => mark.type.name === "veritasTypography" && mark.attrs.font)) explicit = true; });
          if (!explicit) correction.setNodeMarkup(pos, undefined, { ...node.attrs, contentFont: font });
        });
        // Attribute-only steps preserve offsets/selection and join the originating
        // history item. Tiptap emits one update with the final HTML, not a second
        // writing event. Undo/redo replay their recorded attributes unchanged.
        return correction.docChanged ? correction.setMeta("veritas:new-block-font", true) : null;
      },
    })];
  },
});
