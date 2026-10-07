import { forwardRef, useImperativeHandle, useState } from "react";
import { Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorProps } from "@tiptap/pm/view";
import type { WritingEvent } from "./types";

export const VERITAS_EVENT_META = "veritas:event";
const ORIGINS = new Set(["paste", "paste-edited"]);
const FONTS = new Set(["serif", "sans", "mono"]);
const SIZES = new Set(["small", "normal", "large", "x-large"]);

type MutationEvent = Extract<WritingEvent["event_type"], "insert" | "delete" | "paste" | "paste_edit" | "format">;
type EventMeta = { eventType: MutationEvent; inputType: string; data?: string | null };

export type EditorMutation = EventMeta & { html: string };

export type VeritasEditorHandle = {
  focus: () => void;
  getHTML: () => string;
};

type Props = {
  initialHtml: string;
  onBlur: () => void;
  onFocus: () => void;
  onMutation: (mutation: EditorMutation) => void;
};

export const Provenance = Mark.create({
  name: "veritasProvenance",
  inclusive: false,
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
    };
  },
  parseHTML() { return [{ tag: "span[data-font]" }, { tag: "span[data-size]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes), 0]; },
});

const selectionHasImportedText = (state: EditorState) => {
  const provenance = state.schema.marks.veritasProvenance;
  if (!provenance) return false;
  const { from, to, empty, $from } = state.selection;
  const marks = state.storedMarks ?? $from.marks();
  if (marks.some((mark: { type: unknown; attrs: Record<string, unknown> }) => mark.type === provenance && ORIGINS.has(String(mark.attrs.origin)))) return true;
  return !empty && state.doc.rangeHasMark(from, to, provenance);
};

export const createVeritasExtensions = () => [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: false,
    strike: false,
    trailingNode: false,
  }),
  Placeholder.configure({ placeholder: "Empieza a escribir…" }),
  Provenance,
  Typography,
];

export const createVeritasEditorProps = (): EditorProps => ({
  attributes: { class: "editor", spellcheck: "true" },
  handleTextInput(view, from, to, text, defaultTransaction) {
    const imported = selectionHasImportedText(view.state);
    const provenance = view.state.schema.marks.veritasProvenance;
    const transaction = imported && provenance
      ? view.state.tr.insertText(text, from, to)
      : defaultTransaction();
    if (imported && provenance) {
      const end = from + text.length;
      transaction.removeMark(from, end, provenance);
      transaction.addMark(from, end, provenance.create({ origin: "paste-edited" }));
    }
    transaction.setMeta(VERITAS_EVENT_META, {
      eventType: imported ? "paste_edit" : "insert",
      inputType: "insertText",
      data: text,
    } satisfies EventMeta);
    view.dispatch(transaction.scrollIntoView());
    return true;
  },
  handlePaste(view, event) {
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
    transaction.setMeta(VERITAS_EVENT_META, { eventType: "paste", inputType: "insertFromPaste", data: normalized } satisfies EventMeta);
    view.dispatch(transaction.scrollIntoView());
    return true;
  },
});

const VeritasEditor = forwardRef<VeritasEditorHandle, Props>(function VeritasEditor({ initialHtml, onBlur, onFocus, onMutation }, ref) {
  const [, renderToolbar] = useState(0);
  const editor = useEditor({
    content: initialHtml || "",
    extensions: createVeritasExtensions(),
    editorProps: createVeritasEditorProps(),
    onUpdate({ editor: current, transaction }) {
      const supplied = transaction.getMeta(VERITAS_EVENT_META) as EventMeta | undefined;
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

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    getHTML: () => editor?.getHTML() ?? initialHtml,
  }), [editor, initialHtml]);

  if (!editor) return <div className="editor-loading">Preparando el documento…</div>;

  const setEventMeta = (inputType: string, data: string | null = null) => ({
    eventType: "format" as const,
    inputType,
    data,
  });
  const typography = editor.getAttributes("veritasTypography") as { font?: string | null; size?: string | null };
  const setTypography = (attribute: "font" | "size", value: string) => {
    const next = { font: typography.font ?? null, size: typography.size ?? null, [attribute]: value || null };
    const chain = editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta(`typography:${attribute}`, value || null));
    if (!next.font && !next.size) chain.unsetMark("veritasTypography").run();
    else chain.setMark("veritasTypography", next).run();
  };
  const button = (active: boolean) => active ? "active" : undefined;

  return <>
    <div className="toolbar" role="toolbar" aria-label="Formato" onMouseDown={event => { if (event.target instanceof Element && event.target.closest("button")) event.preventDefault(); }}>
      <button type="button" className={button(editor.isActive("bold"))} aria-pressed={editor.isActive("bold")} title="Negrita" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("bold")).toggleBold().run()}><strong>B</strong></button>
      <button type="button" className={button(editor.isActive("italic"))} aria-pressed={editor.isActive("italic")} title="Cursiva" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("italic")).toggleItalic().run()}><em>I</em></button>
      <button type="button" className={button(editor.isActive("underline"))} aria-pressed={editor.isActive("underline")} title="Subrayado" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("underline")).toggleUnderline().run()}><u>U</u></button>
      <span aria-hidden="true"></span>
      <button type="button" className={button(editor.isActive("heading", { level: 2 }))} aria-pressed={editor.isActive("heading", { level: 2 })} title="Alternar título y párrafo" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("heading:2")).toggleHeading({ level: 2 }).run()}>T</button>
      <button type="button" className={button(editor.isActive("bulletList"))} aria-pressed={editor.isActive("bulletList")} title="Lista con viñetas" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("bullet-list")).toggleBulletList().run()}>☷</button>
      <button type="button" className={button(editor.isActive("orderedList"))} aria-pressed={editor.isActive("orderedList")} title="Lista numerada" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("ordered-list")).toggleOrderedList().run()}>1.</button>
      <button type="button" className={button(editor.isActive("blockquote"))} aria-pressed={editor.isActive("blockquote")} title="Cita" onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("blockquote")).toggleBlockquote().run()}>❞</button>
      <span aria-hidden="true"></span>
      <label className="toolbar-select"><span>Fuente</span><select aria-label="Familia tipográfica" value={typography.font ?? ""} onChange={event => setTypography("font", event.target.value)}><option value="">Documento</option><option value="serif">Serif editorial</option><option value="sans">Sans serif</option><option value="mono">Monoespaciada</option></select></label>
      <label className="toolbar-select compact"><span>Tamaño</span><select aria-label="Tamaño de texto" value={typography.size ?? ""} onChange={event => setTypography("size", event.target.value)}><option value="">Normal</option><option value="small">Pequeño</option><option value="large">Grande</option><option value="x-large">Muy grande</option></select></label>
      <button type="button" title="Deshacer" aria-label="Deshacer" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("historyUndo")).undo().run()}>↶</button>
      <button type="button" title="Rehacer" aria-label="Rehacer" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().setMeta(VERITAS_EVENT_META, setEventMeta("historyRedo")).redo().run()}>↷</button>
      <small><i className="legend paste"></i>Pegado <i className="legend edited"></i>Reelaborado</small>
    </div>
    <EditorContent editor={editor} className="editor-host" />
  </>;
});

export default VeritasEditor;
