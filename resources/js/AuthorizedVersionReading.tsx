import type { ComponentProps, ReactNode } from 'react';
import { SubmissionReplay } from './SubmissionReplay';
import SealedReading from './SealedReading';
import { useLocale } from './i18n';
type ReplayProps = ComponentProps<typeof SubmissionReplay>;
type Props = Omit<ReplayProps, 'nominalImage' | 'nominalEvent'> & { nominalImage: NonNullable<ReplayProps['nominalImage']>; nominalEvent: NonNullable<ReplayProps['nominalEvent']>; coverage?: { status: string; complete: boolean }; children?: ReactNode };
/** Presentation only: each provider retains its own authorization and bounded cache. */
export default function AuthorizedVersionReading({ coverage, children, ...replay }: Props) {
  const en = useLocale() === 'en';
  return <section className="authorized-version-reading">
    <h3>{en ? 'Sealed version' : 'Versión sellada'} {replay.version.version_number}</h3>
    <p>{en ? 'Storage order within the sealed boundary; no authenticated global chronology. Page format unavailable in this API; reconstructed presentation.' : 'Orden de almacenamiento dentro de la frontera sellada; sin cronología global autenticada. Formato de página no disponible en esta API; presentación reconstruida.'}</p>
    {children}
    <div className="replay-paper"><SealedReading html={replay.version.snapshot_html} read={replay.nominalImage} /></div>
    {coverage && !coverage.complete && <p role="status">{en ? 'Partial history under this seal’s contract.' : 'Historial parcial según el contrato de este sello.'} {coverage.status}</p>}
    {!!replay.events.length && <SubmissionReplay {...replay} />}
    {replay.onNeedMore && <button disabled={replay.historyBusy} onClick={() => void replay.onNeedMore!()}>{en ? 'More sealed history' : 'Más historial sellado'}</button>}
    {replay.historyBusy && <p role="status">{en ? 'Loading sealed history…' : 'Cargando historial sellado…'}</p>}
  </section>;
}
