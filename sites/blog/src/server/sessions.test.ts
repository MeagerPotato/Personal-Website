import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BlogEnv } from './env';
import {
  ABSOLUTE_MS,
  IDLE_MS,
  cookieValue,
  endSession,
  readSession,
  startSession,
  sweepSessions,
} from './sessions';
import { freshEnv, startPlatform } from './test/platform';

const platform = await startPlatform();
afterAll(() => platform.dispose());

let env: BlogEnv;
beforeEach(async () => {
  env = await freshEnv(platform);
});

const T0 = Date.parse('2026-09-30T12:00:00Z');
const header = (cookie: string) => cookie.split(';')[0] ?? '';

describe('studio sessions', () => {
  it('sets a __Host- cookie this host alone can read, and keeps only its hash', async () => {
    const { cookie, session } = await startSession(env.DB, 'cred', T0);
    expect(cookie).toMatch(
      /^__Host-sid=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800$/,
    );
    const token = cookieValue(header(cookie), '__Host-sid') ?? '';
    const stored = await env.DB.prepare('SELECT id_hash FROM sessions').first<{
      id_hash: string;
    }>();
    expect(stored?.id_hash).toBe(session.idHash);
    expect(stored?.id_hash).not.toContain(token);
    expect(await readSession(env.DB, `other=1; ${header(cookie)}`, T0 + 1000)).toEqual(session);
  });

  it('ends after a day without use, or a week in all', async () => {
    const idle = await startSession(env.DB, 'cred', T0);
    expect(await readSession(env.DB, header(idle.cookie), T0 + IDLE_MS + 1)).toBeNull();

    const busy = await startSession(env.DB, 'cred', T0);
    let now = T0;
    while (now + IDLE_MS / 2 < T0 + ABSOLUTE_MS) {
      now += IDLE_MS / 2;
      expect(await readSession(env.DB, header(busy.cookie), now)).not.toBeNull();
    }
    expect(await readSession(env.DB, header(busy.cookie), T0 + ABSOLUTE_MS)).toBeNull();
  });

  it('forgets a session on signing out, and the cron sweeps the expired', async () => {
    const one = await startSession(env.DB, 'cred', T0);
    expect(await endSession(env.DB, one.session)).toContain('Max-Age=0');
    expect(await readSession(env.DB, header(one.cookie), T0 + 1)).toBeNull();

    await startSession(env.DB, 'cred', T0);
    await sweepSessions(env.DB, T0 + ABSOLUTE_MS + 1);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('ignores a cookie that is not one of its tokens', async () => {
    expect(await readSession(env.DB, '__Host-sid=../../etc', T0)).toBeNull();
    expect(await readSession(env.DB, null, T0)).toBeNull();
  });
});
