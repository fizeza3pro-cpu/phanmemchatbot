import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { testBackend } from './helpers';

const runtimes: Awaited<ReturnType<typeof testBackend>>[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map((r) => r.dispose())); });

it('repairs only unspent preflight locks without resetting usage or reopening genuine locks', async () => {
  const b = await testBackend();
  runtimes.push(b);
  const session = await b.login();
  const cases = [
    { status: 'limit_reached', reason: 'INSUFFICIENT_TOKEN_BUDGET', used: 656, requestStatus: 'rejected', usage: 'not_incurred', repair: true },
    { status: 'limit_reached', reason: 'INSUFFICIENT_TOKEN_BUDGET', used: 2000, requestStatus: 'rejected', usage: 'not_incurred', repair: false },
    { status: 'limit_reached', reason: 'SESSION_TOKEN_LIMIT_EXCEEDED', used: 656, requestStatus: 'rejected', usage: 'not_incurred', repair: false },
    { status: 'limit_reached', reason: 'ADMIN_LIMIT_REDUCED', used: 656, requestStatus: 'rejected', usage: 'not_incurred', repair: false },
    { status: 'limit_reached', reason: 'INSUFFICIENT_TOKEN_BUDGET', used: 656, requestStatus: 'usage_pending', usage: 'unknown', repair: false },
    { status: 'processing', reason: 'INSUFFICIENT_TOKEN_BUDGET', used: 656, requestStatus: 'processing', usage: 'unknown', repair: false },
    { status: 'deleted', reason: 'INSUFFICIENT_TOKEN_BUDGET', used: 656, requestStatus: 'rejected', usage: 'not_incurred', repair: false },
    { status: 'limit_reached', reason: 'INSUFFICIENT_TOKEN_BUDGET', used: 656, requestStatus: 'suppressed', usage: 'settled', repair: false },
  ];
  const ids: string[] = [];
  for (const item of cases) {
    const id = await b.conversation(session.cookie);
    ids.push(id);
    const requestId = crypto.randomUUID();
    await b.db.prepare(`INSERT INTO ai_requests (id, conversation_id, user_id, client_request_id,
      content_hash, status, usage_status, error_code, started_at)
      VALUES (?, ?, ?, ?, 'fixture', ?, ?, 'INSUFFICIENT_TOKEN_BUDGET', ?)`)
      .bind(requestId, id, session.user.id, crypto.randomUUID(), item.requestStatus, item.usage, Date.now()).run();
    await b.db.prepare(`UPDATE conversations SET status = ?, lock_reason = ?, used_input_tokens = ?,
      used_output_tokens = 200, used_total_tokens = ?, active_request_id = ? WHERE id = ?`)
      .bind(item.status, item.reason, item.used - 200, item.used,
        item.requestStatus === 'processing' ? requestId : null, id).run();
  }
  const sql = await readFile(resolve('migrations/0002_reopen_preflight_rejections.sql'), 'utf8');
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  // Reapplying the repair cannot alter real usage or bypass other lock reasons.
  for (let pass = 0; pass < 2; pass++) {
    await b.db.batch(statements.map((s) => b.db.prepare(s)));
    for (const [index, item] of cases.entries()) {
      const row = await b.db.prepare('SELECT * FROM conversations WHERE id = ?').bind(ids[index]!).first();
      expect(row).toMatchObject({ status: item.repair ? 'active' : item.status,
        lock_reason: item.repair ? null : item.reason, token_limit: 2000,
        used_input_tokens: item.used - 200, used_output_tokens: 200, used_total_tokens: item.used });
    }
  }
});
