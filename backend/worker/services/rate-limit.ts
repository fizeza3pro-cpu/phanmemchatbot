import { ApiError } from '../lib/errors';

export async function rateLimit(db: D1Database, key: string, maximum: number, windowMs: number) {
  const now = Date.now();
  const start = Math.floor(now / windowMs) * windowMs;
  const row = await db.prepare(`INSERT INTO rate_limits (key, window_start, count, expires_at)
    VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
    window_start = excluded.window_start, expires_at = excluded.expires_at RETURNING count`)
    .bind(key, start, start + windowMs).first<{ count: number }>();
  if (!row || row.count > maximum) {
    throw new ApiError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.', {
      retry_after_seconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)),
    });
  }
}
