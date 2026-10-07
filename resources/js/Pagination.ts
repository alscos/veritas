import { Extension, Node as TiptapNode } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DEFAULT_PAGE, PAGE_GAP, pageDimensions } from "./pageLayout";
import type { PageSettings } from "./types";

type Flow = { height: number; points: string };
type Layout = { settings: PageSettings; count: number; breaks: Record<number, number>; flows: Record<number, Flow>; blocks: Record<number, number> };
export const paginationKey = new PluginKey<Layout>("veritasPagination");

// Page furniture is a decoration, never a document node or a writing event.
// Each text block gets its own float, so table/image node views are never pushed
// below a document-wide float. Polygons exclude only page margins and gutters.
export const Pagination = Extension.create<{ settings: PageSettings; onPageCount: (count: number) => void }>({
  name: "veritasPagination",
  addOptions() { return { settings: DEFAULT_PAGE, onPageCount: () => undefined }; },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<Layout>({
      key: paginationKey,
      state: {
        init: () => ({ settings: options.settings, count: 1, breaks: {}, flows: {}, blocks: {} }),
        apply: (transaction, previous) => {
          const supplied = transaction.getMeta(paginationKey); if (supplied) return supplied;
          if (!transaction.docChanged) return previous;
          const map = <T,>(values: Record<number, T>) => Object.fromEntries(Object.entries(values).flatMap(([position, value]) => {
            const mapped = transaction.mapping.mapResult(Number(position), 1);
            return mapped.deleted || mapped.pos > transaction.doc.content.size ? [] : [[mapped.pos, value]];
          }));
          return { ...previous, breaks: map(previous.breaks), flows: map(previous.flows), blocks: map(previous.blocks) };
        },
      },
      props: {
        decorations(state) {
          const layout = paginationKey.getState(state)!;
          const decorations = [];
          for (const [position, flow] of Object.entries(layout.flows)) decorations.push(Decoration.widget(Number(position), () => {
            const furniture = document.createElement("span");
            furniture.className = "page-furniture";
            furniture.contentEditable = "false";
            furniture.setAttribute("aria-hidden", "true");
            const gap = document.createElement("span");
            gap.className = "page-flow-gap";
            gap.style.height = `${flow.height}px`;
            gap.style.shapeOutside = `polygon(${flow.points})`;
            furniture.append(gap);
            return furniture;
          }, { side: -1, key: `flow:${position}:${JSON.stringify(flow)}`, ignoreSelection: true }));
          for (const [position, height] of Object.entries(layout.blocks)) if (height > 0) decorations.push(Decoration.widget(Number(position), () => {
            const spacer = document.createElement("div"); spacer.className = "page-block-gap"; spacer.contentEditable = "false"; spacer.setAttribute("aria-hidden", "true"); spacer.style.height = `${height}px`; return spacer;
          }, { side: -1, key: `block:${position}:${height}`, ignoreSelection: true }));
          state.doc.descendants((node, position) => {
            if (node.type.name === "pageBreak") decorations.push(Decoration.node(position, position + node.nodeSize, { style: `height: ${layout.breaks[position] ?? 30}px` }));
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
      view(view) {
        let frame = 0;
        let disposed = false;
        const schedule = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (disposed || !view.dom.isConnected || !view.dom.getBoundingClientRect().width) return;
            const layout = paginationKey.getState(view.state)!;
            const { heightPx, marginPx } = pageDimensions(layout.settings);
            const rect = view.dom.getBoundingClientRect();
            const scale = rect.width / pageDimensions(layout.settings).widthPx;
            const pitch = heightPx + PAGE_GAP;
            const breaks: Record<number, number> = {};
            const flows: Record<number, Flow> = {};
            const blocks: Record<number, number> = {};
            view.state.doc.descendants((node, position) => {
              const dom = view.nodeDOM(position);
              if (!(dom instanceof HTMLElement)) return;
              const top = (dom.getBoundingClientRect().top - rect.top) / scale;
              const bottom = (dom.getBoundingClientRect().bottom - rect.top) / scale;
              if (node.type.name === "pageBreak") {
                const page = Math.floor((top + 1) / pitch);
                breaks[position] = Math.max(1, (page + 1) * pitch + marginPx - top);
              } else if (node.isTextblock) {
                const points = ["0 0"]; let height = 0;
                for (let page = Math.max(0, Math.floor(top / pitch)); page < Math.min(500, Math.ceil(bottom / pitch)); page++) {
                  const gapTop = page * pitch + heightPx - marginPx;
                  const gapBottom = (page + 1) * pitch + marginPx;
                  if (gapTop >= bottom - 1 || gapBottom <= top) continue;
                  const start = Math.round(Math.max(0, gapTop - top) * 100) / 100; const end = Math.round((gapBottom - top) * 100) / 100;
                  points.push(`0 ${start}px`, `100% ${start}px`, `100% ${end}px`, `0 ${end}px`); height = end;
                }
                if (height) flows[position + 1] = { height: Math.round(height * 100) / 100, points: points.join(", ") };
              } else if (node.type.name === "image" || node.type.name === "table") {
                const base = top - (layout.blocks[position] ?? 0);
                const page = Math.floor(base / pitch);
                const end = page * pitch + heightPx - marginPx;
                // Keep small tables and images together. Cell paragraphs also
                // receive line-flow decorations when a table spans pages.
                if (bottom - top <= heightPx - marginPx * 2 && base + bottom - top > end + 1) blocks[position] = (page + 1) * pitch + marginPx - base;
              }
            });
            const last = Array.from(view.dom.children).filter(child => !child.classList.contains("page-furniture") && !child.classList.contains("page-block-gap")).at(-1);
            const bottom = last ? (last.getBoundingClientRect().bottom - rect.top) / scale : marginPx;
            const count = Math.max(1, Math.min(500, Math.ceil((bottom + marginPx) / pitch)));
            if (count === layout.count && JSON.stringify([breaks, flows, blocks]) === JSON.stringify([layout.breaks, layout.flows, layout.blocks])) return;
            view.dispatch(view.state.tr.setMeta(paginationKey, { ...layout, count, breaks, flows, blocks }).setMeta("addToHistory", false));
            options.onPageCount(count);
          });
        };
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
        observer?.observe(view.dom);
        view.dom.addEventListener("load", schedule, true);
        window.addEventListener("resize", schedule);
        document.fonts?.ready.then(schedule);
        schedule();
        return {
          update(previousView, previousState) { if (previousState.doc !== previousView.state.doc || paginationKey.getState(previousState) !== paginationKey.getState(previousView.state)) schedule(); },
          destroy() { disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); view.dom.removeEventListener("load", schedule, true); window.removeEventListener("resize", schedule); },
        };
      },
    })];
  },
});

export const PageBreak = TiptapNode.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break="true"]' }],
  renderHTML: () => ["div", { "data-page-break": "true", class: "manual-page-break" }],
});
