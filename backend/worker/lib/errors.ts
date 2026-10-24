import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodType } from 'zod';
import type { AppEnv } from '../types';

export class ApiError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, message: string,
    public details: Record<string, unknown> = {}) { super(message); }
}
export async function readJson<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Yêu cầu Content-Type: application/json.');
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new ApiError(400, 'INVALID_JSON', 'JSON không hợp lệ.'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return parsed.data;
}
export function pagination(c: Context<AppEnv>) {
  const limit = Number(c.req.query('limit') ?? 30);
  const offset = Number(c.req.query('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Tham số phân trang không hợp lệ.');
  }
  return { limit, offset };
}
