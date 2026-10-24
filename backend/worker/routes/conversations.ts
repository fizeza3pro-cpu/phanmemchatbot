import { Hono } from 'hono';
import type { AiRequest, AppEnv } from '../types';
import { createConversationSchema, sendMessageSchema, updateConversationSchema } from '../../shared/schemas';
import { ApiError, pagination, readJson } from '../lib/errors';
import { getSettings } from '../repositories/settings';
import { buildPrompt, countInput, outputBudget } from '../services/tokenizer';
import { createConversation, deleteConversation, getHistory, getMessages, getOwnedConversation,
  listConversations, publicConversation, updateConversation } from '../repositories/conversations';
import { rateLimit } from '../services/rate-limit';
import { sendMessage, type ChatDependencies } from '../services/chat';
import { bytePlusConfig } from '../services/byteplus-ai';

export function conversationRoutes(dependencies: ChatDependencies = {}) {
  const router = new Hono<AppEnv>();
  router.post('/', async (c) => {
    const body = await readJson(c, createConversationSchema);
    const settings = await getSettings(c.env.DB);
    if (body.model && !settings.model_allowlist.includes(body.model)) throw new ApiError(503, 'MODEL_DISABLED', 'Model đang bị tắt.');
    const provider = (body.model ?? settings.default_model) === 'byteplus/configured' ? bytePlusConfig(c.env) : undefined;
    await rateLimit(c.env.DB, `conversation:${c.get('user').id}`, settings.conversation_rate_per_hour, 3_600_000);
    const row = await createConversation(c.env.DB, c.get('user').id, body.title,
      body.model ? { ...settings, default_model: body.model } : settings, provider);
    return c.json({ data: publicConversation(row) }, 201);
  });
  router.get('/', async (c) => {
    const { limit, offset } = pagination(c);
    const search = (c.req.query('search') ?? '').slice(0, 120);
    return c.json({ data: await listConversations(c.env.DB, c.get('user').id, limit, offset, search) });
  });
  router.get('/:id', async (c) => {
    const row = await getOwnedConversation(c.env.DB, c.req.param('id'), c.get('user').id);
    const { limit } = pagination(c);
    const before = Number(c.req.query('before') ?? Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'before không hợp lệ.');
    const mode = c.env.TOKEN_COUNT_MODE ?? 'verified';
    let estimate: { next_input_tokens: number; available_output_tokens: number } | null = null;
    try {
      const history = await getHistory(c.env.DB, row.id);
      const prompt = buildPrompt([{ role: 'system', content: row.system_prompt_snapshot },
        ...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: '' }], row.model);
      // Polling/history reads must never call a metered external provider.
      if (row.model !== 'byteplus/configured') {
        const input = await countInput(prompt, row.model, mode);
        estimate = { next_input_tokens: input, available_output_tokens: outputBudget(row.token_limit,
          row.used_total_tokens, input, row.max_output_tokens, row.model) };
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'INPUT_TOO_LARGE')) throw error;
    }
    return c.json({ data: { conversation: publicConversation(row), messages: await getMessages(c.env.DB, row.id, limit, before),
      token_count_mode: mode, budget_estimate: estimate } });
  });
  router.patch('/:id', async (c) => {
    const body = await readJson(c, updateConversationSchema);
    const row = await getOwnedConversation(c.env.DB, c.req.param('id'), c.get('user').id);
    return c.json({ data: publicConversation(await updateConversation(c.env.DB, row, body)) });
  });
  router.delete('/:id', async (c) => {
    await deleteConversation(c.env.DB, await getOwnedConversation(c.env.DB, c.req.param('id'), c.get('user').id));
    return c.body(null, 204);
  });
  router.post('/:id/messages', async (c) => {
    const body = await readJson(c, sendMessageSchema);
    return c.json({ data: await sendMessage(c.env, c.get('user').id, c.req.param('id'), body.request_id, body.content, dependencies) });
  });
  return router;
}
export const requestRoutes = new Hono<AppEnv>();
requestRoutes.get('/:id', async (c) => {
  const request = await c.env.DB.prepare(`SELECT r.* FROM ai_requests r JOIN conversations v ON v.id = r.conversation_id
    WHERE r.id = ? AND r.user_id = ? AND v.status != 'deleted'`).bind(c.req.param('id'), c.get('user').id).first<AiRequest>();
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy lượt chat.');
  const message = request.status === 'completed'
    ? await c.env.DB.prepare("SELECT id, role, content, sequence, created_at FROM messages WHERE request_id = ? AND role = 'assistant'")
      .bind(request.id).first() : null;
  const conversation = await getOwnedConversation(c.env.DB, request.conversation_id, c.get('user').id);
  return c.json({ data: {
    request_id: request.id, client_request_id: request.client_request_id, status: request.status,
    error_code: request.error_code, usage_status: request.usage_status, message,
    usage: request.usage_status === 'settled' ? { input_tokens: request.input_tokens,
      output_tokens: request.output_tokens, total_tokens: request.total_tokens } : null,
    conversation: publicConversation(conversation),
  } });
});
