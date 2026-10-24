import type { AiResult, Env } from '../types';
import { ApiError } from '../lib/errors';
import { parseUsage, ProviderError } from './cloudflare-ai';
import type { ChatMessage } from './tokenizer';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function bytePlusConfig(env: Env, snapshotModel?: string | null) {
  const model = (snapshotModel ?? env.BYTEPLUS_MODEL)?.trim();
  if (!env.BYTEPLUS_API_KEY?.trim() || !model) {
    throw new ApiError(503, 'BYTEPLUS_NOT_CONFIGURED', 'Điền BYTEPLUS_API_KEY và BYTEPLUS_MODEL trong cấu hình backend, rồi khởi động lại backend.');
  }
  let base: URL;
  try { base = new URL(env.BYTEPLUS_BASE_URL?.trim() || 'https://ark.ap-southeast.bytepluses.com/api/v3'); }
  catch { throw new ApiError(503, 'BYTEPLUS_CONFIG_INVALID', 'BYTEPLUS_BASE_URL không hợp lệ.'); }
  const context = Number(env.BYTEPLUS_CONTEXT_TOKENS || 32_768);
  const cap = env.BYTEPLUS_MAX_TOKENS_PARAMETER || 'max_completion_tokens';
  const thinking = env.BYTEPLUS_THINKING || 'disabled';
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || base.pathname.endsWith('/chat/completions') || !Number.isSafeInteger(context) || context < 256 || context > 2_000_000
    || !['max_tokens', 'max_completion_tokens'].includes(cap) || !['disabled', 'enabled', 'auto', 'omit'].includes(thinking)
    || (cap === 'max_tokens' && thinking !== 'disabled') || model.length > 200) {
    throw new ApiError(503, 'BYTEPLUS_CONFIG_INVALID', 'Kiểm tra base URL, context và chế độ token của BytePlus. max_tokens yêu cầu BYTEPLUS_THINKING=disabled.');
  }
  return { model, context, cap, thinking, base: base.toString().replace(/\/$/, '') };
}

// Tokenization measures the selected model's text; message framing is an
// estimate. Actual completion usage, including reasoning, decides settlement.
export async function countBytePlusInput(env: Env, prompt: string, snapshotModel?: string | null) {
  const config = bytePlusConfig(env, snapshotModel);
  const messages = JSON.parse(prompt) as ChatMessage[];
  let stage = 'fetch';
  let httpStatus: number | null = null;
  try {
    const response = await fetch(`${config.base}/tokenization`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.BYTEPLUS_API_KEY?.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, text: messages.map((m) => m.content) }),
      signal: AbortSignal.timeout(15_000), redirect: 'manual',
    });
    httpStatus = response.status;
    stage = 'http';
    if (!response.ok) throw new Error('Tokenization rejected');
    stage = 'json';
    const result: unknown = await response.json();
    stage = 'validate';
    if (!record(result) || !Array.isArray(result.data) || result.data.length !== messages.length) throw new Error('Invalid tokens');
    const indices = new Set<number>();
    let total = 0;
    for (const item of result.data) {
      if (!record(item) || !Number.isSafeInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= messages.length
        || indices.has(item.index as number) || !Number.isSafeInteger(item.total_tokens) || (item.total_tokens as number) < 0) throw new Error('Invalid tokens');
      indices.add(item.index as number);
      total += item.total_tokens as number;
    }
    if (!Number.isSafeInteger(total)) throw new Error('Invalid tokens');
    return total + messages.length * 8 + 16;
  } catch (error) {
    // Never log the request, credentials, prompt or upstream response body.
    console.error(JSON.stringify({ event: 'byteplus_tokenization_failed', stage, http_status: httpStatus,
      error_name: error instanceof Error ? error.name : 'unknown' }));
    // No inference has started: retry is safe and the conversation stays active.
    throw new ApiError(503, 'BYTEPLUS_TOKENIZER_UNAVAILABLE', 'Chưa đếm được token từ BytePlus. Kiểm tra API key, model và quyền Tokenization rồi gửi lại; phiên chưa bị khóa.');
  }
}

export async function runBytePlus(env: Env, prompt: string, maxTokens: number, snapshotModel?: string | null): Promise<AiResult> {
  const config = bytePlusConfig(env, snapshotModel);
  let response: Response;
  try {
    response = await fetch(`${config.base}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.BYTEPLUS_API_KEY?.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages: JSON.parse(prompt), stream: false, [config.cap]: maxTokens,
        ...(config.thinking === 'omit' ? {} : { thinking: { type: config.thinking } }) }),
      signal: AbortSignal.timeout(60_000), redirect: 'manual',
    });
  } catch { throw new ProviderError('AI_CONNECTION_UNCERTAIN', 'unknown'); }
  if (!response.ok) {
    const rejected = (response.status >= 300 && response.status < 400)
      || [400, 401, 403, 404, 413, 422, 429].includes(response.status);
    throw new ProviderError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE', rejected ? 'no' : 'unknown');
  }
  let json: unknown;
  try { json = await response.json(); } catch { throw new ProviderError('AI_INVALID_RESPONSE', 'unknown'); }
  if (!record(json)) throw new ProviderError('AI_INVALID_RESPONSE', 'unknown');
  const usage = parseUsage(json.usage);
  if (!usage) throw new ProviderError('USAGE_PENDING', 'unknown');
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const message = record(choice) && record(choice.message) ? choice.message : null;
  const content = message?.content;
  return { content: typeof content === 'string' && new TextEncoder().encode(content).byteLength <= 256_000 ? content : '',
    usage, provider_request_id: response.headers.get('x-request-id') ?? (typeof json.id === 'string' ? json.id : null) };
}
