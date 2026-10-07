// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { exportOdt, exportRtf } from "./exportDocument";
import { DEFAULT_PAGE, pageDimensions } from "./pageLayout";
import type { JSONContent } from "@tiptap/core";

const fixture: JSONContent = { type: "doc", content: [
  { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [{ type: "text", text: "El pingüino llegó a Cádiz" }] },
  { type: "paragraph", attrs: { textAlign: "justify", indent: 1, lineHeight: "2" }, content: [{ type: "text", text: "Dos  espacios, {llaves}, \\barra y música 🎼.", marks: [{ type: "bold" }, { type: "veritasTypography", attrs: { font: "arial", size: "18", color: "#2d6680" } }, { type: "veritasProvenance", attrs: { origin: "paste" } }] }, { type: "hardBreak" }, { type: "text", text: "Otra línea", marks: [{ type: "italic" }] }] },
  { type: "paragraph" }, { type: "paragraph" },
  { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Una viñeta" }] }] }] },
  { type: "pageBreak" },
  { type: "paragraph", content: [{ type: "text", text: "Un enlace", marks: [{ type: "link", attrs: { href: "https://example.org/?a=1&b=2" } }] }] },
  { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] }] },
] };
const xml = (text: string) => { const document = new DOMParser().parseFromString(text, "application/xml"); expect(document.querySelector("parsererror")).toBeNull(); return document; };
const odtText = (document: Document) => {
  for (const space of Array.from(document.getElementsByTagName("text:s"))) space.replaceWith(" ".repeat(Number(space.getAttribute("text:c") ?? 1)));
  return document.documentElement.textContent;
};
describe("Documentos editables", () => {
  it("crea un paquete ODT estándar, XML válido y texto Unicode", () => {
    const archive = exportOdt(fixture, { title: "Notas de escritura", page: DEFAULT_PAGE });
    const entries = unzipSync(archive);
    expect(strFromU8(entries.mimetype)).toBe("application/vnd.oasis.opendocument.text");
    const content = xml(strFromU8(entries["content.xml"]));
    xml(strFromU8(entries["styles.xml"])); xml(strFromU8(entries["meta.xml"])); xml(strFromU8(entries["META-INF/manifest.xml"]));
    expect(content.getElementsByTagName("text:line-break")).toHaveLength(1);
    expect(strFromU8(entries["content.xml"])).toContain('text:c="2"');
    expect(strFromU8(entries["content.xml"])).toContain('fo:break-before="page"');
    expect(strFromU8(entries["content.xml"])).not.toContain("paste");
    expect(content.getElementsByTagName("table:table-cell")).toHaveLength(2);
    const text = odtText(content);
    expect(text).toContain("El pingüino llegó a Cádiz");
    expect(text).toContain("música 🎼.");
  });
  it("exporta las dimensiones y márgenes elegidos", () => {
    const page = { format: "legal", orientation: "landscape", margin: 20 } as const;
    const archive = unzipSync(exportOdt(fixture, { title: "Legal", page }));
    const styles = strFromU8(archive["styles.xml"]);
    expect(styles).toContain('fo:page-width="355.6mm"');
    expect(styles).toContain('fo:page-height="215.9mm"');
    expect(styles).toContain('fo:margin="20mm"');
    expect(pageDimensions(page).width).toBe(355.6);
  });
  it("incluye los bytes de las imágenes en el ODT sin depender de la URL privada", () => {
    const document: JSONContent = { type: "doc", content: [{ type: "image", attrs: { src: "/private/image", alt: "Ejemplo", width: 300 } }] };
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const archive = unzipSync(exportOdt(document, { title: "Imagen", page: DEFAULT_PAGE, images: { "/private/image": { bytes, mime: "image/png", width: 600, height: 400 } } }));
    expect(archive["Pictures/image-1.png"]).toEqual(bytes);
    expect(strFromU8(archive["content.xml"])).toContain('xlink:href="Pictures/image-1.png"');
    expect(strFromU8(archive["content.xml"])).not.toContain("/private/image");
  });
  it("crea RTF con Unicode, párrafos, formato, saltos y tablas", () => {
    const rtf = exportRtf(fixture, { title: "Notas", page: DEFAULT_PAGE });
    expect(rtf).toMatch(/^\{\\rtf1/);
    expect(rtf).toContain("\\u252?");
    expect(rtf).toContain("\\u225?");
    expect(rtf).toContain("\\qj"); expect(rtf).toContain("\\fs36");
    expect(rtf).toContain("\\line "); expect(rtf).toContain("\\page");
    expect(rtf).toContain("\\trowd"); expect(rtf).toContain("\\cellx");
    expect(rtf).toContain("\\{llaves\\}");
    expect(rtf).not.toContain("data-origin");
  });
});
