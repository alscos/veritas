import { useEffect, useId, useRef } from 'react';
import { t } from './i18n';

export default function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const titleId = useId();
  const requestClose = () => { if (window.dispatchEvent(new Event('inkgroove:modal-close', { cancelable: true }))) onClose(); };
  const close = useRef(requestClose); close.current = requestClose;
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    (dialog.current?.querySelector<HTMLElement>('[data-modal-autofocus]') ?? dialog.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]'))?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); }
      if (e.key !== 'Tab') return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]') ?? [])].filter(el => !el.closest('[hidden]') && !el.hasAttribute('disabled'));
      const first = elements[0], last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prior?.focus(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}><button className="modal-close" onClick={requestClose} aria-label={t("Cerrar")}>×</button><h2 id={titleId}>{title}</h2>{children}</section></div>;
}
