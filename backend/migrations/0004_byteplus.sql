ALTER TABLE conversations ADD COLUMN provider_model TEXT;
ALTER TABLE conversations ADD COLUMN model_context_tokens INTEGER;

-- Preserve the current defaults and all existing conversation snapshots.
INSERT INTO app_settings (
  default_token_limit, default_model, model_allowlist, system_prompt,
  max_input_bytes, max_output_tokens, message_rate_per_minute,
  conversation_rate_per_hour, updated_by, created_at
)
SELECT default_token_limit, default_model,
  json_insert(model_allowlist, '$[#]', 'byteplus/configured'),
  system_prompt, max_input_bytes, max_output_tokens, message_rate_per_minute,
  conversation_rate_per_hour, updated_by, unixepoch() * 1000
FROM app_settings
WHERE version = (SELECT MAX(version) FROM app_settings)
  AND NOT EXISTS (SELECT 1 FROM json_each(model_allowlist) WHERE value = 'byteplus/configured');
