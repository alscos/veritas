import { authenticatedIdentity, identityGeneration, SESSION_EXPIRED_EVENT } from './api';
import { useCallback, useEffect, useRef, useState } from 'react';
import SealedReading from './SealedReading';
import { sharePdf, SharePdfError, downloadSharePdf } from './sharePdf';
import type { PdfSource } from './sealedPdf';
import { setLocale } from './i18n';

type Grant = { display_title_at_issue?: string | null; id: string; level: 1 | 2 | 3; audience_mode: string | null; label: string | null; state: string; created_at: string; expires_at: string | null; revoked_at: string | null };
type Issued = { grant: Grant; url: string | null; replayed?: boolean };
type Reading = { snapshot_html: string; events: { id: number; sequence: number; html: string }[]; next_after: number | null; total_events?: number; coverage: { status: string; complete: boolean } };
type Card = { expires_at?: string | null; level: number; seal: { certificate_code: string; version_number: number | null; valid: boolean; scope: string; issued_at: string }; summary?: { coverage: { status: string; complete: boolean }; counts: { value: { direct: number; pasted: number; edited: number; total: number } | null } }; reading?: Reading };
export class ShareRequestError extends Error { constructor(public status: number) { super('Unavailable'); } }
export async function shareRequest(path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  const epoch = identityGeneration(), user = authenticatedIdentity();
  const run = () => fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    headers: { Accept: 'application/json', ...(user !== null ? { 'X-InkGroove-User': String(user) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response = await run();
  if (epoch !== identityGeneration() || signal.aborted) throw new ShareRequestError(0);
  if (response.status === 419) {
    const csrf = await fetch('/api/csrf-token', { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
    if (!csrf.ok) throw new ShareRequestError(csrf.status);
    const data = await csrf.json(); const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
    if (epoch !== identityGeneration() || signal.aborted) throw new ShareRequestError(0);
    if (meta && typeof data.csrf_token === 'string') meta.content = data.csrf_token;
    response = await run();
  }
  if (epoch !== identityGeneration() || signal.aborted) throw new ShareRequestError(0);
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  if (!response.ok) throw new ShareRequestError(response.status);
  // Body decoding can finish after a login/logout or an aborted grant scope.
  const current = () => { if (epoch !== identityGeneration() || signal.aborted) throw new ShareRequestError(0); };
  const json = response.json.bind(response);
  response.json = async () => { const value = await json(); current(); return value; };
  if (response.blob) { const blob = response.blob.bind(response); response.blob = async () => { const value = await blob(); current(); return value; }; }
  return response;
}

export default function VersionShareApp({ documentId, versionId, initialSecret, wizard = false, versionLabel, onDone }: { documentId?: string; versionId?: string; initialSecret: string; wizard?: boolean; versionLabel?: string; onDone?: () => void }) {
  const [english, setEnglish] = useState(document.documentElement.lang === 'en');
  const tr = (es: string, en: string) => english ? en : es;
  const secret = useRef(initialSecret);
  const snapshots = useRef(new Map<number, string>());
  const remember = (reading: Reading) => {
    for (const e of reading.events) snapshots.current.set(e.id, e.html);
    while (snapshots.current.size > 64) snapshots.current.delete(snapshots.current.keys().next().value!);
  };
  const [frame, setFrame] = useState<{id:number;html:string} | null>(null);
  const lifetime = useRef(new AbortController());
  const pending = useRef<AbortController | null>(null);
  const pdfPending = useRef<AbortController | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [step, setStep] = useState(0);
  const wizardForm = useRef<HTMLFormElement | null>(null);
  useEffect(() => { if (wizard) [...(wizardForm.current?.querySelectorAll<HTMLElement>('select, input, textarea, button') ?? [])].find(el => !el.closest('[hidden]'))?.focus(); }, [wizard, step]);
  const [pdfReady, setPdfReady] = useState<Blob | null>(null);
  const done = () => onDone ? onDone() : location.assign('/deliveries/sent');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    const clear = () => { secret.current = ''; snapshots.current.clear(); setFrame(null); lifetime.current.abort(); pending.current?.abort(); pdfPending.current?.abort(); setCard(null); setIssued(null); setPdfReady(null); };
    window.addEventListener('pagehide', clear);
    const accountChanged = (e: StorageEvent) => { if (e.key === 'veritas:auth-generation' && documentId) clear(); };
    const expired = () => { if (documentId) clear(); };
    window.addEventListener('storage', accountChanged); window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => { window.removeEventListener('pagehide', clear); window.removeEventListener('storage', accountChanged); window.removeEventListener(SESSION_EXPIRED_EVENT, expired); lifetime.current.abort(); pending.current?.abort(); pdfPending.current?.abort(); secret.current = ''; };
  }, []);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [level, setLevel] = useState<1 | 2 | 3>(2); const [days, setDays] = useState<number | null>(7); const [label, setLabel] = useState('');
  const operation = useRef<{ key: string; fingerprint: string } | null>(null);
  const submitting = useRef(false);
  const [emails, setEmails] = useState('');
  const [mode, setMode] = useState('restricted'); const [accepted, setAccepted] = useState(false);
  const resultSection = useRef<HTMLElement | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  useEffect(() => { if (wizard && issued) (resultSection.current?.querySelector<HTMLElement>('input, button') ?? resultSection.current)?.focus(); }, [wizard, issued?.grant.id, issued?.url]); const [copied, setCopied] = useState(false);
  const [audit, setAudit] = useState<{ accounts: { user_id: number; name: string; email: string; first_seen: string; last_seen: string; access_count: number }[]; next_after: number | null; grant: string } | null>(null);
  const [card, setCard] = useState<Card | null>(null); const [position, setPosition] = useState(-1); const [playing, setPlaying] = useState(false);
  const [cursors, setCursors] = useState<number[]>([0]);
  const base = `/process-summary/share/manage/${encodeURIComponent(documentId ?? '')}/${encodeURIComponent(versionId ?? '')}`;
  const owner = !!documentId && !!versionId;
  const refresh = async () => {
    const r = await shareRequest(base + '/grants', lifetime.current.signal); const data = await r.json();
    if (!lifetime.current.signal.aborted) { setGrants(data.grants); }
  };
  useEffect(() => { if (owner) void refresh().catch(() => setError('No disponible / Unavailable')); }, [base, owner]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { if (!lifetime.current.signal.aborted) setError(e instanceof ShareRequestError && e.status === 422 ? tr('Selección no disponible. En esta fase todos los destinatarios deben tener una cuenta existente. No se envían invitaciones.', 'Selection unavailable. All recipients must have an existing account in this phase. No invitations are sent.') : e instanceof ShareRequestError && e.status === 401 ? tr('Inicia sesión en otra pestaña y reintenta. También puedes volver a abrir el enlace original tras entrar.', 'Sign in in another tab and retry. You can also reopen the original link after signing in.') : tr('No disponible. Comprueba permisos, caducidad y formato; puedes reintentar.', 'Unavailable. Check permissions, expiry and format; you can retry.')); }
    finally { if (!lifetime.current.signal.aborted) setBusy(false); }
  };
  const query = async (after = 0, stack = [0], append = false) => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    if (!append) { snapshots.current.clear(); setFrame(null); setCard(null); setPlaying(false); setPosition(-1); }
    let success = false;
    await action(async () => {
      const r = await shareRequest('/process-summary/share/query', controller.signal, { capability: secret.current, after });
      const data = await r.json();
      if (controller.signal.aborted || lifetime.current.signal.aborted) return;
      if (append && data.reading && (data.reading.events.some((e: Reading['events'][number]) => e.id <= after) || (data.reading.next_after !== null && data.reading.next_after <= after) || data.reading.snapshot_html !== card?.reading?.snapshot_html)) throw new ShareRequestError(409);
      if (data.reading) { remember(data.reading); data.reading.events = data.reading.events.map((e: Reading['events'][number]) => ({ ...e, html: '' })); }
      if (!controller.signal.aborted && !lifetime.current.signal.aborted) { setCard(old => append && old?.reading && data.reading ? { ...data, reading: { ...data.reading, events: [...old.reading.events, ...data.reading.events] } } : data); setCursors(stack); success = true; }
    });
    if (!success) { setPlaying(false); setCard(null); snapshots.current.clear(); setFrame(null); }
    return success;
  };
  const event = card?.reading?.events[position];
  useEffect(() => {
    setFrame(null); if (!event) return;
    const c = new AbortController();
    const cached = snapshots.current.get(event.id);
    if (cached !== undefined) { setFrame({id:event.id,html:cached}); return; }
    void shareRequest('/process-summary/share/event', c.signal, {capability:secret.current,event:event.id}).then(r => r.json()).then((page: Reading) => {
      if (c.signal.aborted || lifetime.current.signal.aborted) return;
      const found = page.events.find(e => e.id === event.id); if (!found) throw Error('Unavailable');
      remember(page); setFrame({id:event.id,html:found.html});
    }).catch(() => { if (!c.signal.aborted && !lifetime.current.signal.aborted) { setCard(null); snapshots.current.clear(); setPlaying(false); setError(tr('Evento no disponible. Reintenta la consulta.', 'Event unavailable. Retry the query.')); } });
    return () => c.abort();
  }, [event?.id]);
  const readImage = useCallback(async (id: string, signal: AbortSignal) => {
    const r = await shareRequest('/process-summary/share/image', signal, { capability: secret.current, image: id, ...(event ? { event: event.id } : {}) });
    return r.blob();
  }, [event?.id]);
  useEffect(() => {
    if (!playing || busy || !card?.reading || (event && frame?.id !== event.id)) return;
    const timer = setTimeout(() => {
      if (position + 1 < card.reading!.events.length) setPosition(position + 1);
      else if (card.reading!.next_after !== null) void query(card.reading!.next_after, [...cursors, card.reading!.next_after], true);
      else setPlaying(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [playing, position, card, cursors, busy, frame, event?.id]);
  const issue = async () => {
    if (submitting.current) return;
    submitting.current = true;
    const input = { level, days, label: label || null, ...(level === 3 ? { audience_mode: mode, ...(mode === 'restricted' ? { recipient_emails: emails.split(/[;,\s]+/).filter(Boolean) } : { forwardable_accepted: accepted }) } : {}) };
    const fingerprint = JSON.stringify(input);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { key: crypto.randomUUID(), fingerprint };
    try { await action(async () => {
      pdfPending.current?.abort(); setPdfError(''); setPdfReady(null); setIssued(null); setCopied(false);
      const r = await shareRequest(base + '/grants', lifetime.current.signal, { ...input, operation_key: operation.current!.key });
      const value = await r.json(); if (lifetime.current.signal.aborted) return;
      setIssued(value); if (!wizard) await refresh();
      window.dispatchEvent(new Event('inkgroove:shares-updated'));
    }); } finally { submitting.current = false; }
  };
  const pdf = async (download = true) => {
    pdfPending.current?.abort();
    const controller = new AbortController(); pdfPending.current = controller;
    const cancel = () => controller.abort();
    lifetime.current.signal.addEventListener('abort', cancel, { once: true });
    setBusy(true); setPdfError('');
    try {
    if (!issued?.url) return;
    // Only the authenticated version source can supply the downloaded full text.
    // The QR/query capability remains independently limited by VersionShareGate.
    const r = await shareRequest(`/api/documents/${documentId}/versions/${versionId}/pdf-source`, controller.signal);
    const full: PdfSource = await r.json(); if (full.version_id !== versionId) throw new SharePdfError('content');
    const source: PdfSource = { ...full, title_at_issue: issued.grant.display_title_at_issue, share: { url: issued.url, level: issued.grant.level, expires_at: issued.grant.expires_at } };
    const blob = await sharePdf(source, english, controller.signal);
    if (controller.signal.aborted) return;
    setPdfReady(blob);
    if (download) { downloadSharePdf(blob, `${source.certificate_code}-${issued.grant.id}.pdf`, controller.signal); if (wizard) done(); }
    } catch (e) {
      if (!lifetime.current.signal.aborted) {
        const messages = {
          content: tr('Contenido o fuente no exportable.', 'Content or font cannot be exported.'),
          worker: tr('Worker PDF no disponible o con error.', 'PDF Worker unavailable or failed.'),
          timeout: tr('Se agotó el tiempo para generar el PDF. Reintenta.', 'PDF generation timed out. Retry.'),
          cancelled: tr('Exportación cancelada.', 'Export cancelled.'),
          download: tr('Descarga no iniciada. Reintenta.', 'Download not initiated. Retry.'),
        };
        setPdfError(controller.signal.aborted ? messages.cancelled : e instanceof SharePdfError ? messages[e.code] : e instanceof ShareRequestError
          ? tr('La solicitud HTTP del PDF fue rechazada. Comprueba sesión y permisos.', 'The PDF HTTP request was rejected. Check session and permissions.')
          : tr('No se pudo obtener la fuente del PDF.', 'Could not retrieve the PDF source.'));
      }
    } finally { lifetime.current.signal.removeEventListener('abort', cancel); if (!lifetime.current.signal.aborted) setBusy(false); }
  };
  const downloadReady = () => {
    if (!pdfReady) { void pdf(false); return; }
    try { downloadSharePdf(pdfReady, `InkGroove-${versionId}.pdf`, lifetime.current.signal); if (wizard) done(); }
    catch { setPdfError(tr('Descarga no iniciada. Reintenta.', 'Download not initiated. Retry.')); }
  };
  useEffect(() => { if (wizard && issued?.url) void pdf(false); }, [issued?.url, wizard]);
  const Container = wizard ? 'div' : 'main';
  return <Container className="version-share-app">{!wizard && <header><b>InkGroove</b><label>{tr('Idioma', 'Language')} <select aria-label="ES/EN" value={english ? 'en' : 'es'} onChange={e => { setEnglish(e.target.value === 'en'); setLocale(e.target.value === 'en' ? 'en' : 'es'); }}><option value="es">ES</option><option value="en">EN</option></select></label></header>}
    {!wizard && <h1>{tr('Versión sellada', 'Sealed version')}</h1>}<p>{tr('Consulta de una versión inmutable. El documento en edición permanece privado.', 'Consult an immutable version. The document being edited remains private.')}</p>
    {owner ? <>
      {!wizard && <h2>{tr('Emitir / compartir', 'Issue / share')}</h2>}
      {wizard && !issued && <ol className="emission-steps" aria-label={tr('Pasos de emisión', 'Issue steps')}>{[tr('Versión', 'Version'), tr('Nivel', 'Level'), tr('Opciones / destinatarios', 'Options / recipients'), tr('Confirmación', 'Confirmation')].map((s,i) => <li key={i} aria-current={i === step ? 'step' : undefined} data-complete={i < step}>{i < step ? '✓ ' : `${i + 1}. `}{s}</li>)}</ol>}
      <form ref={wizardForm} hidden={!!issued && wizard} onSubmit={e => { e.preventDefault(); if (!wizard || step === 3) void issue(); }}>
        {wizard && step === 0 && <p>{tr('Versión sellada exacta', 'Exact sealed version')}: {versionLabel ?? versionId}</p>}
        <fieldset hidden={wizard && step !== 1}><legend>{tr('Nivel', 'Level')}</legend>
        <label>{tr('Nivel fijo', 'Fixed level')} <select value={level} onChange={e => setLevel(Number(e.target.value) as 1 | 2 | 3)}><option value="1">1 · {tr('Sello', 'Seal')}</option><option value="2">2 · {tr('Sello y conteos', 'Seal and counts')}</option><option value="3">3 · {tr('Texto y moviola con cuenta', 'Text and replay with account')}</option></select></label>
        </fieldset><fieldset hidden={wizard && step !== 2}><legend>{tr('Opciones / destinatarios', 'Options / recipients')}</legend>
        <label>{tr('Etiqueta opcional', 'Optional label')} <input maxLength={120} value={label} onChange={e => setLabel(e.target.value)} /></label>
        <label>{tr('Caducidad', 'Expiry')} <select value={days === null ? 'never' : String(days)} onChange={e => setDays(e.target.value === 'never' ? null : Number(e.target.value))}><option value="never">{tr('Nunca caduca', 'Never expires')}</option>{Array.from({length: 30}, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} {tr('días', 'days')}</option>)}</select></label>
        <p>{tr('Nunca significa sin expiración automática; no garantiza acceso ni perpetuidad del servicio. Siempre puede revocarse.', 'Never means no automatic expiry; access and service availability are not guaranteed forever. It can always be revoked.')}</p>
        {level === 3 && <fieldset><legend>{tr('Audiencia', 'Audience')}</legend><label><input type="radio" name="audience" checked={mode === 'restricted'} onChange={() => { setMode('restricted'); setAccepted(false); }} />{tr('Cuentas existentes elegidas por correo', 'Existing accounts selected by email')}</label><label><input type="radio" name="audience" checked={mode === 'signed_in_link'} onChange={() => setMode('signed_in_link')} />{tr('Avanzado: cualquier cuenta autenticada con el enlace', 'Advanced: any signed-in account with the link')}</label>
          {mode === 'restricted' ? <label>{tr('Correos de destinatarios (separados por espacios o comas)', 'Recipient emails (separated by spaces or commas)')}<textarea required value={emails} onChange={e => setEmails(e.target.value)} /></label> : <label><input type="checkbox" required checked={accepted} onChange={e => setAccepted(e.target.checked)} />{tr('Acepto que el enlace reenviado permita consultar a cualquier cuenta autenticada.', 'I accept that forwarding the link permits access by any signed-in account.')}</label>}
        </fieldset>}
        </fieldset>
        {(!wizard || step === 3) && <><p><strong>{versionLabel ?? versionId}</strong> · {tr('Nivel', 'Level')} {level} · {days === null ? tr('Nunca caduca', 'Never expires') : `${days} ${tr('días', 'days')}`} {level === 3 ? ` · ${mode === 'restricted' ? emails : tr('Cualquier cuenta con el enlace', 'Any account with the link')}` : ` · ${tr('Verificación pública', 'Public verification')}`}</p><p>{tr('Cada emisión tiene nivel fijo y revocación independiente. El enlace y el QR pueden reenviarse. Sólo se muestra una vez: copia y descarga el PDF ahora; después tendrás que emitir otro. El inventario no conserva el secreto ni acredita que hayas descargado el PDF.', 'Each issue has a fixed level and independent revocation. The link and QR can be forwarded. Shown once: copy and download the PDF now; later you must issue another. The inventory retains no secret and does not prove a PDF download.')}</p>
        <p role="note">{tr('El PDF incluye el texto íntegro. Cualquiera que lo reciba puede leerlo y conservarlo. Revocar sólo desactiva la consulta en línea del QR/enlace', 'The PDF includes the full text. Anyone receiving it can read and retain it. Revoking only disables online consultation through the QR/link')}{level === 3 ? tr('. El lector en línea y la moviola requieren autorización.', '. The online reader and replay require authorization.') : ''}</p></>}
        {wizard && step > 0 && <button type="button" disabled={busy} onClick={() => setStep(step - 1)}>{tr('Atrás', 'Back')}</button>}
        {wizard && step < 3 ? <button className="primary" type="button" disabled={busy || (step === 2 && level === 3 && (mode === 'restricted' ? !emails.trim() : !accepted))} onClick={e => { if (step !== 2 || e.currentTarget.form?.reportValidity()) setStep(step + 1); }}>{tr('Continuar', 'Continue')}</button> : <button disabled={busy || (level === 3 && (mode === 'restricted' ? !emails.trim() : !accepted))}>{tr('Emitir / compartir', 'Issue / share')}</button>}
      </form>
      {issued && !issued.url && <section ref={resultSection} tabIndex={-1} role="status"><p>{tr("La operación ya se completó. El enlace portador no se puede recuperar. Revisa o revoca la concesión antes de crear otra deliberadamente.", "The operation already completed. The bearer link cannot be recovered. Review or revoke the grant before deliberately creating another.")}</p><button onClick={() => { operation.current = null; setIssued(null); }}>{tr("Preparar una nueva compartición", "Prepare a new share")}</button><button onClick={done}>{tr('Ver en Enviadas', 'View Sent')}</button></section>}
      {issued?.url && <section ref={resultSection} tabIndex={-1} aria-label={tr('Enlace de una sola vez', 'One-time link')}><h2>{tr('Guárdalo ahora', 'Save it now')}</h2><p>{issued.grant.expires_at === null ? tr('Nunca caduca automáticamente; sigue siendo revocable.', 'Never expires automatically; remains revocable.') : new Date(issued.grant.expires_at).toLocaleString(english ? 'en-GB' : 'es-ES')}</p><input readOnly aria-label={tr('Enlace', 'Link')} value={issued.url} /><button disabled={busy} onClick={() => void action(async () => { await navigator.clipboard.writeText(issued.url!); if (!lifetime.current.signal.aborted) setCopied(true); })}>{tr('Copiar enlace', 'Copy link')}</button><span role="status">{copied ? tr('Copiado', 'Copied') : ''}</span><button disabled={busy} onClick={downloadReady}>{pdfReady ? tr('PDF listo · Descargar documento completo', 'PDF ready · Download full document') : tr('Preparar PDF completo / Reintentar', 'Prepare full PDF / Retry')}</button>{pdfError && <p role="alert">{pdfError}</p>}{busy && <button onClick={() => pdfPending.current?.abort()}>{tr('Cancelar PDF', 'Cancel PDF')}</button>}<button disabled={busy} onClick={done}>{tr('Terminar · Ver en Enviadas', 'Finish · View Sent')}</button></section>}
      {!wizard && <><p><a href="/deliveries/sent">{tr('Ir a Entregas: Recibidas y Enviadas', 'Go to Deliveries: Received and Sent')}</a></p><h2>{tr('Inventario de concesiones emitidas', 'Issued grants')}</h2><button disabled={busy} onClick={() => void action(refresh)}>{tr('Actualizar', 'Refresh')}</button>
      <ul>{grants.map(g => <li key={g.id}><b>{g.label ?? g.id}</b> · {tr('Nivel', 'Level')} {g.level} · {g.audience_mode ?? tr('Sin cuenta', 'No account')} · {new Date(g.created_at).toLocaleString(english ? 'en-GB' : 'es-ES')} · {g.expires_at === null ? tr('Nunca caduca', 'Never expires') : new Date(g.expires_at).toLocaleString(english ? 'en-GB' : 'es-ES')} · {g.state}<p>{tr('Secreto no recuperable. Para otro PDF con QR, emite otra concesión.', 'Secret cannot be recovered. Issue another grant for another PDF with QR.')}</p><button disabled={busy || g.state === 'revoked'} onClick={() => void action(async () => { await shareRequest(base + `/grants/${g.id}/revoke`, lifetime.current.signal, {}); if (issued?.grant.id === g.id) setIssued(null); await refresh(); })}>{tr('Revocar', 'Revoke')}</button>{g.level === 3 && <button disabled={busy} onClick={() => void action(async () => { const r = await shareRequest(base + `/grants/${g.id}/accesses`, lifetime.current.signal); const data = await r.json(); if (!lifetime.current.signal.aborted) setAudit({ ...data, grant: g.id }); })}>{tr('Respuestas autorizadas', 'Authorized responses')}</button>}</li>)}</ul>
      {audit && <section><h2>{tr('Registro por cuenta', 'Account record')}</h2><p>{tr('Primera/última respuesta autorizada y contador. No demuestra lectura humana; incluye páginas e imágenes. Sin IP, UA ni escritura.', 'First/last authorized response and count. Does not prove human reading; includes pages and images. No IP, UA or writing.')}</p>{audit.accounts.map(a => <p key={a.user_id}>{a.name} · {a.email} · {a.first_seen} → {a.last_seen} · {a.access_count}</p>)}{audit.next_after !== null && <button onClick={() => void action(async () => { const r = await shareRequest(base + `/grants/${audit.grant}/accesses?after=${audit.next_after}`, lifetime.current.signal); const data = await r.json(); if (!lifetime.current.signal.aborted) setAudit({ ...data, grant: audit.grant }); })}>{tr('Siguiente página', 'Next page')}</button>}</section>}
      </>}
    </> : <>
      <p>{tr('En nivel 3 el autor verá tu cuenta, primera/última respuesta autorizada y contador (también páginas e imágenes); esto no prueba lectura. No se registra IP, navegador ni escritura.', 'At level 3 the author sees your account, first/last authorized response and count (including pages and images); this does not prove reading. No IP, browser or writing is recorded.')}</p>
      <p><a href="/" target="_blank" rel="noopener noreferrer">{tr('Iniciar sesión en otra pestaña', 'Sign in in another tab')}</a>. {tr('El secreto permanece sólo en memoria de esta pestaña. Después de entrar, reintenta aquí o vuelve a abrir el enlace original. Recargar exige reabrirlo.', 'The secret stays only in this tab’s memory. After signing in, retry here or reopen the original link. Reloading requires reopening it.')}</p>
      <button disabled={busy} onClick={() => void query()}>{tr('Consultar / Reintentar', 'Consult / Retry')}</button>
      {card && <section><h2>{card.seal.certificate_code} · {tr('Versión', 'Version')} {card.seal.version_number ?? '—'} · {tr('Nivel fijo', 'Fixed level')} {card.level}</h2><p>{card.seal.issued_at} · {card.seal.valid ? tr('Firma del payload válida', 'Valid payload signature') : tr('No válido', 'Invalid')}</p><p>{tr('El sello acredita el registro recibido; no autoría humana ni los bytes de un PDF.', 'The seal attests the received record; not human authorship or PDF bytes.')}</p>
        {card.expires_at !== undefined && <p>{card.expires_at === null ? tr('Nunca caduca automáticamente; sigue siendo revocable.', 'Never expires automatically; remains revocable.') : `${tr('Caduca:', 'Expires:')} ${new Date(card.expires_at).toLocaleString(english ? 'en-GB' : 'es-ES')}`}</p>}
        {card.summary && <><p>{card.summary.coverage.status} · complete={String(card.summary.coverage.complete)}</p><p>{card.summary.counts.value ? Object.entries(card.summary.counts.value).map(([k, v]) => `${({ direct: tr('Directas', 'Direct'), pasted: tr('Pegadas', 'Pasted'), edited: tr('Reelaboradas', 'Edited'), total: 'Total' } as Record<string, string>)[k]}: ${v}`).join(' · ') : tr('Conteos no disponibles', 'Counts unavailable')}</p><p>{tr('Tiempos, pausas y PPM históricos no disponibles. V2 tiene alcance limitado.', 'Historical times, pauses and PPM unavailable. V2 has limited scope.')}</p></>}
        {card.reading && <><h3>{tr('Consulta de texto y moviola sellada', 'Sealed text and replay')}</h3><p>{tr('Orden de almacenamiento, no cronología global autenticada. Sólo prefijos de esta versión; sin escrituras.', 'Storage order, not authenticated global chronology. Only this version’s prefixes; no writing.')}</p>
          <button onClick={() => { setPosition(-1); setPlaying(false); }}>{tr('Texto sellado', 'Sealed text')}</button><button disabled={position < 0} onClick={() => { setPosition(position - 1); setPlaying(false); }}>{tr('Anterior', 'Previous')}</button><button disabled={busy || (position + 1 >= card.reading.events.length && card.reading.next_after === null)} onClick={() => { setPlaying(false); if (position + 1 < card.reading!.events.length) setPosition(position + 1); else void query(card.reading!.next_after!, [...cursors, card.reading!.next_after!], true).then(ok => { if (ok) setPosition(position + 1); }); }}>{tr('Siguiente evento', 'Next event')}</button><button disabled={!card.reading.events.length} onClick={() => setPlaying(!playing)}>{playing ? tr('Pausa', 'Pause') : tr('Reproducir', 'Play')}</button>
          <p role="status">{card.reading.events.length} {tr('cargados', 'loaded')} / {card.reading.total_events ?? '…'} · {card.reading.next_after === null ? tr('Fin del historial sellado disponible', 'End of available sealed history') : tr('Hay más historial sellado', 'More sealed history available')}{!card.reading.coverage.complete && ` · ${tr('Historial parcial', 'Partial history')}`}</p>
          <label>{tr('Posición global cargada', 'Loaded global position')}<input type="range" min={-1} max={card.reading.events.length - 1} value={position} onChange={e => { setPlaying(false); setPosition(Number(e.target.value)); }} /></label>
          <p role="status">{event ? `${tr('Evento', 'Event')} ${event.id} · ${event.sequence}` : tr('Instantánea sellada', 'Sealed snapshot')}</p>
          {event && frame?.id !== event.id && <p role="status">{tr('Cargando evento…', 'Loading event…')}</p>}
          <SealedReading key={event?.id ?? 'snapshot'} html={event ? frame?.id === event.id ? frame.html : '' : card.reading.snapshot_html} read={readImage} />
          <button disabled={busy || position <= 0} onClick={() => { setPlaying(false); setPosition(Math.max(0, position - 32)); }}>{tr('Página anterior', 'Previous page')}</button><button disabled={busy || card.reading.next_after === null} onClick={() => void query(card.reading!.next_after!, [...cursors, card.reading!.next_after!], true)}>{tr('Más historial sellado', 'More sealed history')}</button>
        </>}
      </section>}
    </>}
    {busy && <p role="status">{tr('Cargando…', 'Loading…')}</p>}{error && <p role="alert">{error}</p>}
  </Container>;
}
