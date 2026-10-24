import { z } from 'zod';
import { SUPPORTED_MODELS } from './models';

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).default('Cuộc trò chuyện mới'),
  model: z.enum(SUPPORTED_MODELS).optional(),
}).strict();
export const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
}).strict().refine((v) => v.title !== undefined || v.archived !== undefined, 'Không có thay đổi.');
export const sendMessageSchema = z.object({
  request_id: z.string().uuid(),
  content: z.string().trim().min(1).max(65536),
}).strict();
export const settingsSchema = z.object({
  default_token_limit: z.number().int().min(1).max(1_000_000),
  default_model: z.enum(SUPPORTED_MODELS),
  model_allowlist: z.array(z.enum(SUPPORTED_MODELS)).min(1).max(SUPPORTED_MODELS.length),
  system_prompt: z.string().trim().min(1).max(4000),
  max_input_bytes: z.number().int().min(1).max(65536),
  max_output_tokens: z.number().int().min(1).max(4096),
  message_rate_per_minute: z.number().int().min(1).max(120),
  conversation_rate_per_hour: z.number().int().min(1).max(1000),
}).strict().refine((v) => v.model_allowlist.includes(v.default_model), {
  message: 'Model mặc định phải nằm trong danh sách cho phép.', path: ['default_model'],
}).refine((v) => new Set(v.model_allowlist).size === v.model_allowlist.length, {
  message: 'Danh sách model không được trùng.', path: ['model_allowlist'],
});
export const limitSchema = z.object({ token_limit: z.number().int().min(1).max(1_000_000) }).strict();
export const userUpdateSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  status: z.enum(['active', 'blocked']).optional(),
}).strict().refine((v) => v.role !== undefined || v.status !== undefined, 'Không có thay đổi.');
export const devLoginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  display_name: z.string().trim().min(1).max(100).default('Local developer'),
}).strict();
export const reconcileSchema = z.object({
  input_tokens: z.number().int().min(0).max(1_000_000),
  output_tokens: z.number().int().min(0).max(1_000_000),
  note: z.string().trim().min(10).max(1000),
}).strict();
export type SettingsInput = z.infer<typeof settingsSchema>;
