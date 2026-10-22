import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t, useLocale } from './i18n';

export type EvidenceTab = 'activity' | 'versions';
export function EvidenceAccess({ open }: { open: (tab: EvidenceTab) => void }) {
  useLocale();
  return <div className="evidence-access">{(['activity', 'versions'] as const).map(tab => <button key={tab} type="button" aria-haspopup="dialog" aria-controls="mobile-evidence" onClick={event => { event.currentTarget.focus({ preventScroll: true }); open(tab); }}>{t(tab === 'activity' ? 'Actividad' : 'Versiones')}</button>)}</div>;
}

// The same mounted children serve both layouts; CSS alone hides the inactive tab.
export default function MobileEvidence({ tab, setTab, activity, versions }: { tab: EvidenceTab | null; setTab: (tab: EvidenceTab | null) => void; activity: ReactNode; versions: ReactNode }) {
  useLocale();
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1080px)').matches);
  const open = mobile && tab !== null;
  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 1080px)');
    const change = () => { setMobile(media.matches); if (!media.matches) setTab(null); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [setTab]);
  useLayoutEffect(() => {
    if (!open) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
      return;
    }
    if (!panel.current) return;
    const trigger = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const siblings: HTMLElement[] = [];
    for (let branch: HTMLElement = node; branch.parentElement && branch !== document.body; branch = branch.parentElement) {
      siblings.push(...Array.from(branch.parentElement.children).filter(el => el !== branch) as HTMLElement[]);
    }
    const previous = siblings.map(el => el.inert);
    siblings.forEach(el => { el.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus({ preventScroll: true });
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>('button, select, input, a[href], [tabindex="0"]')).filter(el => !el.closest('[hidden]') && !el.hasAttribute('disabled') && el.tabIndex >= 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); setTab(null); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    node.addEventListener('keydown', keydown);
    return () => {
      node.removeEventListener('keydown', keydown);
      siblings.forEach((el, i) => { el.inert = previous[i]; });
      document.body.style.overflow = overflow;
      returnFocus.current = trigger;
    };
  }, [open, setTab]);
  return <aside ref={panel} id="mobile-evidence" className={`evidence-panel ${open ? 'evidence-open' : ''}`} role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-labelledby={open ? 'evidence-title' : undefined}>
    <div className="evidence-mobile-heading"><h2 id="evidence-title">{t('Actividad y versiones')}</h2><button type="button" aria-label={t('Cerrar')} onClick={() => setTab(null)}>×</button></div>
    <div className="evidence-tabs" role="tablist" aria-label={t('Actividad y versiones')}>{(['activity', 'versions'] as const).map(value => <button key={value} id={`evidence-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`evidence-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 'activity' : event.key === 'End' ? 'versions' : value === 'activity' ? 'versions' : 'activity';
        setTab(next); panel.current?.querySelector<HTMLButtonElement>(`#evidence-tab-${next}`)?.focus();
      }
    }}>{t(value === 'activity' ? 'Actividad' : 'Versiones')}</button>)}</div>
    <div id="evidence-activity" role={mobile ? 'tabpanel' : undefined} aria-labelledby={mobile ? 'evidence-tab-activity' : undefined} hidden={mobile && tab !== 'activity'}>{activity}</div>
    <div id="evidence-versions" role={mobile ? 'tabpanel' : undefined} aria-labelledby={mobile ? 'evidence-tab-versions' : undefined} hidden={mobile && tab !== 'versions'}>{versions}</div>
  </aside>;
}
