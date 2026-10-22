import NominalDeliveries from './NominalDeliveries';
import SealedReading from './SealedReading';
import SealedPdfButton from './SealedPdfButton';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api';
import { getLocale, t, useLocale } from './i18n';
import { eventKey, historyWindow, type HistoryPage } from './history';
import type { DocumentVersion, Submission, SubmissionIdentity, WritingEvent } from './types';
import { useTimelineSnapshots } from './useTimelineSnapshots';

type ScopedVersion = DocumentVersion & { document_id: string };
const imageScope = (html: string, versionId: string) => html.replace(/(\/api\/documents\/[^"\s<>]+\/images\/[^"\s<>?]+)/g, `$1?version_id=${encodeURIComponent(versionId)}`);
const date = (value?: string) => {
  const parsed = new Date(value ?? '');
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
};

const identity = (account?: SubmissionIdentity) => {
  if (!account) return t('Cuenta desconocida');
  if (account.kind === 'unavailable') return t('Cuenta no disponible');
  if (account.kind === 'restricted' && account.id != null) return t('Cuenta #{id} (perfil no autorizado)', { id: account.id });
  return account.value || (account.id != null ? t('Cuenta #{id}', { id: account.id }) : t('Cuenta desconocida'));
};
const recipient = (item: Submission) => item.recipient_email || (item.recipient_user_id != null ? t('Cuenta #{id}', { id: item.recipient_user_id }) : t('Cuenta desconocida'));
function Accounts({ item, sent }: { item: Submission; sent: boolean }) {
  return <div className="submission-accounts"><p>{t('Creado por')}: {identity(item.creator_account)}</p><p>{t('Enviado por')}: {identity(item.sender_account)}</p>{sent && <p>{t('Destinatario')}: {recipient(item)}</p>}</div>;
}

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

export function AcademicSubmissionsView({ children, readerSubmissionId }: { children?: React.ReactNode; readerSubmissionId?: string }) {
  useLocale();
  const [items, setItems] = useState<(Submission & { direction: string })[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listAttempt, setListAttempt] = useState(0);
  const [selected, setSelected] = useState('');
  const [version, setVersion] = useState<ScopedVersion | null>(null);
  const [detail, setDetail] = useState<Submission | null>(null);
  const [notice, setNotice] = useState(false);
  const [history, setHistory] = useState<WritingEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const readAttempt = useRef(0);
  useEffect(() => {
    let disposed = false;
    setListState('loading');
    void api<{ received: Submission[]; sent: Submission[] }>('/submissions').then(data => {
      if (disposed) return;
      const unique = new Map<string, Submission & { direction: string }>();
      data.sent.forEach(item => unique.set(item.id, { ...item, direction: 'Enviada' }));
      data.received.forEach(item => unique.set(item.id, { ...item, direction: 'Recibida' }));
      setItems([...unique.values()]); setListState('ready');
    }).catch(() => { if (!disposed) setListState('error'); });
    return () => { disposed = true; };
  }, [listAttempt]);
  useEffect(() => () => { ++readAttempt.current; }, []);
  const open = async (id: string) => {
    const attempt = ++readAttempt.current;
    setSelected(id); setDetail(null); setVersion(null); setHistory([]); setNotice(false); setError(''); setLoading(true);
    try {
      const data = await api<{ submission?: Submission; version: ScopedVersion; history_available: boolean }>(`/submissions/${id}`);
      if (attempt !== readAttempt.current) return;
      setDetail(data.submission ?? null); setVersion(data.version); setNotice(!data.history_available);
      if (data.history_available) {
        let page: HistoryPage; let query = `version_id=${data.version.id}&metadata=1`; const events: WritingEvent[] = [];
        do {
          page = await api<HistoryPage>(`/documents/${data.version.document_id}/timeline?${query}`);
          if (attempt !== readAttempt.current) return;
          events.push(...page.events);
          query = `version_id=${data.version.id}&metadata=1&before_id=${page.before_id}&cursor=${encodeURIComponent(page.next_cursor ?? '')}`;
        } while (page.next_cursor);
        setHistory(events);
      }
    } catch { if (attempt === readAttempt.current) setError(t('No se pudo cargar la entrega.')); }
    finally { if (attempt === readAttempt.current) setLoading(false); }
  };
  useEffect(() => { if (readerSubmissionId) void open(readerSubmissionId); }, [readerSubmissionId]);
  const item = items.find(item => item.id === selected);
  return <main className="workspace dashboard submissions-workspace">
    <header className="dashboard-head"><div><p className="eyebrow">InkGroove</p><h1>{t('Entregas')}</h1><p>{t('Versiones selladas compartidas contigo o enviadas por ti.')}</p></div></header>
    {children}{!readerSubmissionId && <h2>{t("Entrega académica")}</h2>}<div className="submissions-grid"><aside hidden={!!readerSubmissionId} className="submission-list" aria-label={t('Entregas')}>
      {listState === 'loading' && <p role="status">{t('Cargando…')}</p>}
      {listState === 'error' && <p role="alert">{t('No se pudo cargar la entrega.')} <button onClick={() => setListAttempt(value => value + 1)}>{t('Reintentar')}</button></p>}
      {listState === 'ready' && !items.length && <p>{t('Todavía no hay entregas.')}</p>}
      {items.map(item => <button key={item.id} data-submission-id={item.id} aria-pressed={selected === item.id} className={selected === item.id ? 'active' : ''} onClick={() => void open(item.id)}><strong>{t(item.direction)}</strong><time dateTime={item.submitted_at}>{date(item.submitted_at)}</time><Accounts item={item} sent={item.direction === 'Enviada'} />{!item.assignment_id && !item.recipient_user_id && <small>{t('Registro antiguo sin cuenta destinataria asociada; no concede acceso.')}</small>}</button>)}
    </aside><section className="submission-detail" aria-label={t('Versión')}>
      {!selected && <p>{t('Selecciona una entrega para consultar su versión sellada.')}</p>}
      {loading && <p role="status">{t('Cargando…')}</p>}
      {error && <p role="alert">{error} <button onClick={() => void open(selected)}>{t('Reintentar')}</button></p>}
      {version && <><header><p className="eyebrow">{t('Versión sellada')}</p><h2>{t('Versión')} {version.version_number}</h2><p><time dateTime={version.sealed_at}>{date(version.sealed_at)}</time> · {version.word_count} {t('palabras')}</p>{version.certificate && <><p>{version.certificate.certificate_code}</p><SealedPdfButton key={version.id} documentId={version.document_id} versionId={version.id} /></>}{detail && <Accounts item={detail} sent={item?.direction === 'Enviada'} />}<p>{t('Cuenta propietaria actual; no acredita un creador histórico.')}</p>{detail?.note && <p>{detail.note}</p>}</header>
        <div className="replay-paper"><article dangerouslySetInnerHTML={{ __html: imageScope(version.snapshot_html, version.id) }} /></div>
        {notice && <p>{t('Esta versión antigua no tiene una frontera de proceso verificable. Solo se comparte la instantánea sellada.')}</p>}
        {!notice && !loading && !error && !history.length && <p>{t('Sin eventos en esta versión.')}</p>}
        {!!history.length && <SubmissionReplay key={`${selected}:${version.id}`} version={version} events={history} />}
      </>}
    </section></div>
  </main>;
}

export default function SubmissionsView() {
  useLocale();
  const [academic, setAcademic] = useState<{ received: Submission[]; sent: Submission[] }>({received:[],sent:[]});
  const [academicError, setAcademicError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reader, setReader] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setAcademicError(false);
    void api<{received:Submission[];sent:Submission[]}>('/submissions').then(data => { if (active) setAcademic(data); }).catch(() => { if (active) setAcademicError(true); });
    return () => { active = false; };
  }, [attempt]);
  if (reader) return <><button onClick={() => setReader(null)}>{t('Volver a Entregas')}</button><AcademicSubmissionsView key={reader} readerSubmissionId={reader} /></>;
  return <main className="workspace dashboard submissions-workspace"><header className="dashboard-head"><div><p className="eyebrow">InkGroove</p><h1>{t('Entregas')}</h1></div></header>
    {academicError && <p role="alert">{t('No se pudo cargar la entrega.')} <button onClick={() => setAttempt(n => n + 1)}>{t('Reintentar')}</button></p>}
    <NominalDeliveries academic={academic} onAcademic={setReader} />
  </main>;
}
