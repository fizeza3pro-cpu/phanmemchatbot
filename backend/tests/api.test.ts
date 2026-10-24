import { afterEach, describe, expect, it, vi } from 'vitest';
import { testBackend } from './helpers';
import { ProviderError } from '../worker/services/cloudflare-ai';

const runtimes: Awaited<ReturnType<typeof testBackend>>[] = [];
async function setup() {
  const runAi = vi.fn(async () => ({ content: 'Đã trả lời', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, provider_request_id: null }));
  const backend = await testBackend({ runAi, countTokens: async () => 10 });
  runtimes.push(backend);
  const user = await backend.login();
  const admin = await backend.login('admin@example.test');
  const id = await backend.conversation(user.cookie);
  const send = () => backend.api(`/api/conversations/${id}/messages`, { method: 'POST', cookie: user.cookie,
    body: { request_id: crypto.randomUUID(), content: 'Xin chào' } });
  return { ...backend, user, admin, id, runAi, send };
}
afterEach(async () => { await Promise.all(runtimes.splice(0).map((r) => r.dispose())); });

describe('authentication, API ownership and admin settings', () => {
  it('requires authentication and isolates other users conversations and requests', async () => {
    const b = await setup();
    expect((await b.api('/api/conversations')).response.status).toBe(401);
    const stranger = await b.login('other@example.test');
    expect((await b.api(`/api/conversations/${b.id}`, { cookie: stranger.cookie })).response.status).toBe(404);
    expect((await b.api(`/api/conversations/${b.id}/messages`, { method: 'POST', cookie: stranger.cookie,
      body: { request_id: crypto.randomUUID(), content: 'Truy cập trái phép' } })).response.status).toBe(404);
    const answered = await b.send();
    expect((await b.api(`/api/requests/${answered.json.data.request_id}`, { cookie: stranger.cookie })).response.status).toBe(404);
  });
  it('rejects admin access for ordinary users', async () => {
    const b = await setup();
    expect((await b.api('/api/admin/settings', { cookie: b.user.cookie })).response.status).toBe(403);
    expect((await b.api('/api/admin/settings', { cookie: b.admin.cookie })).response.status).toBe(200);
  });
  it('protects writes against absent or foreign origins', async () => {
    const b = await setup();
    expect((await b.api('/api/conversations', { method: 'POST', cookie: b.user.cookie, body: {}, origin: null })).response.status).toBe(403);
    expect((await b.api('/api/conversations', { method: 'POST', cookie: b.user.cookie, body: {}, origin: 'https://evil.example' })).response.status).toBe(403);
  });
  it('revokes login on logout and when expired', async () => {
    const b = await setup();
    expect((await b.api('/api/me', { cookie: b.user.cookie })).response.status).toBe(200);
    await b.api('/api/auth/logout', { method: 'POST', cookie: b.user.cookie });
    expect((await b.api('/api/me', { cookie: b.user.cookie })).response.status).toBe(401);
    await b.db.prepare('UPDATE auth_sessions SET expires_at = 0 WHERE user_id = ?').bind(b.admin.user.id).run();
    expect((await b.api('/api/me', { cookie: b.admin.cookie })).response.status).toBe(401);
  });
  it('does not expose development authentication in production', async () => {
    const b = await setup();
    b.env.ENVIRONMENT = 'production';
    const result = await b.api('/api/auth/dev', { method: 'POST', body: { email: 'attacker@example.test' } });
    expect(result.response.status).toBe(404);
  });
  it('validates request bodies and never accepts client-supplied quotas or roles', async () => {
    const b = await setup();
    expect((await b.api('/api/conversations', { method: 'POST', cookie: b.user.cookie,
      body: { title: 'Test', token_limit: 999999 } })).response.status).toBe(400);
    expect((await b.api(`/api/conversations/${b.id}/messages`, { method: 'POST', cookie: b.user.cookie,
      body: { request_id: crypto.randomUUID(), content: 'Test', used_tokens: 0, role: 'system' } })).response.status).toBe(400);
  });
  it('applies default quota edits to new conversations while keeping existing snapshots', async () => {
    const b = await setup();
    const settings = (await b.api('/api/admin/settings', { cookie: b.admin.cookie })).json.data;
    const { version, created_at, updated_by, ...input } = settings;
    const result = await b.api('/api/admin/settings', { method: 'PUT', cookie: b.admin.cookie,
      body: { ...input, default_token_limit: 5000 } });
    expect(result.response.status).toBe(200);
    expect(result.json.applies_to).toBe('new_conversations');
    expect((await b.api(`/api/conversations/${b.id}`, { cookie: b.user.cookie })).json.data.conversation.token_limit).toBe(2000);
    const next = await b.conversation(b.user.cookie);
    expect((await b.api(`/api/conversations/${next}`, { cookie: b.user.cookie })).json.data.conversation.token_limit).toBe(5000);
  });
  it('locks on an admin quota reduction and refuses to reopen a locked session', async () => {
    const b = await setup();
    await b.send();
    const result = await b.api(`/api/admin/conversations/${b.id}/limit`, { method: 'PATCH', cookie: b.admin.cookie, body: { token_limit: 10 } });
    expect(result.response.status).toBe(200);
    expect(result.json.data.status).toBe('limit_reached');
    expect((await b.api(`/api/admin/conversations/${b.id}/limit`, { method: 'PATCH', cookie: b.admin.cookie,
      body: { token_limit: 10000 } })).response.status).toBe(409);
  });
  it('disallows changing a quota during processing', async () => {
    const b = await setup();
    await b.db.prepare("UPDATE conversations SET status = 'processing', active_request_id = 'in-flight' WHERE id = ?").bind(b.id).run();
    expect((await b.api(`/api/admin/conversations/${b.id}/limit`, { method: 'PATCH', cookie: b.admin.cookie,
      body: { token_limit: 10000 } })).response.status).toBe(409);
  });
  it('keeps at least one active admin and immediately blocks revoked accounts', async () => {
    const b = await setup();
    expect((await b.api(`/api/admin/users/${b.admin.user.id}`, { method: 'PATCH', cookie: b.admin.cookie,
      body: { role: 'user' } })).json.error.code).toBe('LAST_ADMIN');
    expect((await b.api(`/api/admin/users/${b.user.user.id}`, { method: 'PATCH', cookie: b.admin.cookie,
      body: { status: 'blocked' } })).response.status).toBe(200);
    expect((await b.api('/api/me', { cookie: b.user.cookie })).response.status).toBe(401);
  });
  it('rate limits messages using database state', async () => {
    const b = await setup();
    await b.db.prepare('UPDATE app_settings SET message_rate_per_minute = 2').run();
    expect((await b.send()).response.status).toBe(200);
    expect((await b.send()).response.status).toBe(200);
    const third = await b.send();
    expect(third.response.status).toBe(429);
    expect(third.response.headers.get('Retry-After')).toBeTruthy();
    expect(b.runAi).toHaveBeenCalledTimes(2);
  });
  it('deletes chat content while retaining the usage ledger and hides request replay', async () => {
    const b = await setup();
    const answered = await b.send();
    expect((await b.api(`/api/conversations/${b.id}`, { method: 'DELETE', cookie: b.user.cookie })).response.status).toBe(204);
    expect((await b.api(`/api/conversations/${b.id}`, { cookie: b.user.cookie })).response.status).toBe(404);
    expect((await b.api(`/api/requests/${answered.json.data.request_id}`, { cookie: b.user.cookie })).response.status).toBe(404);
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())?.n).toBe(0);
    expect((await b.db.prepare('SELECT total_tokens FROM token_ledger').first<{ total_tokens: number }>())?.total_tokens).toBe(15);
    expect((await b.db.prepare('SELECT user_content FROM ai_requests').first<{ user_content: string | null }>())?.user_content).toBeNull();
  });
  it('supports literal title search and message pagination', async () => {
    const b = await setup();
    await b.api(`/api/conversations/${b.id}`, { method: 'PATCH', cookie: b.user.cookie, body: { title: 'Test 100%' } });
    const list = await b.api('/api/conversations?search=100%25', { cookie: b.user.cookie });
    expect(list.response.status).toBe(200);
    expect(list.json.data.items).toHaveLength(1);
    await b.send();
    const page = await b.api(`/api/conversations/${b.id}?limit=1`, { cookie: b.user.cookie });
    expect(page.json.data.messages.items[0].role).toBe('assistant');
    const older = await b.api(`/api/conversations/${b.id}?limit=1&before=${page.json.data.messages.next_before}`, { cookie: b.user.cookie });
    expect(older.json.data.messages.items[0].role).toBe('user');
  });
  it('requires provider evidence notes to manually reconcile pending usage', async () => {
    const b = await setup();
    b.runAi.mockRejectedValueOnce(new ProviderError('AI_CONNECTION_UNCERTAIN', 'unknown'));
    const pending = await b.send();
    const requestId = pending.json.error.details.request_id;
    const result = await b.api(`/api/admin/requests/${requestId}/reconcile`, { method: 'POST', cookie: b.admin.cookie,
      body: { input_tokens: 10, output_tokens: 7, note: 'Đối chiếu request với log provider: 17 tokens.' } });
    expect(result.response.status).toBe(200);
    const reload = await b.api(`/api/conversations/${b.id}`, { cookie: b.user.cookie });
    expect(reload.json.data.conversation.used_total_tokens).toBe(17);
    expect(reload.json.data.conversation.status).toBe('limit_reached');
    expect(reload.json.data.messages.items).toHaveLength(0);
    expect((await b.api(`/api/admin/requests/${requestId}/reconcile`, { method: 'POST', cookie: b.admin.cookie,
      body: { input_tokens: 10, output_tokens: 7, note: 'Gửi lại request đối soát cũ.' } })).response.status).toBe(409);
  });
});
