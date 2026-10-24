import type { ModelId } from './models';

// Plain domain types can be consumed by the UI without installing the Workers runtime.
export interface User {
  id: string; email: string; display_name: string; oauth_subject: string | null;
  role: 'user' | 'admin'; status: 'active' | 'blocked'; created_at: number; updated_at: number;
}
export type ConversationStatus = 'active' | 'processing' | 'usage_pending' | 'limit_reached' | 'archived' | 'deleted';
export interface Conversation {
  id: string; user_id: string; title: string; status: ConversationStatus; lock_reason: string | null;
  model: ModelId; token_limit: number; used_input_tokens: number; used_output_tokens: number;
  provider_model: string | null; model_context_tokens: number | null;
  used_total_tokens: number; active_request_id: string | null; settings_version: number;
  system_prompt_snapshot: string; max_output_tokens: number; max_input_bytes: number;
  created_at: number; updated_at: number;
}
export interface Message {
  id: string; conversation_id: string; request_id: string; sequence: number;
  role: 'user' | 'assistant'; content: string; created_at: number;
}
export interface AiRequest {
  id: string; conversation_id: string; user_id: string; client_request_id: string; content_hash: string;
  status: 'processing' | 'completed' | 'rejected' | 'failed' | 'usage_pending' | 'suppressed';
  user_content: string | null; provider_request_id: string | null; preflight_input_tokens: number | null;
  reserved_tokens: number; max_output_tokens: number | null; input_tokens: number | null;
  output_tokens: number | null; total_tokens: number | null;
  usage_status: 'unknown' | 'not_incurred' | 'settled'; error_code: string | null;
  started_at: number; completed_at: number | null;
}
export interface Settings {
  version: number; default_token_limit: number; default_model: ModelId; model_allowlist: ModelId[];
  system_prompt: string; max_input_bytes: number; max_output_tokens: number;
  message_rate_per_minute: number; conversation_rate_per_hour: number;
  updated_by: string | null; created_at: number;
}
export interface Usage { input_tokens: number; output_tokens: number; total_tokens: number }
export interface AiResult { content: string; usage: Usage; provider_request_id: string | null }
