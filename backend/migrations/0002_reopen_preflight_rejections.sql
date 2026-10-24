-- A preflight rejection never called the provider and did not spend tokens.
-- Repair only sessions closed for that reason while actual usage is below quota.
-- Keep genuinely exhausted, uncertain and in-flight sessions untouched.
UPDATE conversations
SET status = 'active', lock_reason = NULL, updated_at = unixepoch() * 1000
WHERE status = 'limit_reached'
  AND lock_reason = 'INSUFFICIENT_TOKEN_BUDGET'
  AND used_total_tokens < token_limit
  AND active_request_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ai_requests
    WHERE conversation_id = conversations.id
      AND status = 'rejected'
      AND error_code = 'INSUFFICIENT_TOKEN_BUDGET'
      AND usage_status = 'not_incurred'
  )
  AND NOT EXISTS (
    SELECT 1 FROM ai_requests
    WHERE conversation_id = conversations.id
      AND (usage_status = 'unknown' OR status IN ('processing', 'usage_pending', 'suppressed'))
  );
