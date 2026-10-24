-- Publish a new settings version. Existing sessions keep their chosen model.
INSERT INTO app_settings (
  default_token_limit, default_model, model_allowlist, system_prompt,
  max_input_bytes, max_output_tokens, message_rate_per_minute,
  conversation_rate_per_hour, updated_by, created_at
)
SELECT default_token_limit, default_model,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM json_each(model_allowlist) WHERE value = 'openai/gpt-oss-120b')
     AND NOT EXISTS (SELECT 1 FROM json_each(model_allowlist) WHERE value = 'openai/gpt-oss-20b')
      THEN json_insert(model_allowlist, '$[#]', 'openai/gpt-oss-120b', '$[#]', 'openai/gpt-oss-20b')
    WHEN NOT EXISTS (SELECT 1 FROM json_each(model_allowlist) WHERE value = 'openai/gpt-oss-120b')
      THEN json_insert(model_allowlist, '$[#]', 'openai/gpt-oss-120b')
    ELSE json_insert(model_allowlist, '$[#]', 'openai/gpt-oss-20b')
  END,
  system_prompt, max_input_bytes, max_output_tokens, message_rate_per_minute,
  conversation_rate_per_hour, updated_by, unixepoch() * 1000
FROM app_settings
WHERE version = (SELECT MAX(version) FROM app_settings)
  AND (NOT EXISTS (SELECT 1 FROM json_each(model_allowlist) WHERE value = 'openai/gpt-oss-120b')
    OR NOT EXISTS (SELECT 1 FROM json_each(model_allowlist) WHERE value = 'openai/gpt-oss-20b'));
