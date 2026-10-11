import type { PageSettings, WritingEvent } from "./types";
import { authenticatedIdentity } from "./api";
export type EditorRecovery = { format: 2; ownerId: number; documentId: string; savedAt: number; html: string; title: string; page?: PageSettings; folderId?: string | null; sessionId: string; startedAt: number; sequence: number; pending: WritingEvent[]; baseRevision?: number; storageKey?: string };

// The optional slot preserves the v2 key as a readable legacy recovery.
export const recoveryKey = (documentId: string, ownerId: number, slot?: string) => `veritas:recovery:v2:${ownerId}:${documentId}${slot ? `:${slot}` : ""}`;
export const clearRecovery = (documentId: string, ownerId: number, slot?: string) => {
  try { localStorage.removeItem(recoveryKey(documentId, ownerId, slot)); } catch { /* Storage unavailable. */ }
};
export const listRecoveries = (documentId: string, ownerId: number): EditorRecovery[] => {
  if (authenticatedIdentity() !== ownerId) return [];
  const result: EditorRecovery[] = [];
  try {
    const prefix = recoveryKey(documentId, ownerId);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || (key !== prefix && !key.startsWith(prefix + ":"))) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null") as EditorRecovery;
        if (value?.format === 2 && value.ownerId === ownerId && value.documentId === documentId && typeof value.html === "string" && value.sessionId && Array.isArray(value.pending)) result.push({ ...value, storageKey: key });
      } catch { /* Retain malformed entries without rendering them. */ }
    }
  } catch { /* Storage unavailable. */ }
  return result.sort((a, b) => b.savedAt - a.savedAt);
};
export const loadRecovery = (documentId: string, _serverUpdatedAt: string, ownerId: number): EditorRecovery | null => listRecoveries(documentId, ownerId)[0] ?? null;
