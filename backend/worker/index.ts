import { createApp } from './app';
import { maintenance } from './services/maintenance';
import type { Env } from './types';

const app = createApp();
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(maintenance(env));
  },
} satisfies ExportedHandler<Env>;
