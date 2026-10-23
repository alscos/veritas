import { SubmissionReplay } from './SubmissionReplay';
export { SubmissionReplay } from './SubmissionReplay';
import NominalDeliveries from './NominalDeliveries';
import SealedPdfButton from './SealedPdfButton';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getLocale, t, useLocale } from './i18n';
import type { HistoryPage } from './history';
import type { DocumentVersion, Submission, SubmissionIdentity, WritingEvent } from './types';

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
