import type { Env } from '../types';
import { MODEL_PROVIDERS, type ModelId } from '../../shared/models';
import { requireAiConfig as requireCloudflareConfig, runCloudflare } from './cloudflare-ai';
import { requireGroqConfig, runGroq } from './groq-ai';
import { bytePlusConfig, runBytePlus } from './byteplus-ai';

export function requireAiConfig(env: Env, model: ModelId, snapshotModel?: string | null) {
  if (MODEL_PROVIDERS[model] === 'byteplus') bytePlusConfig(env, snapshotModel);
  else if (MODEL_PROVIDERS[model] === 'groq') requireGroqConfig(env);
  else requireCloudflareConfig(env);
}
export function runAi(env: Env, model: ModelId, prompt: string, maxTokens: number, snapshotModel?: string | null) {
  if (MODEL_PROVIDERS[model] === 'byteplus') return runBytePlus(env, prompt, maxTokens, snapshotModel);
  return MODEL_PROVIDERS[model] === 'groq' ? runGroq(env, model, prompt, maxTokens) : runCloudflare(env, model, prompt, maxTokens);
}
