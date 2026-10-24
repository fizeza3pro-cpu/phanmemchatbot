import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createApp } from '../worker/app';
import type { Env, User } from '../worker/types';
import type { ChatDependencies } from '../worker/services/chat';

export async function testBackend(dependencies: ChatDependencies = {}) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: '2026-10-05', d1Databases: ['DB'],
  }));
  const db = await runtime.getD1Database('DB') as unknown as D1Database;
  const migrations = (await readdir(resolve('migrations'))).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    const sql = await readFile(resolve('migrations', name), 'utf8');
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
  const env: Env = { DB: db, ENVIRONMENT: 'development', APP_ORIGIN: 'http://localhost:8787',
    ENABLE_DEV_AUTH: 'true', ADMIN_EMAILS: 'admin@example.test', TOKEN_COUNT_MODE: 'conservative' };
  const app = createApp(dependencies);
  async function api(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.origin !== null) headers.Origin = options.origin ?? env.APP_ORIGIN;
    if (options.cookie) headers.Cookie = options.cookie;
    const response = await app.request(`${env.APP_ORIGIN}${path}`, { method: options.method ?? 'GET', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body) }, env);
    const json = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() as any : null;
    return { response, json };
  }
  async function login(email = 'user@example.test') {
    const result = await api('/api/auth/dev', { method: 'POST', body: { email } });
    if (result.response.status !== 200) throw new Error(JSON.stringify(result.json));
    return { cookie: result.response.headers.get('set-cookie')!.split(';')[0]!, user: result.json.data as User };
  }
  async function conversation(cookie: string) {
    const result = await api('/api/conversations', { method: 'POST', cookie, body: {} });
    if (result.response.status !== 201) throw new Error(JSON.stringify(result.json));
    return result.json.data.id as string;
  }
  return { runtime, db, env, app, api, login, conversation, dispose: () => runtime.dispose() };
}
