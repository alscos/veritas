import { useCallback, useEffect, useRef, useState } from 'react';
import SealedReading from './SealedReading';
import { sharePdf, SharePdfError, downloadSharePdf } from './sharePdf';
import type { PdfSource } from './sealedPdf';

type Grant = { id: string; level: 1 | 2 | 3; audience_mode: string | null; label: string | null; state: string; created_at: string; expires_at: string; revoked_at: string | null };
type Recipient = { id: number; name: string; email: string };
type Issued = { grant: Grant; url: string };
type Reading = { snapshot_html: string; events: { id: number; sequence: number; html: string }[]; next_after: number | null; coverage: { status: string; complete: boolean } };
type Card = { level: number; seal: { certificate_code: string; version_number: number | null; valid: boolean; scope: string; issued_at: string }; summary?: { coverage: { status: string; complete: boolean }; counts: { value: { direct: number; pasted: number; edited: number; total: number } | null } }; reading?: Reading };
export class ShareRequestError extends Error { constructor(public status: number) { super('Unavailable'); } }
export async function shareRequest(path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  const run = () => fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response = await run();
  if (response.status === 419) {
    const csrf = await fetch('/api/csrf-token', { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
    if (!csrf.ok) throw new ShareRequestError(csrf.status);
    const data = await csrf.json(); const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
    if (meta && typeof data.csrf_token === 'string') meta.content = data.csrf_token;
    response = await run();
  }
  if (!response.ok) throw new ShareRequestError(response.status);
  return response;
}

export default function VersionShareApp({ documentId, versionId, initialSecret }: { documentId?: string; versionId?: string; initialSecret: string }) {
  const [english, setEnglish] = useState(document.documentElement.lang === 'en');
  const tr = (es: string, en: string) => english ? en : es;
  const secret = useRef(initialSecret);
  const lifetime = useRef(new AbortController());
  const pending = useRef<AbortController | null>(null);
  const pdfPending = useRef<AbortController | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    const clear = () => { secret.current = ''; lifetime.current.abort(); pending.current?.abort(); pdfPending.current?.abort(); setCard(null); setIssued(null); };
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); lifetime.current.abort(); pending.current?.abort(); pdfPending.current?.abort(); secret.current = ''; };
  }, []);
  const [grants, setGrants] = useState<Grant[]>([]); const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [level, setLevel] = useState<1 | 2 | 3>(2); const [days, setDays] = useState(7); const [label, setLabel] = useState('');
  const [mode, setMode] = useState('restricted'); const [accepted, setAccepted] = useState(false); const [selected, setSelected] = useState<number[]>([]);
  const [issued, setIssued] = useState<Issued | null>(null); const [copied, setCopied] = useState(false);
  const [audit, setAudit] = useState<{ accounts: { user_id: number; name: string; email: string; first_seen: string; last_seen: string; access_count: number }[]; next_after: number | null; grant: string } | null>(null);
  const [card, setCard] = useState<Card | null>(null); const [position, setPosition] = useState(-1); const [playing, setPlaying] = useState(false);
  const [cursors, setCursors] = useState<number[]>([0]);
  const base = `/process-summary/share/manage/${encodeURIComponent(documentId ?? '')}/${encodeURIComponent(versionId ?? '')}`;
  const owner = !!documentId && !!versionId;
  const refresh = async () => {
    const r = await shareRequest(base + '/grants', lifetime.current.signal); const data = await r.json();
    if (!lifetime.current.signal.aborted) { setGrants(data.grants); setRecipients(data.recipients); }
  };
  useEffect(() => { if (owner) void refresh().catch(() => setError('No disponible / Unavailable')); }, [base, owner]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { if (!lifetime.current.signal.aborted) setError(e instanceof ShareRequestError && e.status === 401 ? tr('Inicia sesión en otra pestaña y reintenta. También puedes volver a abrir el enlace original tras entrar.', 'Sign in in another tab and retry. You can also reopen the original link after signing in.') : tr('No disponible. Comprueba permisos, caducidad y formato; puedes reintentar.', 'Unavailable. Check permissions, expiry and format; you can retry.')); }
    finally { if (!lifetime.current.signal.aborted) setBusy(false); }
  };
  const query = async (after = 0, stack = [0]) => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setCard(null); setPlaying(false); setPosition(-1);
    await action(async () => {
      const r = await shareRequest('/process-summary/share/query', controller.signal, { capability: secret.current, after });
      const data = await r.json();
      if (!controller.signal.aborted && !lifetime.current.signal.aborted) { setCard(data); setCursors(stack); }
    });
  };
  const event = card?.reading?.events[position];
  const readImage = useCallback(async (id: string, signal: AbortSignal) => {
    const r = await shareRequest('/process-summary/share/image', signal, { capability: secret.current, image: id, ...(event ? { event: event.id } : {}) });
    return r.blob();
  }, [event?.id]);
  useEffect(() => {
    if (!playing || !card?.reading) return;
    const timer = setTimeout(() => {
      if (position + 1 < card.reading!.events.length) setPosition(position + 1);
      else if (card.reading!.next_after !== null) void query(card.reading!.next_after, [...cursors, card.reading!.next_after]);
      else setPlaying(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [playing, position, card, cursors]);
  const issue = () => action(async () => {
    pdfPending.current?.abort(); setPdfError(''); setIssued(null); setCopied(false);
    const r = await shareRequest(base + '/grants', lifetime.current.signal, { level, days, label: label || null, ...(level === 3 ? { audience_mode: mode, ...(mode === 'restricted' ? { recipient_ids: selected } : { forwardable_accepted: accepted }) } : {}) });
    const value = await r.json(); if (lifetime.current.signal.aborted) return; setIssued(value); await refresh();
  });
  const pdf = async () => {
    pdfPending.current?.abort();
    const controller = new AbortController(); pdfPending.current = controller;
    const cancel = () => controller.abort();
    lifetime.current.signal.addEventListener('abort', cancel, { once: true });
    setBusy(true); setPdfError('');
    try {
    if (!issued) return;
    const r = await shareRequest(`/api/documents/${documentId}/versions/${versionId}/pdf-source`, controller.signal);
    const source: PdfSource = await r.json(); if (source.version_id !== versionId) throw new SharePdfError('content');
    const blob = await sharePdf({ ...source, share: { url: issued.url, level: issued.grant.level, expires_at: issued.grant.expires_at } }, english, controller.signal);
    if (controller.signal.aborted) return;
    downloadSharePdf(blob, `${source.certificate_code}-${issued.grant.id}.pdf`, controller.signal);
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
  return <main className="version-share-app"><header><b>InkGroove</b><label>{tr('Idioma', 'Language')} <select aria-label="ES/EN" value={english ? 'en' : 'es'} onChange={e => { setEnglish(e.target.value === 'en'); document.documentElement.lang = e.target.value; }}><option value="es">ES</option><option value="en">EN</option></select></label></header>
    <h1>{tr('Versión sellada', 'Sealed version')}</h1><p>{tr('Consulta de una versión inmutable. El documento en edición permanece privado.', 'Consult an immutable version. The document being edited remains private.')}</p>
    {owner ? <>
      <h2>{tr('Emitir enlace y PDF independientes', 'Issue an independent link and PDF')}</h2>
      <form onSubmit={e => { e.preventDefault(); void issue(); }}>
        <label>{tr('Nivel fijo', 'Fixed level')} <select value={level} onChange={e => setLevel(Number(e.target.value) as 1 | 2 | 3)}><option value="1">1 · {tr('Sello', 'Seal')}</option><option value="2">2 · {tr('Sello y conteos', 'Seal and counts')}</option><option value="3">3 · {tr('Texto y moviola con cuenta', 'Text and replay with account')}</option></select></label>
        <label>{tr('Etiqueta opcional', 'Optional label')} <input maxLength={120} value={label} onChange={e => setLabel(e.target.value)} /></label>
        <label>{tr('Caduca en días (1–30)', 'Expires in days (1–30)')} <input type="number" min="1" max="30" required value={days} onChange={e => setDays(Number(e.target.value))} /></label>
        {level === 3 && <fieldset><legend>{tr('Audiencia', 'Audience')}</legend><label><input type="radio" name="audience" checked={mode === 'restricted'} onChange={() => { setMode('restricted'); setAccepted(false); }} />{tr('Sólo cuentas seleccionadas de Entregas de esta versión', 'Only selected accounts from submissions of this version')}</label><label><input type="radio" name="audience" checked={mode === 'signed_in_link'} onChange={() => setMode('signed_in_link')} />{tr('Cualquier cuenta autenticada con el enlace', 'Any signed-in account with the link')}</label>
          {mode === 'restricted' ? <><p>{tr('Selecciona al menos una cuenta. Una Entrega por sí sola no da acceso.', 'Select at least one account. A submission alone does not grant access.')}</p>{recipients.map(r => <label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))} />{r.name} · {r.email}</label>)}</> : <label><input type="checkbox" required checked={accepted} onChange={e => setAccepted(e.target.checked)} />{tr('Acepto que el enlace reenviado permita consultar a cualquier cuenta autenticada.', 'I accept that forwarding the link permits access by any signed-in account.')}</label>}
        </fieldset>}
        <p>{tr('Cada emisión tiene nivel fijo y revocación independiente. El enlace y el QR pueden reenviarse. Sólo se muestra una vez: copia y descarga el PDF ahora; después tendrás que emitir otro. El inventario no conserva el secreto ni acredita que hayas descargado el PDF.', 'Each issue has a fixed level and independent revocation. The link and QR can be forwarded. Shown once: copy and download the PDF now; later you must issue another. The inventory retains no secret and does not prove a PDF download.')}</p>
        <button disabled={busy || (level === 3 && (mode === 'restricted' ? selected.length === 0 : !accepted))}>{tr('Emitir concesión', 'Issue grant')}</button>
      </form>
      {issued && <section aria-label={tr('Enlace de una sola vez', 'One-time link')}><h2>{tr('Guárdalo ahora', 'Save it now')}</h2><input readOnly aria-label={tr('Enlace', 'Link')} value={issued.url} /><button disabled={busy} onClick={() => void action(async () => { await navigator.clipboard.writeText(issued.url); if (!lifetime.current.signal.aborted) setCopied(true); })}>{tr('Copiar enlace', 'Copy link')}</button><span role="status">{copied ? tr('Copiado', 'Copied') : ''}</span><button disabled={busy} onClick={() => void pdf()}>{tr('Descargar PDF de esta concesión', 'Download this grant’s PDF')}</button>{pdfError && <p role="alert">{pdfError}</p>}{busy && <button onClick={() => pdfPending.current?.abort()}>{tr('Cancelar PDF', 'Cancel PDF')}</button>}<button onClick={() => { pdfPending.current?.abort(); setIssued(null); }}>{tr('Ocultar secreto', 'Hide secret')}</button></section>}
      <h2>{tr('Inventario de concesiones emitidas', 'Issued grants')}</h2><button disabled={busy} onClick={() => void action(refresh)}>{tr('Actualizar', 'Refresh')}</button>
      <ul>{grants.map(g => <li key={g.id}><b>{g.label ?? g.id}</b> · {tr('Nivel', 'Level')} {g.level} · {g.audience_mode ?? tr('Sin cuenta', 'No account')} · {g.created_at} → {g.expires_at} · {g.state}<p>{tr('Secreto no recuperable. Para otro PDF con QR, emite otra concesión.', 'Secret cannot be recovered. Issue another grant for another PDF with QR.')}</p><button disabled={busy || g.state === 'revoked'} onClick={() => void action(async () => { await shareRequest(base + `/grants/${g.id}/revoke`, lifetime.current.signal, {}); if (issued?.grant.id === g.id) setIssued(null); await refresh(); })}>{tr('Revocar', 'Revoke')}</button>{g.level === 3 && <button disabled={busy} onClick={() => void action(async () => { const r = await shareRequest(base + `/grants/${g.id}/accesses`, lifetime.current.signal); const data = await r.json(); if (!lifetime.current.signal.aborted) setAudit({ ...data, grant: g.id }); })}>{tr('Respuestas autorizadas', 'Authorized responses')}</button>}</li>)}</ul>
      {audit && <section><h2>{tr('Registro por cuenta', 'Account record')}</h2><p>{tr('Primera/última respuesta autorizada y contador. No demuestra lectura humana; incluye páginas e imágenes. Sin IP, UA ni escritura.', 'First/last authorized response and count. Does not prove human reading; includes pages and images. No IP, UA or writing.')}</p>{audit.accounts.map(a => <p key={a.user_id}>{a.name} · {a.email} · {a.first_seen} → {a.last_seen} · {a.access_count}</p>)}{audit.next_after !== null && <button onClick={() => void action(async () => { const r = await shareRequest(base + `/grants/${audit.grant}/accesses?after=${audit.next_after}`, lifetime.current.signal); const data = await r.json(); if (!lifetime.current.signal.aborted) setAudit({ ...data, grant: audit.grant }); })}>{tr('Siguiente página', 'Next page')}</button>}</section>}
    </> : <>
      <p>{tr('En nivel 3 el autor verá tu cuenta, primera/última respuesta autorizada y contador (también páginas e imágenes); esto no prueba lectura. No se registra IP, navegador ni escritura.', 'At level 3 the author sees your account, first/last authorized response and count (including pages and images); this does not prove reading. No IP, browser or writing is recorded.')}</p>
      <p><a href="/" target="_blank" rel="noopener noreferrer">{tr('Iniciar sesión en otra pestaña', 'Sign in in another tab')}</a>. {tr('El secreto permanece sólo en memoria de esta pestaña. Después de entrar, reintenta aquí o vuelve a abrir el enlace original. Recargar exige reabrirlo.', 'The secret stays only in this tab’s memory. After signing in, retry here or reopen the original link. Reloading requires reopening it.')}</p>
      <button disabled={busy} onClick={() => void query()}>{tr('Consultar / Reintentar', 'Consult / Retry')}</button>
      {card && <section><h2>{card.seal.certificate_code} · {tr('Versión', 'Version')} {card.seal.version_number ?? '—'} · {tr('Nivel fijo', 'Fixed level')} {card.level}</h2><p>{card.seal.issued_at} · {card.seal.valid ? tr('Firma del payload válida', 'Valid payload signature') : tr('No válido', 'Invalid')}</p><p>{tr('El sello acredita el registro recibido; no autoría humana ni los bytes de un PDF.', 'The seal attests the received record; not human authorship or PDF bytes.')}</p>
        {card.summary && <><p>{card.summary.coverage.status} · complete={String(card.summary.coverage.complete)}</p><p>{card.summary.counts.value ? Object.entries(card.summary.counts.value).map(([k, v]) => `${({ direct: tr('Directas', 'Direct'), pasted: tr('Pegadas', 'Pasted'), edited: tr('Reelaboradas', 'Edited'), total: 'Total' } as Record<string, string>)[k]}: ${v}`).join(' · ') : tr('Conteos no disponibles', 'Counts unavailable')}</p><p>{tr('Tiempos, pausas y PPM históricos no disponibles. V2 tiene alcance limitado.', 'Historical times, pauses and PPM unavailable. V2 has limited scope.')}</p></>}
        {card.reading && <><h3>{tr('Consulta de texto y moviola sellada', 'Sealed text and replay')}</h3><p>{tr('Orden de almacenamiento, no cronología global autenticada. Sólo prefijos de esta versión; sin escrituras.', 'Storage order, not authenticated global chronology. Only this version’s prefixes; no writing.')}</p>
          <button onClick={() => { setPosition(-1); setPlaying(false); }}>{tr('Texto sellado', 'Sealed text')}</button><button disabled={position < 0} onClick={() => { setPosition(position - 1); setPlaying(false); }}>{tr('Anterior', 'Previous')}</button><button disabled={position + 1 >= card.reading.events.length} onClick={() => { setPosition(position + 1); setPlaying(false); }}>{tr('Siguiente evento', 'Next event')}</button><button disabled={!card.reading.events.length} onClick={() => setPlaying(!playing)}>{playing ? tr('Pausa', 'Pause') : tr('Reproducir', 'Play')}</button>
          <p role="status">{event ? `${tr('Evento', 'Event')} ${event.id} · ${event.sequence}` : tr('Instantánea sellada', 'Sealed snapshot')}</p>
          <SealedReading key={event?.id ?? 'snapshot'} html={event?.html ?? card.reading.snapshot_html} read={readImage} />
          <button disabled={busy || cursors.length < 2} onClick={() => void query(cursors[cursors.length - 2], cursors.slice(0, -1))}>{tr('Página anterior', 'Previous page')}</button><button disabled={busy || card.reading.next_after === null} onClick={() => void query(card.reading!.next_after!, [...cursors, card.reading!.next_after!])}>{tr('Página siguiente', 'Next page')}</button>
        </>}
      </section>}
    </>}
    {busy && <p role="status">{tr('Cargando…', 'Loading…')}</p>}{error && <p role="alert">{error}</p>}
  </main>;
}
