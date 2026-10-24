import type { Env } from '../types';

export async function maintenance(env: Env) {
  const now = Date.now();
  const stale = now - 2 * 60_000;
  const deletedCutoff = now - 30 * 24 * 60 * 60_000;
  await env.DB.batch([
    env.DB.prepare(`UPDATE conversations SET status = 'usage_pending', lock_reason = 'STALE_REQUEST', updated_at = ?
      WHERE status = 'processing' AND EXISTS (SELECT 1 FROM ai_requests WHERE id = active_request_id
      AND status = 'processing' AND started_at < ?)`).bind(now, stale),
    env.DB.prepare(`UPDATE ai_requests SET status = 'usage_pending', error_code = 'STALE_REQUEST'
      WHERE status = 'processing' AND started_at < ?`).bind(stale),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
    env.DB.prepare("DELETE FROM token_ledger WHERE conversation_id IN (SELECT id FROM conversations WHERE status = 'deleted' AND updated_at < ?)").bind(deletedCutoff),
    env.DB.prepare("DELETE FROM ai_requests WHERE conversation_id IN (SELECT id FROM conversations WHERE status = 'deleted' AND updated_at < ?)").bind(deletedCutoff),
    env.DB.prepare("DELETE FROM conversations WHERE status = 'deleted' AND updated_at < ?").bind(deletedCutoff),
  ]);
}
