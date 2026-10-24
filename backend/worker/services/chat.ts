import type { AiRequest, AiResult, Conversation, Env, Message } from '../types';
import { ApiError } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { getSettings } from '../repositories/settings';
import { getHistory, getOwnedConversation, publicConversation } from '../repositories/conversations';
import { assistantForRequest, claimRequest, findRequest, finishWithoutUsage, getRequest, reserveRequest, settleRequest } from '../repositories/requests';
import { buildPrompt, countInput, outputBudget } from './tokenizer';
import { ProviderError } from './cloudflare-ai';
import { requireAiConfig, runAi } from './ai-provider';
import { MODEL_PROVIDERS, PROVIDER_NAMES } from '../../shared/models';
import { rateLimit } from './rate-limit';

export interface ChatDependencies {
  runAi?: typeof runAi;
  countTokens?: typeof countInput;
}
function quotaError(row: Conversation, code = 'SESSION_TOKEN_LIMIT_EXCEEDED') {
  return new ApiError(409, code, 'Phiên không còn đủ token để trả lời. Hãy tạo phiên mới.', {
    used_tokens: row.used_total_tokens, token_limit: row.token_limit, requires_new_conversation: true,
  });
}
function inputBudgetError(row: Conversation, input: number | null) {
  return new ApiError(409, 'INSUFFICIENT_TOKEN_BUDGET',
    'Token còn lại chưa đủ cho câu hỏi và lịch sử của lượt này. Hãy rút gọn câu hỏi hoặc tạo phiên mới. Phiên chưa bị khóa.', {
      used_tokens: row.used_total_tokens, token_limit: row.token_limit,
      remaining_tokens: Math.max(0, row.token_limit - row.used_total_tokens),
      preflight_input_tokens: input, requires_new_conversation: false,
    });
}
function stateError(row: Conversation): never {
  if (row.status === 'limit_reached' || row.used_total_tokens >= row.token_limit) throw quotaError(row);
  if (row.status === 'usage_pending') throw new ApiError(409, 'USAGE_PENDING', 'Đang xác nhận usage của lượt trước.');
  if (row.status === 'processing') throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Phiên đang xử lý một lượt chat.');
  throw new ApiError(409, 'SESSION_NOT_ACTIVE', 'Phiên chat hiện không hoạt động.');
}
export async function requestResult(db: D1Database, request: AiRequest, conversation: Conversation) {
  if (request.status === 'completed') {
    const message = await assistantForRequest(db, request.id);
    if (!message) throw new Error('Completed request is missing its persisted answer.');
    return { request_id: request.id, client_request_id: request.client_request_id, status: request.status,
      message, usage: { input_tokens: request.input_tokens, output_tokens: request.output_tokens, total_tokens: request.total_tokens },
      conversation: publicConversation(conversation) };
  }
  if (request.status === 'rejected' || request.status === 'suppressed') {
    if (request.status === 'rejected' && request.error_code === 'INSUFFICIENT_TOKEN_BUDGET'
      && conversation.used_total_tokens < conversation.token_limit) {
      throw inputBudgetError(conversation, request.preflight_input_tokens);
    }
    if (request.error_code === 'AI_USAGE_MISMATCH') {
      throw new ApiError(502, 'AI_USAGE_MISMATCH', 'Usage của model không khớp ngân sách. Phiên đã khóa.', { requires_new_conversation: true });
    }
    if (request.error_code === 'AI_EMPTY_RESPONSE') {
      throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'Model chưa tạo câu trả lời hiển thị. Token thực tế đã được ghi nhận; nếu phiên còn ngân sách, bạn có thể sửa câu hỏi và gửi lại.',
        { requires_new_conversation: conversation.status === 'limit_reached' });
    }
    throw quotaError(conversation, request.error_code ?? undefined);
  }
  if (request.status === 'usage_pending') {
    throw new ApiError(409, 'USAGE_PENDING', 'Lượt trước cần xác nhận usage trước khi tiếp tục.', { request_id: request.id });
  }
  if (request.status === 'failed') {
    throw new ApiError(request.error_code === 'INPUT_TOO_LARGE' ? 413 : 502,
      request.error_code ?? 'AI_UNAVAILABLE', 'Không xử lý được lượt này. Hãy gửi lượt mới khi lỗi đã được giải quyết.');
  }
  throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Lượt này đang được xử lý.', { request_id: request.id });
}
export async function sendMessage(env: Env, userId: string, conversationId: string,
  clientId: string, content: string, dependencies: ChatDependencies = {}) {
  const db = env.DB;
  let conversation = await getOwnedConversation(db, conversationId, userId);
  const hash = await sha256(content);
  const existing = await findRequest(db, conversationId, clientId);
  if (existing) {
    if (existing.content_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'request_id đã được dùng với nội dung khác.');
    return requestResult(db, existing, conversation);
  }
  if (conversation.status !== 'active' || conversation.used_total_tokens >= conversation.token_limit) stateError(conversation);
  if (new TextEncoder().encode(content).byteLength > conversation.max_input_bytes) {
    throw new ApiError(413, 'INPUT_TOO_LARGE', 'Câu hỏi vượt giới hạn độ dài đầu vào.');
  }
  const settings = await getSettings(db);
  if (!settings.model_allowlist.includes(conversation.model)) throw new ApiError(503, 'MODEL_DISABLED', 'Model của phiên này đang bị tắt.');
  if (!dependencies.runAi) requireAiConfig(env, conversation.model, conversation.provider_model);
  await rateLimit(db, `message:${userId}`, settings.message_rate_per_minute, 60_000);
  let request: AiRequest | null;
  try {
    request = await claimRequest(db, conversationId, userId, clientId, hash, content);
  } catch (error) {
    const raced = await findRequest(db, conversationId, clientId);
    if (!raced) throw error;
    if (raced.content_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'request_id đã được dùng với nội dung khác.');
    return requestResult(db, raced, await getOwnedConversation(db, conversationId, userId));
  }
  if (!request) {
    // A competing request may have created the same idempotency record.
    const raced = await findRequest(db, conversationId, clientId);
    if (raced) {
      if (raced.content_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'request_id đã được dùng với nội dung khác.');
      return requestResult(db, raced, await getOwnedConversation(db, conversationId, userId));
    }
    stateError(await getOwnedConversation(db, conversationId, userId));
  }
  // Refetch the snapshot after the claim: an admin limit edit could precede it.
  conversation = await getOwnedConversation(db, conversationId, userId);
  let input: number;
  let maxOutput: number;
  let prompt: string;
  try {
    const history = await getHistory(db, conversationId);
    prompt = buildPrompt([{ role: 'system', content: conversation.system_prompt_snapshot },
      ...history.map((m: Message) => ({ role: m.role, content: m.content })), { role: 'user', content }], conversation.model);
    input = await (dependencies.countTokens ?? countInput)(prompt, conversation.model, env.TOKEN_COUNT_MODE ?? 'verified',
      { env, model: conversation.provider_model });
    if (!Number.isSafeInteger(input) || input < 1) throw new Error('Invalid tokenizer count.');
    maxOutput = outputBudget(conversation.token_limit, conversation.used_total_tokens, input, conversation.max_output_tokens, conversation.model, conversation.model_context_tokens);
    if (maxOutput < 1) {
      // A large prompt is rejected before inference; it does not consume tokens
      // or exhaust the session. A shorter question can still fit its budget.
      await finishWithoutUsage(db, request, 'INSUFFICIENT_TOKEN_BUDGET', 'rejected', false, input);
      throw inputBudgetError(conversation, input);
    }
    if (!await reserveRequest(db, request, input, maxOutput)) {
      throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Trạng thái phiên vừa thay đổi.');
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'INSUFFICIENT_TOKEN_BUDGET')) {
      await finishWithoutUsage(db, request, error instanceof ApiError ? error.code : 'TOKENIZER_ERROR', 'failed', false);
    }
    throw error;
  }
  let result: AiResult;
  try {
    const provider = dependencies.runAi ?? runAi;
    result = conversation.model === 'byteplus/configured'
      ? await provider(env, conversation.model, prompt, maxOutput, conversation.provider_model)
      : await provider(env, conversation.model, prompt, maxOutput);
  }
  catch (error) {
    const provider = error instanceof ProviderError ? error : new ProviderError('AI_CONNECTION_UNCERTAIN', 'unknown');
    await finishWithoutUsage(db, request, provider.code, provider.incurred === 'no' ? 'failed' : 'usage_pending', false);
    throw new ApiError(provider.incurred === 'no' ? 502 : 503,
      provider.incurred === 'no' ? provider.code : 'USAGE_PENDING',
      provider.incurred === 'no' ? `${PROVIDER_NAMES[MODEL_PROVIDERS[conversation.model]]} từ chối lượt này. Vui lòng thử lại sau.` : 'Chưa xác nhận được usage. Phiên tạm ngừng để đối soát.',
      { request_id: request.id });
  }
  const freshRequest = await getRequest(db, request.id);
  if (!freshRequest) throw new Error('Request disappeared before settlement.');
  // Input estimates can differ. Settlement checks actual total before output
  // is released; an input mismatch by itself does not exhaust the session.
  const mismatch = result.usage.output_tokens > maxOutput;
  // Content is persisted only after the actual usage passes every quota guard.
  await settleRequest(db, freshRequest, { usage: result.usage, content: result.content,
    providerRequestId: result.provider_request_id, source: 'provider',
    suppressReason: mismatch ? 'AI_USAGE_MISMATCH' : result.content.trim() ? undefined : 'AI_EMPTY_RESPONSE' });
  const finalRequest = await getRequest(db, request.id);
  if (!finalRequest) throw new Error('Settlement did not persist.');
  return requestResult(db, finalRequest, await getOwnedConversation(db, conversationId, userId));
}
