import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv, Env, User } from '../types';
import { ApiError } from '../lib/errors';
import { randomToken, sha256, pkceChallenge } from '../lib/crypto';
import { rateLimit } from './rate-limit';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
function secure(env: Env) { return new URL(env.APP_ORIGIN).protocol === 'https:'; }
export function sessionCookie(env: Env) { return secure(env) ? '__Host-chatbot_session' : 'chatbot_session'; }
function stateCookie(env: Env) { return secure(env) ? '__Host-chatbot_oauth' : 'chatbot_oauth'; }
function isBootstrapAdmin(env: Env, email: string) {
  return (env.ADMIN_EMAILS ?? '').split(',').map((v) => v.trim().toLowerCase()).includes(email.toLowerCase());
}
export async function issueSession(c: Context<AppEnv>, user: User) {
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_BLOCKED', 'Tài khoản đã bị khóa.');
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), user.id, Date.now() + SESSION_MS, Date.now()).run();
  setCookie(c, sessionCookie(c.env), token, {
    httpOnly: true, secure: secure(c.env), sameSite: 'Lax', path: '/', maxAge: SESSION_MS / 1000,
  });
  return publicUser(user);
}
export function publicUser(user: User) {
  return { id: user.id, email: user.email, display_name: user.display_name, role: user.role,
    status: user.status, created_at: user.created_at };
}
export async function currentUser(c: Context<AppEnv>): Promise<User> {
  const token = getCookie(c, sessionCookie(c.env));
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.');
  const user = await c.env.DB.prepare(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha256(token), Date.now()).first<User>();
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn.');
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_BLOCKED', 'Tài khoản đã bị khóa.');
  return user;
}
export async function logout(c: Context<AppEnv>) {
  const token = getCookie(c, sessionCookie(c.env));
  if (token) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, sessionCookie(c.env), { path: '/', secure: secure(c.env), httpOnly: true, sameSite: 'Lax' });
}
export async function devLogin(c: Context<AppEnv>, email: string, name: string) {
  const hostname = new URL(c.req.url).hostname;
  if (c.env.ENVIRONMENT !== 'development' || c.env.ENABLE_DEV_AUTH !== 'true'
    || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy API.');
  }
  const now = Date.now();
  const user = await c.env.DB.prepare(`INSERT INTO users
    (id, email, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
    RETURNING *`).bind(crypto.randomUUID(), email, name,
      isBootstrapAdmin(c.env, email) ? 'admin' : 'user', now, now).first<User>();
  if (!user) throw new Error('Could not create local user.');
  return issueSession(c, user);
}
function requireGoogle(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Chưa cấu hình đăng nhập Google.');
  }
}
export async function beginGoogle(c: Context<AppEnv>) {
  requireGoogle(c.env);
  await rateLimit(c.env.DB, `oauth:${c.req.header('CF-Connecting-IP') ?? 'local'}`, 30, 60_000);
  const state = randomToken();
  const verifier = randomToken();
  await c.env.DB.prepare('INSERT INTO oauth_states (state_hash, code_verifier, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(state), verifier, Date.now() + 10 * 60_000).run();
  setCookie(c, stateCookie(c.env), state, { httpOnly: true, secure: secure(c.env), sameSite: 'Lax', path: '/', maxAge: 600 });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!, redirect_uri: `${c.env.APP_ORIGIN}/api/auth/google/callback`,
    response_type: 'code', scope: 'openid email profile', state,
    code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}
export async function finishGoogle(c: Context<AppEnv>) {
  requireGoogle(c.env);
  const state = c.req.query('state');
  const cookieState = getCookie(c, stateCookie(c.env));
  if (!state || !cookieState || state !== cookieState || !/^[a-f0-9]{64}$/.test(state)) {
    throw new ApiError(400, 'INVALID_OAUTH_STATE', 'Phiên đăng nhập Google không hợp lệ.');
  }
  const record = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier')
    .bind(await sha256(state), Date.now()).first<{ code_verifier: string }>();
  deleteCookie(c, stateCookie(c.env), { path: '/', secure: secure(c.env) });
  if (!record) throw new ApiError(400, 'INVALID_OAUTH_STATE', 'Phiên đăng nhập đã hết hạn hoặc đã sử dụng.');
  const code = c.req.query('code');
  if (!code || c.req.query('error')) throw new ApiError(400, 'OAUTH_CANCELLED', 'Đăng nhập Google đã bị hủy.');
  const tokens = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID!, client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${c.env.APP_ORIGIN}/api/auth/google/callback`, grant_type: 'authorization_code',
      code_verifier: record.code_verifier }), signal: AbortSignal.timeout(15_000),
  });
  if (!tokens.ok) throw new ApiError(502, 'OAUTH_FAILED', 'Không thể xác minh đăng nhập Google.');
  const tokenData = z.object({ access_token: z.string().min(1) }).safeParse(await tokens.json());
  if (!tokenData.success) throw new ApiError(502, 'OAUTH_FAILED', 'Phản hồi đăng nhập không hợp lệ.');
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.data.access_token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!profileResponse.ok) throw new ApiError(502, 'OAUTH_FAILED', 'Không lấy được tài khoản Google.');
  const profile = z.object({ sub: z.string().min(1), email: z.string().email(), email_verified: z.literal(true),
    name: z.string().max(200).optional() }).safeParse(await profileResponse.json());
  if (!profile.success) throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Cần tài khoản Google có email đã xác minh.');
  const email = profile.data.email.toLowerCase();
  const now = Date.now();
  const user = await c.env.DB.prepare(`INSERT INTO users
    (id, email, display_name, oauth_subject, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(oauth_subject) DO UPDATE SET
    email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at RETURNING *`)
    .bind(crypto.randomUUID(), email, profile.data.name ?? email, profile.data.sub,
      isBootstrapAdmin(c.env, email) ? 'admin' : 'user', now, now).first<User>();
  if (!user) throw new Error('Could not create OAuth user.');
  await issueSession(c, user);
}
