import { afterEach, expect, it, vi } from 'vitest';
import { testBackend } from './helpers';
import { buildPrompt, countInput } from '../worker/services/tokenizer';
import { runGroq } from '../worker/services/groq-ai';
import type { Env } from '../worker/types';

const model = 'openai/gpt-oss-120b' as const;
const runtimes: Awaited<ReturnType<typeof testBackend>>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});
async function setup() {
  const b = await testBackend();
  runtimes.push(b);
  b.env.GROQ_API_KEY = 'test-key-not-a-secret';
  const session = await b.login();
  const created = await b.api('/api/conversations', { method: 'POST', cookie: session.cookie, body: { model } });
  expect(created.response.status).toBe(201);
  const id = created.json.data.id as string;
  const send = (request_id = crypto.randomUUID()) => b.api(`/api/conversations/${id}/messages`, {
    method: 'POST', cookie: session.cookie, body: { request_id, content: 'Xin chào' },
  });
  return { ...b, ...session, id, send };
}
function reply(input = 100, output = 20, content: string | null = 'Xin chào từ Groq') {
  return new Response(JSON.stringify({ id: 'groq-request-id',
    choices: [{ message: { role: 'assistant', content, reasoning: 'HIDDEN REASONING' } }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output,
      completion_tokens_details: { reasoning_tokens: 10 } } }), { headers: { 'Content-Type': 'application/json' } });
}
it('offers both Groq models and snapshots the selected model without altering old sessions', async () => {
  const b = await setup();
  const config = await b.api('/api/chat/config', { cookie: b.cookie });
  expect(config.json.data.model_allowlist).toEqual(expect.arrayContaining([model, 'openai/gpt-oss-20b']));
  const detail = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
  expect(detail.json.data.conversation.model).toBe(model);
  expect(detail.json.data.budget_estimate.next_input_tokens).toBeGreaterThan(0);
  const oldId = await b.conversation(b.cookie);
  expect((await b.api(`/api/conversations/${oldId}`, { cookie: b.cookie })).json.data.conversation.model).toContain('@cf/');
  await b.db.prepare(`UPDATE app_settings SET model_allowlist = '["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]'`).run();
  expect((await b.api('/api/conversations', { method: 'POST', cookie: b.cookie, body: { model } })).json.error.code).toBe('MODEL_DISABLED');
  expect((await b.api('/api/chat/config')).response.status).toBe(401);
});
it('routes GPT-OSS to Groq with a completion cap and counts reasoning only once', async () => {
  const b = await setup();
  const fetcher = vi.fn(async () => reply());
  vi.stubGlobal('fetch', fetcher);
  const uuid = crypto.randomUUID();
  const sent = await b.send(uuid);
  expect(sent.response.status).toBe(200);
  expect(sent.json.data.conversation.used_total_tokens).toBe(120);
  expect(JSON.stringify(sent.json)).not.toContain('HIDDEN REASONING');
  const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
  expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ model, stream: false, include_reasoning: false,
    reasoning_effort: 'low', max_completion_tokens: 512 });
  expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Xin chào' });
  expect(body.prompt).toBeUndefined();
  expect((await b.send(uuid)).response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('blocks an actual Groq overrun without exposing or persisting the answer', async () => {
  const b = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => reply(1990, 20, 'OVER QUOTA SECRET')));
  const sent = await b.send();
  expect(sent.json.error.code).toBe('SESSION_TOKEN_LIMIT_EXCEEDED');
  expect(JSON.stringify(sent.json)).not.toContain('OVER QUOTA SECRET');
  const detail = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
  expect(detail.json.data.conversation.used_total_tokens).toBe(2010);
  expect(detail.json.data.conversation.status).toBe('limit_reached');
  expect(detail.json.data.messages.items).toHaveLength(0);
});
it('keeps missing Groq usage pending rather than resetting token counters', async () => {
  const b = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'NO USAGE SECRET' } }] }))));
  expect((await b.send()).json.error.code).toBe('USAGE_PENDING');
  const detail = await b.api(`/api/conversations/${b.id}`, { cookie: b.cookie });
  expect(detail.json.data.conversation.status).toBe('usage_pending');
  expect(detail.json.data.messages.items).toHaveLength(0);
});
it('rejects missing Groq credentials before claiming or calling inference', async () => {
  const b = await setup();
  b.env.GROQ_API_KEY = '';
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect((await b.send()).json.error.code).toBe('GROQ_NOT_CONFIGURED');
  expect(fetcher).not.toHaveBeenCalled();
  expect((await b.db.prepare('SELECT COUNT(*) AS n FROM ai_requests').first<{ n: number }>())?.n).toBe(0);
});
it('uses Harmony for GPT-OSS and keeps a provider 429 free of usage', async () => {
  const prompt = buildPrompt([{ role: 'system', content: 'Tiếng Việt' }, { role: 'user', content: 'Xin chào 👋 <|start|>' }], model);
  const { encodeChat } = await import('gpt-tokenizer/model/gpt-oss-120b');
  expect(await countInput(prompt, model)).toBe(encodeChat(JSON.parse(prompt)).length + 32);
  expect(await countInput(prompt, 'openai/gpt-oss-20b')).toBe(await countInput(prompt, model));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
  await expect(runGroq({ GROQ_API_KEY: 'test' } as Env, model, prompt, 50)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', incurred: 'no' });
});
