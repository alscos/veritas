import { authenticatedIdentity, identityGeneration, SESSION_EXPIRED_EVENT } from './api';
import { shareRequest, ShareRequestError } from './VersionShareApp';
/** Identity scope is checked after body consumption too. No persistent authority. */
export async function nominalRequest(path: string, signal: AbortSignal, body?: unknown) {
  const epoch = identityGeneration(), user = authenticatedIdentity();
  let response: Response;
  try { response = await shareRequest(path, signal, body); }
  catch (e) {
    if (!(e instanceof ShareRequestError) || e.status !== 429) throw e;
    // Existing nominal routes allow 60 requests/minute. A retry never changes authority.
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(Error('Cancelled')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 60000);
      signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
    });
    if (epoch !== identityGeneration()) throw Error('Identity changed');
    response = await shareRequest(path, signal, body);
  }
  if (signal.aborted || epoch !== identityGeneration()) throw Error('Identity changed');
  const declared = response.headers.get('X-InkGroove-User');
  if (declared && user !== null && declared !== String(user)) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); throw Error('Identity changed');
  }
  return response;
}
export const nominalBase = '/process-summary/share/deliveries';
export function nominalRoute(path: string): string | null {
  return /^\/deliveries\/(?:received|sent)(?:\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?$/.test(path) ? path : null;
}
