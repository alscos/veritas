// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { resetIdentity } from './api';
import { clearRecovery, listRecoveries, recoveryKey } from './recovery';
afterEach(() => { localStorage.clear(); resetIdentity(); });
it('keeps tab copies separate, retains older drafts and isolates owners including v2', () => {
  resetIdentity(1);
  for (const [slot, html, baseRevision] of [['tab-a', 'DRAFT A', 1], ['tab-b', 'DRAFT B', 2], [undefined, 'LEGACY V2', undefined]] as const) {
    localStorage.setItem(recoveryKey('doc', 1, slot), JSON.stringify({ format: 2, ownerId: 1, documentId: 'doc', html, baseRevision, savedAt: 1, sessionId: slot ?? 'legacy', pending: [] }));
  }
  expect(listRecoveries('doc', 1).map(r => r.html)).toEqual(['DRAFT A', 'DRAFT B', 'LEGACY V2']);
  clearRecovery('doc', 1, 'tab-a'); expect(listRecoveries('doc', 1)).toHaveLength(2);
  resetIdentity(2); expect(listRecoveries('doc', 1)).toEqual([]); expect(listRecoveries('doc', 2)).toEqual([]);
  resetIdentity(1); expect(listRecoveries('doc', 1)).toHaveLength(2);
});
