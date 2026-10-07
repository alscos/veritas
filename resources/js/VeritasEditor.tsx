import { forwardRef, useImperativeHandle, useState } from "react";
import { Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { Fragment, Slice } from "@tiptap/pm/model";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { EditorProps } from "@tiptap/pm/view";
import type { WritingEvent } from "./types";

export const VERITAS_EVENT_META = "veritas:event";
const PROVENANCE_APPLIED_META = "veritas:provenance-applied";
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
    return [new Plugin({
      key: new PluginKey("veritasProvenance"),
      appendTransaction(transactions, oldState, newState) {
        const correction = newState.tr;
        let eventMeta: EventMeta | undefined;
        let continueEditing = false;

        transactions.forEach((transaction, transactionIndex) => {
          const supplied = transaction.getMeta(VERITAS_EVENT_META) as EventMeta | undefined;
          // Formatting, history and imported content already carry their own provenance.
          if (!transaction.docChanged || transaction.getMeta(PROVENANCE_APPLIED_META)
            || isHistoryTransaction(transaction) || transaction.getMeta("preventUpdate")
            || supplied?.eventType === "paste" || supplied?.eventType === "format"
            || ["paste", "drop"].includes(transaction.getMeta("uiEvent"))) return;

          transaction.steps.forEach((step, stepIndex) => {
            if (!(step instanceof ReplaceStep)) return;
            const before = transaction.docs[stepIndex];
            step.getMap().forEach((from, to, insertedFrom, insertedTo) => {
              const marks = before.resolve(from).marks();
              const stored = transactionIndex === 0 && stepIndex === 0
                && oldState.selection.empty && oldState.selection.from === from
                ? oldState.storedMarks : null;
              const imported = before.rangeHasMark(from, to, provenance)
                || [...marks, ...(stored ?? [])].some(mark => mark.type === provenance && ORIGINS.has(mark.attrs.origin));
              const insertedText = step.slice.content.textBetween(0, step.slice.content.size, "\n");
              const hasInsertedText = step.slice.content.textBetween(0, step.slice.content.size, "") !== "";
              if (!imported || (from === to && !hasInsertedText)) return;

              // Step coordinates belong to that step's document. Map only the
              // inserted range through subsequent steps, never the surrounding paste.
              let start = transaction.mapping.slice(stepIndex + 1).map(insertedFrom, 1);
              let end = transaction.mapping.slice(stepIndex + 1).map(insertedTo, -1);
              for (const later of transactions.slice(transactionIndex + 1)) {
                start = later.mapping.map(start, 1);
                end = later.mapping.map(end, -1);
              }
              if (end < start) return;
              if (hasInsertedText) newState.doc.nodesBetween(start, end, (node, position) => {
                if (!node.isText) return;
                const textFrom = Math.max(start, position);
                const textTo = Math.min(end, position + node.nodeSize);
                if (textFrom >= textTo) return;
                correction.removeMark(textFrom, textTo, provenance);
                correction.addMark(textFrom, textTo, provenance.create({ origin: "paste-edited" }));
              });
              if (newState.selection.empty && newState.selection.from >= start && newState.selection.from <= end) continueEditing = true;
              eventMeta = {
                eventType: "paste_edit",
                inputType: supplied?.inputType ?? (hasInsertedText ? "insertReplacementText" : "deleteContent"),
                data: supplied?.data ?? (hasInsertedText ? insertedText : null),
              };
            });
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
    };
  },
  parseHTML() { return [{ tag: "span[data-font]" }, { tag: "span[data-size]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes), 0]; },
});

const selectionHasImportedText = (state: EditorState, from = state.selection.from, to = state.selection.to) => {
  const provenance = state.schema.marks.veritasProvenance;
  if (!provenance) return false;
  const marks = state.storedMarks ?? state.doc.resolve(from).marks();
  if (marks.some((mark: { type: unknown; attrs: Record<string, unknown> }) => mark.type === provenance && ORIGINS.has(String(mark.attrs.origin)))) return true;
  return from !== to && state.doc.rangeHasMark(from, to, provenance);
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
});

const VeritasEditor = forwardRef<VeritasEditorHandle, Props>(function VeritasEditor({ initialHtml, onBlur, onFocus, onMutation }, ref) {
  const [, renderToolbar] = useState(0);
  const editor = useEditor({
    content: initialHtml || "",
    extensions: createVeritasExtensions(),
    editorProps: createVeritasEditorProps(),
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
