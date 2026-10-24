import { afterEach, describe, expect, it, vi } from 'vitest';
import { testBackend } from './helpers';
import { pkceChallenge } from '../worker/lib/crypto';

const runtimes: Awaited<ReturnType<typeof testBackend>>[] = [];
async function setup() {
  const b = await testBackend();
  runtimes.push(b);
  b.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  b.env.GOOGLE_CLIENT_SECRET = 'test-only-client-secret';
  return b;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});
describe('Google OAuth state, PKCE and server-side identity', () => {
  it('creates an expiring state and S256 challenge, then rejects a mismatched callback', async () => {
    const b = await setup();
    const start = await b.api('/api/auth/google');
    expect(start.response.status).toBe(302);
    const location = new URL(start.response.headers.get('Location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    const record = await b.db.prepare('SELECT code_verifier, expires_at FROM oauth_states').first<{ code_verifier: string; expires_at: number }>();
    expect(location.searchParams.get('code_challenge')).toBe(await pkceChallenge(record!.code_verifier));
    expect(record!.expires_at).toBeGreaterThan(Date.now());
    const result = await b.api(`/api/auth/google/callback?state=${'a'.repeat(64)}&code=test`, {
      cookie: start.response.headers.get('Set-Cookie')!.split(';')[0]!,
    });
    expect(result.json.error.code).toBe('INVALID_OAUTH_STATE');
  });
  it('uses verified Google identity, issues a secure cookie and consumes state only once', async () => {
    const b = await setup();
    b.env.APP_ORIGIN = 'https://chat.example.test';
    b.env.ENVIRONMENT = 'production';
    const start = await b.api('/api/auth/google');
    const location = new URL(start.response.headers.get('Location')!);
    const cookie = start.response.headers.get('Set-Cookie')!.split(';')[0]!;
    const callback = `/api/auth/google/callback?state=${location.searchParams.get('state')}&code=test-code`;
    const fetcher = vi.fn(async (input: unknown) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'test-access-token' }));
      if (String(input) === 'https://openidconnect.googleapis.com/v1/userinfo') return new Response(JSON.stringify({
        sub: 'verified-google-subject', email: 'google@example.test', email_verified: true, name: 'Google user',
      }));
      throw new Error('Unexpected network request in OAuth test.');
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await b.api(callback, { cookie });
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get('Location')).toBe('https://chat.example.test/chat');
    const session = result.response.headers.get('Set-Cookie')!;
    expect(session).toContain('__Host-chatbot_session=');
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    const user = await b.api('/api/me', { cookie: session.split(',').find((s) => s.includes('__Host-chatbot_session='))!.trim().split(';')[0]! });
    expect(user.json.data.email).toBe('google@example.test');
    expect(user.json.data.role).toBe('user');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await b.api(callback, { cookie })).json.error.code).toBe('INVALID_OAUTH_STATE');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects unverified Google emails without issuing a login session', async () => {
    const b = await setup();
    const start = await b.api('/api/auth/google');
    const state = new URL(start.response.headers.get('Location')!).searchParams.get('state');
    const cookie = start.response.headers.get('Set-Cookie')!.split(';')[0]!;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => new Response(JSON.stringify(
      String(input).includes('/token') ? { access_token: 'test-access-token' }
        : { sub: 'unverified-subject', email: 'unverified@example.test', email_verified: false },
    ))));
    const result = await b.api(`/api/auth/google/callback?state=${state}&code=test-code`, { cookie });
    expect(result.response.status).toBe(403);
    expect(result.json.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>())?.n).toBe(0);
  });
  it('refuses an expired OAuth state before exchanging a code', async () => {
    const b = await setup();
    const start = await b.api('/api/auth/google');
    const state = new URL(start.response.headers.get('Location')!).searchParams.get('state');
    await b.db.prepare('UPDATE oauth_states SET expires_at = 0').run();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await b.api(`/api/auth/google/callback?state=${state}&code=test-code`, {
      cookie: start.response.headers.get('Set-Cookie')!.split(';')[0]!,
    });
    expect(result.json.error.code).toBe('INVALID_OAUTH_STATE');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
