import type { AiResult, Env, Usage } from '../types';
import type { ModelId } from '../../shared/models';
import { ApiError } from '../lib/errors';

export class ProviderError extends Error {
  constructor(public code: string, public incurred: 'no' | 'unknown') { super(code); }
}
export function requireAiConfig(env: Env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID) || !env.CLOUDFLARE_API_TOKEN) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Chưa cấu hình Cloudflare Account ID và API token trên máy chủ.');
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseUsage(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  const input = value.prompt_tokens;
  const output = value.completion_tokens;
  const total = value.total_tokens;
  if (typeof input !== 'number' || typeof output !== 'number' || typeof total !== 'number'
    || ![input, output, total].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 2_000_000)
    || input + output !== total) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}
export async function runCloudflare(env: Env, model: ModelId, prompt: string, maxTokens: number): Promise<AiResult> {
  requireAiConfig(env);
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, raw: true, stream: false, max_tokens: maxTokens, temperature: 0.6 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new ProviderError('AI_CONNECTION_UNCERTAIN', 'unknown'); }
  if (!response.ok) {
    const definitelyRejected = [400, 401, 403, 404, 413, 422, 429].includes(response.status);
    throw new ProviderError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE', definitelyRejected ? 'no' : 'unknown');
  }
  let json: unknown;
  try { json = await response.json(); } catch { throw new ProviderError('AI_INVALID_RESPONSE', 'unknown'); }
  if (!isRecord(json) || json.success !== true || !isRecord(json.result)) {
    throw new ProviderError('AI_INVALID_RESPONSE', 'unknown');
  }
  const usage = parseUsage(json.result.usage);
  if (!usage) throw new ProviderError('USAGE_PENDING', 'unknown');
  const content = json.result.response;
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > 256_000) {
    // Preserve known usage even if provider content is malformed.
    return { content: '', usage, provider_request_id: response.headers.get('cf-ray') };
  }
  return { content, usage, provider_request_id: response.headers.get('cf-ray') };
}
