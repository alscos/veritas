import SealedReading from './SealedReading';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getLocale, t } from './i18n';
import { eventKey, historyWindow } from './history';
import type { DocumentVersion, WritingEvent } from './types';
import { useTimelineSnapshots } from './useTimelineSnapshots';
type ScopedVersion = DocumentVersion & { document_id: string };
const imageScope = (html: string, versionId: string) => html.replace(/(\/api\/documents\/[^"\s<>]+\/images\/[^"\s<>?]+)/g, `$1?version_id=${encodeURIComponent(versionId)}`);
const date = (value?: string) => { const parsed = new Date(value ?? ''); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }); };
export function SubmissionReplay({ version, events, nominalImage, nominalEvent, onNeedMore, historyBusy = false, totalEvents }: { version: ScopedVersion; events: WritingEvent[]; historyBusy?: boolean; totalEvents?: number; onNeedMore?: () => Promise<void>; nominalEvent?: (id: number, signal: AbortSignal) => Promise<string>; nominalImage?: (id: string, signal: AbortSignal, event?: number) => Promise<Blob> }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const advanceAfter = useRef<number | null>(null);
  useEffect(() => {
    if (advanceAfter.current === null) return;
    if (events.length > advanceAfter.current) {
      setIndex(advanceAfter.current); advanceAfter.current = null;
    } else if (!historyBusy && onNeedMore) void onNeedMore();
    else if (!historyBusy && !onNeedMore) advanceAfter.current = null;
  }, [events.length, historyBusy, onNeedMore]);
  const next = () => {
    setPlaying(false);
    if (index < events.length - 1) setIndex(index + 1);
    else if (onNeedMore && !historyBusy) {
      advanceAfter.current = events.length;
      void onNeedMore();
    }
  };
  const legacy = useTimelineSnapshots(nominalImage ? undefined : version.document_id, events, index, version.id);
  const event = events[index];
  const [authorized, setAuthorized] = useState<{ id: number; html: string } | null>(null);
  useEffect(() => {
    if (!nominalEvent || !event?.id) return;
    const c = new AbortController(); setAuthorized(null);
    void nominalEvent(event.id, c.signal).then(html => { if (!c.signal.aborted) setAuthorized({ id: event.id!, html }); }).catch(() => {});
    return () => c.abort();
  }, [nominalEvent, event?.id]);
  const snapshot = nominalEvent ? authorized?.id === event?.id ? authorized?.html : undefined : legacy.snapshot;
  const snapshotError = nominalEvent ? false : legacy.snapshotError;
  const retrySnapshot = legacy.retrySnapshot;
  const scopedImage = useCallback((id: string, signal: AbortSignal) => nominalImage!(id, signal, event?.id), [nominalImage, event?.id]);
  const lastFrame = useRef<{ event: WritingEvent; html: string; index: number } | null>(null);
  useLayoutEffect(() => { if (event && snapshot !== undefined) lastFrame.current = { event, html: snapshot, index }; }, [event, snapshot, index]);
  const frame = event && snapshot !== undefined ? { event, html: snapshot, index } : nominalImage ? null : lastFrame.current;
  const pending = snapshot === undefined;
  useEffect(() => { if (snapshotError) setPlaying(false); }, [snapshotError]);
  useEffect(() => {
    if (!playing || pending || snapshotError) return;
    if (index === events.length - 1) { if (onNeedMore) { if (!historyBusy) void onNeedMore(); } else setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(index + 1), 800 / speed);
    return () => clearTimeout(timer);
  }, [playing, pending, snapshotError, index, events.length, speed, onNeedMore, historyBusy]);
  const select = (next: number) => {
    setPlaying(false); advanceAfter.current = null;
    if (next < events.length) setIndex(next);
    else if (onNeedMore) { advanceAfter.current = next; if (!historyBusy) void onNeedMore(); }
  };
  const labels: Record<string, string> = { start: t('Inicio'), insert: t('Escritura'), delete: t('Eliminación'), paste: t('Pegado'), paste_edit: t('Reelaboración de pegado'), format: t('Formato'), focus: t('Vuelta al editor'), blur: t('Salida del editor'), save: t('Guardado') };
  const window = historyWindow(index, events.length);
  return <section className="submission-process" aria-label={t('Proceso de escritura')}>
    <h2>{t('Proceso de escritura')}</h2><p>{t('El proceso incluye borradores recibidos, que pueden diferir del texto guardado o sellado.')}</p>
    {nominalImage || onNeedMore || totalEvents !== undefined ? <p role="status">{getLocale() === 'en' ? `${events.length} loaded${totalEvents === undefined ? '; total pending' : ` / ${totalEvents}`}. ${onNeedMore ? 'More sealed history available.' : 'End of available sealed history.'}` : `${events.length} cargados${totalEvents === undefined ? '; total pendiente' : ` / ${totalEvents}`}. ${onNeedMore ? 'Hay más historial sellado.' : 'Fin del historial sellado disponible.'}`}</p> : null}
    <div className="submission-controls">
      <button disabled={snapshotError} onClick={() => setPlaying(!playing)}>{t(playing ? 'Pausar' : 'Reproducir')}</button>
      <button disabled={index === 0} aria-label={t('Evento anterior')} onClick={() => select(index - 1)}>←</button>
      <input aria-label={t('Evento')} aria-valuetext={t('Evento {index} de {total}', { index: index + 1, total: totalEvents ?? events.length })} type="range" min={0} max={(totalEvents ?? events.length) - 1} value={index} onChange={e => select(Number(e.target.value))} />
      <button disabled={historyBusy || (index === events.length - 1 && !onNeedMore)} aria-label={t('Evento siguiente')} onClick={next}>→</button>
      <select aria-label={t('Velocidad')} value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option></select>
    </div>
    <div className="submission-history">
      <div className="replay-paper"><div className="replay-meta"><span>{frame ? t('Evento {index} de {total}', { index: frame.index + 1, total: events.length }) : '—'} · {date(frame?.event.server_received_at)}</span><strong>{frame ? nominalImage ? t('Evento') : labels[frame.event.event_type] ?? frame.event.event_type : ''}</strong></div>
        {nominalImage ? <SealedReading html={frame?.html ?? ''} read={scopedImage} /> : <article data-testid="submission-frame" data-event-key={frame ? eventKey(frame.event) : undefined} aria-busy={pending} dangerouslySetInnerHTML={{ __html: frame ? imageScope(frame.html, version.id) : '' }} />}
      </div>
      <aside className="event-rail"><h3>{t('Secuencia')}</h3><div className="event-list">{events.slice(window.start, window.end).map((item, offset) => <button key={eventKey(item)} aria-pressed={window.start + offset === index} className={window.start + offset === index ? 'active' : ''} onClick={() => select(window.start + offset)}><span><strong>{window.start + offset + 1} · {nominalImage ? t('Evento') : labels[item.event_type] ?? item.event_type}</strong><small>{date(item.server_received_at)}</small></span></button>)}</div></aside>
    </div>
    {pending && !snapshotError && <p role="status">{t('Cargando evento {index}…', { index: index + 1 })}</p>}
    {snapshotError && <p role="alert">{t('No se pudo cargar la instantánea.')} <button onClick={retrySnapshot}>{t('Reintentar')}</button></p>}
  </section>;
}
