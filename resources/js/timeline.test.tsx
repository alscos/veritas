// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from './App';
import { resetIdentity } from './api';
import { setLocale } from './i18n';
import { cacheSnapshots, snapshotIdsToLoad } from './useTimelineSnapshots';
import type { WritingEvent } from './types';

const html = (id: number) => `<p>Evento ${id}: El pingüino llegó a Cádiz. ge\u0301nesis</p><p></p><p><mark data-origin="paste">fuente</mark> <mark data-origin="paste-edited">enmienda</mark></p>`;
const metadata = (): WritingEvent[] => Array.from({ length: 120 }, (_, index) => ({ id: index + 1, writing_session_id: 'fictional', sequence: index + 1, event_type: 'insert', elapsed_ms: index * 200 }));
type Request = { ids: number[]; signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void };
let container: HTMLDivElement;
let root: Root;
let requests: Request[];
let currentEvents: WritingEvent[];
let currentIndex: number;
let documentId: string | undefined;
const close = vi.fn();
const rerender = () => root.render(<Timeline events={currentEvents} documentId={documentId} index={currentIndex} setIndex={setIndex} loading={false} historyError={false} onRetryHistory={() => {}} title="Documento ficticio" onClose={close} />);
const setIndex = (index: number) => { currentIndex = index; rerender(); };
const article = () => container.querySelector('article')!;
const meta = () => container.querySelector('.replay-meta')!;
const choose = async (index: number) => { await act(async () => setIndex(index)); };
const resolve = async (request: Request, events = request.ids.map(id => ({ ...currentEvents[id - 1], after_html: html(id) }))) => {
  await act(async () => {
    request.resolve(new Response(JSON.stringify({ events }), { headers: { 'Content-Type': 'application/json' } }));
  });
};
const begin = async (index = 119, inline = true) => {
  currentEvents = metadata();
  if (inline) currentEvents[119].after_html = html(120);
  currentIndex = index;
  await act(async () => rerender());
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetIdentity(7); setLocale('es'); documentId = 'fictional-document'; requests = []; close.mockClear();
  vi.stubGlobal('fetch', vi.fn((path: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    expect(options.method ?? 'GET').toBe('GET');
    expect(path).toContain(`/api/documents/${documentId}/timeline?`);
    const ids = new URL(path, 'http://localhost').searchParams.getAll('snapshot_ids[]').map(Number);
    expect(ids.length).toBeGreaterThan(0); expect(ids.length).toBeLessThanOrEqual(32);
    requests.push({ ids, signal: options.signal as AbortSignal, resolve, reject });
  })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); resetIdentity();
});

describe('read-only timeline with delayed snapshots', () => {
  it('keeps the confirmed HTML, event label and time until a backwards jump loads', async () => {
    await begin(119, false); await resolve(requests[0]);
    const original = article().innerHTML;
    await choose(40);
    expect(article().innerHTML).toBe(original);
    expect(article().getAttribute('aria-busy')).toBe('true');
    expect(meta().textContent).toContain('Evento 120 de 120');
    expect(meta().textContent).toContain('Cargando evento 41…');
    expect(container.querySelector('.transport > span')?.textContent).toBe('0:23');
    await resolve(requests[1]);
    expect(article().innerHTML).toBe(html(41));
    expect(article().getAttribute('aria-busy')).toBe('false');
    expect(meta().textContent).toContain('Evento 41 de 120');
    expect(meta().textContent).not.toContain('Cargando');
    expect(container.querySelector('.transport > span')?.textContent).toBe('0:08');
  });

  it('prefetches backwards and forwards without blanking on adjacent reverse steps', async () => {
    await begin(); await resolve(requests[0]); await choose(40); await resolve(requests[1]);
    const received = [...requests[1].ids];
    expect(received).toContain(25); expect(received).toContain(56);
    const before = structuredClone(currentEvents);
    for (const index of [39, 38, 37, 38, 39, 40]) {
      await choose(index);
      expect(article().innerHTML).toBe(html(index + 1));
      expect(article().getAttribute('aria-busy')).toBe('false');
      expect(article().textContent).not.toContain('Cargando');
    }
    expect(requests).toHaveLength(2);
    expect(currentEvents).toEqual(before);
    expect(container.querySelectorAll('.event-list button').length).toBeLessThanOrEqual(41);
  });

  it('uses one request at a time and serves the latest scrub position after a late response', async () => {
    await begin(); await resolve(requests[0]);
    await choose(70); await choose(40); await choose(20);
    expect(requests).toHaveLength(2);
    expect(article().innerHTML).toBe(html(120));
    await resolve(requests[1]);
    expect(article().innerHTML).toBe(html(120));
    expect(meta().textContent).toContain('Cargando evento 21…');
    expect(requests).toHaveLength(3);
    expect(requests[2].ids).toContain(21);
    await resolve(requests[2]);
    expect(article().innerHTML).toBe(html(21));
    expect(article().getAttribute('data-event-key')).toBe('fictional:21');
  });

  it('keeps valid text on error, stops automatic retries and retries only when requested', async () => {
    await begin(); await resolve(requests[0]); await choose(40);
    await act(async () => requests[1].reject(new Error('Controlled network failure')));
    expect(article().innerHTML).toBe(html(120));
    expect(meta().textContent).toContain('Evento 41 pendiente');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('No se pudo cargar la instantánea.');
    expect((container.querySelector('.play') as HTMLButtonElement).disabled).toBe(true);
    currentEvents = [...currentEvents]; await act(async () => rerender());
    expect(requests).toHaveLength(2);
    await act(async () => (container.querySelector('[role=alert] button') as HTMLButtonElement).click());
    expect(requests).toHaveLength(3);
    await resolve(requests[2]);
    expect(article().innerHTML).toBe(html(41));
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect((container.querySelector('.play') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not carry a failure message over to another cached selection', async () => {
    await begin(); await resolve(requests[0]); await choose(40);
    await act(async () => requests[1].reject(new Error('Controlled failure')));
    await choose(119);
    expect(article().innerHTML).toBe(html(120));
    expect(article().getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('[role=alert]')).toBeNull();
  });

  it('does not treat an omitted snapshot as a valid empty frame', async () => {
    await begin(); await resolve(requests[0]); await choose(40);
    await resolve(requests[1], requests[1].ids.filter(id => id !== 41).map(id => ({ ...currentEvents[id - 1], after_html: html(id) })));
    expect(article().innerHTML).toBe(html(120));
    expect(article().getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(requests).toHaveLength(2);
  });

  it('replaces the retained frame with a genuinely empty snapshot', async () => {
    await begin(); await resolve(requests[0]); await choose(40);
    await resolve(requests[1], requests[1].ids.map(id => ({ ...currentEvents[id - 1], after_html: id === 41 ? '' : html(id) })));
    expect(article().getAttribute('aria-busy')).toBe('false');
    expect(article().textContent).toBe('La sesión comienza aquí.');
    expect(article().getAttribute('data-event-key')).toBe('fictional:41');
    expect(meta().textContent).toContain('Evento 41 de 120');
  });

  it('aborts an old document scope and never displays its late HTML in the new one', async () => {
    await begin(); await resolve(requests[0]); await choose(40);
    const oldRequest = requests[1];
    documentId = 'other-fictional-document'; currentEvents = metadata();
    await act(async () => rerender());
    expect(oldRequest.signal.aborted).toBe(true);
    expect(article().textContent).not.toContain('El pingüino');
    await resolve(oldRequest);
    expect(article().textContent).not.toContain('El pingüino');
    await resolve(requests[2]);
    expect(article().innerHTML).toBe(html(41));
    expect(requests).toHaveLength(3);
  });

  it('waits at an uncached frame during play and resumes after its snapshot arrives', async () => {
    vi.useFakeTimers();
    await begin(40, false); await resolve(requests[0]);
    await act(async () => (container.querySelector('.play') as HTMLButtonElement).click());
    for (let step = 0; step < 25; step++) await act(async () => vi.advanceTimersByTime(200));
    expect(currentIndex).toBe(56);
    expect(article().innerHTML).toBe(html(56));
    expect(meta().textContent).toContain('Evento 56 de 120');
    expect(meta().textContent).toContain('Cargando evento 57…');
    await act(async () => vi.advanceTimersByTime(10000));
    expect(currentIndex).toBe(56);
    await resolve(requests[1]);
    expect(article().innerHTML).toBe(html(57));
    await act(async () => vi.advanceTimersByTime(200));
    expect(currentIndex).toBe(57);
    expect(article().innerHTML).toBe(html(58));
  });

  it('preserves local/demo snapshots and translates the pending selection', async () => {
    await begin(); await resolve(requests[0]); setLocale('en'); await choose(40);
    expect(meta().textContent).toContain('Event 120 of 120');
    expect(meta().textContent).toContain('Loading event 41…');
    await resolve(requests[1]);
    currentEvents = [{ sequence: 1, event_type: 'insert', elapsed_ms: 0, after_html: html(1) }];
    documentId = undefined; currentIndex = 0;
    await act(async () => rerender());
    expect(article().innerHTML).toBe(html(1));
    expect(article().getAttribute('aria-busy')).toBe('false');
    expect(requests).toHaveLength(2);
  });
});

describe('bounded snapshot planning', () => {
  it('prefetches a whole adjacent block at either edge instead of many small reads', () => {
    const events = metadata();
    const first = new Map(Array.from({ length: 64 }, (_, index) => [index + 1, html(index + 1)] as const));
    expect(snapshotIdsToLoad(events, 56, first, new Set())).toEqual(Array.from({ length: 32 }, (_, index) => index + 65));
    const middle = new Map(Array.from({ length: 64 }, (_, index) => [index + 33, html(index + 33)] as const));
    expect(snapshotIdsToLoad(events, 39, middle, new Set())).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
  });

  it('keeps at most 64 cached snapshots near the latest position', () => {
    const events = metadata();
    const cache = new Map(Array.from({ length: 64 }, (_, index) => [index + 1, html(index + 1)] as const));
    const received = new Map(Array.from({ length: 32 }, (_, index) => [index + 65, html(index + 65)] as const));
    cacheSnapshots(cache, received, events, 80);
    expect(cache.size).toBe(64);
    expect(cache.has(81)).toBe(true); expect(cache.has(1)).toBe(false);
  });

  it('avoids one prefetch per step and never loops on a failed requested frame', () => {
    const events = metadata();
    const cache = new Map(Array.from({ length: 17 }, (_, offset) => [offset + 33, html(offset + 33)] as const));
    expect(snapshotIdsToLoad(events, 40, cache, new Set())).toEqual([]);
    expect(snapshotIdsToLoad(events, 40, new Map(), new Set([41]))).toEqual([]);
    const ids = snapshotIdsToLoad(events, 40, new Map(), new Set());
    expect(ids).toHaveLength(32); expect(ids).toContain(25); expect(ids).toContain(56);
  });
});
