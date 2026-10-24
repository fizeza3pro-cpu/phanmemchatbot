import { afterEach, expect, it, vi } from 'vitest';
import { testBackend } from './helpers';
import { bytePlusConfig } from '../worker/services/byteplus-ai';
import type { Env } from '../worker/types';

const model = 'byteplus/configured';
const runtimes: Awaited<ReturnType<typeof testBackend>>[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(runtimes.splice(0).map((b) => b.dispose())); });
async function setup() {
  const b = await testBackend(); runtimes.push(b);
  Object.assign(b.env, { BYTEPLUS_API_KEY:'test-byteplus-key', BYTEPLUS_MODEL:'seed-test-model', BYTEPLUS_CONTEXT_TOKENS:'32768' });
  const user = await b.login();
  const created = await b.api('/api/conversations', { method:'POST', cookie:user.cookie, body:{ model } });
  expect(created.response.status).toBe(201);
  const id = created.json.data.id as string;
  return { ...b, ...user, id, send: (request_id = crypto.randomUUID()) => b.api(`/api/conversations/${id}/messages`, {
    method:'POST', cookie:user.cookie, body:{ request_id, content:'Xin chào tiếng Việt 👩‍💻' }
  }), detail: () => b.api(`/api/conversations/${id}`, { cookie:user.cookie }) };
}
function mock(input = 100, output = 20, content = 'Chào bạn', textTokens = 12) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/tokenization')) {
      const body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ data:body.text.map((_: string, index: number) => ({ index, total_tokens:textTokens })) }));
    }
    return new Response(JSON.stringify({ id:'byteplus-request', choices:[{ message:{ content, reasoning_content:'HIDDEN' } }],
      usage:{ prompt_tokens:input, completion_tokens:output, total_tokens:input + output, completion_tokens_details:{ reasoning_tokens:10 } } }));
  });
}
it('offers BytePlus, snapshots model/context, and keeps history/config reads free of provider calls', async () => {
  const b = await setup(); const fetcher = mock(); vi.stubGlobal('fetch',fetcher);
  const config = await b.api('/api/chat/config', { cookie:b.cookie });
  expect(config.json.data).toMatchObject({ byteplus_model:'seed-test-model', default_token_limit:2000 });
  expect(config.json.data.model_allowlist).toContain(model);
  expect(JSON.stringify(config.json)).not.toContain('test-byteplus-key');
  b.env.BYTEPLUS_MODEL = 'seed-new-model'; b.env.BYTEPLUS_CONTEXT_TOKENS = '65536';
  const detail = await b.detail();
  expect(detail.json.data.conversation).toMatchObject({ provider_model:'seed-test-model', model_context_tokens:32768 });
  expect(detail.json.data.budget_estimate).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  expect((await b.send()).response.status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).model).toBe('seed-test-model');
  const next = await b.api('/api/conversations', { method:'POST', cookie:b.cookie, body:{ model } });
  expect(next.json.data).toMatchObject({ provider_model:'seed-new-model', model_context_tokens:65536 });
});
it('counts with BytePlus, caps output including reasoning, and replays without calling/charging twice', async () => {
  const b = await setup(); const fetcher = mock(); vi.stubGlobal('fetch',fetcher);
  const uuid = crypto.randomUUID(); const sent = await b.send(uuid);
  expect(sent.response.status).toBe(200); expect(sent.json.data.conversation.used_total_tokens).toBe(120);
  expect(JSON.stringify(sent.json)).not.toContain('HIDDEN');
  expect(fetcher.mock.calls[0]![0]).toBe('https://ark.ap-southeast.bytepluses.com/api/v3/tokenization');
  expect(fetcher.mock.calls[0]![1]?.redirect).toBe('manual');
  expect(fetcher.mock.calls[1]![1]?.redirect).toBe('manual');
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({ model:'seed-test-model', stream:false,
    max_completion_tokens:512, thinking:{ type:'disabled' }, messages:expect.arrayContaining([{ role:'user',content:'Xin chào tiếng Việt 👩‍💻' }]) });
  expect((await b.send(uuid)).json.data.conversation.used_total_tokens).toBe(120); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('allows an input estimate mismatch below quota and rejects a large prompt without locking or inference', async () => {
  const b = await setup(); const fetcher = mock(200,20); vi.stubGlobal('fetch',fetcher);
  expect((await b.send()).response.status).toBe(200);
  const tooLarge = mock(100,20,'SHOULD NOT CALL',1000); vi.stubGlobal('fetch',tooLarge);
  expect((await b.send()).json.error.code).toBe('INSUFFICIENT_TOKEN_BUDGET'); expect(tooLarge).toHaveBeenCalledTimes(1);
  const detail = await b.detail(); expect(detail.json.data.conversation).toMatchObject({ status:'active',used_total_tokens:220 });
});
it('withholds and never persists an actual over-quota answer', async () => {
  const b = await setup(); vi.stubGlobal('fetch', mock(1990,20,'OVER QUOTA SECRET'));
  const sent = await b.send(); expect(sent.json.error.code).toBe('SESSION_TOKEN_LIMIT_EXCEEDED');
  expect(JSON.stringify(sent.json)).not.toContain('OVER QUOTA SECRET');
  const detail = await b.detail(); expect(detail.json.data.conversation).toMatchObject({ status:'limit_reached',used_total_tokens:2010 });
  expect(detail.json.data.messages.items).toHaveLength(0);
});
it('keeps an unknown inference usage pending without exposing the answer', async () => {
  const b = await setup(); const tokenizer = mock();
  vi.stubGlobal('fetch', vi.fn(async (url,init) => String(url).endsWith('/tokenization') ? tokenizer(url,init) :
    new Response(JSON.stringify({ choices:[{ message:{ content:'NO USAGE SECRET' } }] }))));
  expect((await b.send()).json.error.code).toBe('USAGE_PENDING');
  const detail = await b.detail(); expect(detail.json.data.conversation.status).toBe('usage_pending');
  expect(detail.json.data.messages.items).toHaveLength(0);
});
it('keeps tokenizer failures active and retries safely on a new request', async () => {
  const b = await setup(); const fetcher = vi.fn(async () => new Response('{}',{ status:503 })); vi.stubGlobal('fetch',fetcher);
  expect((await b.send()).json.error.code).toBe('BYTEPLUS_TOKENIZER_UNAVAILABLE'); expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await b.detail()).json.data.conversation).toMatchObject({ status:'active',used_total_tokens:0,active_request_id:null });
  vi.stubGlobal('fetch',mock()); expect((await b.send()).response.status).toBe(200);
});
it('rejects missing key before claiming, and rejects unsafe configuration', async () => {
  const b = await setup(); b.env.BYTEPLUS_API_KEY = ''; const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
  expect((await b.send()).json.error.code).toBe('BYTEPLUS_NOT_CONFIGURED'); expect(fetcher).not.toHaveBeenCalled();
  expect((await b.db.prepare('SELECT COUNT(*) AS n FROM ai_requests').first<{ n:number }>())?.n).toBe(0);
  expect((await b.api('/api/conversations',{ method:'POST',cookie:b.cookie,body:{ model } })).json.error.code).toBe('BYTEPLUS_NOT_CONFIGURED');
  for (const patch of [{ BYTEPLUS_BASE_URL:'http://example.test' },{ BYTEPLUS_CONTEXT_TOKENS:'garbage' },
    { BYTEPLUS_BASE_URL:'https://example.test/api/v3/chat/completions' },{ BYTEPLUS_MAX_TOKENS_PARAMETER:'max_tokens',BYTEPLUS_THINKING:'enabled' }]) {
    expect(() => bytePlusConfig({ ...b.env, BYTEPLUS_API_KEY:'test', ...patch } as Env)).toThrowError(expect.objectContaining({ code:'BYTEPLUS_CONFIG_INVALID' }));
  }
});
