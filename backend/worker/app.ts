import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './types';
import { ApiError } from './lib/errors';
import { requireAdmin, requireAuth } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { conversationRoutes, requestRoutes } from './routes/conversations';
import { publicUser } from './services/auth';
import type { ChatDependencies } from './services/chat';
import { getSettings } from './repositories/settings';

export function createApp(dependencies: ChatDependencies = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('X-Request-ID', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      if (!origin || origin !== c.env.APP_ORIGIN) throw new ApiError(403, 'INVALID_ORIGIN', 'Origin không được phép.');
    }
    await next();
  });
  app.use('/api/*', bodyLimit({ maxSize: 128 * 1024,
    onError: () => { throw new ApiError(413, 'INPUT_TOO_LARGE', 'Request body quá lớn.'); } }));
  app.get('/api/health', (c) => c.json({ data: { status: 'ok', service: 'cloudflare-chatbot', version: '0.1.0' } }));
  app.route('/api/auth', authRoutes);
  app.use('/api/me', requireAuth);
  app.get('/api/me', (c) => c.json({ data: publicUser(c.get('user')) }));
  app.use('/api/chat/config', requireAuth);
  app.get('/api/chat/config', async (c) => {
    const settings = await getSettings(c.env.DB);
    return c.json({ data: { default_model: settings.default_model, model_allowlist: settings.model_allowlist,
      default_token_limit: settings.default_token_limit, byteplus_model: c.env.BYTEPLUS_MODEL?.trim() || null } });
  });
  app.use('/api/conversations', requireAuth);
  app.use('/api/conversations/*', requireAuth);
  app.route('/api/conversations', conversationRoutes(dependencies));
  app.use('/api/requests/*', requireAuth);
  app.route('/api/requests', requestRoutes);
  app.use('/api/admin/*', requireAuth, requireAdmin);
  app.route('/api/admin', adminRoutes);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy API.', request_id: c.get('requestId') } }, 404));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.status === 429 && typeof error.details.retry_after_seconds === 'number') {
        c.header('Retry-After', String(error.details.retry_after_seconds));
      }
      return c.json({ error: { code: error.code, message: error.message, details: error.details, request_id: c.get('requestId') } }, error.status);
    }
    // Never emit provider payloads, API tokens, user messages or raw exception strings.
    console.error(JSON.stringify({ event: 'backend_error', request_id: c.get('requestId'), path: c.req.path,
      error_type: error.name }));
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ. Vui lòng thử lại sau.', request_id: c.get('requestId') } }, 500);
  });
  return app;
}
