// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { Editor, type EditorEvents } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { createVeritasEditorProps, createVeritasExtensions, VERITAS_EVENT_META } from "./VeritasEditor";

const active: Editor[] = [];
const makeEditor = (content: string, onUpdate?: (event: EditorEvents["update"]) => void) => {
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

const typeText = (editor: Editor, text: string) => {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    editor.options.editorProps.handleTextInput?.call(
      editor.options.editorProps, editor.view, from, to, character,
      () => editor.state.tr.insertText(character, from, to),
    );
  }
};

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

  it("mantiene azul toda la palabra que sustituye un fragmento pegado", () => {
    const editor = makeEditor('<p><mark data-origin="paste">abc viejo xyz</mark></p>');
    editor.commands.setTextSelection({ from: 5, to: 10 });
    typeText(editor, "nuevo");

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste">abc </mark><mark data-origin="paste-edited">nuevo</mark><mark data-origin="paste"> xyz</mark></p>');
  });

  it("recuerda la procedencia después de borrar el fragmento pegado completo", () => {
    const editor = makeEditor('<p><mark data-origin="paste">viejo</mark></p>');
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    typeText(editor, "nuevo");

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste-edited">nuevo</mark></p>');
  });

  it("marca también una sustitución recibida como transacción del navegador", () => {
    const editor = makeEditor('<p><mark data-origin="paste">Monica</mark></p>');
    editor.view.dispatch(editor.state.tr.insertText("ó", 2, 3).setMeta("composition", 1));

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste">M</mark><mark data-origin="paste-edited">ó</mark><mark data-origin="paste">nica</mark></p>');
  });

  it("publica una sola actualización con la procedencia corregida para el registro", () => {
    const updates: { html: string; eventType: string | undefined }[] = [];
    const editor = makeEditor('<p><mark data-origin="paste">Monica</mark></p>', ({ editor: current, transaction, appendedTransactions }) => {
      const supplied = appendedTransactions.map(item => item.getMeta(VERITAS_EVENT_META)).find(meta => meta !== undefined)
        ?? transaction.getMeta(VERITAS_EVENT_META);
      updates.push({ html: current.getHTML(), eventType: supplied?.eventType });
    });
    editor.view.dispatch(editor.state.tr.insertText("ó", 2, 3).setMeta("composition", 1));

    expect(updates).toEqual([{
      html: '<p><mark data-origin="paste">M</mark><mark data-origin="paste-edited">ó</mark><mark data-origin="paste">nica</mark></p>',
      eventType: "paste_edit",
    }]);
  });

  it("restaura el texto rojo al deshacer y el azul al rehacer", () => {
    const original = '<p><mark data-origin="paste">abc viejo xyz</mark></p>';
    const editor = makeEditor(original);
    editor.commands.setTextSelection({ from: 5, to: 10 });
    typeText(editor, "nuevo");
    const revised = editor.getHTML();

    editor.commands.undo();
    expect(editor.getHTML()).toBe(original);
    editor.commands.redo();
    expect(editor.getHTML()).toBe(revised);
    expect(makeEditor(revised).getHTML()).toBe(revised);
  });

  it("escribe sin marca al continuar después de pegar texto", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setTextSelection(1);
    const clipboardEvent = { clipboardData: { getData: () => "importado" } } as unknown as ClipboardEvent;
    editor.options.editorProps.handlePaste?.call(editor.options.editorProps, editor.view, clipboardEvent, Slice.empty);
    typeText(editor, " propio");

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste">importado</mark> propio</p>');
  });

  it("deja de heredar azul al mover el cursor a escritura propia", () => {
    const editor = makeEditor('<p>propio <mark data-origin="paste">viejo</mark></p>');
    editor.commands.setTextSelection({ from: 8, to: 13 });
    typeText(editor, "nuevo");
    editor.commands.setTextSelection(4);
    typeText(editor, "X");

    expect(editor.getHTML()).toBe('<p>proXpio <mark data-origin="paste-edited">nuevo</mark></p>');
  });

  it("no transmite la marca azul a un párrafo nuevo", () => {
    const editor = makeEditor('<p><mark data-origin="paste">viejo</mark></p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    typeText(editor, "nuevo");
    editor.commands.splitBlock();
    typeText(editor, "propio");

    expect(editor.getHTML()).toBe('<p><mark data-origin="paste-edited">nuevo</mark></p><p>propio</p>');
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
