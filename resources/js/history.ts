import type { WritingEvent } from './types';
export type HistoryPage = { events: WritingEvent[]; total: number; before_id: number; next_cursor: string | null };
// Identity is per session, not sequence alone. Local events survive history arrivals.
export const eventKey = (event: WritingEvent) => `${event.writing_session_id ?? 'demo'}:${event.sequence}`;
export function mergeHistory(history: WritingEvent[], local: WritingEvent[]): WritingEvent[] {
  const seen = new Set<string>();
  return [...history, ...local].filter(event => {
    const key = eventKey(event);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export const historyWindow = (index: number, total: number) => {
  const start = Math.max(0, Math.min(index - 20, total - 41));
  return { start, end: Math.min(total, start + 41) };
};
