import type { Conversation, Message, Settings } from '../types';
import { ApiError } from '../lib/errors';

export function publicConversation(row: Conversation) {
  const { system_prompt_snapshot: _prompt, user_id: _user, ...publicRow } = row;
  return { ...publicRow, remaining_tokens: Math.max(0, row.token_limit - row.used_total_tokens),
    requires_new_conversation: row.status === 'limit_reached' };
}
export async function getOwnedConversation(db: D1Database, id: string, userId: string) {
  const row = await db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .bind(id, userId).first<Conversation>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy phiên chat.');
  return row;
}
export async function createConversation(db: D1Database, userId: string, title: string, settings: Settings,
  provider?: { model: string; context: number }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`INSERT INTO conversations (id, user_id, title, model, token_limit, settings_version,
    system_prompt_snapshot, max_output_tokens, max_input_bytes, created_at, updated_at, provider_model, model_context_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, title, settings.default_model, settings.default_token_limit, settings.version,
      settings.system_prompt, settings.max_output_tokens, settings.max_input_bytes, now, now, provider?.model ?? null, provider?.context ?? null).run();
  return getOwnedConversation(db, id, userId);
}
export async function listConversations(db: D1Database, userId: string, limit: number, offset: number, search: string) {
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const result = await db.prepare(`SELECT * FROM conversations WHERE user_id = ? AND status != 'deleted'
    AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(userId, pattern, limit + 1, offset).all<Conversation>();
  return { items: result.results.slice(0, limit).map(publicConversation),
    next_offset: result.results.length > limit ? offset + limit : null };
}
export async function getMessages(db: D1Database, conversationId: string, limit: number, before: number) {
  const result = await db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND sequence < ?
    ORDER BY sequence DESC LIMIT ?`).bind(conversationId, before, limit + 1).all<Message>();
  const page = result.results.slice(0, limit);
  return { items: [...page].reverse(), next_before: result.results.length > limit ? page[page.length - 1]?.sequence : null };
}
export async function getHistory(db: D1Database, conversationId: string) {
  const result = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence LIMIT 1001')
    .bind(conversationId).all<Message>();
  if (result.results.length > 1000) throw new ApiError(413, 'INPUT_TOO_LARGE', 'Lịch sử phiên quá dài. Hãy tạo phiên mới.');
  return result.results;
}
export async function updateConversation(db: D1Database, row: Conversation, patch: { title?: string; archived?: boolean }) {
  let nextStatus = row.status;
  if (patch.archived !== undefined) {
    if (!['active', 'archived'].includes(row.status)) {
      throw new ApiError(409, 'SESSION_NOT_EDITABLE', 'Không thể thay đổi trạng thái phiên này.');
    }
    nextStatus = patch.archived ? 'archived' : 'active';
  }
  const result = await db.prepare(`UPDATE conversations SET title = ?, status = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND status = ? AND active_request_id IS NULL`)
    .bind(patch.title ?? row.title, nextStatus, Date.now(), row.id, row.user_id, row.status).run();
  if (!result.meta.changes) throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Phiên đang xử lý hoặc đã thay đổi.');
  return getOwnedConversation(db, row.id, row.user_id);
}
export async function deleteConversation(db: D1Database, row: Conversation) {
  if (row.active_request_id || ['processing', 'usage_pending'].includes(row.status)) {
    throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Chờ quyết toán lượt đang xử lý trước khi xóa phiên.');
  }
  const results = await db.batch([
    db.prepare(`UPDATE conversations SET status = 'deleted', title = 'Đã xóa', system_prompt_snapshot = '', updated_at = ?
      WHERE id = ? AND user_id = ? AND active_request_id IS NULL AND status != 'deleted'`)
      .bind(Date.now(), row.id, row.user_id),
    db.prepare("DELETE FROM messages WHERE conversation_id = ? AND EXISTS (SELECT 1 FROM conversations WHERE id = ? AND status = 'deleted')")
      .bind(row.id, row.id),
    db.prepare("UPDATE ai_requests SET user_content = NULL WHERE conversation_id = ? AND EXISTS (SELECT 1 FROM conversations WHERE id = ? AND status = 'deleted')")
      .bind(row.id, row.id),
  ]);
  if (!results[0]?.meta.changes) throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Phiên vừa thay đổi. Vui lòng thử lại.');
}
