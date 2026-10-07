// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { createVeritasEditorProps, createVeritasExtensions, VERITAS_EVENT_META } from "./VeritasEditor";

const active: Editor[] = [];
const makeEditor = (content: string, onUpdate?: (event: { transaction: import("@tiptap/pm/state").Transaction }) => void) => {
  const editor = new Editor({
    element: document.createElement("div"),
    content,
    extensions: createVeritasExtensions(),
    editorProps: createVeritasEditorProps(),
    onUpdate: onUpdate ?? (() => undefined),
  });
  active.push(editor);
  return editor;
};

afterEach(() => {
  while (active.length) active.pop()?.destroy();
});

describe("VeritasEditor", () => {
  it("convierte únicamente el texto nuevo dentro de un pegado en texto reelaborado", () => {
    let eventType: string | undefined;
    const editor = makeEditor('<p><mark data-origin="paste">abcdef</mark></p>', ({ transaction }) => {
      eventType = transaction.getMeta(VERITAS_EVENT_META)?.eventType;
    });
    editor.commands.setTextSelection(4);
    const handler = editor.options.editorProps.handleTextInput;
    expect(handler).toBeTypeOf("function");
    handler?.call(editor.options.editorProps, editor.view, 4, 4, "X", () => editor.state.tr.insertText("X", 4, 4));

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste">abc</mark><mark data-origin="paste-edited">X</mark><mark data-origin="paste">def</mark></p>');
    expect(eventType).toBe("paste_edit");
  });

  it("conserva cada salto de línea de un pegado como un bloque marcado", () => {
    let eventType: string | undefined;
    const editor = makeEditor("<p></p>", ({ transaction }) => {
      eventType = transaction.getMeta(VERITAS_EVENT_META)?.eventType;
    });
    editor.commands.setTextSelection(1);
    const handler = editor.options.editorProps.handlePaste;
    const clipboardEvent = { clipboardData: { getData: () => "uno\n\ndos" } } as unknown as ClipboardEvent;
    handler?.call(editor.options.editorProps, editor.view, clipboardEvent, Slice.empty);

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste">uno</mark></p><p></p><p><mark data-origin="paste">dos</mark></p>');
    expect(editor.getJSON().content?.filter(node => node.type === "paragraph")).toHaveLength(3);
    expect(eventType).toBe("paste");
  });

  it("mantiene la procedencia al aplicar formato al texto pegado", () => {
    const editor = makeEditor('<p><mark data-origin="paste">texto</mark></p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.toggleBold();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks?.map(mark => mark.type);
    expect(marks).toContain("veritasProvenance");
    expect(marks).toContain("bold");
  });

  it("alterna un título y vuelve a convertirlo en párrafo", () => {
    const editor = makeEditor("<p>Un título reversible</p>");
    editor.commands.setTextSelection(1);
    editor.commands.toggleHeading({ level: 2 });
    expect(editor.getHTML()).toBe("<h2>Un título reversible</h2>");
    editor.commands.toggleHeading({ level: 2 });
    expect(editor.getHTML()).toBe("<p>Un título reversible</p>");
  });

  it("serializa y vuelve a leer la tipografía con atributos restringidos", () => {
    const editor = makeEditor("<p>Texto editorial</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setMark("veritasTypography", { font: "sans", size: "large" });
    const html = editor.getHTML();

    expect(html).toContain('data-font="sans"');
    expect(html).toContain('data-size="large"');
    const restored = makeEditor(html);
    expect(restored.getHTML()).toBe(html);
  });
});
