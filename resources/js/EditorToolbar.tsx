import { useEffect, useState } from "react";
import type { Editor, ChainedCommands } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic, Underline, Strikethrough, Subscript, Superscript, Undo2, Redo2, List, ListOrdered, Quote, IndentIncrease, IndentDecrease, Link, Unlink, ImagePlus, Table2, Minus, FileDown, Search, Eraser, ScissorsLineDashed, ChevronLeft, ChevronRight, X, Pilcrow, Plus, Trash2 } from "lucide-react";
import { DEFAULT_PAGE, FONT_FAMILIES, FONT_SIZES, PAGE_FORMATS } from "./pageLayout";
import { findMatches, searchKey } from "./EditorTools";
import { VERITAS_EVENT_META } from "./VeritasEditor";
import { downloadEditable } from "./exportDocument";
import type { PageSettings } from "./types";

type Props = { editor: Editor; title: string; page: PageSettings; onPageChange: (page: PageSettings) => void; onImage: () => void; beforeExport: () => Promise<boolean>; busy: boolean; zoom: number; onZoom: (zoom: number) => void; onError: (message: string) => void };
type Tab = "format" | "insert" | "page" | "file";
const TABS: [Tab, string][] = [["format", "Formato"], ["insert", "Insertar"], ["page", "Página"], ["file", "Archivo"]];
const COLORS = ["#17231f", "#315c4c", "#2d6680", "#a43f2d", "#785191", "#b7862e"];

export default function EditorToolbar({ editor, title, page = DEFAULT_PAGE, onPageChange, onImage, beforeExport, busy, zoom, onZoom, onError }: Props) {
  const [tab, setTab] = useState<Tab>("format");
  const [findOpen, setFindOpen] = useState(false); const [query, setQuery] = useState(""); const [replacement, setReplacement] = useState(""); const [matchIndex, setMatchIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false); const [href, setHref] = useState("");
  const [exporting, setExporting] = useState(false);
  const matches = findMatches(editor.state.doc, query);
  const typography = editor.getAttributes("veritasTypography");
  const block = editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph");
  const command = (name: string, action: (chain: ChainedCommands) => ChainedCommands) => action(editor.chain().focus().setMeta(VERITAS_EVENT_META, { eventType: "format", inputType: name })).run();
  const insertPageBreak = () => command("pageBreak", chain => {
    const content = [{ type: "pageBreak" }, { type: "paragraph" }];
    return editor.state.selection instanceof NodeSelection ? chain.insertContentAt(editor.state.selection.to, content) : chain.insertContent(content);
  });
  const tool = (label: string, icon: React.ReactNode, run: () => void, active = false, disabled = false) => <button type="button" className={`tool-button${active ? " active" : ""}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={run}>{icon}</button>;
  const group = (label: string, content: React.ReactNode) => <div className="ribbon-group"><div className="ribbon-group-tools">{content}</div><span className="ribbon-caption">{label}</span></div>;
  const setTypography = (attribute: string, value: string) => command(`typography:${attribute}`, chain => chain.setMark("veritasTypography", { ...typography, [attribute]: value || null }));
  const setBlock = (attribute: string, value: unknown) => command(`paragraph:${attribute}`, chain => chain.updateAttributes(editor.isActive("heading") ? "heading" : "paragraph", { [attribute]: value }));
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: findOpen ? query : "", index: matchIndex }).setMeta("addToHistory", false));
  }, [editor, query, findOpen, matchIndex]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && editor.view.dom.contains(document.activeElement)) { event.preventDefault(); setFindOpen(true); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [editor]);
  const goToMatch = (index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length; setMatchIndex(next);
    editor.chain().focus().setTextSelection(matches[next]).scrollIntoView().run();
  };
  const replace = (all: boolean) => {
    const targets = all ? matches : matches.length ? [matches[Math.min(matchIndex, matches.length - 1)]] : [];
    if (!targets.length) return;
    const transaction = editor.state.tr;
    for (const match of [...targets].reverse()) transaction.insertText(replacement, match.from, match.to);
    transaction.setMeta(VERITAS_EVENT_META, { eventType: "insert", inputType: "insertReplacementText", data: replacement });
    editor.view.dispatch(transaction); setMatchIndex(0);
  };
  const exportFile = async (format: "odt" | "rtf") => {
    setExporting(true); onError("");
    try { if (await beforeExport()) await downloadEditable(editor.getJSON(), { title, page }, format); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "No se pudo descargar el documento."); }
    finally { setExporting(false); }
  };
  const applyLink = () => {
    const value = href.trim();
    if (!/^(https?:\/\/\S+|mailto:[^\s@]+@[^\s@]+|#[\w-]+)$/i.test(value)) { onError("Escribe una dirección https://, http:// o mailto: válida."); return; }
    command("link", chain => chain.extendMarkRange("link").setLink({ href: value })); setLinkOpen(false); onError("");
  };
  return <div className="editor-ribbon" onMouseDown={event => { if (event.target instanceof Element && event.target.closest("button")) event.preventDefault(); }}>
    <div className="ribbon-tabs" role="tablist" aria-label="Herramientas de edición">{TABS.map(([name, label]) => <button type="button" key={name} role="tab" aria-selected={tab === name} aria-controls={`ribbon-${name}`} id={`tab-${name}`} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{label}</button>)}<div className="ribbon-quick">{tool("Deshacer", <Undo2 />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}{tool("Rehacer", <Redo2 />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}{tool("Buscar y reemplazar", <Search />, () => setFindOpen(!findOpen), findOpen)}</div></div>
    <div className="ribbon-controls" id={`ribbon-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === "format" && <>
        {group("Estilo", <label className="tool-select wide"><span>Estilo de párrafo</span><select aria-label="Estilo de párrafo" value={editor.isActive("heading") ? `h${block.level}` : "p"} onChange={event => command("paragraphStyle", chain => event.target.value === "p" ? chain.setParagraph() : chain.setHeading({ level: Number(event.target.value.slice(1)) as 1 | 2 | 3 }))}><option value="p">Párrafo normal</option><option value="h1">Título 1</option><option value="h2">Título 2</option><option value="h3">Título 3</option></select></label>)}
        {group("Tipografía", <><label className="tool-select font"><span>Fuente</span><select aria-label="Familia tipográfica" value={typography.font ?? ""} onChange={event => setTypography("font", event.target.value)}><option value="">Georgia · documento</option>{Object.entries(FONT_FAMILIES).map(([key, font]) => <option key={key} value={key}>{font.label}</option>)}</select></label><label className="tool-select size"><span>Tamaño en puntos</span><select aria-label="Tamaño en puntos" value={typography.size ?? ""} onChange={event => setTypography("size", event.target.value)}><option value="">12 pt</option>{FONT_SIZES.map(size => <option key={size} value={String(size)}>{size} pt</option>)}{["small", "normal", "large", "x-large"].includes(typography.size) && <option value={typography.size}>Tamaño anterior</option>}</select></label><div className="tool-formatting">{tool("Negrita", <Bold />, () => command("bold", chain => chain.toggleBold()), editor.isActive("bold"))}{tool("Cursiva", <Italic />, () => command("italic", chain => chain.toggleItalic()), editor.isActive("italic"))}{tool("Subrayado", <Underline />, () => command("underline", chain => chain.toggleUnderline()), editor.isActive("underline"))}{tool("Tachado", <Strikethrough />, () => command("strike", chain => chain.toggleStrike()), editor.isActive("strike"))}{tool("Subíndice", <Subscript />, () => command("subscript", chain => chain.toggleSubscript()), editor.isActive("subscript"))}{tool("Superíndice", <Superscript />, () => command("superscript", chain => chain.toggleSuperscript()), editor.isActive("superscript"))}</div><div className="color-palette" aria-label="Color del texto">{COLORS.map(color => <button type="button" key={color} aria-label={`Color ${color}`} title={`Color ${color}`} style={{ backgroundColor: color }} onClick={() => setTypography("color", color)} />)}</div></>)}
        {group("Párrafo", <><div className="tool-formatting">{tool("Alinear a la izquierda", <AlignLeft />, () => command("align:left", chain => chain.setTextAlign("left")), editor.isActive({ textAlign: "left" }))}{tool("Centrar", <AlignCenter />, () => command("align:center", chain => chain.setTextAlign("center")), editor.isActive({ textAlign: "center" }))}{tool("Alinear a la derecha", <AlignRight />, () => command("align:right", chain => chain.setTextAlign("right")), editor.isActive({ textAlign: "right" }))}{tool("Justificar", <AlignJustify />, () => command("align:justify", chain => chain.setTextAlign("justify")), editor.isActive({ textAlign: "justify" }))}{tool("Reducir sangría", <IndentDecrease />, () => setBlock("indent", Math.max(0, Number(block.indent ?? 0) - 1)))}{tool("Aumentar sangría", <IndentIncrease />, () => setBlock("indent", Math.min(6, Number(block.indent ?? 0) + 1)))}</div><label className="tool-select"><span>Interlineado</span><select aria-label="Interlineado" value={block.lineHeight ?? "1.5"} onChange={event => setBlock("lineHeight", event.target.value)}><option value="1">Simple · 1</option><option value="1.15">1,15</option><option value="1.5">1,5</option><option value="2">Doble · 2</option></select></label></>)}
        {group("Estructura", <>{tool("Lista con viñetas", <List />, () => command("bullet-list", chain => chain.toggleBulletList()), editor.isActive("bulletList"))}{tool("Lista numerada", <ListOrdered />, () => command("ordered-list", chain => chain.toggleOrderedList()), editor.isActive("orderedList"))}{tool("Cita", <Quote />, () => command("blockquote", chain => chain.toggleBlockquote()), editor.isActive("blockquote"))}{tool("Limpiar formato conservando la procedencia", <Eraser />, () => command("clearFormatting", chain => chain.unsetBold().unsetItalic().unsetUnderline().unsetStrike().unsetSubscript().unsetSuperscript().unsetLink().unsetMark("veritasTypography").setParagraph().updateAttributes("paragraph", { indent: 0, lineHeight: null, textAlign: "left" })))}</>)}
      </>}
      {tab === "insert" && <>
        {group("Contenido", <><button type="button" className="ribbon-action" disabled={busy} onClick={onImage}><ImagePlus />Imagen<span>Arrastrar o seleccionar</span></button><button type="button" className="ribbon-action" onClick={() => command("insertTable", chain => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><Table2 />Tabla<span>3 × 3 · ampliable</span></button></>)}
        {group("Referencias", <>{tool("Insertar o editar enlace", <Link />, () => { setHref(editor.getAttributes("link").href ?? "https://"); setLinkOpen(true); }, editor.isActive("link"))}{tool("Quitar enlace", <Unlink />, () => command("unlink", chain => chain.unsetLink()), false, !editor.isActive("link"))}{tool("Línea horizontal", <Minus />, () => command("horizontalRule", chain => chain.setHorizontalRule()))}{tool("Salto de página", <ScissorsLineDashed />, insertPageBreak)}</>)}
        {editor.isActive("image") && group("Imagen seleccionada", <><label className="tool-select"><span>Ancho</span><select aria-label="Ancho de la imagen" value={String(editor.getAttributes("image").width ?? 400)} onChange={event => command("image:width", chain => chain.updateAttributes("image", { width: Number(event.target.value), height: null }))}>{[160, 240, 320, 400, 500, 600].map(width => <option key={width} value={width}>{width}px</option>)}</select></label><input className="tool-input" aria-label="Texto alternativo de la imagen" placeholder="Descripción de la imagen" value={editor.getAttributes("image").alt ?? ""} maxLength={300} onChange={event => editor.chain().setMeta(VERITAS_EVENT_META, { eventType: "format", inputType: "image:alt" }).updateAttributes("image", { alt: event.target.value }).run()}/></>)}
        {editor.isActive("table") && group("Tabla seleccionada", <>{tool("Añadir fila", <Plus />, () => command("table:addRow", chain => chain.addRowAfter()))}{tool("Añadir columna", <Table2 />, () => command("table:addColumn", chain => chain.addColumnAfter()))}{tool("Eliminar fila", <Minus />, () => command("table:deleteRow", chain => chain.deleteRow()))}{tool("Eliminar columna", <ScissorsLineDashed />, () => command("table:deleteColumn", chain => chain.deleteColumn()))}{tool("Combinar o dividir celdas", <Pilcrow />, () => command("table:mergeSplit", chain => chain.mergeOrSplit()))}{tool("Eliminar tabla", <Trash2 />, () => command("table:delete", chain => chain.deleteTable()))}</>)}
      </>}
      {tab === "page" && <>
        {group("Tamaño de hoja", <label className="tool-select wide"><span>Formato de papel</span><select aria-label="Formato de papel" value={page.format} onChange={event => onPageChange({ ...page, format: event.target.value as PageSettings["format"] })}>{Object.entries(PAGE_FORMATS).map(([key, format]) => <option key={key} value={key}>{format.name} · {format.width} × {format.height} mm</option>)}</select></label>)}
        {group("Disposición", <><label className="tool-select"><span>Orientación</span><select aria-label="Orientación" value={page.orientation} onChange={event => onPageChange({ ...page, orientation: event.target.value as PageSettings["orientation"] })}><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label><label className="tool-select"><span>Márgenes</span><select aria-label="Márgenes" value={page.margin} onChange={event => onPageChange({ ...page, margin: Number(event.target.value) as PageSettings["margin"] })}>{[15, 20, 25, 30].map(margin => <option key={margin} value={margin}>{margin} mm</option>)}</select></label></>)}
        {group("Vista", <label className="tool-select"><span>Zoom</span><select aria-label="Zoom" value={zoom} onChange={event => onZoom(Number(event.target.value))}><option value="0">Ajustar al ancho</option>{[.6, .75, 1, 1.25].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label>)}
        {group("Separación", <button type="button" className="ribbon-action" onClick={insertPageBreak}><ScissorsLineDashed />Salto de página</button>)}
      </>}
      {tab === "file" && <>{group("Descargar copia editable", <><button type="button" className="ribbon-action" disabled={busy || exporting} onClick={() => void exportFile("odt")}><FileDown />OpenDocument<span>.odt · formato abierto</span></button><button type="button" className="ribbon-action" disabled={busy || exporting} onClick={() => void exportFile("rtf")}><FileDown />Rich Text<span>.rtf · compatible</span></button></>)}<p className="export-note">{exporting ? "Preparando el archivo…" : "El archivo incluye texto, formato e imágenes. La memoria de escritura se conserva en InkGroove."}</p></>}
    </div>
    {findOpen && <div className="find-toolbar"><input aria-label="Buscar texto" placeholder="Buscar en el documento" value={query} onChange={event => { setQuery(event.target.value); setMatchIndex(0); }}/><span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : "0 resultados"}</span>{tool("Anterior resultado", <ChevronLeft />, () => goToMatch(matchIndex - 1), false, !matches.length)}{tool("Siguiente resultado", <ChevronRight />, () => goToMatch(matchIndex + 1), false, !matches.length)}<input aria-label="Texto de sustitución" placeholder="Reemplazar por…" value={replacement} onChange={event => setReplacement(event.target.value)}/><button type="button" disabled={!matches.length} onClick={() => replace(false)}>Reemplazar</button><button type="button" disabled={!matches.length} onClick={() => replace(true)}>Todos</button>{tool("Cerrar búsqueda", <X />, () => setFindOpen(false))}</div>}
    {linkOpen && <form className="find-toolbar link-toolbar" onSubmit={event => { event.preventDefault(); applyLink(); }}><Link size={16}/><input aria-label="Dirección del enlace" value={href} onChange={event => setHref(event.target.value)} autoFocus placeholder="https://…"/><button type="submit">Aplicar enlace</button>{tool("Cancelar enlace", <X />, () => setLinkOpen(false))}</form>}
  </div>;
}
