import { Hono } from 'hono';
import type { AppEnv, Conversation, User } from '../types';
import { limitSchema, reconcileSchema, settingsSchema, userUpdateSchema } from '../../shared/schemas';
import { ApiError, pagination, readJson } from '../lib/errors';
import { getSettings, saveSettings } from '../repositories/settings';
import { publicConversation } from '../repositories/conversations';
import { getRequest, settleRequest } from '../repositories/requests';
import { publicUser } from '../services/auth';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.get('/settings', async (c) => c.json({ data: await getSettings(c.env.DB) }));
adminRoutes.put('/settings', async (c) => {
  const input = await readJson(c, settingsSchema);
  return c.json({ data: await saveSettings(c.env.DB, c.get('user').id, input), applies_to: 'new_conversations' });
});
adminRoutes.get('/stats', async (c) => {
  const [users, conversations, requests, tokens] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'active') AS active FROM users"),
    c.env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'limit_reached') AS locked, SUM(status = 'usage_pending') AS usage_pending FROM conversations WHERE status != 'deleted'"),
    c.env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, SUM(status IN ('failed', 'suppressed', 'usage_pending')) AS errors FROM ai_requests"),
    c.env.DB.prepare('SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM token_ledger'),
  ]);
  return c.json({ data: { users: users?.results[0], conversations: conversations?.results[0],
    requests: requests?.results[0], tokens: tokens?.results[0] } });
});
adminRoutes.get('/users', async (c) => {
  const { limit, offset } = pagination(c);
  const rows = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC, id LIMIT ? OFFSET ?').bind(limit + 1, offset).all<User>();
  return c.json({ data: { items: rows.results.slice(0, limit).map(publicUser), next_offset: rows.results.length > limit ? offset + limit : null } });
});
adminRoutes.patch('/users/:id', async (c) => {
  const body = await readJson(c, userUpdateSchema);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<User>();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
  const role = body.role ?? user.role;
  const status = body.status ?? user.status;
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ? AND
      (role != 'admin' OR status != 'active' OR (? = 'admin' AND ? = 'active')
      OR EXISTS (SELECT 1 FROM users other WHERE other.id != users.id AND other.role = 'admin' AND other.status = 'active'))`)
      .bind(role, status, Date.now(), user.id, role, status),
    c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND EXISTS
      (SELECT 1 FROM users WHERE id = ? AND status = 'blocked')`).bind(user.id, user.id),
    c.env.DB.prepare(`INSERT INTO admin_audit_logs (id, actor_id, action, target_id, metadata, created_at)
      SELECT ?, ?, 'user.updated', ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND status = ?)`)
      .bind(crypto.randomUUID(), c.get('user').id, user.id, JSON.stringify({ role, status }), Date.now(), user.id, role, status),
  ]);
  if (!results[0]?.meta.changes) throw new ApiError(409, 'LAST_ADMIN', 'Phải giữ ít nhất một quản trị viên đang hoạt động.');
  return c.json({ data: publicUser((await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>())!) });
});
adminRoutes.patch('/conversations/:id/limit', async (c) => {
  const { token_limit } = await readJson(c, limitSchema);
  const row = await c.env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND status != 'deleted'").bind(c.req.param('id')).first<Conversation>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy phiên chat.');
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE conversations SET token_limit = ?, status = CASE WHEN used_total_tokens >= ? THEN 'limit_reached' ELSE 'active' END,
      lock_reason = CASE WHEN used_total_tokens >= ? THEN 'ADMIN_LIMIT_REDUCED' ELSE NULL END, updated_at = ?
      WHERE id = ? AND status = 'active' AND active_request_id IS NULL`)
      .bind(token_limit, token_limit, token_limit, Date.now(), row.id),
    c.env.DB.prepare(`INSERT INTO admin_audit_logs (id, actor_id, action, target_id, metadata, created_at)
      SELECT ?, ?, 'conversation.limit_updated', ?, ?, ? WHERE EXISTS
      (SELECT 1 FROM conversations WHERE id = ? AND token_limit = ? AND active_request_id IS NULL AND status IN ('active', 'limit_reached'))`)
      .bind(crypto.randomUUID(), c.get('user').id, row.id, JSON.stringify({ old_limit: row.token_limit, token_limit }), Date.now(), row.id, token_limit),
  ]);
  if (!results[0]?.meta.changes) throw new ApiError(409, 'SESSION_NOT_EDITABLE', 'Chỉ đổi hạn mức phiên active và chưa có lượt đang xử lý. Phiên khóa cần tạo mới.');
  const updated = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(row.id).first<Conversation>();
  return c.json({ data: publicConversation(updated!) });
});
adminRoutes.get('/requests', async (c) => {
  const { limit, offset } = pagination(c);
  const status = c.req.query('status');
  if (status && !['processing', 'completed', 'rejected', 'failed', 'usage_pending', 'suppressed'].includes(status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Trạng thái request không hợp lệ.');
  }
  const rows = await c.env.DB.prepare(`SELECT id, conversation_id, user_id, status, provider_request_id,
    preflight_input_tokens, max_output_tokens, input_tokens, output_tokens, total_tokens, usage_status,
    error_code, started_at, completed_at FROM ai_requests WHERE (? IS NULL OR status = ?)
    ORDER BY started_at DESC, id LIMIT ? OFFSET ?`).bind(status ?? null, status ?? null, limit + 1, offset).all();
  return c.json({ data: { items: rows.results.slice(0, limit), next_offset: rows.results.length > limit ? offset + limit : null } });
});
adminRoutes.post('/requests/:id/reconcile', async (c) => {
  const body = await readJson(c, reconcileSchema);
  const request = await getRequest(c.env.DB, c.req.param('id'));
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy request.');
  if (request.status !== 'usage_pending' || request.usage_status !== 'unknown') {
    throw new ApiError(409, 'REQUEST_NOT_PENDING', 'Chỉ đối soát request đang chờ usage.');
  }
  await settleRequest(c.env.DB, request, { content: null, source: 'admin_reconciliation',
    usage: { input_tokens: body.input_tokens, output_tokens: body.output_tokens, total_tokens: body.input_tokens + body.output_tokens },
    audit: { actorId: c.get('user').id, note: body.note } });
  return c.json({ data: { request_id: request.id, usage_status: 'settled', requires_new_conversation: true } });
});
adminRoutes.get('/audit-logs', async (c) => {
  const { limit, offset } = pagination(c);
  const rows = await c.env.DB.prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC, id LIMIT ? OFFSET ?').bind(limit + 1, offset).all();
  return c.json({ data: { items: rows.results.slice(0, limit), next_offset: rows.results.length > limit ? offset + limit : null } });
});
