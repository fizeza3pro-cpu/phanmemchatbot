import type {
  Conversation as StoredConversation,
  Message,
  Settings,
  User as StoredUser,
  Usage,
  AiRequest,
} from '../../../backend/shared/domain';
export type { ModelId } from '../../../backend/shared/models';
import type { ModelId } from '../../../backend/shared/models';
export interface ChatConfig {
  default_model: ModelId;
  model_allowlist: ModelId[];
  default_token_limit?: number;
  byteplus_model?: string | null;
}
export type User = Pick<
  StoredUser,
  'id' | 'email' | 'display_name' | 'role' | 'status' | 'created_at'
>;
export type Conversation = Omit<
  StoredConversation,
  'user_id' | 'system_prompt_snapshot'
> & {
  remaining_tokens: number;
  requires_new_conversation: boolean;
};
export type { Message, Settings, Usage };
export type SettingsInput = Omit<
  Settings,
  'version' | 'updated_by' | 'created_at'
>;
export interface Page<T> {
  items: T[];
  next_offset: number | null;
}
export interface ConversationDetail {
  conversation: Conversation;
  messages: { items: Message[]; next_before: number | null };
  token_count_mode: 'conservative' | 'verified';
  budget_estimate?: {
    next_input_tokens: number;
    available_output_tokens: number;
  } | null;
}
export interface SendResult {
  request_id: string;
  client_request_id: string;
  status: 'completed';
  message: Message;
  usage: Usage;
  conversation: Conversation;
}
export interface RequestResult {
  request_id: string;
  client_request_id: string;
  status: AiRequest['status'];
  error_code: string | null;
  usage_status: AiRequest['usage_status'];
  message: Pick<
    Message,
    'id' | 'role' | 'content' | 'sequence' | 'created_at'
  > | null;
  usage: Usage | null;
  conversation: Conversation;
}
export type AdminRequest = Pick<
  AiRequest,
  | 'id'
  | 'conversation_id'
  | 'user_id'
  | 'status'
  | 'provider_request_id'
  | 'preflight_input_tokens'
  | 'max_output_tokens'
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'usage_status'
  | 'error_code'
  | 'started_at'
  | 'completed_at'
>;
export interface AuditLog {
  id: string;
  actor_id: string;
  action: string;
  target_id: string;
  metadata: string;
  created_at: number;
}
export interface Stats {
  users: { total: number; active: number | null };
  conversations: {
    total: number;
    locked: number | null;
    usage_pending: number | null;
  };
  requests: { total: number; completed: number | null; errors: number | null };
  tokens: Usage;
}
