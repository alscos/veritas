import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Certificate, DocumentVersion, Submission, User, VeritasDocument, WritingEvent } from "./types";

declare global { interface Window { __VERITAS_USER__?: User | null } }

type View = "documents" | "editor" | "timeline" | "submissions";
type AuthMode = "login" | "register";
type EditorRecovery = { savedAt: number; html: string; title: string; sessionId: string; startedAt: number; sequence: number; pending: WritingEvent[] };

const recoveryKey = (documentId: string) => `veritas:recovery:${documentId}`;
const clearRecovery = (documentId: string) => {
  try { localStorage.removeItem(recoveryKey(documentId)); } catch { /* Storage can be unavailable in hardened browser modes. */ }
};
const loadRecovery = (documentId: string, serverUpdatedAt: string): EditorRecovery | null => {
  try {
    const raw = localStorage.getItem(recoveryKey(documentId)); if (!raw) return null;
    const recovery = JSON.parse(raw) as EditorRecovery;
    if (typeof recovery.html !== "string" || !recovery.sessionId || !Array.isArray(recovery.pending) || recovery.savedAt <= new Date(serverUpdatedAt).getTime()) { clearRecovery(documentId); return null; }
    return recovery;
  } catch { return null; }
};

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
type Provenance = "direct" | "paste" | "paste-edited";
const blockTags = new Set(["DIV", "P", "H2", "H3", "LI", "BLOCKQUOTE", "UL", "OL"]);
const analyzeHtml = (html: string) => {
  const root = document.createElement("div"); root.innerHTML = html;
  let source = ""; const provenance: Provenance[] = [];
  const append = (text: string, origin: Provenance) => { source += text; for (let index = 0; index < text.length; index++) provenance.push(origin); };
  const visit = (node: Node, inherited: Provenance) => {
    if (node.nodeType === Node.TEXT_NODE) { append(node.textContent ?? "", inherited); return; }
    if (!(node instanceof HTMLElement)) return;
    let origin = inherited;
    if (node.tagName === "MARK" && node.dataset.origin === "paste") origin = "paste";
    if (node.tagName === "MARK" && node.dataset.origin === "paste-edited") origin = "paste-edited";
    if (node.tagName === "BR") { append("\n", origin); return; }
    Array.from(node.childNodes).forEach(child => visit(child, origin));
    if (blockTags.has(node.tagName)) append("\n", origin);
  };
  Array.from(root.childNodes).forEach(child => visit(child, "direct"));
  const counts = { direct: 0, pasted: 0, edited: 0, total: 0 };
  for (const match of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)) {
    const start = match.index ?? 0; const end = start + match[0].length;
    const origins = new Set(provenance.slice(start, end)); counts.total++;
    if (origins.has("paste-edited")) counts.edited++;
    else if (origins.has("paste")) counts.pasted++;
    else counts.direct++;
  }
  return { ...counts, text: source.replace(/\u200b/g, "").replace(/\s+/gu, " ").trim() };
};
const plainText = (html: string) => analyzeHtml(html).text;

const ppmForSession = (events: WritingEvent[]): number | null => {
  if (!events.length) return null;
  const startDirect = analyzeHtml(events[0].after_html ?? "").direct;
  const finalDirect = analyzeHtml(events.at(-1)?.after_html ?? "").direct;
  const writtenWords = Math.max(0, finalDirect - startDirect);
  const firstWriting = events.find(event => event.event_type === "insert" && event.input_type !== "insertFromPaste" && analyzeHtml(event.after_html ?? "").direct > startDirect);
  const elapsed = firstWriting ? (events.at(-1)?.elapsed_ms ?? 0) - firstWriting.elapsed_ms : 0;
  return writtenWords >= 3 && elapsed >= 5_000 ? Math.round((writtenWords / elapsed) * 60_000) : null;
};

const groupSessions = (events: WritingEvent[]): WritingEvent[][] => {
  const sessions: WritingEvent[][] = [];
  for (const event of events) {
    const previous = sessions.at(-1)?.at(-1);
    const newSession = !previous || (event.writing_session_id && previous.writing_session_id && event.writing_session_id !== previous.writing_session_id) || event.sequence <= previous.sequence;
    if (newSession) sessions.push([]);
    sessions.at(-1)!.push(event);
  }
  return sessions;
};

const lastRecordedPpm = (events: WritingEvent[]): number | null => {
  const sessions = groupSessions(events);
  for (let index = sessions.length - 1; index >= 0; index--) {
    const ppm = ppmForSession(sessions[index]); if (ppm !== null) return ppm;
  }
  return null;
};

const PAUSE_THRESHOLD_MS = 5_000;
const timingAnalysis = (events: WritingEvent[]) => {
  const result = { totalMs: 0, writingMs: 0, revisionMs: 0, pauseMs: 0, pauseCount: 0, awayMs: 0 };
  const contentTypes = new Set<WritingEvent["event_type"]>(["insert", "delete", "paste", "paste_edit", "format"]);
  for (const session of groupSessions(events)) {
    if (!session.length) continue;
    const sessionEnd = Math.max(...session.map(event => event.elapsed_ms)); result.totalMs += sessionEnd;
    const away: Array<[number, number]> = []; let awayStart: number | null = null;
    for (const event of session) {
      if (event.event_type === "blur" && awayStart === null) awayStart = event.elapsed_ms;
      if (event.event_type === "focus" && awayStart !== null) { away.push([awayStart, event.elapsed_ms]); awayStart = null; }
    }
    if (awayStart !== null) away.push([awayStart, sessionEnd]);
    result.awayMs += away.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0);
    const focusedDuration = (start: number, end: number) => Math.max(0, end - start - away.reduce((sum, [awayFrom, awayTo]) => sum + Math.max(0, Math.min(end, awayTo) - Math.max(start, awayFrom)), 0));
    const contentEvents = session.filter(event => contentTypes.has(event.event_type));
    if (!contentEvents.length) continue;
    let previous = session[0].elapsed_ms;
    for (const event of contentEvents) {
      const gap = focusedDuration(previous, event.elapsed_ms);
      if (gap >= PAUSE_THRESHOLD_MS) { result.pauseCount++; result.pauseMs += gap; }
      else if (event.event_type === "insert") result.writingMs += gap;
      else result.revisionMs += gap;
      previous = event.elapsed_ms;
    }
    const tail = focusedDuration(previous, sessionEnd);
    if (tail >= PAUSE_THRESHOLD_MS) { result.pauseCount++; result.pauseMs += tail; }
  }
  return result;
};
const makeId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
const shortDate = (value: string) => new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const duration = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1_000)); const hours = Math.floor(seconds / 3_600); const minutes = Math.floor(seconds / 60) % 60; const rest = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`; };

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
        <button className={view === "documents" || view === "editor" || view === "timeline" ? "active" : ""} disabled={view === "editor"} onClick={() => setView("documents")}>Documentos</button>
        <button className={view === "submissions" ? "active" : ""} disabled={view === "editor"} onClick={() => setView("submissions")}>Entregas</button>
      </nav>
      <div className="account"><span className="avatar">{user.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="account-name">{user.name}</span><button className="icon-button" title={view === "editor" ? "Vuelve primero a tus documentos" : "Cerrar sesión"} disabled={view === "editor"} onClick={onLogout}>↗</button></div>
    </header>
    {demo && <div className="demo-ribbon">Demostración local · datos temporales de esta sesión</div>}
    {children}
  </div>;
}

function DocumentsView({ documents, onOpen, onCreate, onDelete }: { documents: VeritasDocument[]; onOpen: (document: VeritasDocument) => void; onCreate: (title: string) => void; onDelete: (document: VeritasDocument) => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<VeritasDocument | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate(title.trim() || "Documento sin título"); setTitle(""); setCreating(false); };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true); setDeleteError("");
    try { await onDelete(deleting); setDeleting(null); }
    catch (reason) { setDeleteError(reason instanceof ApiError ? reason.message : "No se pudo eliminar el documento."); }
    finally { setDeleteBusy(false); }
  };
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
      <div className="list-heading"><span>Documento</span><span>Proceso</span><span>Último cambio</span><span></span><span></span></div>
      {documents.map(document => <div className="document-row" key={document.id}>
        <button className="document-open" onClick={() => onOpen(document)}>
          <span className="doc-main"><span className="doc-icon">{(document.versions_count ?? 0) > 0 ? "V" : "·"}</span><span><strong>{document.title}</strong><small>{document.word_count} palabras · {document.status === "draft" ? "Borrador activo" : "Archivado"}</small></span></span>
          <span className="process-cell"><span className={(document.versions_count ?? 0) > 0 ? "status sealed" : "status draft"}>{(document.versions_count ?? 0) > 0 ? `${document.versions_count} sellada${document.versions_count === 1 ? "" : "s"}` : "Sin sellar"}</span><small>{document.sessions_count ?? 0} sesiones</small></span>
          <span className="date-cell">{shortDate(document.updated_at)}</span><span className="row-arrow">→</span>
        </button>
        <button className="document-delete" title={`Eliminar ${document.title}`} aria-label={`Eliminar ${document.title}`} onClick={() => { setDeleting(document); setDeleteError(""); }}>×</button>
      </div>)}
    </section>
    {deleting && <Modal title="Eliminar documento" onClose={() => { if (!deleteBusy) setDeleting(null); }}>
      <p>Vas a eliminar <strong>«{deleting.title}»</strong> y todo su historial de escritura{(deleting.versions_count ?? 0) > 0 ? ", incluidas sus versiones certificadas" : ""}. Esta acción no se puede deshacer.</p>
      {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
      <div className="modal-actions"><button className="secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Cancelar</button><button className="danger" disabled={deleteBusy} onClick={() => void confirmDelete()}>{deleteBusy ? "Eliminando…" : "Eliminar definitivamente"}</button></div>
    </Modal>}
  </main>;
}

function EditorView({ initial, initialEvents, demo, onBack, onPersist }: { initial: VeritasDocument; initialEvents: WritingEvent[]; demo: boolean; onBack: () => void; onPersist: (document: VeritasDocument) => void }) {
  const recovery = useMemo(() => loadRecovery(initial.id, initial.updated_at), [initial.id, initial.updated_at]);
  const initialHtml = recovery?.html ?? (typeof initial.content_html === "string" ? initial.content_html : "");
  const [documentState, setDocumentState] = useState(initial);
  const [events, setEvents] = useState<WritingEvent[]>([...initialEvents, ...(recovery?.pending ?? [])]);
  const [title, setTitle] = useState(recovery?.title ?? initial.title);
  const [html, setHtml] = useState(initialHtml);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "expired">(recovery ? "saving" : "saved");
  const [showSeal, setShowSeal] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(initial.versions?.at(-1)?.certificate ?? null);
  const [showSend, setShowSend] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(Math.max(0, initialEvents.length - 1));
  const [firstTypingAt, setFirstTypingAt] = useState<number | null>(null);
  const [metricNow, setMetricNow] = useState(Date.now());
  const editorRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(recovery?.sessionId ?? makeId());
  const started = useRef(recovery?.startedAt ?? Date.now());
  const sequence = useRef(recovery?.sequence ?? 0);
  const pending = useRef<WritingEvent[]>([...(recovery?.pending ?? [])]);
  const syncInFlight = useRef<Promise<boolean> | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const changeRevision = useRef(recovery ? 1 : 0);
  const lastSavedRevision = useRef(0);
  const sessionExpired = useRef(false);
  const editingProvenance = useRef(false);
  const pendingPasteEdit = useRef<{ mark: HTMLElement; original: string; start: number; end: number } | null>(null);
  const analysis = useMemo(() => analyzeHtml(html), [html]);
  const currentWordCount = analysis.total;
  const pasteWords = analysis.pasted;
  const editedPasteWords = analysis.edited;
  const initialDirectWords = useRef(analysis.direct);
  const sessionDirectWords = Math.max(0, analysis.direct - initialDirectWords.current);
  const typingElapsedMs = firstTypingAt === null ? 0 : metricNow - firstTypingAt;
  const sessionPpm = sessionDirectWords >= 3 && typingElapsedMs >= 5_000 ? Math.round((sessionDirectWords / typingElapsedMs) * 60_000) : null;
  const previousPpm = useMemo(() => lastRecordedPpm(initialEvents), [initialEvents]);
  const displayedPpm = sessionPpm ?? previousPpm;
  const timing = useMemo(() => timingAnalysis(events), [events]);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
    record(recovery ? "focus" : "start", null, null, initialHtml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!sessionExpired.current && pending.current.length) void syncEvents(); }, 1200);
    return () => { window.clearInterval(timer); void syncEvents(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (firstTypingAt === null) return;
    const timer = window.setInterval(() => setMetricNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [firstTypingAt]);

  useEffect(() => {
    if (!timelineOpen && editorRef.current) editorRef.current.innerHTML = html;
    // `html` is intentionally omitted: resetting on every keystroke would move the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineOpen]);

  useEffect(() => {
    const warnIfPending = (event: BeforeUnloadEvent) => {
      if (changeRevision.current <= lastSavedRevision.current && !pending.current.length) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnIfPending);
    return () => window.removeEventListener("beforeunload", warnIfPending);
  }, []);

  const persistLocalRecovery = (contentHtml = editorRef.current?.innerHTML ?? html, recoveryTitle = title) => {
    try { localStorage.setItem(recoveryKey(documentState.id), JSON.stringify({ savedAt: Date.now(), html: contentHtml, title: recoveryTitle, sessionId: sessionId.current, startedAt: started.current, sequence: sequence.current, pending: pending.current } satisfies EditorRecovery)); } catch { /* Storage can be unavailable in hardened browser modes. */ }
  };
  const expireSession = () => { sessionExpired.current = true; persistLocalRecovery(); setSaveState("expired"); };
  const record = (eventType: WritingEvent["event_type"], inputType: string | null, data?: string | null, nextHtml?: string) => {
    const event: WritingEvent = { writing_session_id: sessionId.current, sequence: ++sequence.current, event_type: eventType, input_type: inputType, data: data ?? null, after_html: nextHtml ?? editorRef.current?.innerHTML ?? html, elapsed_ms: Date.now() - started.current, created_at: new Date().toISOString() };
    pending.current.push(event); setEvents(previous => [...previous, event]);
    if (sessionExpired.current) persistLocalRecovery(event.after_html);
  };
  const syncEvents = async (): Promise<boolean> => {
    if (sessionExpired.current) return false;
    if (demo) { pending.current = []; return true; }
    if (syncInFlight.current) {
      const synced = await syncInFlight.current;
      return synced && pending.current.length ? syncEvents() : synced;
    }
    const batch = [...pending.current]; if (!batch.length) return true;
    const operation = (async () => {
      try {
        await api(`/documents/${documentState.id}/events`, { method: "POST", body: JSON.stringify({ session_id: sessionId.current, started_at: new Date(started.current).toISOString(), events: batch }) });
        pending.current.splice(0, batch.length); return true;
      } catch (reason) { if (reason instanceof ApiError && (reason.status === 419 || reason.status === 401)) expireSession(); else setSaveState("error"); return false; }
    })();
    syncInFlight.current = operation;
    const synced = await operation;
    if (syncInFlight.current === operation) syncInFlight.current = null;
    return synced;
  };
  const save = async (): Promise<boolean> => {
    if (sessionExpired.current) { persistLocalRecovery(); return false; }
    if (saveInFlight.current) {
      const saved = await saveInFlight.current;
      return saved && lastSavedRevision.current < changeRevision.current ? save() : saved;
    }
    const revision = changeRevision.current;
    const contentHtml = editorRef.current?.innerHTML ?? html;
    const snapshotTitle = title;
    setHtml(contentHtml); setSaveState("saving");
    const operation = (async () => {
      const updated = { ...documentState, title: snapshotTitle, content_html: contentHtml, content_text: plainText(contentHtml), word_count: words(plainText(contentHtml)), updated_at: new Date().toISOString() };
      try {
        let persisted = updated;
        if (!demo) {
          const result = await api<{ document: VeritasDocument }>(`/documents/${documentState.id}`, { method: "PATCH", body: JSON.stringify({ title: snapshotTitle, content_html: contentHtml }) });
          persisted = { ...updated, ...result.document };
        }
        setDocumentState(persisted); record("save", null, null, contentHtml);
        if (!await syncEvents()) return false;
        lastSavedRevision.current = Math.max(lastSavedRevision.current, revision);
        if (revision === changeRevision.current) clearRecovery(documentState.id);
        onPersist(persisted); setSaveState(revision === changeRevision.current ? "saved" : "saving"); return true;
      } catch (reason) { if (reason instanceof ApiError && (reason.status === 419 || reason.status === 401)) { persistLocalRecovery(contentHtml, snapshotTitle); expireSession(); } else setSaveState("error"); return false; }
    })();
    saveInFlight.current = operation;
    const saved = await operation;
    if (saveInFlight.current === operation) saveInFlight.current = null;
    return saved && lastSavedRevision.current < changeRevision.current ? save() : saved;
  };

  useEffect(() => {
    if (saveState !== "saving") return;
    const timer = window.setTimeout(() => { void save(); }, 1100);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, title, saveState]);

  const markChanged = () => { changeRevision.current++; if (sessionExpired.current) { persistLocalRecovery(); setSaveState("expired"); } else setSaveState("saving"); };
  const openTimeline = async () => {
    const ready = lastSavedRevision.current < changeRevision.current ? await save() : await syncEvents();
    if (!ready) return;
    setTimelineIndex(Math.max(0, events.length - 1)); setTimelineOpen(true);
  };
  const leaveEditor = async () => { if (await save()) onBack(); };
  const onBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode; const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const originMark = element?.closest?.('mark[data-origin]') as HTMLElement | null;
    editingProvenance.current = Boolean(originMark);
    pendingPasteEdit.current = null;
    if (!selection?.rangeCount || originMark?.dataset.origin !== "paste") return;
    const range = selection.getRangeAt(0);
    if (!originMark.contains(range.startContainer) || !originMark.contains(range.endContainer)) return;
    const offsetWithin = (container: Node, offset: number) => { const probe = document.createRange(); probe.selectNodeContents(originMark); probe.setEnd(container, offset); return probe.toString().length; };
    pendingPasteEdit.current = { mark: originMark, original: originMark.textContent ?? "", start: offsetWithin(range.startContainer, range.startOffset), end: offsetWithin(range.endContainer, range.endOffset) };
  };
  const onInput = (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.currentTarget; const native = event.nativeEvent as InputEvent;
    const pendingEdit = pendingPasteEdit.current;
    const isInsertion = native.inputType?.startsWith("insert") || native.data !== null;
    const inserted = native.data ?? (native.inputType === "insertParagraph" || native.inputType === "insertLineBreak" ? "\n" : null);
    if (pendingEdit && isInsertion && inserted !== null && pendingEdit.mark.isConnected) {
      const fragment = document.createDocumentFragment();
      const provenanceMark = (text: string, origin: "paste" | "paste-edited") => { const mark = document.createElement("mark"); mark.dataset.origin = origin; mark.textContent = text; return mark; };
      if (pendingEdit.start > 0) fragment.append(provenanceMark(pendingEdit.original.slice(0, pendingEdit.start), "paste"));
      const edited = provenanceMark(inserted, "paste-edited"); fragment.append(edited);
      if (pendingEdit.end < pendingEdit.original.length) fragment.append(provenanceMark(pendingEdit.original.slice(pendingEdit.end), "paste"));
      pendingEdit.mark.replaceWith(fragment);
      const selection = window.getSelection(); const caret = document.createRange(); caret.selectNodeContents(edited); caret.collapse(false); selection?.removeAllRanges(); selection?.addRange(caret);
    }
    let eventType: WritingEvent["event_type"] = native.inputType?.startsWith("delete") ? "delete" : "insert";
    if (editingProvenance.current) eventType = "paste_edit";
    if (eventType === "insert" && native.inputType !== "insertFromPaste" && native.data) setFirstTypingAt(previous => previous ?? Date.now());
    editingProvenance.current = false; pendingPasteEdit.current = null;
    const next = target.innerHTML; setHtml(next); markChanged(); record(eventType, native.inputType, native.data, next);
  };
  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault(); const text = event.clipboardData.getData("text/plain"); const selection = window.getSelection();
    if (!selection?.rangeCount) return; const range = selection.getRangeAt(0); range.deleteContents();
    const mark = globalThis.document.createElement("mark"); mark.dataset.origin = "paste"; mark.textContent = text;
    const neutral = globalThis.document.createTextNode("\u200b"); range.insertNode(neutral); range.insertNode(mark); range.setStartAfter(neutral); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    const next = event.currentTarget.innerHTML; setHtml(next); markChanged(); record("paste", "insertFromPaste", text, next);
  };
  const format = (command: string, value?: string) => { editorRef.current?.focus(); document.execCommand(command, false, value); const next = editorRef.current?.innerHTML ?? html; setHtml(next); markChanged(); record("format", command, value ?? null, next); };
  const toggleHeading = () => { const selection = window.getSelection(); const anchor = selection?.anchorNode; const element = anchor instanceof Element ? anchor : anchor?.parentElement; format("formatBlock", element?.closest("h2") ? "p" : "h2"); };
  const seal = async () => {
    if (!await save()) return;
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
  if (timelineOpen) return <Timeline events={events} title={title} onClose={() => setTimelineOpen(false)} index={timelineIndex} setIndex={setTimelineIndex} />;
  return <main className="editor-layout">
    <aside className="document-context">
      <button className="back-link" onClick={() => void leaveEditor()}>← Mis documentos</button>
      <p className="eyebrow">Documento propio</p>
      <h1>{title || "Sin título"}</h1>
      <dl><div><dt>Estado</dt><dd>Borrador privado</dd></div><div><dt>Extensión</dt><dd>{currentWordCount} palabras</dd></div><div><dt>Versiones</dt><dd>{documentState.versions_count ?? 0} certificadas</dd></div></dl>
      <div className="privacy-note"><span>⌁</span><p><strong>Solo tú puedes verlo.</strong><br />El acceso cambia únicamente al entregar una versión.</p></div>
    </aside>
    <section className="writing-surface">
      <div className="editor-header"><div><input className="title-input" value={title} onChange={event => { const nextTitle = event.target.value; setTitle(nextTitle); markChanged(); if (sessionExpired.current) persistLocalRecovery(editorRef.current?.innerHTML ?? html, nextTitle); }} aria-label="Título"/><span>Sesión activa · registro local y servidor</span></div>{saveState === "expired" ? <button className="save-state expired" onClick={() => window.location.reload()}>Sesión caducada · volver a entrar</button> : <span className={`save-state ${saveState}`}>{saveState === "saved" ? "Todo guardado" : saveState === "saving" ? "Guardando…" : "Error al guardar"}</span>}</div>
      <div className="paper">
        <div className="toolbar" role="toolbar" aria-label="Formato" onMouseDown={event => { if (event.target instanceof Element && event.target.closest("button")) event.preventDefault(); }}><button onClick={() => format("bold")}><strong>B</strong></button><button onClick={() => format("italic")}><em>I</em></button><button onClick={() => format("underline")}><u>U</u></button><span></span><button title="Alternar título y párrafo" aria-label="Alternar título y párrafo" onClick={toggleHeading}>T</button><button onClick={() => format("insertUnorderedList")}>☷</button><button onClick={() => format("formatBlock", "blockquote")}>❞</button><small><i className="legend paste"></i>Pegado <i className="legend edited"></i>Reelaborado</small></div>
        <div ref={editorRef} className="editor" contentEditable suppressContentEditableWarning data-placeholder="Empieza a escribir…" onBeforeInput={onBeforeInput} onInput={onInput} onPaste={onPaste} onFocus={() => record("focus", null)} onBlur={() => record("blur", null)} />
      </div>
      <div className="editor-actions"><span>{currentWordCount} palabras</span><div><button className="secondary" onClick={() => void save()}>Guardar ahora</button><button className="secondary" onClick={() => void openTimeline()}>Ver proceso</button><button className="primary" disabled={!currentWordCount} onClick={() => setShowSeal(true)}>Sellar versión</button></div></div>
    </section>
    <aside className="evidence-panel">
      <div className="live-title"><span><i></i>Registro en directo</span><small>{events.length} eventos</small></div>
      <div className="metric-hero"><span>{sessionPpm !== null ? "Ritmo de esta sesión" : previousPpm !== null ? "Último ritmo registrado" : "Ritmo de esta sesión"}</span><strong>{displayedPpm ?? "—"}<em> ppm</em></strong><div className="bars">{[6,10,8,14,11,16,13,18,15].map((height, i) => <i key={i} style={{height}} />)}</div></div>
      <ul className="evidence-list"><li><span className="metric-icon typed">T</span><p>Escritura directa<strong>{analysis.direct} palabras</strong></p></li><li><span className="metric-icon pasted">□</span><p>Pegado sin modificar<strong>{pasteWords} palabras</strong></p></li><li><span className="metric-icon revised">↺</span><p>Pegado reelaborado<strong>{editedPasteWords} palabras</strong></p></li><li><span className="metric-icon history">◷</span><p>Tiempo total registrado<strong>{duration(timing.totalMs)}</strong></p></li><li><span className="metric-icon typed">⌨</span><p>Escritura activa estimada<strong>{duration(timing.writingMs)}</strong></p></li><li><span className="metric-icon revised">✎</span><p>Edición activa estimada<strong>{duration(timing.revisionMs)}</strong></p></li><li><span className="metric-icon pause">Ⅱ</span><p>Pausas de al menos 5 s<strong>{timing.pauseCount} · {duration(timing.pauseMs)}</strong></p></li><li><span className="metric-icon away">↗</span><p>Fuera del editor<strong>{duration(timing.awayMs)}</strong></p></li></ul>
      <button className="process-card" onClick={() => void openTimeline()}><span>▶</span><p><strong>Abrir la moviola</strong><br />Reconstruye el documento evento a evento.</p></button>
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
  const remove = async (document: VeritasDocument) => { if (!demo) await api<{ deleted: boolean }>(`/documents/${document.id}`, { method: 'DELETE' }); setDocuments(previous => previous.filter(item => item.id !== document.id)); setEventsByDocument(previous => { const next = { ...previous }; delete next[document.id]; return next; }); if (active?.id === document.id) setActive(null); };
  const open = async (document: VeritasDocument) => { if (!demo) { const [detail, timeline] = await Promise.all([api<{ document: VeritasDocument }>(`/documents/${document.id}`), api<{ events: WritingEvent[] }>(`/documents/${document.id}/timeline`)]); document = detail.document; setEventsByDocument(previous => ({ ...previous, [document.id]: timeline.events })); } setActive(document); setView("editor"); };
  const persist = (updated: VeritasDocument) => { setDocuments(previous => previous.map(document => document.id === updated.id ? { ...document, ...updated } : document)); setActive(updated); setEventsByDocument(previous => active ? ({ ...previous, [active.id]: previous[active.id] ?? [] }) : previous); };
  const returnToDocuments = () => { setView("documents"); if (!demo) void api<{ documents: VeritasDocument[] }>('/documents').then(result => setDocuments(result.documents)).catch(() => undefined); };
  const logout = async () => { if (!demo) await api('/auth/logout', { method: 'POST', body: '{}' }); setUser(null); setDocuments([]); setView("documents"); };
  if (booting) return <main className="loading"><Logo /><span></span><p>Abriendo tu archivo…</p></main>;
  if (!user) return <AuthScreen onAuthenticated={next => { setUser(next); void api<{ documents: VeritasDocument[] }>('/documents').then(result => setDocuments(result.documents)).catch(() => setDocuments([])); }} />;
  return <Shell user={user} view={view} setView={setView} demo={demo} onLogout={() => void logout()}>
    {view === "documents" && <DocumentsView documents={documents} onOpen={document => void open(document)} onCreate={title => void create(title)} onDelete={remove} />}
    {view === "editor" && active && <EditorView key={active.id} initial={active} initialEvents={eventsByDocument[active.id] ?? []} demo={demo} onBack={returnToDocuments} onPersist={persist} />}
    {view === "submissions" && <SubmissionsView submissions={submissions} />}
  </Shell>;
}
