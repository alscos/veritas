import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export const BlockLayout = Extension.create({
  name: "veritasBlockLayout",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading"], attributes: {
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
