import type { ActionLogEntry } from '../types/socket';

export type { ActionLogEntry };

// Journal en mémoire, borné par salon : suffisant pour raccrocher les
// retardataires au fil temps réel, pas conçu comme historique persistant.
const MAX_ENTRIES_PER_SESSION = 50;
const logs = new Map<string, ActionLogEntry[]>();

export function appendAction(sessionId: string, entry: ActionLogEntry): void {
  const list = logs.get(sessionId) ?? [];
  list.push(entry);
  if (list.length > MAX_ENTRIES_PER_SESSION) list.shift();
  logs.set(sessionId, list);
}

export function getRecentActions(sessionId: string): ActionLogEntry[] {
  return logs.get(sessionId) ?? [];
}
