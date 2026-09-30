/**
 * The daily reminder: Web Push with no content. The push service learns only that this server
 * wants to wake a device; the service worker (sw/sw.js) shows its one fixed message, "How was
 * today?". Per device the server keeps a push address, a time of day and a time zone; for the
 * account, the last date something was written. Nothing else (docs/journal-crypto.md).
 *
 * VAPID (RFC 8292) is how a push service knows the pushes come from the server a device
 * subscribed to: an ES256 key pair, made on first use and kept in D1 beside the subscriptions it
 * signs for. Whoever held it could send the same empty pushes to the same devices and nothing
 * more, so it needs no more protection than they have.
 */
import { base64Url } from './tokens';

/** A device's reminder, as stored. */
export interface Reminder {
  readonly endpoint: string;
  /** "HH:MM" on the device's clock. */
  readonly remindAt: string;
  /** IANA name, e.g. "America/Los_Angeles". */
  readonly timeZone: string;
  /** The device's local date when it was last reminded (or when it was set up too late). */
  readonly lastSent: string | null;
}

export interface VapidKeys {
  /** The uncompressed P-256 point, base64url: what a browser subscribes with. */
  readonly publicKey: string;
  readonly privateKey: JsonWebKey;
}

export type PushResult = 'sent' | 'gone' | 'failed';

/** Whether `timeZone` is a zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in a time zone. */
export function localNow(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/**
 * Whether a device should be reminded now: its time has come today, and today has been neither
 * reminded nor written. `date` is its local date, to record once the push is out.
 */
export function due(
  reminder: Reminder,
  now: Date,
  written: string | null,
): { due: boolean; date: string } {
  const local = localNow(now, reminder.timeZone);
  return {
    due:
      local.time >= reminder.remindAt && reminder.lastSent !== local.date && written !== local.date,
    date: local.date,
  };
}

/**
 * `lastSent` for a reminder being set now: one already sent today stays sent, and a time that has
 * already passed today starts tomorrow (turning the reminder on at 22:00 does not ring at 22:05).
 */
export function lastSentWhenSet(
  remindAt: string,
  timeZone: string,
  now: Date,
  previous: string | null,
): string | null {
  const local = localNow(now, timeZone);
  return previous === local.date || local.time >= remindAt ? local.date : previous;
}

/** This server's VAPID key pair: made the first time it is needed, then read from D1. */
export async function vapidKeys(db: D1Database): Promise<VapidKeys> {
  const read = () =>
    db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first<{ value: string }>();
  const stored = await read();
  if (stored) return JSON.parse(stored.value) as VapidKeys;

  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const made: VapidKeys = {
    publicKey: base64Url(
      new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    ),
    privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
  // Two isolates may make one at once: the first stored wins, and both use it.
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?1)")
    .bind(JSON.stringify(made))
    .run();
  const winner = await read();
  if (!winner) throw new Error('VAPID keys were not stored');
  return JSON.parse(winner.value) as VapidKeys;
}

const json64 = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * The Authorization header for one push service: a JWT for its origin, valid for 12 hours,
 * signed with ES256 (WebCrypto's ECDSA signature is already the r ‖ s form JWS wants).
 */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  subject: string,
  now: Date,
): Promise<string> {
  const unsigned = `${json64({ typ: 'JWT', alg: 'ES256' })}.${json64({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    keys.privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `vapid t=${unsigned}.${base64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/** Sends one empty push. "gone": the device unsubscribed, so forget it. */
export async function sendPush(
  endpoint: string,
  authorization: string,
  fetcher: typeof fetch = fetch,
): Promise<PushResult> {
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        // A reminder hours late is no reminder: the push service drops it after four.
        TTL: String(4 * 60 * 60),
        Urgency: 'normal',
        // A device that was off for days gets one reminder, not one per day.
        Topic: 'daily-reminder',
        'Content-Length': '0',
      },
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

interface Row {
  endpoint: string;
  remind_at: string;
  time_zone: string;
  last_sent: string | null;
}

/**
 * The cron's half (worker/index.ts, every five minutes): every device whose time has come gets
 * its push. A failure is tried again on the next run; a device that is gone is forgotten.
 */
export async function sendReminders(
  db: D1Database,
  subject: string,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<Record<PushResult, number>> {
  const counts: Record<PushResult, number> = { sent: 0, gone: 0, failed: 0 };
  const { results } = await db
    .prepare('SELECT endpoint, remind_at, time_zone, last_sent FROM push_subscriptions')
    .all<Row>();
  if (results.length === 0) return counts;
  const writtenRow = await db
    .prepare("SELECT value FROM settings WHERE key = 'written'")
    .first<{ value: string }>();
  const written = writtenRow?.value ?? null;

  let keys: VapidKeys | null = null;
  for (const row of results) {
    const reminder: Reminder = {
      endpoint: row.endpoint,
      remindAt: row.remind_at,
      timeZone: row.time_zone,
      lastSent: row.last_sent,
    };
    const check = due(reminder, now, written);
    if (!check.due) continue;
    keys ??= await vapidKeys(db);
    const result = await sendPush(
      row.endpoint,
      await vapidAuthorization(keys, row.endpoint, subject, now),
      fetcher,
    );
    counts[result] += 1;
    if (result === 'gone') {
      await db
        .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1')
        .bind(row.endpoint)
        .run();
    } else if (result === 'sent') {
      await db
        .prepare('UPDATE push_subscriptions SET last_sent = ?1 WHERE endpoint = ?2')
        .bind(check.date, row.endpoint)
        .run();
    }
  }
  return counts;
}
