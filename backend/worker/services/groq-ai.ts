import type { AiResult, Env } from '../types';
import type { ModelId } from '../../shared/models';
import { ApiError } from '../lib/errors';
import { parseUsage, ProviderError } from './cloudflare-ai';
import type { ChatMessage } from './tokenizer';

export function requireGroqConfig(env: Env) {
  if (!env.GROQ_API_KEY?.trim()) throw new ApiError(503, 'GROQ_NOT_CONFIGURED', 'Chưa cấu hình GROQ_API_KEY trên máy chủ.');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function runGroq(env: Env, model: ModelId, prompt: string, maxTokens: number): Promise<AiResult> {
  requireGroqConfig(env);
  const messages = JSON.parse(prompt) as ChatMessage[];
  let response: Response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, max_completion_tokens: maxTokens,
        reasoning_effort: 'low', include_reasoning: false, temperature: 0.6 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new ProviderError('AI_CONNECTION_UNCERTAIN', 'unknown'); }
  if (!response.ok) {
    const rejected = [400, 401, 403, 404, 413, 422, 429].includes(response.status);
    throw new ProviderError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE', rejected ? 'no' : 'unknown');
  }
  let json: unknown;
  try { json = await response.json(); } catch { throw new ProviderError('AI_INVALID_RESPONSE', 'unknown'); }
  if (!isRecord(json)) throw new ProviderError('AI_INVALID_RESPONSE', 'unknown');
  // completion_tokens already includes reasoning: do not count it twice.
  const usage = parseUsage(json.usage);
  if (!usage) throw new ProviderError('USAGE_PENDING', 'unknown');
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
  const content = message?.content;
  return { content: typeof content === 'string' && new TextEncoder().encode(content).byteLength <= 256_000 ? content : '',
    usage, provider_request_id: response.headers.get('x-request-id') ?? (typeof json.id === 'string' ? json.id : null) };
}
