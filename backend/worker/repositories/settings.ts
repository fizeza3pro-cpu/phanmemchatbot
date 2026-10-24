import type { D1Database } from '@cloudflare/workers-types';
import type { SettingsInput } from '../../shared/schemas';
import type { Settings } from '../types';

type SettingsRow = Omit<Settings, 'model_allowlist'> & { model_allowlist: string };
export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare('SELECT * FROM app_settings ORDER BY version DESC LIMIT 1').first<SettingsRow>();
  if (!row) throw new Error('Database migrations have not been applied.');
  return { ...row, model_allowlist: JSON.parse(row.model_allowlist) };
}
export async function saveSettings(db: D1Database, actorId: string, settings: SettingsInput) {
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO app_settings (default_token_limit, default_model, model_allowlist, system_prompt,
      max_input_bytes, max_output_tokens, message_rate_per_minute, conversation_rate_per_hour, updated_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(settings.default_token_limit, settings.default_model,
      JSON.stringify(settings.model_allowlist), settings.system_prompt, settings.max_input_bytes,
      settings.max_output_tokens, settings.message_rate_per_minute, settings.conversation_rate_per_hour, actorId, now),
    db.prepare(`INSERT INTO admin_audit_logs (id, actor_id, action, target_id, metadata, created_at)
      VALUES (?, ?, 'settings.updated', 'app_settings', ?, ?)`).bind(crypto.randomUUID(), actorId,
      JSON.stringify({ default_token_limit: settings.default_token_limit, default_model: settings.default_model }), now),
  ]);
  return getSettings(db);
}
