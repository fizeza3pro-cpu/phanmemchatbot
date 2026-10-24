export interface PendingMessage {
  request_id: string;
  content: string;
  phase: 'ready' | 'sending' | 'uncertain' | 'waiting';
  server_id?: string;
}
const key = 'mach:pending:v1';
function read(userId: string): Record<string, PendingMessage> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    return saved.userId === userId ? (saved.items ?? {}) : {};
  } catch {
    return {};
  }
}
export const getPending = (userId: string, conversationId: string) =>
  read(userId)[conversationId] ?? null;
export function savePending(
  userId: string,
  conversationId: string,
  pending: PendingMessage | null
) {
  const items = read(userId);
  if (pending) items[conversationId] = pending;
  else delete items[conversationId];
  try {
    if (Object.keys(items).length)
      sessionStorage.setItem(key, JSON.stringify({ userId, items }));
    else sessionStorage.removeItem(key);
  } catch {
    /* Chat remains usable when browser storage is unavailable. */
  }
}
