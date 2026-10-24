PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  oauth_subject TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE app_settings (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  default_token_limit INTEGER NOT NULL CHECK (default_token_limit BETWEEN 1 AND 1000000),
  default_model TEXT NOT NULL,
  model_allowlist TEXT NOT NULL CHECK (json_valid(model_allowlist)),
  system_prompt TEXT NOT NULL,
  max_input_bytes INTEGER NOT NULL CHECK (max_input_bytes BETWEEN 1 AND 65536),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 4096),
  message_rate_per_minute INTEGER NOT NULL CHECK (message_rate_per_minute BETWEEN 1 AND 120),
  conversation_rate_per_hour INTEGER NOT NULL CHECK (conversation_rate_per_hour BETWEEN 1 AND 1000),
  updated_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
INSERT INTO app_settings (
  default_token_limit, default_model, model_allowlist, system_prompt,
  max_input_bytes, max_output_tokens, message_rate_per_minute,
  conversation_rate_per_hour, created_at
) VALUES (
  2000, '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '["@cf/meta/llama-3.3-70b-instruct-fp8-fast","@cf/meta/llama-3.1-8b-instruct-fast"]',
  'Bạn là trợ lý AI hữu ích. Trả lời rõ ràng bằng tiếng Việt, trừ khi người dùng yêu cầu ngôn ngữ khác.',
  16384, 512, 20, 30, unixepoch() * 1000
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'usage_pending', 'limit_reached', 'archived', 'deleted')),
  lock_reason TEXT,
  model TEXT NOT NULL,
  token_limit INTEGER NOT NULL CHECK (token_limit BETWEEN 1 AND 1000000),
  used_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (used_input_tokens >= 0),
  used_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (used_output_tokens >= 0),
  used_total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (used_total_tokens = used_input_tokens + used_output_tokens),
  active_request_id TEXT,
  settings_version INTEGER NOT NULL REFERENCES app_settings(version),
  system_prompt_snapshot TEXT NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  max_input_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX conversations_user_updated ON conversations(user_id, updated_at DESC);

CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  client_request_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'rejected', 'failed', 'usage_pending', 'suppressed')),
  user_content TEXT,
  provider_request_id TEXT,
  preflight_input_tokens INTEGER,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  max_output_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  usage_status TEXT NOT NULL DEFAULT 'unknown' CHECK (usage_status IN ('unknown', 'not_incurred', 'settled')),
  error_code TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (conversation_id, client_request_id)
);
CREATE INDEX ai_requests_status_started ON ai_requests(status, started_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  request_id TEXT NOT NULL REFERENCES ai_requests(id),
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (request_id, role),
  UNIQUE (conversation_id, sequence)
);
CREATE INDEX messages_conversation_sequence ON messages(conversation_id, sequence);

CREATE TABLE token_ledger (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  request_id TEXT NOT NULL UNIQUE REFERENCES ai_requests(id),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens = input_tokens + output_tokens),
  source TEXT NOT NULL CHECK (source IN ('provider', 'admin_reconciliation')),
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  created_at INTEGER NOT NULL
);
