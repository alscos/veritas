import { t, useLocale } from "./i18n";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { Fragment, Slice } from "@tiptap/pm/model";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { EditorProps } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Transaction } from "@tiptap/pm/state";
import type { PageSettings, WritingEvent } from "./types";
import { DEFAULT_PAGE, FONT_FAMILIES, FONT_SIZES, PAGE_GAP, pageDimensions } from "./pageLayout";
import { PageBreak, Pagination, paginationKey } from "./Pagination";
import { BlockLayout, SearchHighlights } from "./EditorTools";
import EditorToolbar from "./EditorToolbar";

export const VERITAS_EVENT_META = "veritas:event";
const PROVENANCE_APPLIED_META = "veritas:provenance-applied";
export const COMPOSITION_END_META = "veritas:composition-end";
const COMPOSITION_FLUSHED_META = "veritas:composition-flushed";
const ORIGINS = new Set(["paste", "paste-edited"]);
const FONTS = new Set(Object.keys(FONT_FAMILIES));
const SIZES = new Set(["small", "normal", "large", "x-large", ...FONT_SIZES.map(String)]);

type MutationEvent = Extract<WritingEvent["event_type"], "insert" | "delete" | "paste" | "paste_edit" | "format">;
type EventMeta = { eventType: MutationEvent; inputType: string; data?: string | null };
type EditedRange = { from: number; to: number };
type ComposedEdits = { ranges: EditedRange[]; meta?: EventMeta };
const compositionKey = new PluginKey<ComposedEdits>("veritasProvenance");

const importedEdits = (transaction: Transaction, oldState: EditorState, pending: EditedRange[] = []) => {
  const supplied = transaction.getMeta(VERITAS_EVENT_META) as EventMeta | undefined;
  const edits: (EditedRange & { meta: EventMeta })[] = [];
  if (!transaction.docChanged || transaction.getMeta(PROVENANCE_APPLIED_META)
    || isHistoryTransaction(transaction) || transaction.getMeta("preventUpdate")
    || supplied?.eventType === "paste" || supplied?.eventType === "format"
    || ["paste", "drop"].includes(transaction.getMeta("uiEvent"))) return edits;
  const provenance = oldState.schema.marks.veritasProvenance;
  transaction.steps.forEach((step, stepIndex) => {
    if (!(step instanceof ReplaceStep)) return;
    const before = transaction.docs[stepIndex];
    step.getMap().forEach((from, to, insertedFrom, insertedTo) => {
      const stored = stepIndex === 0 && oldState.selection.empty && oldState.selection.from === from ? oldState.storedMarks : null;
      const tracked = pending.some(range => {
        const map = transaction.mapping.slice(0, stepIndex);
        return map.map(range.from, -1) <= to && map.map(range.to, 1) >= from;
      });
      const imported = tracked || before.rangeHasMark(from, to, provenance)
        || [...before.resolve(from).marks(), ...(stored ?? [])].some(mark => mark.type === provenance && ORIGINS.has(mark.attrs.origin));
      const text = step.slice.content.textBetween(0, step.slice.content.size, "\n");
      const hasText = step.slice.content.textBetween(0, step.slice.content.size, "") !== "";
      if (!imported || (from === to && !hasText)) return;
      const map = transaction.mapping.slice(stepIndex + 1);
      edits.push({ from: map.map(insertedFrom, 1), to: map.map(insertedTo, -1), meta: {
        eventType: "paste_edit", inputType: supplied?.inputType ?? (hasText ? "insertReplacementText" : "deleteContent"),
        data: supplied?.data ?? (hasText ? text : null),
      } });
    });
  });
  return edits;
};

export type EditorMutation = EventMeta & { html: string };

export type VeritasEditorHandle = {
  focus: () => void;
  getHTML: () => string;
  getJSON: () => JSONContent;
  waitForUploads: () => Promise<boolean>;
};

type Props = {
  initialHtml: string;
  onBlur: () => void;
  onFocus: () => void;
  onMutation: (mutation: EditorMutation) => void;
  title: string;
  page: PageSettings;
  onPageChange: (page: PageSettings) => void;
  beforeExport: () => Promise<boolean>;
  onUploadImage: (file: File) => Promise<{ src: string; width: number; height: number; sha256?: string }>;
};

export const Provenance = Mark.create({
  name: "veritasProvenance",
  inclusive: false,
  keepOnSplit: false,
  addAttributes() {
    return {
      origin: {
        default: null,
        parseHTML: element => ORIGINS.has(element.getAttribute("data-origin") ?? "") ? element.getAttribute("data-origin") : null,
        renderHTML: attributes => ORIGINS.has(attributes.origin) ? { "data-origin": attributes.origin } : {},
      },
    };
  },
  parseHTML() { return [{ tag: "mark[data-origin]" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes), 0]; },
  addProseMirrorPlugins() {
    const provenance = this.type;
    let currentView: EditorView | null = null;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    return [new Plugin<ComposedEdits>({
      key: compositionKey,
      state: {
        init: () => ({ ranges: [] }),
        apply(transaction, previous, oldState) {
          if (transaction.getMeta(COMPOSITION_FLUSHED_META)) return { ranges: [] };
          const ranges = previous.ranges.map(range => ({ from: transaction.mapping.map(range.from, -1), to: transaction.mapping.map(range.to, 1) }));
          if (!transaction.getMeta("composition") && !currentView?.composing) return { ...previous, ranges };
          const edits = importedEdits(transaction, oldState, previous.ranges);
          return { ranges: [...ranges, ...edits.map(({ from, to }) => ({ from, to }))], meta: edits.at(-1)?.meta ?? previous.meta };
        },
      },
      props: {
        handleDOMEvents: {
          compositionend(view) {
            // Let ProseMirror read the final native DOM mutation before changing
            // marks. Splitting the composing text node commits a Mac dead key.
            clearTimeout(finishTimer);
            finishTimer = setTimeout(() => {
              if (!view.isDestroyed && !view.composing) view.dispatch(view.state.tr.setMeta(COMPOSITION_END_META, true));
            }, 0);
            return false;
          },
        },
      },
      view(view) {
        currentView = view;
        return { destroy() { clearTimeout(finishTimer); currentView = null; } };
      },
      appendTransaction(transactions, oldState, newState) {
        const correction = newState.tr;
        let eventMeta: EventMeta | undefined;
        let continueEditing = false;

        const pending = compositionKey.getState(newState)!;
        const finishing = transactions.some(transaction => transaction.getMeta(COMPOSITION_END_META));
        if (!finishing && (currentView?.composing || transactions.some(transaction => transaction.getMeta("composition")))) {
          // Preserve event classification during composition, without touching
          // the DOM or stored marks that the native keyboard still owns.
          return pending.meta && !transactions.some(transaction => transaction.getMeta(PROVENANCE_APPLIED_META))
            ? correction.setMeta(PROVENANCE_APPLIED_META, true).setMeta(VERITAS_EVENT_META, pending.meta) : null;
        }

        const markRange = (start: number, end: number) => {
          if (end < start) return;
          newState.doc.nodesBetween(start, end, (node, position) => {
            if (!node.isText) return;
            const from = Math.max(start, position), to = Math.min(end, position + node.nodeSize);
            if (from < to) correction.removeMark(from, to, provenance).addMark(from, to, provenance.create({ origin: "paste-edited" }));
          });
          if (newState.selection.empty && newState.selection.from >= start && newState.selection.from <= end) continueEditing = true;
        };
        if (finishing) {
          pending.ranges.forEach(range => markRange(range.from, range.to));
          eventMeta = pending.meta;
          correction.setMeta(COMPOSITION_FLUSHED_META, true).setMeta("addToHistory", false);
        }

        transactions.forEach((transaction, transactionIndex) => {
          importedEdits(transaction, transactionIndex === 0 ? oldState : newState).forEach(edit => {
            let start = edit.from, end = edit.to;
            for (const later of transactions.slice(transactionIndex + 1)) {
              start = later.mapping.map(start, 1); end = later.mapping.map(end, -1);
            }
            markRange(start, end); eventMeta = edit.meta;
          });
        });

        if (!eventMeta) return null;
        if (continueEditing) {
          // Keep a replacement run blue after its first character, and remember
          // the source even when deleting the last pasted character. Moving the
          // selection clears stored marks through ProseMirror's normal rules.
          correction.addStoredMark(provenance.create({ origin: "paste-edited" }));
        }
        return correction.setMeta(PROVENANCE_APPLIED_META, true).setMeta(VERITAS_EVENT_META, eventMeta);
      },
    })];
  },
});

export const Typography = Mark.create({
  name: "veritasTypography",
  inclusive: true,
  addAttributes() {
    return {
      font: {
        default: null,
        parseHTML: element => FONTS.has(element.getAttribute("data-font") ?? "") ? element.getAttribute("data-font") : null,
        renderHTML: attributes => FONTS.has(attributes.font) ? { "data-font": attributes.font } : {},
      },
      size: {
        default: null,
        parseHTML: element => SIZES.has(element.getAttribute("data-size") ?? "") ? element.getAttribute("data-size") : null,
        renderHTML: attributes => SIZES.has(attributes.size) ? { "data-size": attributes.size } : {},
      },
      color: {
        default: null,
        parseHTML: element => /^#[a-f0-9]{6}$/i.test(element.getAttribute("data-color") ?? "") ? element.getAttribute("data-color") : null,
        renderHTML: attributes => /^#[a-f0-9]{6}$/i.test(attributes.color ?? "") ? { "data-color": attributes.color } : {},
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-font]" }, { tag: "span[data-size]" }, { tag: "span[data-color]" }]; },
  renderHTML({ HTMLAttributes }) {
    const font = FONT_FAMILIES[HTMLAttributes["data-font"]];
    const size = HTMLAttributes["data-size"];
    const style = [font ? `font-family: ${font.css}` : "", FONT_SIZES.includes(Number(size)) ? `font-size: ${size}pt` : "", HTMLAttributes["data-color"] ? `color: ${HTMLAttributes["data-color"]}` : ""].filter(Boolean).join("; ");
    return ["span", mergeAttributes(HTMLAttributes, style ? { style } : {}), 0];
  },
});

const VeritasImage = Image.extend({
  addAttributes() {
    const inherited = this.parent?.() as import("@tiptap/core").Attributes | undefined;
    return { ...inherited,
      width: { ...inherited?.width, default: null, renderHTML: attributes => attributes.width ? { width: Math.round(Number(attributes.width)) } : {} },
      height: { ...inherited?.height, default: null, renderHTML: attributes => attributes.height ? { height: Math.round(Number(attributes.height)) } : {} },
      sha256: { default: null, parseHTML: element => element.getAttribute("data-image-sha256"), renderHTML: attributes => attributes.sha256 ? { "data-image-sha256": attributes.sha256 } : {} },
    };
  },
  addInputRules() { return []; },
}).configure({ allowBase64: true, resize: { enabled: true, directions: ["bottom-right", "bottom-left"], minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true } });

const selectionHasImportedText = (state: EditorState, from = state.selection.from, to = state.selection.to) => {
  const provenance = state.schema.marks.veritasProvenance;
  if (!provenance) return false;
  const marks = state.storedMarks ?? state.doc.resolve(from).marks();
  if (marks.some((mark: { type: unknown; attrs: Record<string, unknown> }) => mark.type === provenance && ORIGINS.has(String(mark.attrs.origin)))) return true;
  return from !== to && state.doc.rangeHasMark(from, to, provenance);
};

export const createVeritasExtensions = (options?: { page?: PageSettings; onPageCount?: (count: number) => void }) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    code: false,
    codeBlock: false,
    link: { openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
    trailingNode: false,
  }),
  Placeholder.configure({ placeholder: () => t("Empieza a escribir…") }),
  Provenance,
  Typography,
  BlockLayout,
  TextAlign.configure({ types: ["heading", "paragraph"], defaultAlignment: null }),
  Subscript,
  Superscript,
  TableKit.configure({ table: { resizable: true } }),
  VeritasImage,
  PageBreak,
  SearchHighlights,
  ...(options ? [Pagination.configure({ settings: options.page ?? DEFAULT_PAGE, onPageCount: options.onPageCount ?? (() => undefined) })] : []),
];

export const createVeritasEditorProps = (options?: { onImageFiles: (files: File[], position: number) => void }): EditorProps => {
  const props: EditorProps = {
  attributes: { class: "editor", spellcheck: "true" },
  handleTextInput(view, from, to, text, defaultTransaction) {
    const imported = selectionHasImportedText(view.state, from, to);
    const transaction = defaultTransaction();
    transaction.setMeta(VERITAS_EVENT_META, {
      eventType: imported ? "paste_edit" : "insert",
      inputType: "insertText",
      data: text,
    } satisfies EventMeta);
    view.dispatch(transaction.scrollIntoView());
    return true;
  },
  handlePaste(view, event) {
    const images = Array.from(event.clipboardData?.files ?? []).filter(file => /^image\/(jpeg|png|webp|gif)$/.test(file.type));
    if (images.length && options) { options.onImageFiles(images, view.state.selection.from); return true; }
    const text = event.clipboardData?.getData("text/plain");
    const provenance = view.state.schema.marks.veritasProvenance;
    if (text === undefined || !provenance) return false;
    const mark = provenance.create({ origin: "paste" });
    const normalized = text.replace(/\r\n?/g, "\n");
    const transaction = view.state.tr;
    if (normalized.includes("\n")) {
      const paragraphs = normalized.split("\n").map(line => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line, [mark]) : undefined));
      transaction.replaceSelection(new Slice(Fragment.fromArray(paragraphs), 0, 0));
    } else if (normalized) {
      transaction.replaceSelectionWith(view.state.schema.text(normalized, [mark]), false);
    } else {
      return true;
    }
    transaction.setStoredMarks(provenance.removeFromSet(transaction.selection.$from.marks()));
    transaction.setMeta(VERITAS_EVENT_META, { eventType: "paste", inputType: "insertFromPaste", data: normalized } satisfies EventMeta);
    view.dispatch(transaction.scrollIntoView());
    return true;
  },
  handleDrop(view, event, _slice, moved) {
    if (moved) return false;
    const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
    const images = Array.from(event.dataTransfer?.files ?? []).filter(file => /^image\/(jpeg|png|webp|gif)$/.test(file.type));
    if (images.length && options) { options.onImageFiles(images, position); return true; }
    const text = event.dataTransfer?.getData("text/plain");
    if (!text) return Boolean(event.dataTransfer?.files.length);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
    props.handlePaste?.call(props, view, { clipboardData: { getData: () => text } } as unknown as ClipboardEvent, Slice.empty);
    return true;
  },
  };
  return props;
};

const VeritasEditor = forwardRef<VeritasEditorHandle, Props>(function VeritasEditor({ initialHtml, onBlur, onFocus, onMutation, title, page, onPageChange, beforeExport, onUploadImage }, ref) {
  const locale = useLocale();
  const [, renderToolbar] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(800);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Set<Promise<boolean>>());
  const initialContent = useRef(initialHtml || "");
  const initialPage = useRef(page);
  const uploadFilesRef = useRef<(files: File[], position: number) => void>(() => undefined);
  // Keep editor options stable while React updates metrics, toolbar or language.
  // The mutable draft belongs to ProseMirror; content is only its initial seed.
  const extensions = useMemo(() => createVeritasExtensions({ page: initialPage.current, onPageCount: setPageCount }), []);
  const editorProps = useMemo(() => createVeritasEditorProps({ onImageFiles: (files, position) => uploadFilesRef.current(files, position) }), []);
  const editor = useEditor({
    content: initialContent.current,
    extensions,
    editorProps,
    shouldRerenderOnTransaction: false,
    onUpdate({ editor: current, transaction, appendedTransactions }) {
      const supplied = appendedTransactions.map(item => item.getMeta(VERITAS_EVENT_META) as EventMeta | undefined).find(meta => meta !== undefined)
        ?? (transaction.getMeta(VERITAS_EVENT_META) as EventMeta | undefined);
      const delta = transaction.doc.content.size - transaction.before.content.size;
      const eventType: MutationEvent = supplied?.eventType ?? (delta < 0 ? "delete" : delta > 0 ? "insert" : "format");
      const inputType = supplied?.inputType ?? (eventType === "delete" ? "deleteContent" : eventType === "format" ? "format" : "insertContent");
      onMutation({ eventType, inputType, data: supplied?.data ?? null, html: current.getHTML() });
      renderToolbar(value => value + 1);
    },
    onSelectionUpdate() { renderToolbar(value => value + 1); },
    onFocus() { onFocus(); },
    onBlur() { onBlur(); },
  });

  const uploadFiles = (files: File[], position: number) => {
    if (!editor) return;
    const bookmark = { position };
    const mapPosition = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => { bookmark.position = transaction.mapping.map(bookmark.position, 1); };
    editor.on("transaction", mapPosition);
    const operation = (async () => {
      setBusy(true); setMessage("");
      try {
        for (const file of files) {
          if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error(t("Elige una imagen JPG, PNG, WebP o GIF de hasta 5 MB."));
          const image = await onUploadImage(file);
          if (editor.isDestroyed) return false;
          const dimensions = pageDimensions(page);
          const maxWidth = dimensions.widthPx - dimensions.marginPx * 2;
          const maxHeight = dimensions.heightPx - dimensions.marginPx * 2 - 40;
          const width = Math.min(image.width, maxWidth, 600, maxHeight * image.width / image.height);
          editor.chain().setMeta(VERITAS_EVENT_META, { eventType: "format", inputType: "insertImage", data: JSON.stringify({ name: file.name, sha256: image.sha256 ?? null }) }).insertContentAt(bookmark.position, { type: "image", attrs: { src: image.src, alt: file.name.slice(0, 300), width: Math.round(width), height: Math.round(width * image.height / image.width), sha256: image.sha256 ?? null } }).run();
        }
        return true;
      } catch (reason) { setMessage(reason instanceof Error ? reason.message : t("No se pudo guardar la imagen.")); return false; }
      finally { editor.off("transaction", mapPosition); }
    })();
    uploads.current.add(operation);
    void operation.finally(() => { uploads.current.delete(operation); setBusy(uploads.current.size > 0); });
  };
  uploadFilesRef.current = uploadFiles;

  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta("inkgroove:locale", locale).setMeta("addToHistory", false));
  }, [editor, locale]);

  useEffect(() => {
    if (!editor) return;
    const previous = paginationKey.getState(editor.state)!;
    editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { ...previous, settings: page, breaks: {}, flows: {}, blocks: {} }).setMeta("addToHistory", false));
  }, [editor, page]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const update = () => setAvailableWidth(Math.max(200, element.clientWidth - 40));
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element); update(); return () => observer?.disconnect();
  }, [editor]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    getHTML: () => editor?.getHTML() ?? initialHtml,
    getJSON: () => editor?.getJSON() ?? { type: "doc", content: [] },
    waitForUploads: async () => { const results = await Promise.all(Array.from(uploads.current)); return results.every(Boolean); },
  }), [editor, initialHtml]);

  if (!editor) return <div className="editor-loading">{t("Preparando el documento…")}</div>;

  const dimensions = pageDimensions(page);
  const scale = zoom || Math.min(1, availableWidth / dimensions.widthPx);
  const height = pageCount * (dimensions.heightPx + PAGE_GAP) - PAGE_GAP;
  return <>
    <EditorToolbar editor={editor} title={title} page={page} onPageChange={onPageChange} onImage={() => fileInput.current?.click()} beforeExport={beforeExport} busy={busy} zoom={zoom} onZoom={setZoom} onError={setMessage}/>
    <input type="file" ref={fileInput} className="visually-hidden" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) uploadFiles(files, editor.state.selection.from); event.target.value = ""; }}/>
    {(message || busy) && <div className={`editor-message${message ? " error" : ""}`} role={message ? "alert" : "status"}>{message || t("Guardando imagen… puedes seguir escribiendo.")}</div>}
    <div className="page-viewport" ref={viewport}>
      <div className="page-scaled" style={{ width: dimensions.widthPx * scale, height: height * scale }}>
        <div className="page-canvas" style={{ width: dimensions.widthPx, minHeight: height, transform: `scale(${scale})` }}>
          <div className="page-backgrounds" aria-hidden="true">{Array.from({ length: pageCount }, (_, index) => <div key={index} style={{ top: index * (dimensions.heightPx + PAGE_GAP), height: dimensions.heightPx }}><span>{index + 1}</span></div>)}</div>
          <EditorContent editor={editor} className="editor-host paginated-host" style={{ "--page-margin": `${dimensions.marginPx}px`, "--page-image-height": `${dimensions.heightPx - dimensions.marginPx * 2 - 40}px`, "--page-min-height": `${height}px`, "--page-break-label": JSON.stringify(t("Salto de página")) } as React.CSSProperties}/>
        </div>
      </div>
    </div>
    <div className="page-status"><span>{pageCount} {pageCount === 1 ? t("página") : t("páginas")} · {page.format.toUpperCase()} · {Math.round(scale * 100)}%</span><small><i className="legend paste"/>{t("Pegado")} <i className="legend edited"/>{t("Reelaborado")}</small></div>
  </>;
});

export default VeritasEditor;
