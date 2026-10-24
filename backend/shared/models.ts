export const SUPPORTED_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fast',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'byteplus/configured',
] as const;

export type ModelId = (typeof SUPPORTED_MODELS)[number];
export const MODEL_CONTEXT: Record<ModelId, number> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 24_000,
  // Conservative published Cloudflare AI Search limit until direct inference
  // context/usage are checked with this account; do not assume 131072.
  '@cf/meta/llama-3.1-8b-instruct-fast': 60_000,
  'openai/gpt-oss-120b': 131_072,
  'openai/gpt-oss-20b': 131_072,
  'byteplus/configured': 32_768,
};
export type ProviderId = 'cloudflare' | 'groq' | 'byteplus';
export const MODEL_PROVIDERS: Record<ModelId, ProviderId> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'cloudflare',
  '@cf/meta/llama-3.1-8b-instruct-fast': 'cloudflare',
  'openai/gpt-oss-120b': 'groq',
  'openai/gpt-oss-20b': 'groq',
  'byteplus/configured': 'byteplus',
};
export const MODEL_NAMES: Record<ModelId, string> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'Llama 3.3 · 70B',
  '@cf/meta/llama-3.1-8b-instruct-fast': 'Llama 3.1 · 8B',
  'openai/gpt-oss-120b': 'GPT‑OSS · 120B',
  'openai/gpt-oss-20b': 'GPT‑OSS · 20B',
  'byteplus/configured': 'Model đã cấu hình',
};
export const PROVIDER_NAMES: Record<ProviderId, string> = { cloudflare: 'Cloudflare Workers AI', groq: 'Groq', byteplus: 'BytePlus ModelArk' };
