import Modal from './Modal';
import VersionShareApp from './VersionShareApp';
import { useCallback, useEffect, useRef, useState } from 'react';
import { identityGeneration, SESSION_EXPIRED_EVENT } from './api';
import { useLocale } from './i18n';
import { nominalBase, nominalRequest } from './nominalTransport';
import { SubmissionReplay } from './SubmissionsView';
import SealedReading from './SealedReading';
import SealedPdfButton from './SealedPdfButton';
import type { DocumentVersion, WritingEvent, Submission } from './types';

type Item = { title_basis?: 'issue' | 'current' | null; document_title?: string | null; certificate_code?: string; level?: number; audience_mode?: string; created_at?: string; label?: string; grant_id: string; document_id: string; version_id: string; version_number: number; recipient_user_id: number; sender: string; recipient: string; expires_at: string | null; state: string; independent_submission: boolean };
type Page = { version: { number: number; sealed_at: string }; snapshot_html: string; events: { id: number; sequence: number; html: string }[]; next_after: number | null; total_events?: number; coverage?: { status: string; complete: boolean } };
export default function NominalDeliveries({ academic, onAcademic }: { academic?: {received:Submission[];sent:Submission[]}; onAcademic?: (id: string) => void } = {}) {
  const en = useLocale() === 'en', tr = (es: string, english: string) => en ? english : es;
  const [box, setBox] = useState<'received' | 'sent'>(location.pathname === '/deliveries/sent' ? 'sent' : 'received');
  useEffect(() => {
    const syncBox = () => { if (/^\/deliveries\/(received|sent)$/.test(location.pathname)) setBox(location.pathname.endsWith('/sent') ? 'sent' : 'received'); };
    window.addEventListener('popstate', syncBox); return () => window.removeEventListener('popstate', syncBox);
  }, []);
  const [emission, setEmission] = useState<Item | null>(null);
  const [filter, setFilter] = useState(''), [stateFilter, setStateFilter] = useState('all');
  const [items, setItems] = useState<Item[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [chosen, setChosen] = useState<Item | null>(null), [version, setVersion] = useState<(DocumentVersion & { document_id: string }) | null>(null);
  const [events, setEvents] = useState<WritingEvent[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  const [totalEvents, setTotalEvents] = useState<number>();
  const [coverage, setCoverage] = useState<Page["coverage"]>();
  const snapshots = useRef(new Map<number, string>()), loadingMore = useRef(false);
  const list = useRef<AbortController | null>(null), read = useRef<AbortController | null>(null);
  const initialGrant = useRef(/^\/deliveries\/received\/([a-f0-9-]{36})$/.exec(location.pathname)?.[1]);
  const clear = useCallback(() => { read.current?.abort(); setVersion(null); setEvents([]); setNextAfter(null); setTotalEvents(undefined); setCoverage(undefined); snapshots.current.clear(); loadingMore.current = false; setHistoryBusy(false); }, []);
  const load = async (next?: string) => {
    list.current?.abort(); const c = new AbortController(); list.current = c; const epoch = identityGeneration();
    setBusy(true); setError('');
    try {
      const r = await nominalRequest(`${nominalBase}/${box}${next ? `?cursor=${encodeURIComponent(next)}` : ''}`, c.signal);
      const data: { items: Item[]; next_cursor: string | null } = await r.json();
      if (c.signal.aborted || epoch !== identityGeneration()) return;
      setItems(old => next ? [...old, ...data.items] : data.items); setCursor(data.next_cursor);
      if (initialGrant.current && box === 'received') {
        const item = data.items.find(i => i.grant_id === initialGrant.current);
        if (item) { initialGrant.current = undefined; void open(item); }
        else if (data.next_cursor) void load(data.next_cursor);
      }
    } catch { if (!c.signal.aborted) setError(tr('Listado no disponible.', 'List unavailable.')); }
    finally { if (!c.signal.aborted) setBusy(false); }
  };
  useEffect(() => {
    setItems([]); setCursor(null); setChosen(null); clear(); void load();
    const refresh = () => setAttempt(n => n + 1);
    const expired = () => { list.current?.abort(); clear(); setItems([]); setChosen(null); setEmission(null); };
    window.addEventListener('inkgroove:shares-updated', refresh); window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => { list.current?.abort(); read.current?.abort(); window.removeEventListener('inkgroove:shares-updated', refresh); window.removeEventListener(SESSION_EXPIRED_EVENT, expired); };
  }, [box, attempt, clear]);
  const withdrawn = useCallback(() => { clear(); setItems(old => old.map(i => i.grant_id === chosen?.grant_id ? {...i, document_title: null, state: (i.expires_at === null ? Infinity : Date.parse(i.expires_at)) <= Date.now() ? 'expired' : 'unavailable'} : i)); setError(tr('Acceso no disponible: puede haber caducado o sido retirado.', 'Access unavailable: it may have expired or been withdrawn.')); }, [clear, en, chosen?.grant_id]);
  const metadata = (page: Page): WritingEvent[] => page.events.map(e => ({ id: e.id, sequence: e.sequence, event_type: 'insert', elapsed_ms: 0 }));
  const remember = (page: Page) => {
    for (const event of page.events) snapshots.current.set(event.id, event.html);
    while (snapshots.current.size > 64) snapshots.current.delete(snapshots.current.keys().next().value!);
  };
  const open = async (item: Item) => {
    clear(); setChosen(item); setError(''); if (item.state !== 'active' || box !== 'received') return;
    const c = new AbortController(); read.current = c; const epoch = identityGeneration();
    const active = () => !c.signal.aborted && epoch === identityGeneration();
    try {
      const r = await nominalRequest(`${nominalBase}/${item.grant_id}/page`, c.signal, { after: 0 });
      const page: Page = await r.json(); if (!active()) return;
      remember(page);
      setVersion({ id: item.version_id, document_id: item.document_id, version_number: page.version.number, sealed_at: page.version.sealed_at, snapshot_html: page.snapshot_html, snapshot_text: '', word_count: 0, content_hash: '' });
      setEvents(metadata(page)); setNextAfter(page.next_after); setTotalEvents(page.total_events); setCoverage(page.coverage);
    } catch { if (active()) withdrawn(); }
  };
  const loadMore = useCallback(async () => {
    const c = read.current, after = nextAfter, epoch = identityGeneration();
    if (!c || c.signal.aborted || after === null || loadingMore.current || !chosen) return;
    const active = () => !c.signal.aborted && epoch === identityGeneration();
    loadingMore.current = true; setHistoryBusy(true);
    try {
      const r = await nominalRequest(`${nominalBase}/${chosen.grant_id}/page`, c.signal, { after });
      const page: Page = await r.json(); if (!active()) return;
      if (page.version.number !== chosen.version_number || page.snapshot_html !== version?.snapshot_html || page.events.some(e => e.id <= after) || (page.next_after !== null && page.next_after <= after)) throw Error('Invalid cursor or version');
      remember(page); setEvents(old => [...old, ...metadata(page)]); setNextAfter(page.next_after);
    } catch { if (active()) withdrawn(); }
    finally { if (active()) { loadingMore.current = false; setHistoryBusy(false); } }
  }, [chosen?.grant_id, nextAfter, withdrawn, version?.snapshot_html]);
  // Revalidate a visible reading, including when the tab returns to the foreground.
  useEffect(() => {
    if (!chosen || !version) return;
    const c = new AbortController(); const epoch = identityGeneration();
    const validate = async () => {
      if ((chosen.expires_at === null ? Infinity : Date.parse(chosen.expires_at)) <= Date.now()) { withdrawn(); return; }
      try { await nominalRequest(`${nominalBase}/${chosen.grant_id}/page`, c.signal, { after: 0 }); }
      catch { if (!c.signal.aborted && epoch === identityGeneration()) withdrawn(); }
    };
    const timer = setInterval(() => void validate(), 15000); const focus = () => void validate(); window.addEventListener('focus', focus);
    const remaining = (chosen.expires_at === null ? Infinity : Date.parse(chosen.expires_at)) - Date.now();
    const expiry = remaining <= 2147483647 ? setTimeout(withdrawn, Math.max(0, remaining)) : undefined;
    return () => { c.abort(); clearInterval(timer); clearTimeout(expiry); window.removeEventListener('focus', focus); };
  }, [chosen, version, withdrawn]);
  const readEvent = useCallback(async (id: number, signal: AbortSignal) => {
    try {
      if (signal.aborted || (chosen!.expires_at === null ? Infinity : Date.parse(chosen!.expires_at)) <= Date.now()) throw Error('Unavailable');
      const cached = snapshots.current.get(id); if (cached !== undefined) return cached;
      const r = await nominalRequest(`${nominalBase}/${chosen!.grant_id}/event`, signal, { event: id });
      const page: Page = await r.json(); if (signal.aborted) throw Error('Cancelled');
      const event = page.events.find(e => e.id === id); if (!event) throw Error('Missing event'); remember(page); return event.html;
    } catch (e) { if (!signal.aborted) withdrawn(); throw e; }
  }, [chosen?.grant_id, withdrawn]);
  const readImage = useCallback(async (id: string, signal: AbortSignal, event?: number) => {
    try { return await (await nominalRequest(`${nominalBase}/${chosen!.grant_id}/image`, signal, { image: id, ...(event ? { event } : {}) })).blob(); }
    catch (e) { if (!signal.aborted) withdrawn(); throw e; }
  }, [chosen?.grant_id, withdrawn]);
  return <section className="nominal-deliveries" aria-label={tr('Bandeja de entregas', 'Delivery inbox')}>
    {emission && <Modal title={tr('Emitir / compartir', 'Issue / share')} onClose={() => setEmission(null)}><VersionShareApp key={emission.version_id} documentId={emission.document_id} versionId={emission.version_id} versionLabel={`${emission.version_number} · ${emission.certificate_code ?? ''}`} wizard initialSecret="" onDone={() => { setEmission(null); setAttempt(n => n + 1); }} /></Modal>}
    {!version && <>
    <h2>{tr('Bandeja de entregas', 'Delivery inbox')}</h2>
    <nav className="delivery-navigation" aria-label={tr('Bandejas', 'Inboxes')}><button aria-pressed={box === 'received'} onClick={() => { history.replaceState(null, '', '/deliveries/received'); setBox('received'); }}>{tr('Recibidas', 'Received')}</button><button aria-pressed={box === 'sent'} onClick={() => { history.replaceState(null, '', '/deliveries/sent'); setBox('sent'); }}>{tr('Enviadas', 'Sent')}</button><button onClick={() => setAttempt(n => n + 1)}>{tr('Actualizar', 'Refresh')}</button></nav>
    {busy && <p role="status">{tr('Cargando…', 'Loading…')}</p>}{error && <p role="alert">{error}</p>}
    <div className="delivery-filters"><label>{tr('Buscar por título o cuenta', 'Search by title or account')}<input type="search" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    <label>{tr('Estado', 'Status')}<select value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="all">{tr('Todos', 'All')}</option><option value="active">{tr('Activas', 'Active')}</option><option value="expired">{tr('Caducadas', 'Expired')}</option><option value="revoked">{tr('Revocadas', 'Revoked')}</option></select></label></div>
    <ul className="delivery-inbox">{items.filter(i => (stateFilter === 'all' || i.state === stateFilter) && `${i.document_title ?? ''} ${i.sender} ${i.recipient} ${i.certificate_code ?? ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(i => <li key={`${i.grant_id}:${i.recipient_user_id}`}>
      <h3>{i.document_title ?? `${tr('Versión sellada · versión', 'Sealed version · version')} ${i.version_number}`}</h3>{box === 'sent' && i.title_basis === 'current' && <p>{tr('Título actual (no fijado en esta emisión)', 'Current title (not fixed at issue)')}</p>}<code>{i.certificate_code}</code>{i.label && <p>{i.label}</p>}
      <span>{tr('Versión', 'Version')} {i.version_number} · {box === 'received' ? `${tr('De:', 'From:')} ${i.sender}` : i.recipient ? `${tr('Para:', 'To:')} ${i.recipient}` : tr('Acceso mediante enlace', 'Access by link')} · {tr('Nivel', 'Level')} {i.level ?? 3} · {i.state === 'revoked' ? tr('Revocada', 'Revoked') : i.state === 'expired' ? tr('Caducada', 'Expired') : i.state === 'active' ? tr('Activa', 'Active') : tr('Acceso no disponible', 'Access unavailable')} · {i.created_at ? new Date(i.created_at).toLocaleString(en ? 'en-GB' : 'es-ES') : tr('Fecha no disponible', 'Date unavailable')} · {i.expires_at === null ? tr('Nunca caduca', 'Never expires') : new Date(i.expires_at).toLocaleString(en ? 'en-GB' : 'es-ES')}</span>
      <p>{i.level && i.level < 3 ? tr('Verificación pública', 'Public verification') : i.audience_mode === 'signed_in_link' ? tr('Cualquier cuenta con el enlace', 'Any account with the link') : i.recipient}</p>
      {box === 'sent' && <><p>{tr('Enlace no recuperable; emitir uno nuevo', 'Link cannot be recovered; issue a new one')}</p><button onClick={() => setEmission(i)}>{tr('Emitir uno nuevo', 'Issue a new one')}</button><p>{tr('Revocar sólo corta nuevas consultas de esta concesión. Las copias descargadas y otros permisos independientes subsisten.', 'Revocation only stops new consultations under this grant. Downloaded copies and independent permissions remain.')}</p></>}
      {i.independent_submission && <p>{tr('Existe una Entrega académica independiente. Revocar esta compartición no retira ese permiso.', 'An independent academic submission exists. Revoking this share does not withdraw that permission.')}</p>}
      {box === 'received' && i.state === 'active' && <button onClick={() => void open(i)}>{tr('Leer versión', 'Read version')}</button>}
      {box === 'sent' && <button disabled={busy || i.state !== 'active'} onClick={async () => {
        const c = new AbortController(); list.current?.abort(); list.current = c; setBusy(true);
        try { await nominalRequest(`/process-summary/share/manage/${i.document_id}/${i.version_id}/grants/${i.grant_id}/revoke`, c.signal, {}); if (!c.signal.aborted) setAttempt(n => n + 1); }
        catch { if (!c.signal.aborted) setError(tr('No se pudo revocar.', 'Could not revoke.')); } finally { if (!c.signal.aborted) setBusy(false); }
      }}>{tr('Revocar', 'Revoke')}</button>}
    </li>)}
    {(academic?.[box] ?? []).filter(i => stateFilter === 'all' && `${i.recipient_email ?? ''} ${i.note ?? ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(i => <li key={`academic:${i.id}`}><strong>{tr('Entrega académica', 'Academic submission')}</strong><p>{i.recipient_email} · {i.submitted_at} · {i.status}</p><button data-submission-id={i.id} onClick={() => onAcademic?.(i.id)}>{tr('Abrir versión', 'Open version')}</button><p>{tr('Permiso académico independiente; no se revoca como una emisión voluntaria.', 'Independent academic permission; cannot be revoked as a voluntary share.')}</p></li>)}
    </ul>
    {cursor && <button disabled={busy} onClick={() => void load(cursor)}>{tr('Más comparticiones', 'More shares')}</button>}
    </>}
    {chosen && version && <section key={chosen.grant_id}><button onClick={() => { clear(); setChosen(null); }}>{tr('Volver a Entregas', 'Back to Deliveries')}</button><h3>{tr('Versión sellada', 'Sealed version')} {version.version_number}</h3>
      <p>{tr('Orden de almacenamiento dentro de la frontera sellada; sin cronología global autenticada. Formato de página no disponible en esta API; presentación reconstruida.', 'Storage order within the sealed boundary; no authenticated global chronology. Page format unavailable in this API; reconstructed presentation.')}</p>
      <SealedPdfButton documentId={chosen.document_id} versionId={chosen.version_id} nominalGrant={chosen.grant_id} onDenied={withdrawn} />
      <p>{tr('El PDF completo puede copiarse tras descargarlo; la revocación no recupera copias.', 'The full PDF can be copied after downloading; revocation cannot recover copies.')}</p>
      <div className="replay-paper"><SealedReading html={version.snapshot_html} read={readImage} /></div>
      {coverage && !coverage.complete && <p role="status">{tr('Historial parcial según el contrato de este sello.', 'Partial history under this seal’s contract.')} {coverage.status}</p>}
      {!!events.length && <SubmissionReplay version={version} events={events} nominalImage={readImage} nominalEvent={readEvent} historyBusy={historyBusy} totalEvents={totalEvents} onNeedMore={nextAfter === null ? undefined : loadMore} />}
      {nextAfter !== null && <button disabled={historyBusy} onClick={() => void loadMore()}>{tr('Más historial sellado', 'More sealed history')}</button>}
      {historyBusy && <p role="status">{tr('Cargando historial sellado…', 'Loading sealed history…')}</p>}
    </section>}
  </section>;
}
