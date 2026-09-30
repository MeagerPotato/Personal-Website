/**
 * The daily reminder, per device (worker/lib/push.ts sends it).
 *
 *   GET    /api/push           this server's VAPID public key, and every device's reminder
 *   PUT    /api/push           turns one device's reminder on, or changes its time
 *   DELETE /api/push           turns it off
 *   POST   /api/push/test      sends one now, to see that it arrives
 *   POST   /api/push/written   today is written: no reminder today, on any device
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env';
import { HttpError, body } from '../lib/http';
import { isTimeZone, lastSentWhenSet, sendPush, vapidAuthorization, vapidKeys } from '../lib/push';

/** More devices than anyone owns: the list is not a place to keep anything else. */
const MAX_DEVICES = 20;

/** Push services are https, always; the Worker posts to nothing else. */
const endpoint = z.url({ protocol: /^https$/ }).max(2048);
const endpointBody = z.strictObject({ endpoint });
const setBody = z.strictObject({
  endpoint,
  remindAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().max(64).refine(isTimeZone),
});
const writtenBody = z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

function signedIn(c: Context<AppContext>): void {
  const session = c.get('session');
  if (!session || session.scope !== 'full') throw new HttpError(401, 'Sign in first');
}

export const push = new Hono<AppContext>();

push.get('/push', async (c) => {
  signedIn(c);
  const keys = await vapidKeys(c.env.DB);
  const { results } = await c.env.DB.prepare(
    'SELECT endpoint, remind_at, time_zone FROM push_subscriptions ORDER BY created_at',
  ).all<{ endpoint: string; remind_at: string; time_zone: string }>();
  return c.json({
    publicKey: keys.publicKey,
    devices: results.map((row) => ({
      endpoint: row.endpoint,
      remindAt: row.remind_at,
      timeZone: row.time_zone,
    })),
  });
});

push.put('/push', async (c) => {
  signedIn(c);
  const { endpoint, remindAt, timeZone } = await body(c, setBody);
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT last_sent FROM push_subscriptions WHERE endpoint = ?1')
    .bind(endpoint)
    .first<{ last_sent: string | null }>();
  if (!existing) {
    const count = await db
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions')
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_DEVICES) {
      throw new HttpError(409, 'Too many devices have a reminder: turn one off first');
    }
  }
  const lastSent = lastSentWhenSet(remindAt, timeZone, new Date(), existing?.last_sent ?? null);
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, remind_at, time_zone, last_sent, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (endpoint) DO UPDATE SET
         remind_at = excluded.remind_at, time_zone = excluded.time_zone,
         last_sent = excluded.last_sent`,
    )
    .bind(endpoint, remindAt, timeZone, lastSent, Date.now())
    .run();
  return c.json({ ok: true });
});

push.delete('/push', async (c) => {
  signedIn(c);
  const { endpoint } = await body(c, endpointBody);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
  return c.json({ ok: true });
});

push.post('/push/test', async (c) => {
  signedIn(c);
  const { endpoint } = await body(c, endpointBody);
  const db = c.env.DB;
  const known = await db
    .prepare('SELECT 1 AS known FROM push_subscriptions WHERE endpoint = ?1')
    .bind(endpoint)
    .first();
  if (!known) throw new HttpError(404, 'This device has no reminder');
  const keys = await vapidKeys(db);
  const result = await sendPush(
    endpoint,
    await vapidAuthorization(keys, endpoint, c.env.ORIGIN, new Date()),
  );
  if (result === 'gone') {
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
  }
  return c.json({ result });
});

push.post('/push/written', async (c) => {
  signedIn(c);
  const { date } = await body(c, writtenBody);
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('written', ?1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  )
    .bind(date)
    .run();
  return c.json({ ok: true });
});
