import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '../shared/domain';
export type { User, ConversationStatus, Conversation, Message, AiRequest, Settings, Usage, AiResult } from '../shared/domain';

export interface Env {
  DB: D1Database;
  ENVIRONMENT: 'development' | 'production' | 'test';
  APP_ORIGIN: string;
  ENABLE_DEV_AUTH?: string;
  ADMIN_EMAILS?: string;
  TOKEN_COUNT_MODE?: 'conservative' | 'verified';
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GROQ_API_KEY?: string;
  BYTEPLUS_API_KEY?: string;
  BYTEPLUS_BASE_URL?: string;
  BYTEPLUS_MODEL?: string;
  BYTEPLUS_CONTEXT_TOKENS?: string;
  BYTEPLUS_MAX_TOKENS_PARAMETER?: 'max_completion_tokens' | 'max_tokens';
  BYTEPLUS_THINKING?: 'disabled' | 'enabled' | 'auto' | 'omit';
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
export type AppEnv = {
  Bindings: Env;
  Variables: { user: User; requestId: string };
};
