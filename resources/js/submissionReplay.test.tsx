// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicSubmissionsView as SubmissionsView, SubmissionReplay } from './SubmissionsView';
import { resetIdentity } from './api';
import { setLocale, t } from './i18n';
import type { DocumentVersion, WritingEvent } from './types';
let container: HTMLDivElement; let root: Root;
const version = { id: 'v1', document_id: 'd1', version_number: 2, snapshot_html: '<p>Sealed</p>', snapshot_text: 'Sealed', word_count: 1, content_hash: 'hash', sealed_at: '2026-10-14T12:00:00Z' } satisfies DocumentVersion & { document_id: string };
const events: WritingEvent[] = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, sequence: i + 1, event_type: 'insert', elapsed_ms: i * 100, server_received_at: '2026-10-14T12:00:00Z' }));
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const pending: { url: string; resolve: (value: Response) => void; reject: (reason: Error) => void }[] = [];
const frame = () => container.querySelector<HTMLElement>('[data-testid=submission-frame]')!;
const renderReplay = async (v = version) => act(async () => root.render(<SubmissionReplay key={v.id} version={v} events={events} />));
const select = async (index: number) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[type=range]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(index));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
const complete = async (request: typeof pending[number], emptyId?: number) => act(async () => {
  const ids = new URL(request.url, 'https://test.invalid').searchParams.getAll('snapshot_ids[]').map(Number);
  request.resolve(response({ events: ids.map(id => ({ ...events[id - 1], after_html: id === emptyId ? '' : `<p>Frame ${id}<img src="/api/documents/d1/images/image-${id}"></p>` })) }));
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetIdentity(7); setLocale('es'); pending.length = 0;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((resolve, reject) => pending.push({ url, resolve, reject }))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); resetIdentity(); });
it('keeps the mounted confirmed frame and metadata during 150ms latency, rapid jumps, failures and retry; confirms real empty HTML', async () => {
  vi.useFakeTimers(); await renderReplay(); await complete(pending[0]);
  const article = frame(); const image = article.querySelector('img'); expect(article.textContent).toContain('Frame 1');
  expect(article.querySelector('img')?.getAttribute('src')).toContain('?version_id=v1');
  await select(70); await select(95); await select(0); await select(95);
  expect(pending).toHaveLength(2); // one active read, latest selection queued
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(frame()).toBe(article); expect(article.querySelector('img')).toBe(image); expect(article.textContent).toContain('Frame 1');
  expect(container.querySelector('.replay-meta')?.textContent).toContain('Evento 1 de 100');
  await complete(pending[1]); // obsolete selection fills cache, never selects its frame
  expect(article.textContent).toContain('Frame 1'); expect(pending).toHaveLength(3);
  await act(async () => pending[2].reject(new Error('failed')));
  expect(article.textContent).toContain('Frame 1'); expect(container.querySelector('[role=alert]')).not.toBeNull();
  expect(pending).toHaveLength(3);
  await act(async () => { container.querySelector<HTMLButtonElement>('[role=alert] button')!.click(); });
  await complete(pending[3], 96);
  expect(frame()).toBe(article); expect(article.innerHTML).toBe('');
  expect(container.querySelector('.replay-meta')?.textContent).toContain('Evento 96 de 100');
  expect(container.querySelectorAll('.event-list button').length).toBeLessThanOrEqual(41);
  expect(pending.every(request => request.url.includes('version_id=v1'))).toBe(true);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('ignores a late old-version response and starts with no old text or images', async () => {
  await renderReplay(); await complete(pending[0]); await select(95);
  const old = pending[1]; await renderReplay({ ...version, id: 'v2', document_id: 'd1' });
  expect(frame().innerHTML).toBe('');
  await complete(old); expect(frame().innerHTML).toBe('');
  expect(pending[2].url).toContain('/documents/d1/timeline?version_id=v2');
  await complete(pending[2]); expect(frame().querySelector('img')?.getAttribute('src')).toContain('version_id=v2');
});
it('plays only after confirmation and pauses on failure without clearing the text', async () => {
  vi.useFakeTimers(); await renderReplay(); await complete(pending[0]);
  await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === t('Reproducir'))!.click(); await vi.advanceTimersByTimeAsync(900); });
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(frame().textContent).toContain('Frame 3');
  await select(95); await act(async () => pending[1].reject(new Error('fail')));
  expect(frame().textContent).toContain('Frame 3'); expect(container.querySelector('[role=alert]')).not.toBeNull();
});
for (const locale of ['es', 'en'] as const) {
  it(`shows empty/list load/error states with retry (${locale})`, async () => {
    setLocale(locale); await act(async () => root.render(<SubmissionsView />));
    expect(container.querySelector('[role=status]')).not.toBeNull();
    await act(async () => pending[0].resolve(response({}, 404)));
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
    await act(async () => pending[1].resolve(response({ received: [], sent: [] })));
    expect(container.textContent).toContain(t('Todavía no hay entregas.'));
  });
}
it('selects multiple deliveries, clears prior version on 404, and ignores out-of-order details', async () => {
  await act(async () => root.render(<SubmissionsView />));
  const submissions = ['a', 'b'].map(id => ({ id, submitted_at: '2026-10-14T12:00:00Z', sender_id: 8, recipient_user_id: 7 }));
  await act(async () => pending[0].resolve(response({ received: submissions, sent: [] })));
  expect(container.querySelector('time')?.textContent).not.toContain('T12:00');
  const buttons = container.querySelectorAll<HTMLButtonElement>('[data-submission-id]');
  await act(async () => buttons[0].click());
  await act(async () => pending[1].resolve(response({ version, history_available: false })));
  expect(container.textContent).toContain('Sealed'); expect(container.querySelector('input[type=range]')).toBeNull();
  await act(async () => buttons[1].click()); expect(container.textContent).not.toContain('Sealed');
  await act(async () => pending[2].resolve(response({}, 404))); expect(container.querySelector('[role=alert]')).not.toBeNull();
  await act(async () => buttons[0].click()); await act(async () => buttons[1].click());
  await act(async () => pending[4].resolve(response({ version: { ...version, id: 'v2', snapshot_html: '<p>Other sealed</p>' }, history_available: false })));
  await act(async () => pending[3].resolve(response({ version, history_available: false })));
  expect(container.textContent).toContain('Other sealed'); expect(container.querySelector('.submission-detail article')?.textContent).toBe('Other sealed');
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('loads one delivery through all metadata pages and limits snapshots to those IDs and the sealed version', async () => {
  await act(async () => root.render(<SubmissionsView />));
  await act(async () => pending[0].resolve(response({ sent: [], received: [{ id: 'a', sender_id: 8, recipient_user_id: 7, submitted_at: version.sealed_at }] })));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-submission-id]')!.click());
  await act(async () => pending[1].resolve(response({ version, history_available: true })));
  await act(async () => pending[2].resolve(response({ events: events.slice(0, 2), next_cursor: 'next+page', before_id: 100 })));
  expect(pending[3].url).toContain('version_id=v1&metadata=1&before_id=100&cursor=next%2Bpage');
  await act(async () => pending[3].resolve(response({ events: events.slice(2, 3), next_cursor: null, before_id: 100 })));
  expect(new URL(pending[4].url, 'https://test.invalid').searchParams.getAll('snapshot_ids[]')).toEqual(['1', '2', '3']);
  await complete(pending[4]); expect(frame().textContent).toContain('Frame 1');
  expect(container.querySelector('.submission-detail > .replay-paper article')?.textContent).toBe('Sealed');
  expect(pending).toHaveLength(5);
});
