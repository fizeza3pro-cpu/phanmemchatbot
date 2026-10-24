import type { AiRequest, Conversation, Message, Usage } from '../types';

export async function findRequest(db: D1Database, conversationId: string, clientId: string) {
  return db.prepare('SELECT * FROM ai_requests WHERE conversation_id = ? AND client_request_id = ?')
    .bind(conversationId, clientId).first<AiRequest>();
}
export async function getRequest(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM ai_requests WHERE id = ?').bind(id).first<AiRequest>();
}
export async function claimRequest(db: D1Database, conversationId: string, userId: string,
  clientId: string, hash: string, content: string): Promise<AiRequest | null> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const results = await db.batch([
    db.prepare(`INSERT INTO ai_requests (id, conversation_id, user_id, client_request_id, content_hash,
      status, user_content, started_at) SELECT ?, ?, ?, ?, ?, 'processing', ?, ?
      WHERE EXISTS (SELECT 1 FROM conversations c JOIN users u ON u.id = c.user_id
        WHERE c.id = ? AND c.user_id = ? AND c.status = 'active' AND c.active_request_id IS NULL
        AND c.used_total_tokens < c.token_limit AND u.status = 'active')`)
      .bind(id, conversationId, userId, clientId, hash, content, now, conversationId, userId),
    db.prepare(`UPDATE conversations SET status = 'processing', active_request_id = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'active' AND active_request_id IS NULL
      AND EXISTS (SELECT 1 FROM ai_requests WHERE id = ? AND status = 'processing')`)
      .bind(id, now, conversationId, userId, id),
  ]);
  return results[0]?.meta.changes && results[1]?.meta.changes ? getRequest(db, id) : null;
}
export async function reserveRequest(db: D1Database, request: AiRequest, input: number, output: number) {
  const result = await db.prepare(`UPDATE ai_requests SET preflight_input_tokens = ?, max_output_tokens = ?, reserved_tokens = ?
    WHERE id = ? AND status = 'processing' AND EXISTS (SELECT 1 FROM conversations
    WHERE id = ? AND status = 'processing' AND active_request_id = ? AND used_total_tokens + ? <= token_limit)`)
    .bind(input, output, input + output, request.id, request.conversation_id, request.id, input + output).run();
  return Boolean(result.meta.changes);
}
export async function finishWithoutUsage(db: D1Database, request: AiRequest,
  error: string, kind: 'rejected' | 'failed' | 'usage_pending', lock: boolean, rejectedInput?: number) {
  const pending = kind === 'usage_pending';
  await db.batch([
    db.prepare(`UPDATE conversations SET status = ?, lock_reason = ?, active_request_id = ?, updated_at = ?
      WHERE id = ? AND active_request_id = ? AND status = 'processing'
      AND EXISTS (SELECT 1 FROM ai_requests WHERE id = ? AND usage_status != 'settled')`)
      .bind(pending ? 'usage_pending' : lock ? 'limit_reached' : 'active', pending || lock ? error : null,
        pending ? request.id : null, Date.now(), request.conversation_id, request.id, request.id),
    db.prepare(`UPDATE ai_requests SET status = ?, error_code = ?, usage_status = ?, completed_at = ?,
      reserved_tokens = CASE WHEN ? = 'usage_pending' THEN reserved_tokens ELSE 0 END,
      preflight_input_tokens = COALESCE(?, preflight_input_tokens),
      max_output_tokens = CASE WHEN ? IS NOT NULL THEN 0 ELSE max_output_tokens END
      WHERE id = ? AND status = 'processing' AND usage_status != 'settled'`)
      .bind(kind, error, pending ? 'unknown' : 'not_incurred', pending ? null : Date.now(), kind,
        rejectedInput ?? null, rejectedInput ?? null, request.id),
  ]);
}
export interface Settlement {
  usage: Usage; content: string | null; source: 'provider' | 'admin_reconciliation';
  providerRequestId?: string | null; suppressReason?: string; audit?: { actorId: string; note: string };
}
export async function settleRequest(db: D1Database, request: AiRequest, settlement: Settlement) {
  const { usage } = settlement;
  const now = Date.now();
  const current = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(request.conversation_id).first<Conversation>();
  if (!current) throw new Error('Missing conversation during settlement.');
  const over = current.used_total_tokens + usage.total_tokens > current.token_limit;
  const suppressed = over || Boolean(settlement.suppressReason) || settlement.content === null;
  const reason = over ? 'SESSION_TOKEN_LIMIT_EXCEEDED' : settlement.suppressReason ?? (suppressed ? 'RECONCILED_WITHOUT_RESPONSE' : null);
  const status = suppressed ? 'suppressed' : 'completed';
  const close = suppressed && reason !== 'AI_EMPTY_RESPONSE';
  const statements = [
    db.prepare(`INSERT INTO token_ledger (id, conversation_id, request_id, input_tokens, output_tokens, total_tokens, source, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ai_requests r JOIN conversations c ON c.id = r.conversation_id
      WHERE r.id = ? AND r.status IN ('processing', 'usage_pending') AND r.usage_status != 'settled'
      AND c.active_request_id = r.id) ON CONFLICT(request_id) DO NOTHING`)
      .bind(crypto.randomUUID(), request.conversation_id, request.id, usage.input_tokens, usage.output_tokens,
        usage.total_tokens, settlement.source, now, request.id),
    db.prepare(`UPDATE conversations SET used_input_tokens = used_input_tokens + ?, used_output_tokens = used_output_tokens + ?,
      used_total_tokens = used_total_tokens + ?, status = CASE WHEN ? = 1 OR used_total_tokens + ? >= token_limit
      THEN 'limit_reached' ELSE 'active' END, lock_reason = CASE WHEN ? = 1 THEN ?
      WHEN used_total_tokens + ? >= token_limit THEN 'SESSION_TOKEN_LIMIT_EXCEEDED' ELSE NULL END,
      active_request_id = NULL, updated_at = ? WHERE id = ? AND active_request_id = ?
      AND EXISTS (SELECT 1 FROM token_ledger WHERE request_id = ?)
      AND EXISTS (SELECT 1 FROM ai_requests WHERE id = ? AND usage_status != 'settled')`)
      .bind(usage.input_tokens, usage.output_tokens, usage.total_tokens, close ? 1 : 0, usage.total_tokens,
        close ? 1 : 0, reason, usage.total_tokens, now, request.conversation_id, request.id, request.id, request.id),
    db.prepare(`UPDATE ai_requests SET status = ?, provider_request_id = ?, input_tokens = ?, output_tokens = ?,
      total_tokens = ?, usage_status = 'settled', reserved_tokens = 0, error_code = ?, completed_at = ?
      WHERE id = ? AND usage_status != 'settled' AND EXISTS (SELECT 1 FROM token_ledger WHERE request_id = ?)`)
      .bind(status, settlement.providerRequestId ?? request.provider_request_id, usage.input_tokens,
        usage.output_tokens, usage.total_tokens, reason, now, request.id, request.id),
  ];
  if (!suppressed) {
    for (const [role, content] of [['user', request.user_content], ['assistant', settlement.content]] as const) {
      statements.push(db.prepare(`INSERT INTO messages (id, conversation_id, request_id, sequence, role, content, created_at)
        SELECT ?, ?, ?, COALESCE((SELECT MAX(sequence) FROM messages WHERE conversation_id = ?), 0) + 1, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM ai_requests WHERE id = ? AND status = 'completed')
        AND NOT EXISTS (SELECT 1 FROM messages WHERE request_id = ? AND role = ?)`)
        .bind(crypto.randomUUID(), request.conversation_id, request.id, request.conversation_id,
          role, content, now, request.id, request.id, role));
    }
    const firstQuestion = request.user_content?.trim().replace(/\s+/g, ' ').slice(0, 70);
    if (firstQuestion) {
      statements.push(db.prepare(`UPDATE conversations SET title = ? WHERE id = ?
        AND title = 'Cuộc trò chuyện mới'
        AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = ? AND request_id = ? AND role = 'assistant')
        AND (SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND role = 'user') = 1`)
        .bind(firstQuestion, request.conversation_id, request.conversation_id,
          request.id, request.conversation_id));
    }
  }
  if (settlement.audit) {
    statements.push(db.prepare(`INSERT INTO admin_audit_logs (id, actor_id, action, target_id, metadata, created_at)
      SELECT ?, ?, 'request.reconciled', ?, ?, ? WHERE EXISTS (SELECT 1 FROM ai_requests WHERE id = ? AND usage_status = 'settled')`)
      .bind(crypto.randomUUID(), settlement.audit.actorId, request.id,
        JSON.stringify({ ...usage, note: settlement.audit.note }), now, request.id));
  }
  await db.batch(statements);
  return getRequest(db, request.id);
}
export async function assistantForRequest(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM messages WHERE request_id = ? AND role = 'assistant'").bind(id).first<Message>();
}
