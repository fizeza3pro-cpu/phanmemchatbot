import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { currentUser } from '../services/auth';
import { ApiError } from '../lib/errors';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', await currentUser(c));
  await next();
});
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Chỉ quản trị viên được truy cập.');
  await next();
});
