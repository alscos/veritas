import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { WritingEvent } from './types';

const BATCH_SIZE = 32;
const CACHE_SIZE = 64;
const LOOK_AHEAD = 8;

function range(index: number, total: number, size: number) {
  const start = Math.max(0, Math.min(index - Math.floor(size / 2), total - size));
  return { start, end: Math.min(total, start + size) };
}

// Prefetch in both directions, but only when the selection nears a cache edge.
export function snapshotIdsToLoad(events: WritingEvent[], index: number, cache: Map<number, string>, failed: Set<number>) {
  const selected = events[index];
  if (selected?.after_html === undefined && selected?.id && failed.has(selected.id)) return [];
  const missing = (event: WritingEvent) => event.after_html === undefined && event.id !== undefined && !cache.has(event.id) && !failed.has(event.id);
  const near = range(index, events.length, LOOK_AHEAD * 2 + 1);
  if (!events.slice(near.start, near.end).some(missing)) return [];
  const selectedMissing = selected && missing(selected);
  // A cold jump needs both sides. At an edge, fill a whole adjacent block
  // instead of fetching only a few new neighbours on every eighth step.
  const gap = events.slice(near.start, near.end)
    .map((event, offset) => ({ event, position: near.start + offset }))
    .filter(item => missing(item.event))
    .sort((left, right) => Math.abs(left.position - index) - Math.abs(right.position - index))[0]?.position;
  const batch = selectedMissing || gap === undefined ? range(index, events.length, BATCH_SIZE)
    : gap < index ? { start: Math.max(0, gap - BATCH_SIZE + 1), end: gap + 1 }
    : { start: gap, end: Math.min(events.length, gap + BATCH_SIZE) };
  return [...new Set(events.slice(batch.start, batch.end).filter(missing).map(event => event.id!))];
}

export function cacheSnapshots(cache: Map<number, string>, received: Map<number, string>, events: WritingEvent[], index: number) {
  received.forEach((html, id) => cache.set(id, html));
  if (cache.size <= CACHE_SIZE) return;
  const positions = new Map(events.flatMap((event, position) => event.id === undefined ? [] : [[event.id, position] as const]));
  const furthest = [...cache.keys()].sort((left, right) => Math.abs((positions.get(right) ?? Infinity) - index) - Math.abs((positions.get(left) ?? Infinity) - index));
  for (const id of furthest) {
    if (cache.size <= CACHE_SIZE) break;
    cache.delete(id);
  }
}

export function useTimelineSnapshots(documentId: string | undefined, events: WritingEvent[], index: number, versionId?: string) {
  // A separate store per document prevents late responses crossing document scopes.
  const store = useMemo(() => ({ cache: new Map<number, string>(), failed: new Set<number>() }), [documentId, versionId]);
  const selection = useRef({ events, index });
  const pump = useRef<() => void>(() => {});
  const [, render] = useState(0);
  useLayoutEffect(() => { selection.current = { events, index }; }, [events, index]);

  useEffect(() => {
    if (!documentId) return;
    let disposed = false;
    let request: AbortController | undefined;
    const load = () => {
      if (disposed || request) return;
      const { events: currentEvents, index: currentIndex } = selection.current;
      const ids = snapshotIdsToLoad(currentEvents, currentIndex, store.cache, store.failed);
      if (!ids.length) return;
      const query = new URLSearchParams();
      if (versionId) query.set('version_id', versionId);
      ids.forEach(id => query.append('snapshot_ids[]', String(id)));
      request = new AbortController();
      void api<{ events: WritingEvent[] }>(`/documents/${documentId}/timeline?${query}`, { signal: request.signal })
        .then(page => {
          if (disposed) return;
          const received = new Map<number, string>();
          for (const event of page.events) {
            if (event.id !== undefined && ids.includes(event.id) && typeof event.after_html === 'string') received.set(event.id, event.after_html);
          }
          ids.forEach(id => { if (received.has(id)) store.failed.delete(id); else store.failed.add(id); });
          cacheSnapshots(store.cache, received, selection.current.events, selection.current.index);
          render(value => value + 1);
        })
        .catch(() => {
          if (disposed) return;
          ids.forEach(id => store.failed.add(id));
          render(value => value + 1);
        })
        .finally(() => {
          request = undefined;
          // Finish one read before serving the latest selection. Completed reads
          // still enter the cache when the user has moved; they never select a frame.
          if (!disposed) load();
        });
    };
    pump.current = load;
    load();
    return () => { disposed = true; request?.abort(); pump.current = () => {}; };
  }, [documentId, versionId, store]);

  useEffect(() => { pump.current(); }, [events, index, store]);
  const event = events[index] ?? events[0];
  const snapshot = event?.after_html ?? (event?.id === undefined ? undefined : store.cache.get(event.id));
  const snapshotError = snapshot === undefined && event?.id !== undefined && store.failed.has(event.id);
  const retrySnapshot = () => {
    store.failed.clear();
    render(value => value + 1);
    pump.current();
  };
  return { snapshot, snapshotError, retrySnapshot };
}
