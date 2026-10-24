import { MODEL_CONTEXT, MODEL_PROVIDERS, SUPPORTED_MODELS, type ModelId } from '../../shared/models';
import { ApiError } from '../lib/errors';
import type { Env } from '../types';
import { countBytePlusInput } from './byteplus-ai';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export function buildPrompt(messages: ChatMessage[], model?: ModelId) {
  // User text must never become a model control token in raw prompt mode.
  const escape = (text: string) => text.replace(/<\|/g, '< |');
  if (model && MODEL_PROVIDERS[model] !== 'cloudflare') {
    return JSON.stringify(messages.map((message) => ({ role: message.role, content: escape(message.content.trim()) })));
  }
  return '<|begin_of_text|>' + messages.map((message) =>
    `<|start_header_id|>${message.role}<|end_header_id|>\n\n${escape(message.content.trim())}<|eot_id|>`)
    .join('') + '<|start_header_id|>assistant<|end_header_id|>\n\n';
}
export async function countInput(prompt: string, model: ModelId, mode: 'conservative' | 'verified' = 'verified',
  provider?: { env: Env; model: string | null }) {
  if (!SUPPORTED_MODELS.includes(model)) throw new ApiError(503, 'MODEL_NOT_SUPPORTED', 'Model chưa được hỗ trợ kiểm tra token.');
  if (MODEL_PROVIDERS[model] === 'byteplus') {
    if (!provider) throw new ApiError(503, 'BYTEPLUS_NOT_CONFIGURED', 'Chưa cấu hình đếm token BytePlus.');
    return countBytePlusInput(provider.env, prompt, provider.model);
  }
  if (MODEL_PROVIDERS[model] === 'groq') {
    const { encodeChat } = await import('gpt-tokenizer/model/gpt-oss-120b');
    const messages = JSON.parse(prompt) as ChatMessage[];
    // GPT-OSS uses o200k_harmony. Actual usage remains authoritative;
    // extra provider framing is estimated until checked with this account.
    return encodeChat(messages).length + 32;
  }
  if (mode === 'verified') {
    // Enabled only after the operator verifies this tokenizer and raw template
    // against the selected Cloudflare model. End-of-request usage remains authoritative.
    const { default: tokenizer } = await import('llama3-tokenizer-js');
    // Stored Cloudflare Llama 3.3 usage includes one additional input token.
    // Reserve two for provider-added BOS/EOS instead of counting UTF-8 bytes.
    return tokenizer.encode(prompt, { bos: false, eos: false }).length + 2;
  }
  // Llama's byte-level BPE cannot use more content tokens than UTF-8 bytes.
  // Count the entire raw template too, plus allowance for provider BOS/EOS.
  // This deliberately over-reserves; it is not advertised as the exact usage.
  return new TextEncoder().encode(prompt).byteLength + 2;
}
export function outputBudget(limit: number, used: number, input: number, configuredMax: number, model: ModelId, context?: number | null) {
  const available = Math.min(limit - used - input, (context ?? MODEL_CONTEXT[model]) - input);
  return Math.max(0, Math.min(configuredMax, available));
}
