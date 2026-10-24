import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { devLoginSchema } from '../../shared/schemas';
import { readJson } from '../lib/errors';
import { beginGoogle, devLogin, finishGoogle, logout } from '../services/auth';

export const authRoutes = new Hono<AppEnv>();
authRoutes.get('/google', async (c) => c.redirect(await beginGoogle(c)));
authRoutes.get('/google/callback', async (c) => {
  await finishGoogle(c);
  return c.redirect(`${c.env.APP_ORIGIN}/chat`);
});
authRoutes.post('/logout', async (c) => { await logout(c); return c.json({ data: { logged_out: true } }); });
authRoutes.post('/dev', async (c) => {
  const body = await readJson(c, devLoginSchema);
  return c.json({ data: await devLogin(c, body.email, body.display_name) });
});
