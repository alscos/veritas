// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, identityGeneration, resetIdentity, SESSION_EXPIRED_EVENT } from './api';
import { downloadEditable } from './exportDocument';
import { DEFAULT_PAGE } from './pageLayout';
import { loadRecovery, recoveryKey } from './recovery';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); resetIdentity(); });
describe('identity and recoverable content', () => {
  it('retains A recovery through expiration, refuses B and leaves legacy entries untouched', () => {
    const recovery = { format: 2, ownerId: 1, documentId: 'doc', html: '<p>A PRIVATE</p>', savedAt: Date.now(), sessionId: 'session', pending: [], sequence: 1 };
    localStorage.setItem(recoveryKey('doc', 1), JSON.stringify(recovery));
    localStorage.setItem('veritas:recovery:doc', JSON.stringify({ html: 'LEGACY PRIVATE' }));
    resetIdentity(1); expect(loadRecovery('doc', '2000-01-01', 1)?.html).toContain('A PRIVATE');
    resetIdentity(); expect(loadRecovery('doc', '2000-01-01', 1)).toBeNull();
    resetIdentity(2); expect(loadRecovery('doc', '2000-01-01', 1)).toBeNull(); expect(loadRecovery('doc', '2000-01-01', 2)).toBeNull();
    expect(localStorage.getItem('veritas:recovery:doc')).toContain('LEGACY PRIVATE');
    resetIdentity(1); expect(loadRecovery('doc', '2000-01-01', 1)?.html).toContain('A PRIVATE');
  });
  it('ignores a successful delayed response from A after switching to B', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    resetIdentity(1); const request = api('/documents'); resetIdentity(2);
    finish(new Response(JSON.stringify({ documents: ['A PRIVATE'] }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(request).rejects.toMatchObject({ status: 0 });
  });
  it('does not retry or expire B when an A CSRF refresh finishes after the switch', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 419 })).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    resetIdentity(1); const request = api('/documents');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    resetIdentity(2); finish(new Response(JSON.stringify({ csrf_token: 'old-identity' }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(request).rejects.toMatchObject({ status: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not trigger an A download after the identity changes during preparation', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    resetIdentity(1); const epoch = identityGeneration();
    const preparing = downloadEditable({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A PRIVATE' }] }] }, { title: 'A', page: DEFAULT_PAGE }, 'odt', () => identityGeneration() === epoch);
    resetIdentity(2); await preparing; expect(click).not.toHaveBeenCalled(); click.mockRestore();
  });
  it('expires identity when the real server rejects an earlier identity', async () => {
    const expired = vi.fn(); window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } })));
    resetIdentity(1); await expect(api('/documents')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce(); window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });
});
