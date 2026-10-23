import AuthScreen from "./AuthScreen";
import Modal from './Modal';
import MobileEvidence, { EvidenceAccess, type EvidenceTab } from './MobileEvidence';
import { nominalRoute } from './nominalTransport';
import VersionShareApp from './VersionShareApp';
import { t, getLocale, useLocale } from "./i18n";
import LanguageSwitcher from "./LanguageSwitcher";
import { FormEvent, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, SESSION_EXPIRED_EVENT, authenticatedIdentity, resetIdentity, identityGeneration } from "./api";
import type { Certificate, DocumentFolder, DocumentVersion, PageSettings, Submission, User, VeritasDocument, WritingEvent } from "./types";
import type { EditorMutation, VeritasEditorHandle } from "./VeritasEditor";
import DocumentsWorkspace from "./DocumentsWorkspace";
import SubmissionsView from "./SubmissionsView";
import { DEFAULT_PAGE } from "./pageLayout";
import brandLogo from "../brand/InkGroove-logo-tinta-naranja.svg";
import brandLogoLight from "../brand/InkGroove-logo-tinta-claro.svg";

import { analyzeHtml, lastRecordedPpm, timingAnalysis } from "./writingMetrics";
import { mergeHistory, historyWindow, eventKey, type HistoryPage } from "./history";
import { useTimelineSnapshots } from "./useTimelineSnapshots";

const VeritasEditor = lazy(() => import("./VeritasEditor"));

declare global { interface Window { __VERITAS_USER__?: User | null } }

type View = "documents" | "editor" | "timeline" | "submissions";
import { recoveryKey, clearRecovery, listRecoveries, type EditorRecovery } from "./recovery";

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
const plainText = (html: string) => analyzeHtml(html).text;
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

function EditorView(props: { initial: VeritasDocument; initialEvents: WritingEvent[]; demo: boolean; folders: DocumentFolder[]; onBack: () => void; onPersist: (document: VeritasDocument) => void }) {
  const [copies] = useState(() => props.demo ? [] : listRecoveries(props.initial.id, props.initial.owner_id));
  const [choice, setChoice] = useState<EditorRecovery | null | undefined>(copies.length ? undefined : null);
  if (choice === undefined) return <div className="workspace"><h2>{t("Copias locales pendientes")}</h2><p>{t("Elige una copia para revisarla. No se sobrescribirá una revisión remota más reciente.")}</p>{copies.map(copy => <button key={copy.storageKey} onClick={() => setChoice(copy)}>{copy.title} · {plainText(copy.html).slice(0, 100)} · {new Date(copy.savedAt).toLocaleString()} · {copy.pending.length} {t("eventos")}</button>)}<button onClick={() => setChoice(null)}>{t("Consultar estado del servidor")}</button></div>;
  return <EditorWorkspace {...props} recovery={choice} />;
}

function EditorWorkspace({ initial, recovery, initialEvents, demo, folders, onBack, onPersist }: { recovery: EditorRecovery | null; initial: VeritasDocument; initialEvents: WritingEvent[]; demo: boolean; folders: DocumentFolder[]; onBack: () => void; onPersist: (document: VeritasDocument) => void }) {
  const initialHtml = recovery?.html ?? (typeof initial.content_html === "string" ? initial.content_html : "");
  const [documentState, setDocumentState] = useState(initial);
  const [events, setEvents] = useState<WritingEvent[]>([...initialEvents, ...(recovery?.pending ?? [])]);
  const [history, setHistory] = useState<WritingEvent[]>(initialEvents);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">(demo ? "ready" : "loading");
  const [historyTotal, setHistoryTotal] = useState(initialEvents.length);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    setHistoryState("loading");
    void (async () => {
      let cursor: string | null = null; let watermark: number | undefined; let loaded: WritingEvent[] = [];
      try {
        do {
          const query = new URLSearchParams({ metadata: "1", limit: "1000" });
          if (watermark !== undefined) query.set("before_id", String(watermark));
          if (cursor) query.set("cursor", cursor);
          const page = await api<HistoryPage>(`/documents/${initial.id}/timeline?${query}`);
          if (cancelled) return;
          watermark = page.before_id; cursor = page.next_cursor;
          loaded = mergeHistory(loaded, page.events);
          setHistory(loaded); setHistoryTotal(page.total ?? loaded.length);
          // Yield between requests so typing and painting are never blocked by a full history.
          await new Promise(resolve => window.setTimeout(resolve, 0));
        } while (cursor);
        if (!cancelled) setHistoryState("ready");
      } catch { if (!cancelled) setHistoryState("error"); }
    })();
    return () => { cancelled = true; };
  }, [initial.id, demo, historyAttempt]);
  const allEvents = useMemo(() => mergeHistory(history, events), [history, events]);
  const [title, setTitle] = useState(recovery?.title ?? initial.title);
  const titleRef = useRef(title); titleRef.current = title;
  const [html, setHtml] = useState(initialHtml);
  const [page, setPage] = useState<PageSettings>(recovery?.page ?? initial.page_settings ?? DEFAULT_PAGE);
  const [folderId, setFolderId] = useState<string | null>(recovery?.folderId !== undefined ? recovery.folderId : initial.folder_id ?? null);
  const pageRef = useRef(page);
  const folderRef = useRef(folderId);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "expired" | "conflict">(recovery ? "error" : "saved");
  const [showSeal, setShowSeal] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(initial.versions?.at(-1)?.certificate ?? null);
  const [emission, setEmission] = useState<DocumentVersion | null>(null);
  const [selectedSealed, setSelectedSealed] = useState('');
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(Math.max(0, initialEvents.length - 1));
  const [firstTypingAt, setFirstTypingAt] = useState<number | null>(null);
  const [metricNow, setMetricNow] = useState(Date.now());
  const editorRef = useRef<VeritasEditorHandle>(null);
  const recoverySlot = useRef(makeId());
  const remoteRevision = useRef(recovery ? recovery.baseRevision ?? -1 : initial.revision ?? 0);
  const conflicted = useRef(!!recovery && remoteRevision.current !== (initial.revision ?? 0));
  const retryBlocked = useRef(false);
  const [localStored, setLocalStored] = useState(false);
  const [remotePreview, setRemotePreview] = useState<VeritasDocument | null>(null);
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
  const previousPpm = useMemo(() => historyState === "ready" ? lastRecordedPpm(history) : null, [history, historyState]);
  const displayedPpm = sessionPpm ?? previousPpm;
  const timing = useMemo(() => timingAnalysis(allEvents), [allEvents]);

  useEffect(() => {
    record(recovery ? "focus" : "start", null, null, initialHtml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!sessionExpired.current && !retryBlocked.current && !conflicted.current && pending.current.length) void syncEvents(); }, 1200);
    return () => { window.clearInterval(timer); };
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

  const persistLocalRecovery = (contentHtml = editorRef.current?.getHTML() ?? html, recoveryTitle = titleRef.current) => {
    if (demo) return true;
    try { localStorage.setItem(recoveryKey(documentState.id, initial.owner_id, recoverySlot.current), JSON.stringify({ format: 2, ownerId: initial.owner_id, documentId: initial.id, savedAt: Date.now(), html: contentHtml, title: recoveryTitle, page: pageRef.current, folderId: folderRef.current, sessionId: sessionId.current, startedAt: started.current, sequence: sequence.current, pending: pending.current, baseRevision: remoteRevision.current } satisfies EditorRecovery)); setLocalStored(true); return true; } catch { setLocalStored(false); return false; }
  };
  useEffect(() => { if (changeRevision.current > lastSavedRevision.current) persistLocalRecovery(); }, [title, page, folderId]);
  const recoveryWriter = useRef<() => void>(() => undefined);
  recoveryWriter.current = () => { if (changeRevision.current > lastSavedRevision.current || pending.current.length) persistLocalRecovery(); };
  useEffect(() => {
    sessionExpired.current = false;
    const retain = () => { sessionExpired.current = true; recoveryWriter.current(); };
    window.addEventListener(SESSION_EXPIRED_EVENT, retain);
    return () => { retain(); window.removeEventListener(SESSION_EXPIRED_EVENT, retain); };
  }, []);
  const expireSession = () => { sessionExpired.current = true; persistLocalRecovery(); setSaveState("expired"); };
  const record = (eventType: WritingEvent["event_type"], inputType: string | null, data?: string | null, nextHtml?: string) => {
    const event: WritingEvent = { writing_session_id: sessionId.current, sequence: ++sequence.current, event_type: eventType, input_type: inputType, data: data ?? null, after_html: nextHtml ?? editorRef.current?.getHTML() ?? html, elapsed_ms: Date.now() - started.current, created_at: new Date().toISOString() };
    pending.current.push(event); setEvents(previous => [...previous, event]);
    persistLocalRecovery(editorRef.current?.getHTML() ?? event.after_html);
  };
  const syncEvents = async (): Promise<boolean> => {
    if (conflicted.current || sessionExpired.current || (!demo && authenticatedIdentity() !== initial.owner_id)) return false;
    if (demo) { pending.current = []; return true; }
    if (syncInFlight.current) {
      const synced = await syncInFlight.current;
      return synced && pending.current.length ? syncEvents() : synced;
    }
    const batch = pending.current.slice(0, 250); if (!batch.length) return true;
    const operation = (async () => {
      try {
        await api(`/documents/${documentState.id}/events`, { method: "POST", body: JSON.stringify({ session_id: sessionId.current, started_at: new Date(started.current).toISOString(), events: batch }) });
        pending.current.splice(0, batch.length); if (changeRevision.current > lastSavedRevision.current || pending.current.length) persistLocalRecovery(); else { clearRecovery(documentState.id, initial.owner_id, recoverySlot.current); setLocalStored(false); } return true;
      } catch (reason) { if (reason instanceof ApiError && (reason.status === 419 || reason.status === 401)) expireSession(); else { retryBlocked.current = true; if (reason instanceof ApiError && reason.status === 409) { conflicted.current = true; setSaveState("conflict"); } else setSaveState("error"); persistLocalRecovery(); } return false; }
    })();
    syncInFlight.current = operation;
    const synced = await operation;
    if (syncInFlight.current === operation) syncInFlight.current = null;
    return synced && pending.current.length ? syncEvents() : synced;
  };
  const save = async (): Promise<boolean> => {
    if (conflicted.current) { persistLocalRecovery(); setSaveState("conflict"); return false; }
    retryBlocked.current = false;
    if (!demo && authenticatedIdentity() !== initial.owner_id) return false;
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
    persistLocalRecovery(contentHtml, snapshotTitle);
    setHtml(contentHtml); setSaveState("saving");
    const operation = (async () => {
      const updated: VeritasDocument = { ...documentState, title: snapshotTitle, folder_id: snapshotFolder, page_settings: snapshotPage, content_html: contentHtml, content_text: plainText(contentHtml), word_count: words(plainText(contentHtml)), updated_at: new Date().toISOString() };
      try {
        let persisted = updated;
        if (!demo) {
          const result = await api<{ document: VeritasDocument }>(`/documents/${documentState.id}`, { method: "PATCH", body: JSON.stringify({ revision: remoteRevision.current, title: snapshotTitle, folder_id: snapshotFolder, page_settings: snapshotPage, content_html: contentHtml }) });
          persisted = { ...updated, ...result.document };
        }
        remoteRevision.current = persisted.revision ?? remoteRevision.current;
        setDocumentState(persisted); record("save", null, JSON.stringify({ document_revision: remoteRevision.current }), contentHtml);
        if (!await syncEvents()) return false;
        lastSavedRevision.current = Math.max(lastSavedRevision.current, revision);
        if (revision === changeRevision.current) { clearRecovery(documentState.id, initial.owner_id, recoverySlot.current); setLocalStored(false); if (recovery?.storageKey) { try { localStorage.removeItem(recovery.storageKey); } catch { /* Retain if unavailable. */ } } }
        onPersist(persisted); setSaveState(revision === changeRevision.current ? "saved" : "saving"); return true;
      } catch (reason) { if (reason instanceof ApiError && (reason.status === 419 || reason.status === 401)) { persistLocalRecovery(contentHtml, snapshotTitle); expireSession(); } else { retryBlocked.current = true; if (reason instanceof ApiError && reason.status === 409) { conflicted.current = true; setSaveState("conflict"); } else setSaveState("error"); persistLocalRecovery(); } return false; }
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

  const markChanged = () => { changeRevision.current++; if (sessionExpired.current) { persistLocalRecovery(); setSaveState("expired"); } else if (conflicted.current) { persistLocalRecovery(); setSaveState("conflict"); } else setSaveState("saving"); };
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
    setEvidenceTab(null); setTimelineIndex(Math.max(0, allEvents.length - 1)); setTimelineOpen(true);
  };
  const leaveEditor = async () => { if (await save()) onBack(); };
  const [shareOffer, setShareOffer] = useState<DocumentVersion | null>(null);
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
      setCertificate(created); setSelectedSealed(version.id); setShowSeal(false); if (!demo) setShareOffer(version);
      const next = { ...documentState, versions: [...(documentState.versions ?? []), version], versions_count: (documentState.versions_count ?? 0) + 1 }; setDocumentState(next); onPersist(next);
    } catch { setSaveState("error"); }
  };
  return <>
    {timelineOpen && <Timeline events={allEvents} documentId={demo ? undefined : initial.id} loading={historyState === "loading"} historyError={historyState === "error"} onRetryHistory={() => setHistoryAttempt(value => value + 1)} title={title} onClose={() => setTimelineOpen(false)} index={timelineIndex} setIndex={setTimelineIndex} />}
    <main className="editor-layout" style={timelineOpen ? { display: "none" } : undefined}>
    <aside className="document-context">
      <button className="back-link" onClick={() => void leaveEditor()}>{t("← Mis documentos")}</button>
      <p className="eyebrow">{t("Documento propio")}</p>
      <h1>{title || t("Sin título")}</h1>
      <dl><div><dt>{t("Estado")}</dt><dd>{t("Borrador privado")}</dd></div><div><dt>{t("Extensión")}</dt><dd>{currentWordCount} {t("palabras")}</dd></div><div><dt>{t("Versiones")}</dt><dd>{documentState.versions_count ?? 0} {t("certificadas")}</dd></div><div><dt>{t("Carpeta")}</dt><dd><select aria-label={t("Carpeta del documento")} value={folderId ?? ""} onChange={event => { const next = event.target.value || null; folderRef.current = next; setFolderId(next); markChanged(); }}><option value="">{t("Sin carpeta")}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></dd></div></dl>
      <div className="privacy-note"><span>⌁</span><p><strong>{t("Solo tú puedes verlo.")}</strong><br />{t("El acceso cambia únicamente al entregar una versión.")}</p></div>
    </aside>
    <section className="writing-surface">
      <div className="editor-header"><div><input className="title-input" value={title} onChange={event => { const nextTitle = event.target.value; setTitle(nextTitle); markChanged(); if (sessionExpired.current) persistLocalRecovery(editorRef.current?.getHTML() ?? html, nextTitle); }} aria-label={t("Título")}/><span>{t("Sesión activa · registro local y servidor")}</span></div>{saveState === "expired" ? <button className="save-state expired" onClick={() => window.location.reload()}>{t("Sesión caducada · volver a entrar")}</button> : <span className={`save-state ${saveState}`}>{saveState === "saved" ? t("Todo guardado") : saveState === "saving" ? t("Guardando…") : saveState === "conflict" ? (localStored ? t("Conflicto · copia local conservada") : t("Conflicto · sin copia local confirmada")) : (localStored ? t("Error al guardar · copia local conservada") : t("Error al guardar · sin copia local confirmada"))}</span>}</div>
      <EvidenceAccess tab={evidenceTab} open={setEvidenceTab} />
      <div className="paper">
        <Suspense fallback={<div className="editor-loading">{t("Preparando el documento…")}</div>}>
          <VeritasEditor key={`${initial.owner_id}:${initial.id}`} defaultContentFontId={initial.default_content_font_id ?? null} ref={editorRef} initialHtml={html} title={title} page={page} onPageChange={changePage} beforeExport={save} onUploadImage={uploadImage} onMutation={editorMutation} onFocus={() => record("focus", null)} onBlur={() => record("blur", null)} />
        </Suspense>
      </div>
      <p>{localStored ? t("Copia local disponible en este navegador") : t("Sin copia local confirmada")}</p>
      {(saveState === "conflict" || saveState === "error" || conflicted.current) && <div role="alert"><p>{t("Tu borrador permanece aquí. No se mezclará ni sobrescribirá el servidor automáticamente.")}</p><button onClick={() => { persistLocalRecovery(); const blob = new Blob([JSON.stringify({ format: 2, ownerId: initial.owner_id, documentId: initial.id, savedAt: Date.now(), html: editorRef.current?.getHTML() ?? html, title, page: pageRef.current, folderId: folderRef.current, sessionId: sessionId.current, startedAt: started.current, sequence: sequence.current, pending: pending.current, baseRevision: remoteRevision.current }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "inkgroove-draft.json"; a.click(); URL.revokeObjectURL(url); }}>{t("Conservar borrador en un archivo")}</button><button onClick={() => { if (persistLocalRecovery()) onBack(); }}>{t("Volver a mis documentos conservando la copia local")}</button><button onClick={() => { void api<{ document: VeritasDocument }>(`/documents/${initial.id}`).then(result => setRemotePreview(result.document)).catch(() => setSaveState("error")); }}>{t("Consultar estado del servidor")}</button>{remotePreview && <div><p>{t("Revisión del servidor")}: {remotePreview.revision} · {remotePreview.title}</p><pre>{remotePreview.content_text}</pre></div>}</div>}
      <div className="editor-actions"><span>{currentWordCount} {t("palabras")}</span><div><button className="secondary" onClick={() => void save()}>{t("Guardar ahora")}</button><button className="secondary" onClick={() => void openTimeline()}>{t("Ver proceso")}</button><button className="primary" disabled={!currentWordCount} onClick={() => setShowSeal(true)}>{t("Sellar versión")}</button></div></div>
    </section>
    <MobileEvidence tab={evidenceTab} setTab={setEvidenceTab} activity={<>
      <div className="live-title"><span><i></i>{t("Registro en directo")}</span><small>{historyState === "ready" ? allEvents.length : `${history.length}/${historyTotal}`} {t("eventos")}</small></div>
      {historyState === "loading" && <p role="status">{t("Cargando historial…")}</p>}
      {historyState === "error" && <p role="alert">{t("No se pudo cargar el historial.")} <button onClick={() => setHistoryAttempt(value => value + 1)}>{t("Reintentar")}</button></p>}
      <div className="metric-hero"><span>{sessionPpm !== null ? t("Ritmo de esta sesión") : previousPpm !== null ? t("Último ritmo registrado") : t("Ritmo de esta sesión")}</span><strong>{displayedPpm ?? (historyState !== "ready" ? t("Cargando…") : "—")}<em> {t("ppm")}</em></strong><div className="bars">{[6,10,8,14,11,16,13,18,15].map((height, i) => <i key={i} style={{height}} />)}</div></div>
      <ul className="evidence-list"><li><span className="metric-icon typed">T</span><p>{t("Escritura directa")}<strong>{analysis.direct} {t("palabras")}</strong></p></li><li><span className="metric-icon pasted">□</span><p>{t("Pegado sin modificar")}<strong>{pasteWords} {t("palabras")}</strong></p></li><li><span className="metric-icon revised">↺</span><p>{t("Pegado reelaborado")}<strong>{editedPasteWords} {t("palabras")}</strong></p></li><li><span className="metric-icon history">◷</span><p>{t("Tiempo total registrado")}<strong>{historyState === "ready" ? duration(timing.totalMs) : t("Cargando…")}</strong></p></li><li><span className="metric-icon typed">⌨</span><p>{t("Escritura activa estimada")}<strong>{historyState === "ready" ? duration(timing.writingMs) : t("Cargando…")}</strong></p></li><li><span className="metric-icon revised">✎</span><p>{t("Edición activa estimada")}<strong>{historyState === "ready" ? duration(timing.revisionMs) : t("Cargando…")}</strong></p></li><li><span className="metric-icon pause">Ⅱ</span><p>{t("Pausas de al menos 5 s")}<strong>{historyState === "ready" ? `${timing.pauseCount} · ${duration(timing.pauseMs)}` : t("Cargando…")}</strong></p></li><li><span className="metric-icon away">↗</span><p>{t("Fuera del editor")}<strong>{historyState === "ready" ? duration(timing.awayMs) : t("Cargando…")}</strong></p></li></ul>
      <button className="process-card" onClick={() => void openTimeline()}><span>▶</span><p><strong>{t("Abrir la moviola")}</strong><br />{t("Reconstruye el documento evento a evento.")}</p></button>
    </>} versions={<>
      {!certificate && <p className="evidence-empty">{t("Todavía no hay versiones selladas.")}</p>}
      {certificate && <div className="certificate-card"><span className="seal">V</span><p className="certificate-heading"><strong>{t('Versiones selladas')}</strong></p>
        {!demo && <><p className="certificate-identity"><code tabIndex={0} title={(documentState.versions?.find(v => v.id === selectedSealed)?.certificate ?? certificate).certificate_code}>{(documentState.versions?.find(v => v.id === selectedSealed)?.certificate ?? certificate).certificate_code}</code></p><label>{t('Versión')}<select value={selectedSealed || documentState.versions?.at(-1)?.id || ''} onChange={e => setSelectedSealed(e.target.value)}>{(documentState.versions ?? []).filter(v => v.certificate).map(v => <option key={v.id} value={v.id}>{t('Versión')} {v.version_number} · {v.certificate?.certificate_code}</option>)}</select></label>
        <button onClick={async () => { const v = documentState.versions?.find(v => v.id === selectedSealed) ?? documentState.versions?.at(-1); if (v && await save()) { setEvidenceTab(null); setEmission(v); } }}>{t('Emitir / compartir')}</button><p className="certificate-description">{t('Versión sellada exacta')}</p><a className="certificate-sent" href="/deliveries/sent" onClick={async e => { e.preventDefault(); if (await save()) location.assign('/deliveries/sent'); }}>{t('Enviadas')}</a></>}
      </div>}
    </>} />
    {shareOffer && <SealedShareOffer documentId={documentState.id} version={shareOffer} onDismiss={() => setShareOffer(null)} onShare={() => { setEmission(shareOffer); setShareOffer(null); }} />}
    {showSeal && <Modal title={t("Sellar esta versión")} onClose={() => setShowSeal(false)}><p>{t("Se creará una copia inmutable del texto y de la cadena de eventos recibida por InkGroove. Podrás seguir trabajando y sellar versiones posteriores.")}</p><div className="seal-summary"><strong>{currentWordCount}</strong><span>{t("palabras")}</span><strong>{historyState === "ready" ? allEvents.length : t("Cargando…")}</strong><span>{t("eventos")}</span></div><div className="modal-actions"><button className="secondary" onClick={() => setShowSeal(false)}>{t("Cancelar")}</button><button className="primary" onClick={() => void seal()}>{t("Certificar versión")}</button></div></Modal>}
    {emission && <Modal title={t('Emitir / compartir')} onClose={() => setEmission(null)}><VersionShareApp key={emission.id} documentId={documentState.id} versionId={emission.id} versionLabel={`${emission.version_number} · ${emission.certificate?.certificate_code ?? ''}`} initialSecret="" wizard /></Modal>}
  </main></>;
}

export function Timeline({ events, documentId, loading, historyError, onRetryHistory, title, onClose, index, setIndex }: { documentId?: string; loading: boolean; historyError: boolean; onRetryHistory: () => void; events: WritingEvent[]; title: string; onClose: () => void; index: number; setIndex: (index: number) => void }) {
  const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(4);
  const previousEvents = useRef(events);
  useLayoutEffect(() => {
    const selected = previousEvents.current[index];
    if (selected) {
      const nextIndex = events.findIndex(item => eventKey(item) === eventKey(selected));
      if (nextIndex >= 0 && nextIndex !== index) setIndex(nextIndex);
    }
    previousEvents.current = events;
  }, [events, index, setIndex]);
  const event = events[index] ?? events[0];
  const { snapshot, snapshotError, retrySnapshot } = useTimelineSnapshots(documentId, events, index);
  const lastFrame = useRef<{ documentId?: string; event: WritingEvent; html: string } | null>(null);
  useLayoutEffect(() => {
    if (event && snapshot !== undefined) lastFrame.current = { documentId, event, html: snapshot };
  }, [documentId, event, snapshot]);
  const frame = event && snapshot !== undefined ? { event, html: snapshot } : lastFrame.current?.documentId === documentId ? lastFrame.current : null;
  const frameIndex = frame ? events.findIndex(item => eventKey(item) === eventKey(frame.event)) : index;
  const pending = snapshot === undefined && events.length > 0;
  useEffect(() => { if (snapshotError) setPlaying(false); }, [snapshotError]);
  const window = historyWindow(index, events.length);
  useEffect(() => { if (snapshot === undefined || !playing || index >= events.length - 1) { if (index >= events.length - 1) setPlaying(false); return; } const timer = globalThis.setTimeout(() => setIndex(index + 1), 800 / speed); return () => globalThis.clearTimeout(timer); }, [playing, speed, index, events.length, setIndex, snapshot]);
  const labels: Record<string, string> = { start: t("Inicio"), insert: t("Escritura"), delete: t("Eliminación"), paste: t("Pegado"), paste_edit: t("Reelaboración de pegado"), format: t("Formato"), focus: t("Vuelta al editor"), blur: t("Salida del editor"), save: t("Guardado") };
  return <section className="timeline-view">
    <header><div><button className="back-link" onClick={onClose}>{t("← Volver al documento")}</button><p className="eyebrow">{t("Proceso de escritura")}</p><h1>{title}</h1></div><div className="timeline-stat"><strong>{events.length}</strong><span>{t("eventos registrados")}</span></div></header>
    <p>{t("El proceso incluye borradores recibidos, que pueden diferir del texto guardado o sellado.")}</p>
    <div className="timeline-grid">
      <div className="replay-paper"><div className="replay-meta"><span>{t("Evento {index} de {total}", { index: events.length ? frameIndex + 1 : 0, total: events.length })}{pending && frame && <small className="replay-status" role="status">{t(snapshotError ? "Evento {index} pendiente" : "Cargando evento {index}…", { index: index + 1 })}</small>}</span><strong>{labels[(frame?.event ?? event)?.event_type] ?? (frame?.event ?? event)?.event_type}</strong></div><article aria-busy={pending} data-event-key={frame ? eventKey(frame.event) : undefined} dangerouslySetInnerHTML={{ __html: frame ? frame.html || `<p class="empty-replay">${t("La sesión comienza aquí.")}</p>` : pending ? `<p>${t(snapshotError ? "No se pudo cargar la instantánea." : "Cargando instantánea…")}</p>` : `<p class="empty-replay">${t("La sesión comienza aquí.")}</p>` }} /></div>
      <aside className="event-rail">{historyError && <p role="alert">{t("No se pudo cargar el historial.")} <button onClick={onRetryHistory}>{t("Reintentar")}</button></p>}{loading && <p role="status">{t("Cargando historial…")}</p>}{snapshotError && <p role="alert">{t("No se pudo cargar la instantánea.")} <button onClick={retrySnapshot}>{t("Reintentar")}</button></p>}<h2>{t("Secuencia")}</h2><div className="event-list">{events.slice(window.start, window.end).map((item, offset) => { const eventIndex = window.start + offset; return <button key={`${item.sequence}-${eventIndex}`} className={eventIndex === index ? "active" : ""} onClick={() => { setPlaying(false); setIndex(eventIndex); }}><i className={item.event_type}></i><span><strong>{labels[item.event_type] ?? item.event_type}</strong><small>{duration(item.elapsed_ms)}</small></span></button>; })}</div></aside>
    </div>
    <footer className="transport"><button className="play" disabled={snapshotError || !events.length} aria-label={playing ? t("Pausar") : t("Reproducir")} onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button><input type="range" min="0" max={Math.max(0, events.length - 1)} value={Math.min(index, Math.max(0, events.length - 1))} onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} aria-label={t("Posición de la reproducción")}/><span>{duration((frame?.event ?? event)?.elapsed_ms ?? 0)}</span><select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label={t("Velocidad")}><option value="1">1×</option><option value="4">4×</option><option value="16">16×</option></select></footer>
  </section>;
}

export function SendModal({ certificate, documentState, demo, onClose }: { certificate: Certificate; documentState: VeritasDocument; demo: boolean; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const form = new FormData(event.currentTarget);
    setError(""); setSending(true);
    try {
      if (demo) throw new Error(t("Las entregas requieren una cuenta y no están disponibles en la demostración."));
      const version = documentState.versions?.find(item => item.certificate?.id === certificate.id);
      if (!version) throw new Error(t("Falta la versión sellada"));
      const result = await api<{ submission: Submission }>('/submissions', { method: 'POST', body: JSON.stringify({ document_version_id: version.id, recipient_email: form.get('email'), note: form.get('note') }) });
      if (!result.submission?.id || !result.submission.recipient_user_id || result.submission.document_version_id !== version.id) throw new Error(t("No se pudo confirmar la entrega."));
      setSent(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("No se pudo realizar la entrega.")); }
    finally { setSending(false); }
  };
  return <Modal title={sent ? t("Versión entregada") : t("Entregar versión certificada")} onClose={onClose}>{sent ? <div className="success-message"><span>✓</span><p><strong>{t("La entrega ha quedado registrada.")}</strong><br />{t("El destinatario podrá consultar la instantánea sellada de esta versión. Tus borradores posteriores permanecen privados.")}</p><button className="primary" onClick={onClose}>{t("Cerrar")}</button></div> : <form onSubmit={submit} className="send-form"><p>{t("Se entregará la versión identificada como")} <code>{certificate.certificate_code}</code>.</p><p>{t("El destinatario debe tener una cuenta en InkGroove. Introduce el correo de esa cuenta. No se envían avisos por correo.")}</p><label>{t("Correo del profesor o destinatario")}<input name="email" type="email" required disabled={sending} placeholder={t("profesor@centro.es")} /></label><label>{t("Nota opcional")}<textarea name="note" rows={3} disabled={sending} placeholder={t("Una indicación breve para acompañar la entrega")} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t("Cancelar")}</button><button className="primary" disabled={sending}>{t(sending ? "Un momento…" : "Entregar esta versión")}</button></div></form>}</Modal>;
}

export function SealedShareOffer({ documentId, version, onDismiss, onShare }: { documentId: string; version: DocumentVersion; onDismiss: () => void; onShare?: () => void }) {
  return <Modal title={t("Versión sellada")} onClose={onDismiss}><p>{t("Versión")} {version.version_number}</p><div className="modal-actions"><button className="primary" data-modal-autofocus onClick={onShare ?? (() => location.assign(`/process-summary/share/manage/${encodeURIComponent(documentId)}/${encodeURIComponent(version.id)}`))}>{t("Compartir esta versión")}</button><button className="secondary" onClick={onDismiss}>{t("Ahora no")}</button></div></Modal>;
}





export default function App() {
  useLocale();
  useLayoutEffect(() => { if (nominalRoute(location.pathname) && (location.search || location.hash)) history.replaceState(null, '', location.pathname); }, []);
  const [booting, setBooting] = useState(true); const [user, setUser] = useState<User | null>(window.__VERITAS_USER__ ?? null); const [demo, setDemo] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [view, setView] = useState<View>(nominalRoute(location.pathname) ? "submissions" : "documents"); const [documents, setDocuments] = useState<VeritasDocument[]>([]); const [active, setActive] = useState<VeritasDocument | null>(null); const [eventsByDocument, setEventsByDocument] = useState<Record<string, WritingEvent[]>>({ [demoDocuments[0].id]: demoEvents });
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const opening = useRef(0);
  const loadArchive = async () => { const [texts, groups] = await Promise.all([api<{ documents: VeritasDocument[] }>("/documents"), api<{ folders: DocumentFolder[] }>("/folders")]); setDocuments(texts.documents); setFolders(groups.folders); };
  const announceIdentity = () => { try { localStorage.setItem("veritas:auth-generation", `${Date.now()}:${Math.random()}`); } catch { /* Storage may be disabled. */ } };
  useEffect(() => {
    const externalIdentity = (event: StorageEvent) => { if (event.key === "veritas:auth-generation") window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)); };
    window.addEventListener("storage", externalIdentity);
    return () => window.removeEventListener("storage", externalIdentity);
  }, []);
  useEffect(() => {
    const expire = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? t("Tu sesión ha caducado. Vuelve a identificarte para continuar.");
      opening.current++; resetIdentity(); setEventsByDocument({}); setAuthNotice(message); setUser(null); setDocuments([]); setFolders([]); setActive(null); setView(nominalRoute(location.pathname) ? "submissions" : "documents");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, []);
  useEffect(() => { void (async () => { try { const identity = await api<{ user: User }>('/me'); resetIdentity(identity.user.id); setUser(identity.user); setAuthNotice(""); await loadArchive(); } catch (reason) { if (reason instanceof ApiError && (reason.status === 401 || reason.status === 419)) { setUser(null); setDocuments([]); } else if (import.meta.env.DEV) { setDemo(true); setUser({ id: 1, name: "Alejandro", email: "alejandro@veritas.local" }); setDocuments(demoDocuments); } } finally { setBooting(false); } })(); }, []);
  useEffect(() => {
    if (!user || demo) return;
    let disposed = false;
    const check = async () => {
      try {
        const result = await api<{ user: User }>("/me");
        if (!disposed && result.user.id !== user.id) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      } catch (reason) {
        if (!disposed && reason instanceof ApiError && (reason.status === 401 || reason.status === 419)) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
    };
    const timer = window.setInterval(() => void check(), 15000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [user?.id, demo]);
  const create = async (title: string, folderId: string | null = null) => { const request = ++opening.current, epoch = identityGeneration(); let created: VeritasDocument; if (demo) created = { id: makeId(), owner_id: user!.id, folder_id: folderId, title, default_content_font_id: "literata", content_html: '<p data-content-font="literata"></p>', content_text: "", word_count: 0, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), versions_count: 0, sessions_count: 0, versions: [] }; else { const result = await api<{ document: VeritasDocument }>('/documents', { method: 'POST', body: JSON.stringify({ title, folder_id: folderId }) }); created = result.document; } if (epoch !== identityGeneration() || request !== opening.current || created.owner_id !== user?.id) return; setDocuments(previous => [created, ...previous]); setActive(created); setView("editor"); };
  const remove = async (document: VeritasDocument) => { if (!demo) await api<{ deleted: boolean }>(`/documents/${document.id}`, { method: 'DELETE' }); setDocuments(previous => previous.filter(item => item.id !== document.id)); setEventsByDocument(previous => { const next = { ...previous }; delete next[document.id]; return next; }); if (active?.id === document.id) setActive(null); };
  const open = async (document: VeritasDocument) => { const request = ++opening.current, epoch = identityGeneration(), id = document.id; if (!demo) { const detail = await api<{ document: VeritasDocument }>(`/documents/${document.id}`); document = detail.document; } if (epoch !== identityGeneration() || request !== opening.current || document.id !== id || document.owner_id !== user?.id) return; setActive(document); setView("editor"); };
  const persist = (updated: VeritasDocument) => { if (authenticatedIdentity() !== updated.owner_id && !demo) return; setDocuments(previous => previous.map(document => document.id === updated.id ? { ...document, ...updated } : document)); setActive(updated); setEventsByDocument(previous => active ? ({ ...previous, [active.id]: previous[active.id] ?? [] }) : previous); };
  const move = async (document: VeritasDocument, folderId: string | null) => { if (demo) persist({ ...document, folder_id: folderId }); else { const result = await api<{ document: VeritasDocument }>(`/documents/${document.id}`, { method: "PATCH", body: JSON.stringify({ revision: document.revision ?? 0, folder_id: folderId }) }); persist({ ...document, ...result.document }); } };
  const saveFolder = async (name: string, id?: string): Promise<DocumentFolder> => { const folder = demo ? { id: id ?? makeId(), name } : (await api<{ folder: DocumentFolder }>(id ? `/folders/${id}` : "/folders", { method: id ? "PATCH" : "POST", body: JSON.stringify({ name }) })).folder; setFolders(previous => [...previous.filter(item => item.id !== folder.id), folder].sort((a, b) => a.name.localeCompare(b.name, getLocale()))); return folder; };
  const removeFolder = async (folder: DocumentFolder) => { if (!demo) await api(`/folders/${folder.id}`, { method: "DELETE" }); setFolders(previous => previous.filter(item => item.id !== folder.id)); setDocuments(previous => previous.map(document => document.folder_id === folder.id ? { ...document, folder_id: null } : document)); };
  const returnToDocuments = () => { opening.current++; setView("documents"); if (!demo) void loadArchive().catch(() => undefined); };
  const logout = async () => {
    setSigningOut(true); announceIdentity();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message: "" } }));
    try { if (!demo) await api('/auth/logout', { method: 'POST', body: '{}' }); }
    catch (reason) { if (reason instanceof Error) setAuthNotice(reason.message); }
    finally { setSigningOut(false); }
  };
  if (booting || signingOut) return <main className="loading"><Logo /><span></span><p>{t("Abriendo tu archivo…")}</p></main>;
  if (!user) return <AuthScreen notice={authNotice} onAuthenticated={next => { setAuthNotice(""); resetIdentity(next.id); announceIdentity(); setActive(null); setEventsByDocument({}); setUser(next); void loadArchive().catch(() => setDocuments([])); }} />;
  return <Shell user={user} view={view} setView={next => { history.replaceState(null, '', next === 'submissions' ? '/deliveries/received' : '/'); setView(next); window.dispatchEvent(new PopStateEvent('popstate')); }} demo={demo} onLogout={() => void logout()}>
    {view === "documents" && <DocumentsWorkspace documents={documents} folders={folders} onOpen={open} onCreate={create} onDelete={remove} onMove={move} onFolderSave={saveFolder} onFolderDelete={removeFolder} />}
    {view === "editor" && active && <EditorView key={`${user.id}:${active.id}`} initial={active} initialEvents={eventsByDocument[active.id] ?? []} demo={demo} folders={folders} onBack={returnToDocuments} onPersist={persist} />}
    {view === "submissions" && <SubmissionsView key={user.id} />}
  </Shell>;
}
