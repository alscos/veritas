import type { WritingEvent } from "./types";
type Provenance = "direct" | "paste" | "paste-edited";
const blockTags = new Set(["DIV", "P", "H1", "H2", "H3", "LI", "BLOCKQUOTE", "UL", "OL", "TD", "TH", "TR"]);
export const analyzeHtml = (html: string) => {
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

const eventDirect = (event?: WritingEvent) => event?.direct_words ?? analyzeHtml(event?.after_html ?? "").direct;
const ppmForSession = (events: WritingEvent[]): number | null => {
  if (!events.length) return null;
  const startDirect = eventDirect(events[0]);
  const finalDirect = eventDirect(events.at(-1));
  const writtenWords = Math.max(0, finalDirect - startDirect);
  const firstWriting = events.find(event => event.event_type === "insert" && event.input_type !== "insertFromPaste" && eventDirect(event) > startDirect);
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

export const lastRecordedPpm = (events: WritingEvent[]): number | null => {
  const sessions = groupSessions(events);
  for (let index = sessions.length - 1; index >= 0; index--) {
    const ppm = ppmForSession(sessions[index]); if (ppm !== null) return ppm;
  }
  return null;
};

const PAUSE_THRESHOLD_MS = 5_000;
export const timingAnalysis = (events: WritingEvent[]) => {
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
