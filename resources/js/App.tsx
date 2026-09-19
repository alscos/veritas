import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Certificate, DocumentVersion, Submission, User, VeritasDocument, WritingEvent } from "./types";

declare global { interface Window { __VERITAS_USER__?: User | null } }

type View = "documents" | "editor" | "timeline" | "submissions";
type AuthMode = "login" | "register";

const now = new Date();
const iso = (offsetMinutes = 0) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString();
const demoDocuments: VeritasDocument[] = [
  {
    id: "a4fe45d1-6420-4e9f-b730-429d7372eefe", owner_id: 1,
    title: "La fotografía: documento e interpretación",
    content_html: "<p>La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible.</p><p><mark data-origin=\"paste\">Una imagen también puede llegar al texto desde una fuente externa.</mark> <mark data-origin=\"paste-edited\">Cuando ese material se revisa, Veritas conserva su procedencia y registra la reelaboración.</mark></p><p>El valor de la imagen no reside solo en aquello que muestra, sino también en la mirada que la construye.</p>",
    content_text: "La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible. Una imagen también puede llegar al texto desde una fuente externa. Cuando ese material se revisa, Veritas conserva su procedencia y registra la reelaboración. El valor de la imagen no reside solo en aquello que muestra, sino también en la mirada que la construye.",
    word_count: 64, status: "draft", created_at: iso(-240), updated_at: iso(-8), last_session_at: iso(-8), versions_count: 1, sessions_count: 3,
    versions: [],
  },
  {
    id: "b8c56a82-5126-47dc-85a2-a90e8c71bfbc", owner_id: 1,
    title: "Notas sobre libertad y responsabilidad",
    content_html: "<p>Ser responsable no consiste únicamente en responder por las consecuencias, sino en reconocer la propia intervención en aquello que sucede.</p>",
    content_text: "Ser responsable no consiste únicamente en responder por las consecuencias, sino en reconocer la propia intervención en aquello que sucede.",
    word_count: 19, status: "draft", created_at: iso(-1440), updated_at: iso(-180), versions_count: 0, sessions_count: 1, versions: [],
  },
];

const demoEvents: WritingEvent[] = [
  { sequence: 1, event_type: "start", after_html: "", elapsed_ms: 0 },
  { sequence: 2, event_type: "insert", input_type: "insertText", after_html: "<p>La fotografía mantiene una relación ambigua con la realidad.</p>", elapsed_ms: 8_000 },
  { sequence: 3, event_type: "insert", input_type: "insertText", after_html: "<p>La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible.</p>", elapsed_ms: 21_000 },
  { sequence: 4, event_type: "paste", input_type: "insertFromPaste", data: "Una imagen también puede llegar al texto desde una fuente externa.", after_html: "<p>La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible.</p><p><mark data-origin=\"paste\">Una imagen también puede llegar al texto desde una fuente externa.</mark></p>", elapsed_ms: 35_000 },
  { sequence: 5, event_type: "paste_edit", input_type: "insertText", after_html: "<p>La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible.</p><p><mark data-origin=\"paste\">Una imagen también puede llegar al texto desde una fuente externa.</mark> <mark data-origin=\"paste-edited\">Cuando ese material se revisa, Veritas conserva su procedencia y registra la reelaboración.</mark></p>", elapsed_ms: 58_000 },
  { sequence: 6, event_type: "insert", input_type: "insertText", after_html: demoDocuments[0].content_html, elapsed_ms: 79_000 },
];

const words = (text: string) => text.trim() ? (text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu) ?? []).length : 0;
const plainText = (html: string) => { const node = document.createElement("div"); node.innerHTML = html; return (node.textContent ?? "").replace(/\u200b/g, "").replace(/\s+/g, " ").trim(); };
const makeId = () => crypto.randomUUID();
const shortDate = (value: string) => new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const duration = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1_000) % 60).padStart(2, "0")}`;

function Logo() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true">V</span><span>Veritas</span></div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = Object.fromEntries(form.entries());
      const result = await api<{ user: User }>(`/auth/${mode}`, { method: "POST", body: JSON.stringify(payload) });
      onAuthenticated(result.user);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "No se pudo conectar con Veritas."); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <section className="auth-story">
      <Logo />
      <div>
        <p className="eyebrow">Escritura con memoria</p>
        <h1>Un documento puede contar también cómo llegó a existir.</h1>
        <p>Veritas conserva el proceso de escritura, permite sellar versiones y compartir evidencias verificables sin convertirlas en una acusación automática.</p>
      </div>
      <p className="auth-foot">La autoría se argumenta con evidencias, no con una puntuación opaca.</p>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <p className="eyebrow">{mode === "login" ? "Acceso" : "Crear una cuenta"}</p>
        <h2>{mode === "login" ? "Vuelve a tus documentos" : "Empieza tu archivo personal"}</h2>
        <form onSubmit={submit}>
          {mode === "register" && <label>Nombre<input name="name" autoComplete="name" required /></label>}
          <label>Correo electrónico<input name="email" type="email" autoComplete="email" required /></label>
          <label>Contraseña<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required /></label>
          {mode === "register" && <label>Repite la contraseña<input name="password_confirmation" type="password" autoComplete="new-password" minLength={10} required /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary full" disabled={busy}>{busy ? "Un momento…" : mode === "login" ? "Entrar" : "Crear cuenta"}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "No tengo cuenta" : "Ya tengo una cuenta"}
        </button>
      </div>
    </section>
  </main>;
}

function Shell({ user, view, setView, demo, children, onLogout }: { user: User; view: View; setView: (view: View) => void; demo: boolean; children: React.ReactNode; onLogout: () => void }) {
  return <div className="app-shell">
    <header className="topbar">
      <Logo />
      <nav aria-label="Principal">
        <button className={view === "documents" || view === "editor" || view === "timeline" ? "active" : ""} onClick={() => setView("documents")}>Documentos</button>
        <button className={view === "submissions" ? "active" : ""} onClick={() => setView("submissions")}>Entregas</button>
      </nav>
      <div className="account"><span className="avatar">{user.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="account-name">{user.name}</span><button className="icon-button" title="Cerrar sesión" onClick={onLogout}>↗</button></div>
    </header>
    {demo && <div className="demo-ribbon">Demostración local · datos temporales de esta sesión</div>}
    {children}
  </div>;
}

function DocumentsView({ documents, onOpen, onCreate }: { documents: VeritasDocument[]; onOpen: (document: VeritasDocument) => void; onCreate: (title: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate(title.trim() || "Documento sin título"); setTitle(""); setCreating(false); };
  const totalWords = documents.reduce((sum, document) => sum + document.word_count, 0);
  const sealed = documents.reduce((sum, document) => sum + (document.versions_count ?? 0), 0);
  return <main className="workspace dashboard">
    <section className="dashboard-head">
      <div><p className="eyebrow">Archivo personal</p><h1>Mis documentos</h1><p>Cada texto nace privado. Tú decides cuándo sellarlo, compartirlo o entregarlo.</p></div>
      <button className="primary" onClick={() => setCreating(true)}><span>＋</span> Nuevo documento</button>
    </section>
    <section className="summary-strip" aria-label="Resumen">
      <div><strong>{documents.length}</strong><span>documentos</span></div>
      <div><strong>{sealed}</strong><span>versiones certificadas</span></div>
      <div><strong>{totalWords.toLocaleString("es")}</strong><span>palabras conservadas</span></div>
      <div className="summary-note"><span className="seal-mini">V</span><p><strong>Tu archivo es privado.</strong><br />Un profesor solo ve lo que entregas.</p></div>
    </section>
    {creating && <form className="new-document" onSubmit={submit}>
      <label htmlFor="new-title">Título del nuevo documento</label><input id="new-title" value={title} onChange={event => setTitle(event.target.value)} autoFocus placeholder="Por ejemplo, Comentario de texto" />
      <button className="primary">Crear y escribir</button><button type="button" className="secondary" onClick={() => setCreating(false)}>Cancelar</button>
    </form>}
    <section className="document-list">
      <div className="list-heading"><span>Documento</span><span>Proceso</span><span>Último cambio</span><span></span></div>
      {documents.map(document => <button className="document-row" key={document.id} onClick={() => onOpen(document)}>
        <span className="doc-main"><span className="doc-icon">{(document.versions_count ?? 0) > 0 ? "V" : "·"}</span><span><strong>{document.title}</strong><small>{document.word_count} palabras · {document.status === "draft" ? "Borrador activo" : "Archivado"}</small></span></span>
        <span className="process-cell"><span className={(document.versions_count ?? 0) > 0 ? "status sealed" : "status draft"}>{(document.versions_count ?? 0) > 0 ? `${document.versions_count} sellada${document.versions_count === 1 ? "" : "s"}` : "Sin sellar"}</span><small>{document.sessions_count ?? 0} sesiones</small></span>
        <span className="date-cell">{shortDate(document.updated_at)}</span><span className="row-arrow">→</span>
      </button>)}
    </section>
  </main>;
}

function EditorView({ initial, initialEvents, demo, onBack, onPersist }: { initial: VeritasDocument; initialEvents: WritingEvent[]; demo: boolean; onBack: () => void; onPersist: (document: VeritasDocument) => void }) {
  const [documentState, setDocumentState] = useState(initial);
  const [events, setEvents] = useState<WritingEvent[]>(initialEvents);
  const [title, setTitle] = useState(initial.title);
  const [html, setHtml] = useState(initial.content_html);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [showSeal, setShowSeal] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(initial.versions?.at(-1)?.certificate ?? null);
  const [showSend, setShowSend] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(Math.max(0, initialEvents.length - 1));
  const editorRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(makeId());
  const started = useRef(Date.now());
  const sequence = useRef(0);
  const pending = useRef<WritingEvent[]>([]);
  const editingPaste = useRef<HTMLElement | null>(null);
  const currentWordCount = words(plainText(html));
  const pasteWords = useMemo(() => { const node = globalThis.document.createElement("div"); node.innerHTML = html; return words(Array.from(node.querySelectorAll('mark[data-origin="paste"]')).map(item => item.textContent ?? "").join(" ")); }, [html]);
  const editedPasteWords = useMemo(() => { const node = globalThis.document.createElement("div"); node.innerHTML = html; return words(Array.from(node.querySelectorAll('mark[data-origin="paste-edited"]')).map(item => item.textContent ?? "").join(" ")); }, [html]);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initial.content_html;
    record("start", null, null, initial.content_html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { if (pending.current.length) void syncEvents(); }, 1800);
    return () => window.clearInterval(timer);
  });

  const record = (eventType: WritingEvent["event_type"], inputType: string | null, data?: string | null, nextHtml?: string) => {
    const event: WritingEvent = { sequence: ++sequence.current, event_type: eventType, input_type: inputType, data: data ?? null, after_html: nextHtml ?? editorRef.current?.innerHTML ?? html, elapsed_ms: Date.now() - started.current, created_at: new Date().toISOString() };
    pending.current.push(event); setEvents(previous => [...previous, event]);
  };
  const syncEvents = async () => {
    const batch = [...pending.current]; if (!batch.length || demo) { pending.current = []; return; }
    try { await api(`/documents/${documentState.id}/events`, { method: "POST", body: JSON.stringify({ session_id: sessionId.current, started_at: new Date(started.current).toISOString(), events: batch }) }); pending.current.splice(0, batch.length); }
    catch { setSaveState("error"); }
  };
  const save = async () => {
    setSaveState("saving"); const contentHtml = editorRef.current?.innerHTML ?? html;
    const updated = { ...documentState, title, content_html: contentHtml, content_text: plainText(contentHtml), word_count: words(plainText(contentHtml)), updated_at: new Date().toISOString() };
    try {
      if (!demo) { const result = await api<{ document: VeritasDocument }>(`/documents/${documentState.id}`, { method: "PATCH", body: JSON.stringify({ title, content_html: contentHtml }) }); setDocumentState({ ...updated, ...result.document }); }
      else setDocumentState(updated);
      record("save", null, null, contentHtml); await syncEvents(); onPersist(updated); setSaveState("saved");
    } catch { setSaveState("error"); }
  };
  const onBeforeInput = () => {
    const anchor = window.getSelection()?.anchorNode;
    editingPaste.current = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest?.('mark[data-origin="paste"]') as HTMLElement | null;
  };
  const onInput = (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.currentTarget; const native = event.nativeEvent as InputEvent;
    let eventType: WritingEvent["event_type"] = native.inputType?.startsWith("delete") ? "delete" : "insert";
    if (editingPaste.current?.isConnected) { editingPaste.current.dataset.origin = "paste-edited"; eventType = "paste_edit"; }
    editingPaste.current = null;
    const next = target.innerHTML; setHtml(next); setSaveState("saving"); record(eventType, native.inputType, native.data, next);
  };
  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault(); const text = event.clipboardData.getData("text/plain"); const selection = window.getSelection();
    if (!selection?.rangeCount) return; const range = selection.getRangeAt(0); range.deleteContents();
    const mark = globalThis.document.createElement("mark"); mark.dataset.origin = "paste"; mark.textContent = text;
    const neutral = globalThis.document.createTextNode("\u200b"); range.insertNode(neutral); range.insertNode(mark); range.setStartAfter(neutral); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    const next = event.currentTarget.innerHTML; setHtml(next); setSaveState("saving"); record("paste", "insertFromPaste", text, next);
  };
  const format = (command: string, value?: string) => { editorRef.current?.focus(); document.execCommand(command, false, value); const next = editorRef.current?.innerHTML ?? html; setHtml(next); record("format", command, value ?? null, next); };
  const seal = async () => {
    await save();
    try {
      let created: Certificate;
      let version: DocumentVersion;
      if (demo) {
        created = { id: makeId(), certificate_code: `VRT-${Math.random().toString(36).slice(2, 12).toUpperCase()}`, issued_at: new Date().toISOString() };
        version = { id: makeId(), version_number: (documentState.versions_count ?? 0) + 1, snapshot_html: editorRef.current?.innerHTML ?? html, snapshot_text: plainText(editorRef.current?.innerHTML ?? html), word_count: currentWordCount, content_hash: "demostracion", sealed_at: created.issued_at, certificate: created };
      } else {
        const result = await api<{ version: DocumentVersion; certificate: Certificate }>(`/documents/${documentState.id}/seal`, { method: "POST", body: "{}" });
        created = result.certificate; version = { ...result.version, certificate: result.certificate };
      }
      setCertificate(created); setShowSeal(false);
      const next = { ...documentState, versions: [...(documentState.versions ?? []), version], versions_count: (documentState.versions_count ?? 0) + 1 }; setDocumentState(next); onPersist(next);
    } catch { setSaveState("error"); }
  };
  const replayEvent = events[Math.min(timelineIndex, Math.max(0, events.length - 1))];
  if (timelineOpen) return <Timeline events={events} title={title} onClose={() => setTimelineOpen(false)} index={timelineIndex} setIndex={setTimelineIndex} />;
  return <main className="editor-layout">
    <aside className="document-context">
      <button className="back-link" onClick={onBack}>← Mis documentos</button>
      <p className="eyebrow">Documento propio</p>
      <h1>{title || "Sin título"}</h1>
      <dl><div><dt>Estado</dt><dd>Borrador privado</dd></div><div><dt>Extensión</dt><dd>{currentWordCount} palabras</dd></div><div><dt>Versiones</dt><dd>{documentState.versions_count ?? 0} certificadas</dd></div></dl>
      <div className="privacy-note"><span>⌁</span><p><strong>Solo tú puedes verlo.</strong><br />El acceso cambia únicamente al entregar una versión.</p></div>
    </aside>
    <section className="writing-surface">
      <div className="editor-header"><div><input className="title-input" value={title} onChange={event => { setTitle(event.target.value); setSaveState("saving"); }} aria-label="Título"/><span>Sesión activa · registro local y servidor</span></div><span className={`save-state ${saveState}`}>{saveState === "saved" ? "Todo guardado" : saveState === "saving" ? "Cambios pendientes" : "Error al guardar"}</span></div>
      <div className="paper">
        <div className="toolbar" role="toolbar" aria-label="Formato"><button onClick={() => format("bold")}><strong>B</strong></button><button onClick={() => format("italic")}><em>I</em></button><button onClick={() => format("underline")}><u>U</u></button><span></span><button onClick={() => format("formatBlock", "h2")}>T</button><button onClick={() => format("insertUnorderedList")}>☷</button><button onClick={() => format("formatBlock", "blockquote")}>❞</button><small><i className="legend paste"></i>Pegado <i className="legend edited"></i>Reelaborado</small></div>
        <div ref={editorRef} className="editor" contentEditable suppressContentEditableWarning data-placeholder="Empieza a escribir…" onBeforeInput={onBeforeInput} onInput={onInput} onPaste={onPaste} onFocus={() => record("focus", null)} onBlur={() => record("blur", null)} />
      </div>
      <div className="editor-actions"><span>{currentWordCount} palabras</span><div><button className="secondary" onClick={() => void save()}>Guardar</button><button className="secondary" onClick={() => setTimelineOpen(true)}>Ver proceso</button><button className="primary" disabled={!currentWordCount} onClick={() => setShowSeal(true)}>Sellar versión</button></div></div>
    </section>
    <aside className="evidence-panel">
      <div className="live-title"><span><i></i>Registro en directo</span><small>{events.length} eventos</small></div>
      <div className="metric-hero"><span>Ritmo reciente</span><strong>{Math.max(0, Math.round((currentWordCount / Math.max(1, Date.now() - started.current)) * 60_000))}<em> ppm</em></strong><div className="bars">{[6,10,8,14,11,16,13,18,15].map((height, i) => <i key={i} style={{height}} />)}</div></div>
      <ul className="evidence-list"><li><span className="metric-icon typed">T</span><p>Escritura directa<strong>{Math.max(0, currentWordCount - pasteWords - editedPasteWords)} palabras</strong></p></li><li><span className="metric-icon pasted">□</span><p>Pegado sin modificar<strong>{pasteWords} palabras</strong></p></li><li><span className="metric-icon revised">↺</span><p>Pegado reelaborado<strong>{editedPasteWords} palabras</strong></p></li><li><span className="metric-icon history">◷</span><p>Proceso registrado<strong>{duration(replayEvent?.elapsed_ms ?? 0)}</strong></p></li></ul>
      <button className="process-card" onClick={() => setTimelineOpen(true)}><span>▶</span><p><strong>Abrir la moviola</strong><br />Reconstruye el documento evento a evento.</p></button>
      {certificate && <div className="certificate-card"><span className="seal">V</span><p><strong>Última versión certificada</strong><br /><code>{certificate.certificate_code}</code></p><button onClick={() => setShowSend(true)}>Entregar</button></div>}
    </aside>
    {showSeal && <Modal title="Sellar esta versión" onClose={() => setShowSeal(false)}><p>Se creará una copia inmutable del texto y de la cadena de eventos recibida por Veritas. Podrás seguir trabajando y sellar versiones posteriores.</p><div className="seal-summary"><strong>{currentWordCount}</strong><span>palabras</span><strong>{events.length}</strong><span>eventos</span></div><div className="modal-actions"><button className="secondary" onClick={() => setShowSeal(false)}>Cancelar</button><button className="primary" onClick={() => void seal()}>Certificar versión</button></div></Modal>}
    {showSend && certificate && <SendModal certificate={certificate} demo={demo} documentState={documentState} onClose={() => setShowSend(false)} />}
  </main>;
}

function Timeline({ events, title, onClose, index, setIndex }: { events: WritingEvent[]; title: string; onClose: () => void; index: number; setIndex: (index: number) => void }) {
  const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(4);
  useEffect(() => { if (!playing || index >= events.length - 1) { if (index >= events.length - 1) setPlaying(false); return; } const timer = window.setTimeout(() => setIndex(index + 1), 800 / speed); return () => window.clearTimeout(timer); }, [playing, speed, index, events.length, setIndex]);
  const event = events[index] ?? events[0];
  const labels: Record<string, string> = { start: "Inicio", insert: "Escritura", delete: "Eliminación", paste: "Pegado", paste_edit: "Reelaboración de pegado", format: "Formato", focus: "Vuelta al editor", blur: "Salida del editor", save: "Guardado" };
  return <section className="timeline-view">
    <header><div><button className="back-link" onClick={onClose}>← Volver al documento</button><p className="eyebrow">Proceso de escritura</p><h1>{title}</h1></div><div className="timeline-stat"><strong>{events.length}</strong><span>eventos registrados</span></div></header>
    <div className="timeline-grid">
      <div className="replay-paper"><div className="replay-meta"><span>Evento {index + 1} de {events.length}</span><strong>{labels[event?.event_type] ?? event?.event_type}</strong></div><article dangerouslySetInnerHTML={{ __html: event?.after_html || "<p class='empty-replay'>La sesión comienza aquí.</p>" }} /></div>
      <aside className="event-rail"><h2>Secuencia</h2><div className="event-list">{events.map((item, eventIndex) => <button key={`${item.sequence}-${eventIndex}`} className={eventIndex === index ? "active" : ""} onClick={() => { setPlaying(false); setIndex(eventIndex); }}><i className={item.event_type}></i><span><strong>{labels[item.event_type] ?? item.event_type}</strong><small>{duration(item.elapsed_ms)}</small></span></button>)}</div></aside>
    </div>
    <footer className="transport"><button className="play" onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button><input type="range" min="0" max={Math.max(0, events.length - 1)} value={Math.min(index, Math.max(0, events.length - 1))} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} aria-label="Posición de la reproducción"/><span>{duration(event?.elapsed_ms ?? 0)}</span><select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label="Velocidad"><option value="1">1×</option><option value="4">4×</option><option value="16">16×</option></select></footer>
  </section>;
}

function SendModal({ certificate, documentState, demo, onClose }: { certificate: Certificate; documentState: VeritasDocument; demo: boolean; onClose: () => void }) {
  const [sent, setSent] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { if (!demo) { const version = documentState.versions?.at(-1); if (!version) throw new Error("Falta la versión sellada"); await api('/submissions', { method: 'POST', body: JSON.stringify({ document_version_id: version.id, recipient_email: form.get('email'), note: form.get('note') }) }); } setSent(true); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo realizar la entrega."); } };
  return <Modal title={sent ? "Versión entregada" : "Entregar versión certificada"} onClose={onClose}>{sent ? <div className="success-message"><span>✓</span><p><strong>La entrega ha quedado registrada.</strong><br />El destinatario verá esta versión concreta y su proceso, pero no tus borradores posteriores.</p><button className="primary" onClick={onClose}>Cerrar</button></div> : <form onSubmit={submit} className="send-form"><p>Se entregará la versión identificada como <code>{certificate.certificate_code}</code>.</p><label>Correo del profesor o destinatario<input name="email" type="email" required placeholder="profesor@centro.es" /></label><label>Nota opcional<textarea name="note" rows={3} placeholder="Una indicación breve para acompañar la entrega" /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Entregar esta versión</button></div></form>}</Modal>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button><h2 id="modal-title">{title}</h2>{children}</section></div>;
}

function SubmissionsView({ submissions }: { submissions: Submission[] }) {
  return <main className="workspace dashboard"><section className="dashboard-head"><div><p className="eyebrow">Versiones compartidas</p><h1>Entregas</h1><p>Una entrega contiene una versión inmutable; tus borradores posteriores permanecen privados.</p></div></section><section className="empty-state"><span>↗</span><h2>{submissions.length ? `${submissions.length} entregas registradas` : "Todavía no has realizado ninguna entrega"}</h2><p>Sella una versión desde el editor y elige a quién deseas enviarla. Las actividades del profesor aparecerán aquí cuando estén habilitadas.</p></section></main>;
}

export default function App() {
  const [booting, setBooting] = useState(true); const [user, setUser] = useState<User | null>(window.__VERITAS_USER__ ?? null); const [demo, setDemo] = useState(false);
  const [view, setView] = useState<View>("documents"); const [documents, setDocuments] = useState<VeritasDocument[]>([]); const [active, setActive] = useState<VeritasDocument | null>(null); const [submissions] = useState<Submission[]>([]); const [eventsByDocument, setEventsByDocument] = useState<Record<string, WritingEvent[]>>({ [demoDocuments[0].id]: demoEvents });
  useEffect(() => { void (async () => { try { let current = user; if (!current) { const result = await api<{ user: User }>('/me'); current = result.user; setUser(current); } if (current) { const result = await api<{ documents: VeritasDocument[] }>('/documents'); setDocuments(result.documents); } } catch (reason) { if (import.meta.env.DEV && (!(reason instanceof ApiError) || reason.status !== 401)) { setDemo(true); setUser({ id: 1, name: "Alejandro", email: "alejandro@veritas.local" }); setDocuments(demoDocuments); } } finally { setBooting(false); } })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const create = async (title: string) => { let created: VeritasDocument; if (demo) created = { id: makeId(), owner_id: user!.id, title, content_html: "", content_text: "", word_count: 0, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), versions_count: 0, sessions_count: 0, versions: [] }; else { const result = await api<{ document: VeritasDocument }>('/documents', { method: 'POST', body: JSON.stringify({ title }) }); created = result.document; } setDocuments(previous => [created, ...previous]); setActive(created); setView("editor"); };
  const open = async (document: VeritasDocument) => { if (!demo) { const [detail, timeline] = await Promise.all([api<{ document: VeritasDocument }>(`/documents/${document.id}`), api<{ events: WritingEvent[] }>(`/documents/${document.id}/timeline`)]); document = detail.document; setEventsByDocument(previous => ({ ...previous, [document.id]: timeline.events })); } setActive(document); setView("editor"); };
  const persist = (updated: VeritasDocument) => { setDocuments(previous => previous.map(document => document.id === updated.id ? { ...document, ...updated } : document)); setActive(updated); setEventsByDocument(previous => active ? ({ ...previous, [active.id]: previous[active.id] ?? [] }) : previous); };
  const logout = async () => { if (!demo) await api('/auth/logout', { method: 'POST', body: '{}' }); setUser(null); setDocuments([]); setView("documents"); };
  if (booting) return <main className="loading"><Logo /><span></span><p>Abriendo tu archivo…</p></main>;
  if (!user) return <AuthScreen onAuthenticated={next => { setUser(next); void api<{ documents: VeritasDocument[] }>('/documents').then(result => setDocuments(result.documents)).catch(() => setDocuments([])); }} />;
  return <Shell user={user} view={view} setView={setView} demo={demo} onLogout={() => void logout()}>
    {view === "documents" && <DocumentsView documents={documents} onOpen={document => void open(document)} onCreate={title => void create(title)} />}
    {view === "editor" && active && <EditorView key={active.id} initial={active} initialEvents={eventsByDocument[active.id] ?? []} demo={demo} onBack={() => setView("documents")} onPersist={persist} />}
    {view === "submissions" && <SubmissionsView submissions={submissions} />}
  </Shell>;
}
