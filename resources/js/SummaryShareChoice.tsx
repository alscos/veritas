import { useId, useState } from 'react';
import { useLocale } from './i18n';
import type { DocumentVersion } from './types';

/** Rendered only in the owner's editor; management rechecks ownership server-side. */
export default function SummaryShareChoice({ documentId, versions }: { documentId: string; versions: DocumentVersion[] }) {
  const english = useLocale() === 'en';
  const id = useId();
  const [selected, setSelected] = useState('');
  const sealed = versions.filter(v => v.certificate && v.sealed_at).sort((a, b) => b.version_number - a.version_number);
  const chosen = sealed.find(v => v.id === selected) ?? sealed[0];
  if (!chosen) return null;
  return <div className="sealed-pdf-choice">
    <label htmlFor={id}>{english ? 'Sealed version to share' : 'Versión sellada para compartir'}</label>
    <select id={id} value={chosen.id} onChange={e => setSelected(e.target.value)}>{sealed.map(v => <option key={v.id} value={v.id}>{english ? 'Version' : 'Versión'} {v.version_number}</option>)}</select>
    <a href={`/process-summary/share/manage/${encodeURIComponent(documentId)}/${encodeURIComponent(chosen.id)}`} target="_blank" rel="noopener noreferrer">{english ? 'Share sealed version' : 'Compartir versión sellada'}</a>
    <small>{english ? 'Opens in a new tab. Choose a fixed sharing level for this exact sealed version.' : 'Abre otra pestaña. Elige un nivel fijo de compartición para esta versión sellada exacta.'}</small>
  </div>;
}
