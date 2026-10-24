import { afterEach, describe, expect, it, vi } from 'vitest';
import { testBackend } from './helpers';
import { ProviderError } from '../worker/services/cloudflare-ai';
import { settleRequest, getRequest } from '../worker/repositories/requests';
import { maintenance } from '../worker/services/maintenance';
import type { AiResult } from '../worker/types';
import type { ChatDependencies } from '../worker/services/chat';
import { countInput } from '../worker/services/tokenizer';

const countTokens = vi.fn(async () => 10);
const normalResult: AiResult = { content: 'Xin chào!', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, provider_request_id: 'mock-provider-id' };
const runtimes: Awaited<ReturnType<typeof testBackend>>[] = [];
async function setup(runAi: ReturnType<typeof vi.fn<NonNullable<ChatDependencies['runAi']>>> = vi.fn(async () => normalResult),
  counter: ChatDependencies['countTokens'] = countTokens) {
  const backend = await testBackend({ runAi, countTokens: counter });
  runtimes.push(backend);
  const session = await backend.login();
  const id = await backend.conversation(session.cookie);
  const send = (requestId = crypto.randomUUID(), content = 'Xin chào') => backend.api(`/api/conversations/${id}/messages`, {
    method: 'POST', cookie: session.cookie, body: { request_id: requestId, content },
  });
  return { ...backend, ...session, id, send, runAi };
}
afterEach(async () => { await Promise.all(runtimes.splice(0).map((r) => r.dispose())); vi.clearAllMocks(); });

describe('chat quota and settlement using real D1 SQL', () => {
  it('persists an answer, usage and one ledger entry; reload preserves counters', async () => {
    const b = await setup();
    const result = await b.send();
    expect(result.response.status).toBe(200);
    expect(result.json.data.message.content).toBe('Xin chào!');
    expect(result.json.data.conversation.used_total_tokens).toBe(15);
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.messages.items).toHaveLength(2);
    expect(reload.json.data.conversation.used_total_tokens).toBe(15);
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM token_ledger').first<{ n: number }>())?.n).toBe(1);
  });
  it('names a new conversation after the first answered question without replacing a custom title', async () => {
    const b = await setup();
    const first = await b.send(crypto.randomUUID(), 'Giải thích  cách hoạt động\n của token');
    expect(first.json.data.conversation.title).toBe('Giải thích cách hoạt động của token');
    const listed = await b.api('/api/conversations', { cookie: b.cookie });
    expect(listed.json.data.items.find((item: { id: string }) => item.id === b.id)?.title)
      .toBe('Giải thích cách hoạt động của token');
    await b.api(`/api/conversations/${b.id}`, {
      method: 'PATCH', cookie: b.cookie, body: { title: 'Tên tôi đặt' },
    });
    expect((await b.send(crypto.randomUUID(), 'Câu hỏi tiếp theo')).json.data.conversation.title)
      .toBe('Tên tôi đặt');
  });
  it('rejects an oversized prompt without charging or permanently locking the session', async () => {
    const b = await setup();
    await b.db.prepare('UPDATE conversations SET token_limit = 10 WHERE id = ?').bind(b.id).run();
    const result = await b.send();
    expect(result.response.status).toBe(409);
    expect(result.json.error.code).toBe('INSUFFICIENT_TOKEN_BUDGET');
    expect(result.json.error.details.requires_new_conversation).toBe(false);
    expect(result.json.error.details.remaining_tokens).toBe(10);
    expect(result.json.error.details.preflight_input_tokens).toBe(10);
    expect(b.runAi).not.toHaveBeenCalled();
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.conversation.status).toBe('active');
    expect(reload.json.data.conversation.active_request_id).toBeNull();
    expect(reload.json.data.conversation.requires_new_conversation).toBe(false);
    expect(reload.json.data.conversation.used_total_tokens).toBe(0);
    expect(reload.json.data.messages.items).toHaveLength(0);
    const request = await b.db.prepare('SELECT * FROM ai_requests WHERE conversation_id = ?').bind(b.id).first();
    expect(request).toMatchObject({ status: 'rejected', usage_status: 'not_incurred',
      preflight_input_tokens: 10, max_output_tokens: 0, reserved_tokens: 0 });
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM token_ledger').first<{ n: number }>())?.n).toBe(0);
  });
  it('allows a shorter question after a preflight rejection and safely replays the rejected UUID', async () => {
    const counter = vi.fn(async (prompt: string) => prompt.includes('TOO_LARGE') ? 2000 : 10);
    const b = await setup(vi.fn(async () => normalResult), counter);
    const requestId = crypto.randomUUID();
    expect((await b.send(requestId, 'TOO_LARGE')).response.status).toBe(409);
    const replay = await b.send(requestId, 'TOO_LARGE');
    expect(replay.json.error.details.requires_new_conversation).toBe(false);
    expect(b.runAi).not.toHaveBeenCalled();
    const shorter = await b.send(crypto.randomUUID(), 'Xin chào');
    expect(shorter.response.status).toBe(200);
    expect(shorter.json.data.conversation.status).toBe('active');
    expect(shorter.json.data.conversation.used_total_tokens).toBe(15);
    expect(b.runAi).toHaveBeenCalledTimes(1);
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM ai_requests').first<{ n: number }>())?.n).toBe(2);
  });
  it('uses tokenizer counts so a Vietnamese follow-up fits despite a large UTF-8 history', async () => {
    const result: AiResult = { ...normalResult, content: 'Hướng dẫn trò chuyện bằng tiếng Việt. '.repeat(60),
      usage: { input_tokens: 300, output_tokens: 356, total_tokens: 656 } };
    const b = await setup(vi.fn(async () => result), countInput);
    b.env.TOKEN_COUNT_MODE = 'verified';
    const settings = (await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie })).json.data.conversation;
    const requestId = crypto.randomUUID();
    await b.db.prepare(`INSERT INTO ai_requests (id, conversation_id, user_id, client_request_id, content_hash,
      status, user_content, started_at) VALUES (?, ?, ?, ?, 'fixture', 'processing', 'Xin chào', ?)`)
      .bind(requestId, b.id, b.user.id, crypto.randomUUID(), Date.now()).run();
    await b.db.prepare("UPDATE conversations SET status = 'processing', active_request_id = ? WHERE id = ?")
      .bind(requestId, b.id).run();
    await settleRequest(b.db, (await getRequest(b.db, requestId))!, {
      usage: result.usage, content: result.content, source: 'provider',
    });
    b.runAi.mockResolvedValueOnce(normalResult);
    const followUp = await b.send(crypto.randomUUID(), 'Hãy giải thích thêm.');
    expect(followUp.response.status).toBe(200);
    expect(followUp.json.data.conversation.used_total_tokens).toBe(671);
    expect(followUp.json.data.conversation.status).toBe('active');
    const prompt = b.runAi.mock.calls[0]![2] as string;
    expect(await countInput(prompt, settings.model, 'conservative')).toBeGreaterThan(2000 - 656);
    expect(await countInput(prompt, settings.model, 'verified')).toBeLessThan(2000 - 656);
  });
  it('caps output and closes a session at exactly its budget', async () => {
    const b = await setup();
    await b.db.prepare('UPDATE conversations SET token_limit = 15 WHERE id = ?').bind(b.id).run();
    const result = await b.send();
    expect(result.response.status).toBe(200);
    expect(b.runAi).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String), 5);
    expect(result.json.data.conversation.status).toBe('limit_reached');
    expect((await b.send()).response.status).toBe(409);
    expect(b.runAi).toHaveBeenCalledTimes(1);
  });
  it('suppresses provider output that exceeds quota and records real usage', async () => {
    const runAi = vi.fn(async () => ({ ...normalResult, content: 'SECRET OVER BUDGET',
      usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 } }));
    const b = await setup(runAi);
    await b.db.prepare('UPDATE conversations SET token_limit = 15 WHERE id = ?').bind(b.id).run();
    const result = await b.send();
    expect(result.response.status).toBe(409);
    expect(JSON.stringify(result.json)).not.toContain('SECRET OVER BUDGET');
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.messages.items).toHaveLength(0);
    expect(reload.json.data.conversation.used_total_tokens).toBe(16);
    expect((await b.db.prepare('SELECT total_tokens FROM token_ledger').first<{ total_tokens: number }>())?.total_tokens).toBe(16);
  });
  it('accepts an input estimate mismatch when actual usage still fits the session', async () => {
    const b = await setup(vi.fn(async () => ({ ...normalResult,
      usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 } })));
    const result = await b.send();
    expect(result.response.status).toBe(200);
    expect(result.json.data.conversation.used_total_tokens).toBe(16);
    expect(result.json.data.conversation.status).toBe('active');
    expect((await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie })).json.data.messages.items).toHaveLength(2);
  });
  it('suppresses actual over-quota usage even when an input estimate was lower', async () => {
    const b = await setup(vi.fn(async () => ({ ...normalResult, content: 'DO NOT SHOW',
      usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 } })));
    await b.db.prepare('UPDATE conversations SET token_limit = 15 WHERE id = ?').bind(b.id).run();
    const result = await b.send();
    expect(result.response.status).toBe(409);
    expect(JSON.stringify(result.json)).not.toContain('DO NOT SHOW');
    expect((await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie })).json.data.conversation.used_total_tokens).toBe(16);
  });
  it('charges known usage for an empty answer without closing a session below quota', async () => {
    const b = await setup(vi.fn(async () => ({ ...normalResult, content: '' })));
    const result = await b.send();
    expect(result.json.error.code).toBe('AI_EMPTY_RESPONSE');
    expect(result.json.error.details.requires_new_conversation).toBe(false);
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.conversation.used_total_tokens).toBe(15);
    expect(reload.json.data.conversation.status).toBe('active');
    expect(reload.json.data.messages.items).toHaveLength(0);
    b.runAi.mockResolvedValueOnce(normalResult);
    expect((await b.send()).response.status).toBe(200);
  });
  it('replays the same request without a second provider call or ledger entry', async () => {
    const b = await setup();
    const requestId = crypto.randomUUID();
    const first = await b.send(requestId);
    const second = await b.send(requestId);
    expect(second.response.status).toBe(200);
    expect(second.json.data.message.id).toBe(first.json.data.message.id);
    expect(second.json.data.conversation.used_total_tokens).toBe(15);
    expect(b.runAi).toHaveBeenCalledTimes(1);
    const conflict = await b.send(requestId, 'Nội dung khác');
    expect(conflict.json.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('allows only one concurrent provider call in the same conversation', async () => {
    let resolveAi!: (result: AiResult) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const runAi = vi.fn(() => { markStarted(); return new Promise<AiResult>((resolve) => { resolveAi = resolve; }); });
    const b = await setup(runAi);
    const first = b.send();
    await started;
    const second = await b.send();
    expect(second.json.error.code).toBe('REQUEST_IN_PROGRESS');
    resolveAi(normalResult);
    expect((await first).response.status).toBe(200);
    expect(runAi).toHaveBeenCalledTimes(1);
  });
  it('atomically claims a conversation when two requests start together', async () => {
    let resolveAi!: (result: AiResult) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const runAi = vi.fn(() => { markStarted(); return new Promise<AiResult>((resolve) => { resolveAi = resolve; }); });
    const b = await setup(runAi);
    const first = b.send();
    const second = b.send();
    await started;
    const rejected = await Promise.race([first, second]);
    expect(rejected.response.status).toBe(409);
    resolveAi(normalResult);
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.response.status).sort()).toEqual([200, 409]);
    expect(runAi).toHaveBeenCalledTimes(1);
  });
  it('does not expose an answer if persistence fails after inference', async () => {
    const b = await setup();
    let providerCompleted = false;
    b.runAi.mockImplementationOnce(async () => { providerCompleted = true; return normalResult; });
    b.env.DB = new Proxy(b.db, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (providerCompleted) throw new Error('Simulated database outage after inference');
          return target.batch(statements);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = await b.send();
    expect(result.response.status).toBe(500);
    expect(JSON.stringify(result.json)).not.toContain(normalResult.content);
    b.env.DB = b.db;
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.messages.items).toHaveLength(0);
    expect(reload.json.data.conversation.status).toBe('processing');
    expect((await b.send()).json.error.code).toBe('REQUEST_IN_PROGRESS');
    expect(b.runAi).toHaveBeenCalledTimes(1);
  });
  it('settling the same request twice never double-charges it', async () => {
    const b = await setup();
    const result = await b.send();
    const request = (await getRequest(b.db, result.json.data.request_id))!;
    await settleRequest(b.db, request, { usage: normalResult.usage, content: normalResult.content, source: 'provider' });
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.conversation.used_total_tokens).toBe(15);
    expect(reload.json.data.messages.items).toHaveLength(2);
  });
  it('keeps unknown usage pending and refuses retries and deletion', async () => {
    const b = await setup(vi.fn(async () => { throw new ProviderError('AI_CONNECTION_UNCERTAIN', 'unknown'); }));
    const requestId = crypto.randomUUID();
    expect((await b.send(requestId)).json.error.code).toBe('USAGE_PENDING');
    expect((await b.send(requestId)).json.error.code).toBe('USAGE_PENDING');
    expect((await b.send()).json.error.code).toBe('USAGE_PENDING');
    expect((await b.api(`/api/conversations/${b.id}`, { method: 'DELETE', cookie: b.cookie })).response.status).toBe(409);
    expect(b.runAi).toHaveBeenCalledTimes(1);
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.conversation.status).toBe('usage_pending');
    expect(reload.json.data.conversation.used_total_tokens).toBe(0);
  });
  it('releases a definitely rejected provider call without charging usage', async () => {
    const b = await setup(vi.fn(async () => { throw new ProviderError('AI_RATE_LIMITED', 'no'); }));
    expect((await b.send()).response.status).toBe(502);
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
    expect(reload.json.data.conversation.status).toBe('active');
    expect(reload.json.data.conversation.used_total_tokens).toBe(0);
  });
  it('starts new conversations at zero without history from the old one', async () => {
    const b = await setup();
    await b.send();
    const nextId = await b.conversation(b.cookie);
    const next = await b.api(`/api/conversations/${nextId}`, { cookie: b.cookie });
    expect(nextId).not.toBe(b.id);
    expect(next.json.data.conversation.used_total_tokens).toBe(0);
    expect(next.json.data.messages.items).toHaveLength(0);
  });
  it('does not allow archive/unarchive to unlock a locked session', async () => {
    const b = await setup();
    await b.db.prepare("UPDATE conversations SET status = 'limit_reached' WHERE id = ?").bind(b.id).run();
    const result = await b.api(`/api/conversations/${b.id}`, { method: 'PATCH', cookie: b.cookie, body: { archived: false } });
    expect(result.response.status).toBe(409);
  });
  it('recovers stale requests into pending, never resets their usage to zero', async () => {
    const b = await setup();
    const requestId = crypto.randomUUID();
    await b.db.prepare(`INSERT INTO ai_requests (id, conversation_id, user_id, client_request_id, content_hash, status, started_at)
      VALUES (?, ?, ?, ?, 'hash', 'processing', ?)`).bind(requestId, b.id, b.user.id, crypto.randomUUID(), Date.now() - 180_000).run();
    await b.db.prepare("UPDATE conversations SET status = 'processing', active_request_id = ? WHERE id = ?").bind(requestId, b.id).run();
    await maintenance(b.env);
    expect((await getRequest(b.db, requestId))?.status).toBe('usage_pending');
    expect((await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie })).json.data.conversation.status).toBe('usage_pending');
  });
});
