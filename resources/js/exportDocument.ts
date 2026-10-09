import { t } from "./i18n";
import type { JSONContent } from "@tiptap/core";
import { strToU8, zipSync } from "fflate";
import { FONT_FAMILIES, pageDimensions } from "./pageLayout";
import type { PageSettings } from "./types";

export type ExportImage = { bytes: Uint8Array; mime: string; width: number; height: number };
export type ExportOptions = { title: string; page: PageSettings; images?: Record<string, ExportImage> };
const escapeXml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
const xmlText = (text: string) => text.split(/( +|\t|\n)/).map(part => part.startsWith(" ") ? `<text:s text:c="${part.length}"/>` : part === "\t" ? "<text:tab/>" : part === "\n" ? "<text:line-break/>" : escapeXml(part)).join("");
const children = (node: JSONContent) => node.content ?? [];
const sizePoints = (value: unknown): number => ({ small: 10, normal: 12, large: 14, "x-large": 18 }[String(value)] ?? (Number(value) || 12));
const attributes = (values: Record<string, unknown>) => Object.entries(values).map(([key, value]) => `${key}="${escapeXml(value)}"`).join(" ");
const utf8 = (text: string) => new Uint8Array(strToU8(text));

export const exportOdt = (document: JSONContent, options: ExportOptions): Uint8Array => {
  const styles: string[] = [];
  const styleNames = new Map<string, string>();
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const manifest: string[] = [];
  const style = (family: string, properties: Record<string, unknown>, extra = "") => {
    const key = JSON.stringify([family, properties, extra]);
    if (styleNames.has(key)) return styleNames.get(key)!;
    const name = `V${styleNames.size + 1}`; styleNames.set(key, name);
    styles.push(`<style:style style:name="${name}" style:family="${family}"><style:${family === "text" ? "text" : family === "table-cell" ? "table-cell" : "paragraph"}-properties ${attributes(properties)}/>${extra}</style:style>`);
    return name;
  };
  const inline = (node: JSONContent): string => {
    if (node.type === "hardBreak") return "<text:line-break/>";
    if (node.type !== "text") return children(node).map(inline).join("");
    const properties: Record<string, unknown> = {};
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") properties["fo:font-weight"] = "bold";
      if (mark.type === "italic") properties["fo:font-style"] = "italic";
      if (mark.type === "underline") Object.assign(properties, { "style:text-underline-style": "solid", "style:text-underline-width": "auto" });
      if (mark.type === "strike") properties["style:text-line-through-style"] = "solid";
      if (mark.type === "subscript") properties["style:text-position"] = "sub 58%";
      if (mark.type === "superscript") properties["style:text-position"] = "super 58%";
      if (mark.type === "link") href = mark.attrs?.href;
      if (mark.type === "veritasTypography") {
        if (mark.attrs?.font && FONT_FAMILIES[mark.attrs.font]) properties["fo:font-family"] = FONT_FAMILIES[mark.attrs.font].export;
        if (mark.attrs?.size) properties["fo:font-size"] = `${sizePoints(mark.attrs.size)}pt`;
        if (mark.attrs?.color) properties["fo:color"] = mark.attrs.color;
      }
    }
    let text = xmlText(node.text ?? "");
    if (Object.keys(properties).length) text = `<text:span text:style-name="${style("text", properties)}">${text}</text:span>`;
    return href ? `<text:a xlink:type="simple" xlink:href="${escapeXml(href)}">${text}</text:a>` : text;
  };
  const cellStyle = style("table-cell", { "fo:border": "0.5pt solid #b9c4be", "fo:padding": "0.15cm" });
  const block = (node: JSONContent, quote = false): string => {
    if (node.type === "paragraph" || node.type === "heading") {
      const properties: Record<string, unknown> = { "fo:margin-bottom": "6pt", "fo:text-align": node.attrs?.textAlign ?? "left", "fo:line-height": `${Number(node.attrs?.lineHeight ?? 1.5) * 100}%` };
      if (quote || node.attrs?.indent) properties["fo:margin-left"] = `${(Number(node.attrs?.indent ?? 0) + (quote ? 1 : 0)) * 0.5}cm`;
      const extra = node.type === "heading" ? `<style:text-properties fo:font-size="${[0, 24, 18, 14][Number(node.attrs?.level ?? 2)]}pt" fo:font-weight="bold"/>` : "";
      const tag = node.type === "heading" ? "text:h" : "text:p";
      return `<${tag} text:style-name="${style("paragraph", properties, extra)}"${node.type === "heading" ? ` text:outline-level="${node.attrs?.level ?? 2}"` : ""}>${children(node).map(inline).join("")}</${tag}>`;
    }
    if (node.type === "pageBreak") return `<text:p text:style-name="${style("paragraph", { "fo:break-before": "page" })}"/>`;
    if (node.type === "horizontalRule") return `<text:p text:style-name="${style("paragraph", { "fo:border-bottom": "0.75pt solid #999999" })}"/>`;
    if (node.type === "blockquote") return children(node).map(child => block(child, true)).join("");
    if (node.type === "bulletList" || node.type === "orderedList") return `<text:list text:style-name="${node.type === "orderedList" ? "Numbered" : "Bullets"}">${children(node).map((item, index) => `<text:list-item${node.type === "orderedList" && index === 0 ? ` text:start-value="${node.attrs?.start ?? 1}"` : ""}>${children(item).map(child => block(child, quote)).join("")}</text:list-item>`).join("")}</text:list>`;
    if (node.type === "table") {
      const covered: number[] = [];
      return `<table:table table:name="Tabla"><table:table-column table:number-columns-repeated="${children(node)[0] ? children(children(node)[0]).reduce((sum, cell) => sum + Number(cell.attrs?.colspan ?? 1), 0) : 1}"/>${children(node).map(row => {
        let column = 0; let result = "";
        const skip = () => { while (covered[column] > 0) { result += "<table:covered-table-cell/>"; covered[column]--; column++; } };
        for (const cell of children(row)) {
          skip();
          const span = Number(cell.attrs?.colspan ?? 1); const rows = Number(cell.attrs?.rowspan ?? 1);
          result += `<table:table-cell table:style-name="${cellStyle}"${span > 1 ? ` table:number-columns-spanned="${span}"` : ""}${rows > 1 ? ` table:number-rows-spanned="${rows}"` : ""}>${children(cell).map(child => block(child)).join("")}</table:table-cell>`;
          for (let offset = 0; offset < span; offset++) { covered[column + offset] = rows - 1; if (offset) result += "<table:covered-table-cell/>"; }
          column += span;
        }
        skip();
        return `<table:table-row>${result}</table:table-row>`;
      }).join("")}</table:table>`;
    }
    if (node.type === "image") {
      const image = options.images?.[node.attrs?.src];
      if (!image) throw new Error(t("No se ha podido incluir una imagen en el archivo."));
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[image.mime] ?? "png";
      const name = `Pictures/image-${manifest.length + 1}.${extension}`;
      files[name] = image.bytes;
      manifest.push(`<manifest:file-entry manifest:full-path="${name}" manifest:media-type="${image.mime}"/>`);
      const { width, height } = pageDimensions(options.page);
      const cmWidth = Math.min((Number(node.attrs?.width) || Math.min(image.width, 600)) * 2.54 / 96, (width - options.page.margin * 2) / 10, (height - options.page.margin * 2 - 8) / 10 * image.width / image.height);
      return `<text:p><draw:frame draw:name="Imagen${manifest.length}" text:anchor-type="as-char" svg:width="${cmWidth}cm" svg:height="${cmWidth * image.height / image.width}cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:title>${escapeXml(node.attrs?.alt ?? "")}</svg:title></draw:frame></text:p>`;
    }
    return children(node).map(child => block(child, quote)).join("");
  };
  const body = block(document);
  const namespace = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  const lists = ["Bullets", "Numbered"].map(name => `<text:list-style style:name="${name}">${Array.from({ length: 10 }, (_, level) => name === "Bullets" ? `<text:list-level-style-bullet text:level="${level + 1}" text:bullet-char="•"><style:list-level-properties text:space-before="${level * 0.5}cm" text:min-label-width="0.5cm"/></text:list-level-style-bullet>` : `<text:list-level-style-number text:level="${level + 1}" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="${level * 0.5}cm" text:min-label-width="0.5cm"/></text:list-level-style-number>`).join("")}</text:list-style>`).join("");
  const { width, height } = pageDimensions(options.page);
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespace} office:version="1.3"><office:automatic-styles>${styles.join("")}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styleXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${namespace} office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="150%"/><style:text-properties fo:font-family="Georgia" fo:font-size="12pt"/></style:default-style>${lists}</office:styles><office:automatic-styles><style:page-layout style:name="Page"><style:page-layout-properties fo:page-width="${width}mm" fo:page-height="${height}mm" style:print-orientation="${options.page.orientation}" fo:margin="${options.page.margin}mm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Page"/></office:master-styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><dc:title>${escapeXml(options.title)}</dc:title><meta:generator>InkGroove</meta:generator></office:meta></office:document-meta>`;
  return zipSync({
    mimetype: [utf8("application/vnd.oasis.opendocument.text"), { level: 0 }],
    "content.xml": utf8(content), "styles.xml": utf8(styleXml), "meta.xml": utf8(meta),
    "META-INF/manifest.xml": utf8(`<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>${["content.xml", "styles.xml", "meta.xml"].map(name => `<manifest:file-entry manifest:full-path="${name}" manifest:media-type="text/xml"/>`).join("")}${manifest.join("")}</manifest:manifest>`), ...files,
  });
};

const rtfText = (text: string) => Array.from(text).map(character => {
  if (character === "\n") return "\\line "; if (character === "\t") return "\\tab ";
  if (/[\\{}]/.test(character)) return `\\${character}`;
  if (character.charCodeAt(0) < 128) return character;
  return character.split("").map(unit => `\\u${unit.charCodeAt(0) > 32767 ? unit.charCodeAt(0) - 65536 : unit.charCodeAt(0)}?`).join("");
}).join("");
export const exportRtf = (document: JSONContent, options: ExportOptions): string => {
  const fonts = Array.from(new Set(Object.values(FONT_FAMILIES).map(font => font.export)));
  const colors: string[] = [];
  const colorIndex = (color: string) => { if (!colors.includes(color)) colors.push(color); return colors.indexOf(color) + 1; };
  const inline = (node: JSONContent): string => {
    if (node.type === "hardBreak") return "\\line ";
    if (node.type !== "text") return children(node).map(inline).join("");
    const controls: string[] = [];
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      const name = ({ bold: "b", italic: "i", underline: "ul", strike: "strike", subscript: "sub", superscript: "super" } as Record<string, string>)[mark.type];
      if (name) controls.push(`\\${name}`);
      if (mark.type === "link") href = mark.attrs?.href;
      if (mark.type === "veritasTypography") {
        if (FONT_FAMILIES[mark.attrs?.font]) controls.push(`\\f${fonts.indexOf(FONT_FAMILIES[mark.attrs!.font].export)}`);
        if (mark.attrs?.size) controls.push(`\\fs${sizePoints(mark.attrs.size) * 2}`);
        if (mark.attrs?.color) controls.push(`\\cf${colorIndex(mark.attrs.color)}`);
      }
    }
    const value = `{${controls.join("")} ${rtfText(node.text ?? "")}}`;
    return href ? `{\\field{\\*\\fldinst HYPERLINK "${rtfText(href.replaceAll('"', "%22"))}"}{\\fldrslt ${value}}}` : value;
  };
  const block = (node: JSONContent, prefix = "", quote = false): string => {
    if (["paragraph", "heading"].includes(node.type ?? "")) {
      const align = ({ left: "ql", center: "qc", right: "qr", justify: "qj" } as Record<string, string>)[node.attrs?.textAlign ?? "left"] ?? "ql";
      const size = node.type === "heading" ? [0, 48, 36, 28][node.attrs?.level ?? 2] : 24;
      return `\\pard\\${align}\\f0\\fs${size}\\sl${Math.round(Number(node.attrs?.lineHeight ?? 1.5) * 240)}\\slmult1\\li${(Number(node.attrs?.indent ?? 0) + (quote ? 1 : 0)) * 284}\\sa120 ${prefix}${node.type === "heading" ? "\\b " : ""}${children(node).map(inline).join("")}\\b0\\par\n`;
    }
    if (node.type === "pageBreak") return "\\page\n";
    if (node.type === "horizontalRule") return "\\pard\\brdrb\\brdrs\\brdrw10\\par\n";
    if (node.type === "blockquote") return children(node).map(child => block(child, "", true)).join("");
    if (node.type === "bulletList" || node.type === "orderedList") return children(node).map((item, index) => children(item).map((child, childIndex) => block(child, childIndex ? "" : node.type === "bulletList" ? "\\bullet\\tab " : `${index + Number(node.attrs?.start ?? 1)}.\\tab `, quote)).join("")).join("");
    if (node.type === "image") {
      const image = options.images?.[node.attrs?.src];
      if (!image || !["image/png", "image/jpeg"].includes(image.mime)) throw new Error(t("No se pudo preparar una imagen para RTF."));
      const dimensions = pageDimensions(options.page);
      const width = Math.min(Number(node.attrs?.width) || Math.min(image.width, 600), (dimensions.width - options.page.margin * 2) * 96 / 25.4, (dimensions.height - options.page.margin * 2 - 8) * 96 / 25.4 * image.width / image.height);
      const hex = Array.from(image.bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return `\\pard {\\pict\\${image.mime === "image/png" ? "pngblip" : "jpegblip"}\\picw${image.width}\\pich${image.height}\\picwgoal${Math.round(width * 15)}\\pichgoal${Math.round(width * image.height / image.width * 15)} ${hex}}\\par\n`;
    }
    if (node.type === "table") {
      const tableWidth = Math.round((pageDimensions(options.page).width - options.page.margin * 2) * 1440 / 25.4);
      return children(node).map(row => {
        const cells = children(row); let offset = 0;
        const columns = cells.reduce((sum, cell) => sum + Number(cell.attrs?.colspan ?? 1), 0);
        const borders = "\\clbrdrt\\brdrs\\brdrw5\\clbrdrl\\brdrs\\brdrw5\\clbrdrb\\brdrs\\brdrw5\\clbrdrr\\brdrs\\brdrw5";
        const definitions = cells.map(cell => { offset += Number(cell.attrs?.colspan ?? 1); return `${borders}\\cellx${Math.round(offset * tableWidth / columns)}`; }).join("");
        return `\\trowd\\trgaph80 ${definitions}\n${cells.map(cell => `\\pard\\intbl\\f0\\fs24 ${children(cell).map((paragraph, index) => `${index ? "\\line " : ""}${children(paragraph).map(inline).join("")}`).join("")}\\cell `).join("")}\\row\n`;
      }).join("");
    }
    return children(node).map(child => block(child, prefix, quote)).join("");
  };
  const body = block(document);
  const { width, height } = pageDimensions(options.page);
  const margin = Math.round(options.page.margin * 1440 / 25.4);
  return `{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl${fonts.map((font, index) => `{\\f${index} ${rtfText(font)};}`).join("")}}{\\colortbl;${colors.map(color => `\\red${parseInt(color.slice(1, 3), 16)}\\green${parseInt(color.slice(3, 5), 16)}\\blue${parseInt(color.slice(5, 7), 16)};`).join("")}}{\\info{\\title ${rtfText(options.title)}}}\\paperw${Math.round(width * 1440 / 25.4)}\\paperh${Math.round(height * 1440 / 25.4)}\\margl${margin}\\margr${margin}\\margt${margin}\\margb${margin}\n${body}}`;
};

export const loadExportImages = async (document: JSONContent, rtf = false): Promise<Record<string, ExportImage>> => {
  const sources = new Set<string>();
  const visit = (node: JSONContent) => { if (node.type === "image" && node.attrs?.src) sources.add(node.attrs.src); children(node).forEach(visit); }; visit(document);
  const entries = await Promise.all(Array.from(sources).map(async src => {
    if (!/^\/api\/documents\/[a-f0-9-]{36}\/images\/[a-f0-9-]{36}$/.test(src) && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(src)) throw new Error(t("La imagen no tiene un origen válido."));
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) throw new Error(t("No se pudo descargar una imagen. Comprueba tu sesión."));
    let blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const image = new Image(); image.src = url;
    try {
      await image.decode();
      const { naturalWidth: width, naturalHeight: height } = image;
      if (rtf && !["image/png", "image/jpeg"].includes(blob.type)) {
        const canvas = documentCanvas(width, height); canvas.getContext("2d")!.drawImage(image, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error(t("No se pudo convertir una imagen."))), "image/png"));
      }
      return [src, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, width, height }] as const;
    } finally { URL.revokeObjectURL(url); }
  }));
  return Object.fromEntries(entries);
};
const documentCanvas = (width: number, height: number) => { const canvas = window.document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; };
export const downloadEditable = async (document: JSONContent, options: ExportOptions, format: "odt" | "rtf") => {
  const images = await loadExportImages(document, format === "rtf");
  const result = format === "odt" ? exportOdt(document, { ...options, images }) : exportRtf(document, { ...options, images });
  const blob = new Blob([typeof result === "string" ? result : new Uint8Array(result).buffer], { type: format === "odt" ? "application/vnd.oasis.opendocument.text" : "application/rtf" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a"); anchor.href = url;
  anchor.download = `${options.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "documento"}.${format}`;
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
