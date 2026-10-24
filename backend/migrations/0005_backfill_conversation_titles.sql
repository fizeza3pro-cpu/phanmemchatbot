-- Name earlier conversations that still have the default title after an answer.
UPDATE conversations
SET title = substr(trim(replace(replace(replace(
  (SELECT content FROM messages
   WHERE conversation_id = conversations.id AND role = 'user'
   ORDER BY sequence LIMIT 1), char(13), ' '), char(10), ' '), char(9), ' ')), 1, 70)
WHERE title = 'Cuộc trò chuyện mới'
  AND status != 'deleted'
  AND EXISTS (SELECT 1 FROM messages
              WHERE conversation_id = conversations.id AND role = 'assistant');
