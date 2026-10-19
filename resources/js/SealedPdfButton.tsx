import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, identityGeneration } from './api';
import { getLocale, t } from './i18n';
import type { DocumentVersion } from './types';
import { preparePdfImages, sealedDefinition, PdfFontUnsupported, type PdfSource, type PdfPolicy } from './sealedPdf';

export default function SealedPdfButton({ documentId, versionId, versionNumber }: { documentId: string; versionId: string; versionNumber?: number }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [policy, setPolicy] = useState<PdfPolicy>('strict');
  const policyId = useId();
  const attempt = useRef(0); const cancel = useRef<(() => void) | null>(null);
  useEffect(() => { setBusy(false); setError(''); setPolicy('strict'); return () => { ++attempt.current; cancel.current?.(); }; }, [documentId, versionId]);
  const download = async () => {
    const current = ++attempt.current; const epoch = identityGeneration();
    const active = () => current === attempt.current && epoch === identityGeneration();
    setBusy(true); setError('');
    try {
      const source = await api<PdfSource>(`/documents/${documentId}/versions/${versionId}/pdf-source`);
      if (!active()) return;
      if (source.version_id !== versionId) throw new Error('Version mismatch');
      const prepared = await preparePdfImages(source); if (!active()) return;
      const definition = sealedDefinition(prepared, getLocale() === 'en', policy);
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const worker = new Worker(new URL('./sealedPdf.worker.ts', import.meta.url), { type: 'module' });
        const finish = () => { clearTimeout(timer); worker.terminate(); cancel.current = null; };
        const timer = setTimeout(() => { finish(); reject(new Error('PDF timeout')); }, 30000);
        cancel.current = () => { finish(); reject(new Error('PDF cancelled')); };
        worker.onerror = event => { event.preventDefault(); finish(); reject(new Error('PDF renderer')); };
        worker.onmessage = e => { finish(); if (e.data.bytes) resolve(e.data.bytes); else reject(new Error('PDF renderer')); };
        worker.postMessage(definition);
      });
      if (!active()) return;
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `${source.certificate_code}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { if (active()) setError(error instanceof PdfFontUnsupported ? error.message : t(error instanceof ApiError && error.status === 503 ? 'La descarga PDF requiere configurar el origen público de consulta.' : 'No se pudo preparar el PDF. La versión o su formato no están disponibles para exportar.')); }
    finally { if (current === attempt.current) setBusy(false); }
  };
  return <span className="sealed-pdf-action" aria-busy={busy}><label htmlFor={policyId}>{getLocale() === 'en' ? 'PDF presentation' : 'Presentación PDF'}</label><select id={policyId} disabled={busy} value={policy} onChange={e => setPolicy(e.target.value as PdfPolicy)}><option value="strict">{getLocale() === 'en' ? 'Current font catalog' : 'Catálogo de fuentes actual'}</option><option value="historical">{getLocale() === 'en' ? 'Historical PDF · approximate presentation' : 'PDF histórico · presentación aproximada'}</option></select>{policy === 'historical' && <small>{getLocale() === 'en' ? 'Downloading explicitly accepts replacement of recognized legacy fonts. The PDF lists replacements; original appearance is not accredited. Unsupported structures or glyphs stop export.' : 'Al descargar aceptas expresamente sustituir fuentes legadas reconocidas. El PDF enumera los cambios; no acredita la apariencia original. Estructuras o glifos no compatibles impiden exportar.'}</small>}<button className="sealed-pdf-download" aria-label={versionNumber === undefined ? undefined : `${t('Descargar PDF')} · ${t('Versión')} ${versionNumber}`} type="button" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={() => void download()}>{t(busy ? 'Preparando el PDF…' : 'Descargar PDF')}</button><small>{getLocale() === "en" ? "Reconstructed presentation; historical appearance not accredited. The catalog rejects legacy fonts." : "Presentación reconstruida; apariencia histórica no acreditada. El catálogo rechaza fuentes heredadas."}</small>{busy && <button type="button" onClick={() => { ++attempt.current; cancel.current?.(); setBusy(false); setError(''); }}>{getLocale() === 'en' ? 'Cancel PDF' : 'Cancelar PDF'}</button>}<span className="sealed-pdf-status" role="status">{busy ? t('Preparando el PDF…') : ''}</span>{error && <span role="alert">{error}</span>}</span>;
}

export function SealedPdfChoice({ documentId, versions }: { documentId: string; versions: DocumentVersion[] }) {
  const sealed = versions.filter(v => v.certificate).sort((a, b) => b.version_number - a.version_number);
  const [selected, setSelected] = useState('');
  const choiceId = useId();
  const versionId = sealed.some(v => v.id === selected) ? selected : sealed[0]?.id;
  if (!versionId) return null;
  const chosen = sealed.find(v => v.id === versionId)!;
  return <div className="sealed-pdf-choice">
    <label htmlFor={choiceId}>{t('Versión para PDF')}</label>
    <select id={choiceId} aria-describedby={`${choiceId}-code`} value={versionId} onChange={e => setSelected(e.target.value)}>{sealed.map(v => <option key={v.id} value={v.id}>{t('Versión')} {v.version_number}</option>)}</select>
    <code id={`${choiceId}-code`}>{chosen.certificate?.certificate_code}</code>
    <SealedPdfButton key={`${documentId}:${versionId}`} documentId={documentId} versionId={versionId} versionNumber={chosen.version_number} />
  </div>;
}
