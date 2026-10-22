// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SendModal } from './App';
import { resetIdentity } from './api';
import { setLocale, t } from './i18n';
import type { Certificate, VeritasDocument } from './types';
let container: HTMLDivElement; let root: Root;
const certificate = { id: 'shown-certificate', certificate_code: 'VRT-SHOWN', issued_at: '' } satisfies Certificate;
const documentState = { versions: [{ id: 'shown-version', certificate }, { id: 'later-version', certificate: { ...certificate, id: 'later-certificate' } }] } as VeritasDocument;
const response = (payload: unknown, status = 201) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const submit = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
const input = () => container.querySelector<HTMLInputElement>('input[name=email]')!;
const note = () => container.querySelector<HTMLTextAreaElement>('textarea')!;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetIdentity(7); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); localStorage.clear(); resetIdentity(); });
for (const locale of ['es', 'en'] as const) {
  it(`retains email/note on 422 and confirms the displayed certificate version after correction (${locale})`, async () => {
    setLocale(locale);
    const message = locale === 'es' ? 'El destinatario debe tener una cuenta en InkGroove. Comprueba el correo de su cuenta.' : 'The recipient must have an InkGroove account. Check the email address of their account.';
    const fetch = vi.fn().mockResolvedValueOnce(response({ errors: { recipient_email: [message] } }, 422)).mockResolvedValueOnce(response({ submission: { id: 'delivery', recipient_user_id: 8, document_version_id: 'shown-version' } }));
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(<SendModal certificate={certificate} documentState={documentState} demo={false} onClose={() => {}} />));
    expect(container.textContent).toContain(t('El destinatario debe tener una cuenta en InkGroove. Introduce el correo de esa cuenta. No se envían avisos por correo.'));
    input().value = 'missing@example.test'; note().value = 'My note';
    await submit();
    expect(container.querySelector('[role=alert]')?.textContent).toBe(message);
    expect(container.textContent).not.toContain(t('Versión entregada'));
    expect(input().value).toBe('missing@example.test'); expect(note().value).toBe('My note');
    input().value = 'recipient@example.test'; await submit();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ document_version_id: 'shown-version', recipient_email: 'recipient@example.test', note: 'My note' });
    expect(container.textContent).toContain(t('Versión entregada'));
    expect(container.textContent).not.toContain(t('El destinatario verá esta versión concreta y su proceso, pero no tus borradores posteriores.'));
  });
}
it('does not show success for an unlinked or mismatched server response', async () => {
  setLocale('es'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ submission: { id: 'delivery', recipient_user_id: null, document_version_id: 'shown-version' } })));
  await act(async () => root.render(<SendModal certificate={certificate} documentState={documentState} demo={false} onClose={() => {}} />));
  input().value = 'missing@example.test'; await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(t('No se pudo confirmar la entrega.'));
  expect(container.querySelector('form')).not.toBeNull();
});
