import { t, getLocale, useLocale } from "./i18n";
import LanguageSwitcher from "./LanguageSwitcher";
import EntryStory from "./EntryStory";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, SESSION_EXPIRED_EVENT } from "./api";
import type { Certificate, DocumentFolder, DocumentVersion, PageSettings, Submission, User, VeritasDocument, WritingEvent } from "./types";
import type { EditorMutation, VeritasEditorHandle } from "./VeritasEditor";
import DocumentsWorkspace from "./DocumentsWorkspace";
import { DEFAULT_PAGE } from "./pageLayout";
import brandLogo from "../brand/InkGroove-logo-tinta-naranja.svg";
import brandLogoLight from "../brand/InkGroove-logo-tinta-claro.svg";

const VeritasEditor = lazy(() => import("./VeritasEditor"));

declare global { interface Window { __VERITAS_USER__?: User | null } }

type View = "documents" | "editor" | "timeline" | "submissions";
type AuthMode = "login" | "register";
type EditorRecovery = { savedAt: number; html: string; title: string; page?: PageSettings; folderId?: string | null; sessionId: string; startedAt: number; sequence: number; pending: WritingEvent[] };

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
    content_html: "<p>La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible.</p><p><mark data-origin=\"paste\">Una imagen también puede llegar al texto desde una fuente externa.</mark> <mark data-origin=\"paste-edited\">Cuando ese material se revisa, InkGroove conserva su procedencia y registra la reelaboración.</mark></p><p>El valor de la imagen no reside solo en aquello que muestra, sino también en la mirada que la construye.</p>",
    content_text: "La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible. Una imagen también puede llegar al texto desde una fuente externa. Cuando ese material se revisa, InkGroove conserva su procedencia y registra la reelaboración. El valor de la imagen no reside solo en aquello que muestra, sino también en la mirada que la construye.",
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
  { sequence: 5, event_type: "paste_edit", input_type: "insertText", after_html: "<p>La fotografía mantiene una relación ambigua con la realidad. Su apariencia documental no elimina las decisiones de quien encuadra, selecciona y ordena lo visible.</p><p><mark data-origin=\"paste\">Una imagen también puede llegar al texto desde una fuente externa.</mark> <mark data-origin=\"paste-edited\">Cuando ese material se revisa, InkGroove conserva su procedencia y registra la reelaboración.</mark></p>", elapsed_ms: 58_000 },
  { sequence: 6, event_type: "insert", input_type: "insertText", after_html: demoDocuments[0].content_html, elapsed_ms: 79_000 },
];

const words = (text: string) => text.trim() ? (text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu) ?? []).length : 0;
type Provenance = "direct" | "paste" | "paste-edited";
const blockTags = new Set(["DIV", "P", "H1", "H2", "H3", "LI", "BLOCKQUOTE", "UL", "OL", "TD", "TH", "TR"]);
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
const duration = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1_000)); const hours = Math.floor(seconds / 3_600); const minutes = Math.floor(seconds / 60) % 60; const rest = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`; };

function Logo({ inverted = false }: { inverted?: boolean }) {
  return <div className="brand"><img className="brand-logo" src={inverted ? brandLogoLight : brandLogo} alt="InkGroove" width={1835.51} height={500} /></div>;
}

function AuthScreen({ onAuthenticated, notice }: { onAuthenticated: (user: User) => void; notice?: string }) {
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
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : t("No se pudo conectar con InkGroove.")); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <section className="auth-story">
      <header className="auth-story-header"><Logo inverted /><LanguageSwitcher /></header>
      <div>
        <p className="eyebrow">{t("Escritura con memoria")}</p>
        <EntryStory />
      </div>
      <p className="auth-foot">{t("Conserva el proceso de escritura, vuelve sobre tus borradores y comparte las versiones que tú elijas.")}</p>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <p className="eyebrow">{mode === "login" ? t("Acceso") : t("Crear una cuenta")}</p>
        <h2>{mode === "login" ? t("Vuelve a tus documentos") : t("Empieza tu archivo personal")}</h2>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={submit}>
          {mode === "register" && <label>{t("Nombre")}<input name="name" autoComplete="name" required /></label>}
          <label>{t("Correo electrónico")}<input name="email" type="email" autoComplete="email" required /></label>
          <label>{t("Contraseña")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required /></label>
          {mode === "register" && <label>{t("Repite la contraseña")}<input name="password_confirmation" type="password" autoComplete="new-password" minLength={10} required /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary full" disabled={busy}>{busy ? t("Un momento…") : mode === "login" ? t("Entrar") : t("Crear cuenta")}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? t("No tengo cuenta") : t("Ya tengo una cuenta")}
        </button>
      </div>
    </section>
  </main>;
}

function Shell({ user, view, setView, demo, children, onLogout }: { user: User; view: View; setView: (view: View) => void; demo: boolean; children: React.ReactNode; onLogout: () => void }) {
  return <div className="app-shell">
    <header className="topbar">
      <Logo />
      <nav aria-label={t("Principal")}>
        <button className={view === "documents" || view === "editor" || view === "timeline" ? "active" : ""} disabled={view === "editor"} onClick={() => setView("documents")}>{t("Documentos")}</button>
        <button className={view === "submissions" ? "active" : ""} disabled={view === "editor"} onClick={() => setView("submissions")}>{t("Entregas")}</button>
      </nav>
      <div className="account"><LanguageSwitcher /><span className="avatar">{user.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="account-name">{user.name}</span><button className="icon-button" title={view === "editor" ? t("Vuelve primero a tus documentos") : t("Cerrar sesión")} disabled={view === "editor"} onClick={onLogout}>↗</button></div>
    </header>
    {demo && <div className="demo-ribbon">{t("Demostración local · datos temporales de esta sesión")}</div>}
    {children}
  </div>;
}

function EditorView({ initial, initialEvents, demo, folders, onBack, onPersist }: { initial: VeritasDocument; initialEvents: WritingEvent[]; demo: boolean; folders: DocumentFolder[]; onBack: () => void; onPersist: (document: VeritasDocument) => void }) {
  const recovery = useMemo(() => loadRecovery(initial.id, initial.updated_at), [initial.id, initial.updated_at]);
  const initialHtml = recovery?.html ?? (typeof initial.content_html === "string" ? initial.content_html : "");
  const [documentState, setDocumentState] = useState(initial);
  const [events, setEvents] = useState<WritingEvent[]>([...initialEvents, ...(recovery?.pending ?? [])]);
  const [title, setTitle] = useState(recovery?.title ?? initial.title);
  const [html, setHtml] = useState(initialHtml);
  const [page, setPage] = useState<PageSettings>(recovery?.page ?? initial.page_settings ?? DEFAULT_PAGE);
  const [folderId, setFolderId] = useState<string | null>(recovery?.folderId !== undefined ? recovery.folderId : initial.folder_id ?? null);
  const pageRef = useRef(page);
  const folderRef = useRef(folderId);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "expired">(recovery ? "saving" : "saved");
  const [showSeal, setShowSeal] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(initial.versions?.at(-1)?.certificate ?? null);
  const [showSend, setShowSend] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(Math.max(0, initialEvents.length - 1));
  const [firstTypingAt, setFirstTypingAt] = useState<number | null>(null);
  const [metricNow, setMetricNow] = useState(Date.now());
  const editorRef = useRef<VeritasEditorHandle>(null);
  const sessionId = useRef(recovery?.sessionId ?? makeId());
  const started = useRef(recovery?.startedAt ?? Date.now());
  const sequence = useRef(recovery?.sequence ?? 0);
  const pending = useRef<WritingEvent[]>([...(recovery?.pending ?? [])]);
  const syncInFlight = useRef<Promise<boolean> | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const changeRevision = useRef(recovery ? 1 : 0);
  const lastSavedRevision = useRef(0);
  const sessionExpired = useRef(false);
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
    const warnIfPending = (event: BeforeUnloadEvent) => {
      if (changeRevision.current <= lastSavedRevision.current && !pending.current.length) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnIfPending);
    return () => window.removeEventListener("beforeunload", warnIfPending);
  }, []);

  const persistLocalRecovery = (contentHtml = editorRef.current?.getHTML() ?? html, recoveryTitle = title) => {
    try { localStorage.setItem(recoveryKey(documentState.id), JSON.stringify({ savedAt: Date.now(), html: contentHtml, title: recoveryTitle, page: pageRef.current, folderId: folderRef.current, sessionId: sessionId.current, startedAt: started.current, sequence: sequence.current, pending: pending.current } satisfies EditorRecovery)); } catch { /* Storage can be unavailable in hardened browser modes. */ }
  };
  const expireSession = () => { sessionExpired.current = true; persistLocalRecovery(); setSaveState("expired"); };
  const record = (eventType: WritingEvent["event_type"], inputType: string | null, data?: string | null, nextHtml?: string) => {
    const event: WritingEvent = { writing_session_id: sessionId.current, sequence: ++sequence.current, event_type: eventType, input_type: inputType, data: data ?? null, after_html: nextHtml ?? editorRef.current?.getHTML() ?? html, elapsed_ms: Date.now() - started.current, created_at: new Date().toISOString() };
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
    if (editorRef.current && !await editorRef.current.waitForUploads()) return false;
    if (sessionExpired.current) { persistLocalRecovery(); return false; }
    if (saveInFlight.current) {
      const saved = await saveInFlight.current;
      return saved && lastSavedRevision.current < changeRevision.current ? save() : saved;
    }
    const revision = changeRevision.current;
    const contentHtml = editorRef.current?.getHTML() ?? html;
    const snapshotTitle = title;
    const snapshotPage = pageRef.current;
    const snapshotFolder = folderRef.current;
    setHtml(contentHtml); setSaveState("saving");
    const operation = (async () => {
      const updated: VeritasDocument = { ...documentState, title: snapshotTitle, folder_id: snapshotFolder, page_settings: snapshotPage, content_html: contentHtml, content_text: plainText(contentHtml), word_count: words(plainText(contentHtml)), updated_at: new Date().toISOString() };
      try {
        let persisted = updated;
        if (!demo) {
          const result = await api<{ document: VeritasDocument }>(`/documents/${documentState.id}`, { method: "PATCH", body: JSON.stringify({ title: snapshotTitle, folder_id: snapshotFolder, page_settings: snapshotPage, content_html: contentHtml }) });
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
  }, [html, title, page, folderId, saveState]);

  const markChanged = () => { changeRevision.current++; if (sessionExpired.current) { persistLocalRecovery(); setSaveState("expired"); } else setSaveState("saving"); };
  const editorMutation = (mutation: EditorMutation) => {
    setHtml(mutation.html);
    if (mutation.eventType === "insert" && mutation.inputType !== "insertFromPaste" && mutation.data) setFirstTypingAt(previous => previous ?? Date.now());
    markChanged();
    record(mutation.eventType, mutation.inputType, mutation.data ?? null, mutation.html);
  };
  const changePage = (next: PageSettings) => { pageRef.current = next; setPage(next); markChanged(); record("format", "pageSettings", JSON.stringify(next)); };
  const uploadImage = async (file: File) => {
    if (demo) {
      const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(t("No se pudo leer la imagen."))); reader.readAsDataURL(file); });
      const image = new Image(); image.src = src; await image.decode();
      return { src, width: image.naturalWidth, height: image.naturalHeight };
    }
    const form = new FormData(); form.set("image", file);
    const result = await api<{ src: string; image: { width: number; height: number; sha256: string } }>(`/documents/${documentState.id}/images`, { method: "POST", body: form });
    return { src: result.src, ...result.image };
  };
  const openTimeline = async () => {
    const ready = lastSavedRevision.current < changeRevision.current ? await save() : await syncEvents();
    if (!ready) return;
    setTimelineIndex(Math.max(0, events.length - 1)); setTimelineOpen(true);
  };
  const leaveEditor = async () => { if (await save()) onBack(); };
  const seal = async () => {
    if (!await save()) return;
    try {
      let created: Certificate;
      let version: DocumentVersion;
      if (demo) {
        created = { id: makeId(), certificate_code: `VRT-${Math.random().toString(36).slice(2, 12).toUpperCase()}`, issued_at: new Date().toISOString() };
        version = { id: makeId(), version_number: (documentState.versions_count ?? 0) + 1, snapshot_html: editorRef.current?.getHTML() ?? html, snapshot_text: plainText(editorRef.current?.getHTML() ?? html), word_count: currentWordCount, content_hash: "demostracion", sealed_at: created.issued_at, certificate: created };
      } else {
        const result = await api<{ version: DocumentVersion; certificate: Certificate }>(`/documents/${documentState.id}/seal`, { method: "POST", body: "{}" });
        created = result.certificate; version = { ...result.version, certificate: result.certificate };
      }
      if (demo) version.page_settings = pageRef.current;
      setCertificate(created); setShowSeal(false);
      const next = { ...documentState, versions: [...(documentState.versions ?? []), version], versions_count: (documentState.versions_count ?? 0) + 1 }; setDocumentState(next); onPersist(next);
    } catch { setSaveState("error"); }
  };
  if (timelineOpen) return <Timeline events={events} title={title} onClose={() => setTimelineOpen(false)} index={timelineIndex} setIndex={setTimelineIndex} />;
  return <main className="editor-layout">
    <aside className="document-context">
      <button className="back-link" onClick={() => void leaveEditor()}>{t("← Mis documentos")}</button>
      <p className="eyebrow">{t("Documento propio")}</p>
      <h1>{title || t("Sin título")}</h1>
      <dl><div><dt>{t("Estado")}</dt><dd>{t("Borrador privado")}</dd></div><div><dt>{t("Extensión")}</dt><dd>{currentWordCount} {t("palabras")}</dd></div><div><dt>{t("Versiones")}</dt><dd>{documentState.versions_count ?? 0} {t("certificadas")}</dd></div><div><dt>{t("Carpeta")}</dt><dd><select aria-label={t("Carpeta del documento")} value={folderId ?? ""} onChange={event => { const next = event.target.value || null; folderRef.current = next; setFolderId(next); markChanged(); }}><option value="">{t("Sin carpeta")}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></dd></div></dl>
      <div className="privacy-note"><span>⌁</span><p><strong>{t("Solo tú puedes verlo.")}</strong><br />{t("El acceso cambia únicamente al entregar una versión.")}</p></div>
    </aside>
    <section className="writing-surface">
      <div className="editor-header"><div><input className="title-input" value={title} onChange={event => { const nextTitle = event.target.value; setTitle(nextTitle); markChanged(); if (sessionExpired.current) persistLocalRecovery(editorRef.current?.getHTML() ?? html, nextTitle); }} aria-label={t("Título")}/><span>{t("Sesión activa · registro local y servidor")}</span></div>{saveState === "expired" ? <button className="save-state expired" onClick={() => window.location.reload()}>{t("Sesión caducada · volver a entrar")}</button> : <span className={`save-state ${saveState}`}>{saveState === "saved" ? t("Todo guardado") : saveState === "saving" ? t("Guardando…") : t("Error al guardar")}</span>}</div>
      <div className="paper">
        <Suspense fallback={<div className="editor-loading">{t("Preparando el documento…")}</div>}>
          <VeritasEditor ref={editorRef} initialHtml={html} title={title} page={page} onPageChange={changePage} beforeExport={save} onUploadImage={uploadImage} onMutation={editorMutation} onFocus={() => record("focus", null)} onBlur={() => record("blur", null)} />
        </Suspense>
      </div>
      <div className="editor-actions"><span>{currentWordCount} {t("palabras")}</span><div><button className="secondary" onClick={() => void save()}>{t("Guardar ahora")}</button><button className="secondary" onClick={() => void openTimeline()}>{t("Ver proceso")}</button><button className="primary" disabled={!currentWordCount} onClick={() => setShowSeal(true)}>{t("Sellar versión")}</button></div></div>
    </section>
    <aside className="evidence-panel">
      <div className="live-title"><span><i></i>{t("Registro en directo")}</span><small>{events.length} {t("eventos")}</small></div>
      <div className="metric-hero"><span>{sessionPpm !== null ? t("Ritmo de esta sesión") : previousPpm !== null ? t("Último ritmo registrado") : t("Ritmo de esta sesión")}</span><strong>{displayedPpm ?? "—"}<em> {t("ppm")}</em></strong><div className="bars">{[6,10,8,14,11,16,13,18,15].map((height, i) => <i key={i} style={{height}} />)}</div></div>
      <ul className="evidence-list"><li><span className="metric-icon typed">T</span><p>{t("Escritura directa")}<strong>{analysis.direct} {t("palabras")}</strong></p></li><li><span className="metric-icon pasted">□</span><p>{t("Pegado sin modificar")}<strong>{pasteWords} {t("palabras")}</strong></p></li><li><span className="metric-icon revised">↺</span><p>{t("Pegado reelaborado")}<strong>{editedPasteWords} {t("palabras")}</strong></p></li><li><span className="metric-icon history">◷</span><p>{t("Tiempo total registrado")}<strong>{duration(timing.totalMs)}</strong></p></li><li><span className="metric-icon typed">⌨</span><p>{t("Escritura activa estimada")}<strong>{duration(timing.writingMs)}</strong></p></li><li><span className="metric-icon revised">✎</span><p>{t("Edición activa estimada")}<strong>{duration(timing.revisionMs)}</strong></p></li><li><span className="metric-icon pause">Ⅱ</span><p>{t("Pausas de al menos 5 s")}<strong>{timing.pauseCount} · {duration(timing.pauseMs)}</strong></p></li><li><span className="metric-icon away">↗</span><p>{t("Fuera del editor")}<strong>{duration(timing.awayMs)}</strong></p></li></ul>
      <button className="process-card" onClick={() => void openTimeline()}><span>▶</span><p><strong>{t("Abrir la moviola")}</strong><br />{t("Reconstruye el documento evento a evento.")}</p></button>
      {certificate && <div className="certificate-card"><span className="seal">V</span><p><strong>{t("Última versión certificada")}</strong><br /><code>{certificate.certificate_code}</code></p><button onClick={() => setShowSend(true)}>{t("Entregar")}</button></div>}
    </aside>
    {showSeal && <Modal title={t("Sellar esta versión")} onClose={() => setShowSeal(false)}><p>{t("Se creará una copia inmutable del texto y de la cadena de eventos recibida por InkGroove. Podrás seguir trabajando y sellar versiones posteriores.")}</p><div className="seal-summary"><strong>{currentWordCount}</strong><span>{t("palabras")}</span><strong>{events.length}</strong><span>{t("eventos")}</span></div><div className="modal-actions"><button className="secondary" onClick={() => setShowSeal(false)}>{t("Cancelar")}</button><button className="primary" onClick={() => void seal()}>{t("Certificar versión")}</button></div></Modal>}
    {showSend && certificate && <SendModal certificate={certificate} demo={demo} documentState={documentState} onClose={() => setShowSend(false)} />}
  </main>;
}

function Timeline({ events, title, onClose, index, setIndex }: { events: WritingEvent[]; title: string; onClose: () => void; index: number; setIndex: (index: number) => void }) {
  const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(4);
  useEffect(() => { if (!playing || index >= events.length - 1) { if (index >= events.length - 1) setPlaying(false); return; } const timer = window.setTimeout(() => setIndex(index + 1), 800 / speed); return () => window.clearTimeout(timer); }, [playing, speed, index, events.length, setIndex]);
  const event = events[index] ?? events[0];
  const labels: Record<string, string> = { start: t("Inicio"), insert: t("Escritura"), delete: t("Eliminación"), paste: t("Pegado"), paste_edit: t("Reelaboración de pegado"), format: t("Formato"), focus: t("Vuelta al editor"), blur: t("Salida del editor"), save: t("Guardado") };
  return <section className="timeline-view">
    <header><div><button className="back-link" onClick={onClose}>{t("← Volver al documento")}</button><p className="eyebrow">{t("Proceso de escritura")}</p><h1>{title}</h1></div><div className="timeline-stat"><strong>{events.length}</strong><span>{t("eventos registrados")}</span></div></header>
    <div className="timeline-grid">
      <div className="replay-paper"><div className="replay-meta"><span>{t("Evento {index} de {total}", { index: index + 1, total: events.length })}</span><strong>{labels[event?.event_type] ?? event?.event_type}</strong></div><article dangerouslySetInnerHTML={{ __html: event?.after_html || `<p class="empty-replay">${t("La sesión comienza aquí.")}</p>` }} /></div>
      <aside className="event-rail"><h2>{t("Secuencia")}</h2><div className="event-list">{events.map((item, eventIndex) => <button key={`${item.sequence}-${eventIndex}`} className={eventIndex === index ? "active" : ""} onClick={() => { setPlaying(false); setIndex(eventIndex); }}><i className={item.event_type}></i><span><strong>{labels[item.event_type] ?? item.event_type}</strong><small>{duration(item.elapsed_ms)}</small></span></button>)}</div></aside>
    </div>
    <footer className="transport"><button className="play" aria-label={playing ? t("Pausar") : t("Reproducir")} onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button><input type="range" min="0" max={Math.max(0, events.length - 1)} value={Math.min(index, Math.max(0, events.length - 1))} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} aria-label={t("Posición de la reproducción")}/><span>{duration(event?.elapsed_ms ?? 0)}</span><select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label={t("Velocidad")}><option value="1">1×</option><option value="4">4×</option><option value="16">16×</option></select></footer>
  </section>;
}

function SendModal({ certificate, documentState, demo, onClose }: { certificate: Certificate; documentState: VeritasDocument; demo: boolean; onClose: () => void }) {
  const [sent, setSent] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { if (!demo) { const version = documentState.versions?.at(-1); if (!version) throw new Error(t("Falta la versión sellada")); await api('/submissions', { method: 'POST', body: JSON.stringify({ document_version_id: version.id, recipient_email: form.get('email'), note: form.get('note') }) }); } setSent(true); } catch (reason) { setError(reason instanceof Error ? reason.message : t("No se pudo realizar la entrega.")); } };
  return <Modal title={sent ? t("Versión entregada") : t("Entregar versión certificada")} onClose={onClose}>{sent ? <div className="success-message"><span>✓</span><p><strong>{t("La entrega ha quedado registrada.")}</strong><br />{t("El destinatario verá esta versión concreta y su proceso, pero no tus borradores posteriores.")}</p><button className="primary" onClick={onClose}>{t("Cerrar")}</button></div> : <form onSubmit={submit} className="send-form"><p>{t("Se entregará la versión identificada como")} <code>{certificate.certificate_code}</code>.</p><label>{t("Correo del profesor o destinatario")}<input name="email" type="email" required placeholder={t("profesor@centro.es")} /></label><label>{t("Nota opcional")}<textarea name="note" rows={3} placeholder={t("Una indicación breve para acompañar la entrega")} /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t("Cancelar")}</button><button className="primary">{t("Entregar esta versión")}</button></div></form>}</Modal>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label={t("Cerrar")}>×</button><h2 id="modal-title">{title}</h2>{children}</section></div>;
}

function SubmissionsView({ submissions }: { submissions: Submission[] }) {
  return <main className="workspace dashboard"><section className="dashboard-head"><div><p className="eyebrow">{t("Versiones compartidas")}</p><h1>{t("Entregas")}</h1><p>{t("Una entrega contiene una versión inmutable; tus borradores posteriores permanecen privados.")}</p></div></section><section className="empty-state"><span>↗</span><h2>{submissions.length ? t("{count} entregas registradas", { count: submissions.length }) : t("Todavía no has realizado ninguna entrega")}</h2><p>{t("Sella una versión desde el editor y elige a quién deseas enviarla. Las actividades del profesor aparecerán aquí cuando estén habilitadas.")}</p></section></main>;
}

export default function App() {
  useLocale();
  const [booting, setBooting] = useState(true); const [user, setUser] = useState<User | null>(window.__VERITAS_USER__ ?? null); const [demo, setDemo] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [view, setView] = useState<View>("documents"); const [documents, setDocuments] = useState<VeritasDocument[]>([]); const [active, setActive] = useState<VeritasDocument | null>(null); const [submissions] = useState<Submission[]>([]); const [eventsByDocument, setEventsByDocument] = useState<Record<string, WritingEvent[]>>({ [demoDocuments[0].id]: demoEvents });
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const loadArchive = async () => { const [texts, groups] = await Promise.all([api<{ documents: VeritasDocument[] }>("/documents"), api<{ folders: DocumentFolder[] }>("/folders")]); setDocuments(texts.documents); setFolders(groups.folders); };
  useEffect(() => {
    const expire = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? t("Tu sesión ha caducado. Vuelve a identificarte para continuar.");
      setAuthNotice(message); setUser(null); setDocuments([]); setFolders([]); setActive(null); setView("documents");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, []);
  useEffect(() => { void (async () => { try { const identity = await api<{ user: User }>('/me'); setUser(identity.user); setAuthNotice(""); await loadArchive(); } catch (reason) { if (reason instanceof ApiError && (reason.status === 401 || reason.status === 419)) { setUser(null); setDocuments([]); } else if (import.meta.env.DEV) { setDemo(true); setUser({ id: 1, name: "Alejandro", email: "alejandro@veritas.local" }); setDocuments(demoDocuments); } } finally { setBooting(false); } })(); }, []);
  const create = async (title: string, folderId: string | null = null) => { let created: VeritasDocument; if (demo) created = { id: makeId(), owner_id: user!.id, folder_id: folderId, title, content_html: "", content_text: "", word_count: 0, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), versions_count: 0, sessions_count: 0, versions: [] }; else { const result = await api<{ document: VeritasDocument }>('/documents', { method: 'POST', body: JSON.stringify({ title, folder_id: folderId }) }); created = result.document; } setDocuments(previous => [created, ...previous]); setActive(created); setView("editor"); };
  const remove = async (document: VeritasDocument) => { if (!demo) await api<{ deleted: boolean }>(`/documents/${document.id}`, { method: 'DELETE' }); setDocuments(previous => previous.filter(item => item.id !== document.id)); setEventsByDocument(previous => { const next = { ...previous }; delete next[document.id]; return next; }); if (active?.id === document.id) setActive(null); };
  const open = async (document: VeritasDocument) => { if (!demo) { const [detail, timeline] = await Promise.all([api<{ document: VeritasDocument }>(`/documents/${document.id}`), api<{ events: WritingEvent[] }>(`/documents/${document.id}/timeline`)]); document = detail.document; setEventsByDocument(previous => ({ ...previous, [document.id]: timeline.events })); } setActive(document); setView("editor"); };
  const persist = (updated: VeritasDocument) => { setDocuments(previous => previous.map(document => document.id === updated.id ? { ...document, ...updated } : document)); setActive(updated); setEventsByDocument(previous => active ? ({ ...previous, [active.id]: previous[active.id] ?? [] }) : previous); };
  const move = async (document: VeritasDocument, folderId: string | null) => { if (demo) persist({ ...document, folder_id: folderId }); else { const result = await api<{ document: VeritasDocument }>(`/documents/${document.id}`, { method: "PATCH", body: JSON.stringify({ folder_id: folderId }) }); persist({ ...document, ...result.document }); } };
  const saveFolder = async (name: string, id?: string): Promise<DocumentFolder> => { const folder = demo ? { id: id ?? makeId(), name } : (await api<{ folder: DocumentFolder }>(id ? `/folders/${id}` : "/folders", { method: id ? "PATCH" : "POST", body: JSON.stringify({ name }) })).folder; setFolders(previous => [...previous.filter(item => item.id !== folder.id), folder].sort((a, b) => a.name.localeCompare(b.name, getLocale()))); return folder; };
  const removeFolder = async (folder: DocumentFolder) => { if (!demo) await api(`/folders/${folder.id}`, { method: "DELETE" }); setFolders(previous => previous.filter(item => item.id !== folder.id)); setDocuments(previous => previous.map(document => document.folder_id === folder.id ? { ...document, folder_id: null } : document)); };
  const returnToDocuments = () => { setView("documents"); if (!demo) void loadArchive().catch(() => undefined); };
  const logout = async () => { if (!demo) await api('/auth/logout', { method: 'POST', body: '{}' }); setUser(null); setDocuments([]); setFolders([]); setView("documents"); };
  if (booting) return <main className="loading"><Logo /><span></span><p>{t("Abriendo tu archivo…")}</p></main>;
  if (!user) return <AuthScreen notice={authNotice} onAuthenticated={next => { setAuthNotice(""); setUser(next); void loadArchive().catch(() => setDocuments([])); }} />;
  return <Shell user={user} view={view} setView={setView} demo={demo} onLogout={() => void logout()}>
    {view === "documents" && <DocumentsWorkspace documents={documents} folders={folders} onOpen={open} onCreate={create} onDelete={remove} onMove={move} onFolderSave={saveFolder} onFolderDelete={removeFolder} />}
    {view === "editor" && active && <EditorView key={active.id} initial={active} initialEvents={eventsByDocument[active.id] ?? []} demo={demo} folders={folders} onBack={returnToDocuments} onPersist={persist} />}
    {view === "submissions" && <SubmissionsView submissions={submissions} />}
  </Shell>;
}
