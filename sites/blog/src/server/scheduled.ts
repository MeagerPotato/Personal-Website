/**
 * The cron (wrangler.jsonc: every five minutes): the mail that is due, then the tidying of
 * sessions, challenges, unconfirmed subscriptions and old mail.
 */
import { migrate } from './db/migrate';
import type { BlogEnv } from './env';
import { drainOutbox, sweepOutbox } from './mail';
import { sweepSessions } from './sessions';
import { sweepSubscribers } from './subscribers';

export async function runCron(env: BlogEnv, now = Date.now()): Promise<void> {
  await migrate(env.DB);
  await drainOutbox(env, now);
  await sweepSessions(env.DB, now);
  await sweepSubscribers(env.DB, now);
  await sweepOutbox(env.DB, now);
}
