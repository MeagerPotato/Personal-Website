/**
 * Email subscribers, double opt-in: subscribing sends a confirmation, and only a confirmed
 * address ever gets a post. The confirmation link's token is kept only as its SHA-256; the
 * unsubscribe token goes in every email, so unsubscribing needs nothing but the link.
 *
 * The form answers the same whatever the address's state, so it cannot be used to learn who
 * subscribes.
 */
import { z } from 'zod';
import { HttpError, randomId, randomToken, sha256Hex } from './util';

/** A confirmation link works this long. */
export const CONFIRM_MS = 7 * 24 * 60 * 60 * 1000;
/** Asking again sooner than this sends nothing new (the first email is on its way). */
export const RESEND_MS = 10 * 60 * 1000;

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export type SubscriberStatus = 'pending' | 'active' | 'unsubscribed';

export interface Subscriber {
  id: string;
  email: string;
  status: SubscriberStatus;
  createdAt: number;
  confirmedAt: number | null;
  unsubscribedAt: number | null;
}

/** What subscribing did: 'confirm' means a confirmation should go out now. */
export type SubscribeOutcome =
  { kind: 'confirm'; token: string; unsubscribeToken: string } | { kind: 'nothing' };

interface Row {
  id: string;
  email: string;
  status: SubscriberStatus;
  confirm_sent_at: number | null;
  unsubscribe_token: string;
  created_at: number;
  confirmed_at: number | null;
  unsubscribed_at: number | null;
}

export async function subscribe(
  db: D1Database,
  email: string,
  now = Date.now(),
): Promise<SubscribeOutcome> {
  const existing = await db
    .prepare('SELECT * FROM subscribers WHERE email = ?1')
    .bind(email)
    .first<Row>();
  if (existing?.status === 'active') return { kind: 'nothing' };
  if (existing?.confirm_sent_at && now - existing.confirm_sent_at < RESEND_MS)
    return { kind: 'nothing' };

  const token = randomToken(32);
  const hash = await sha256Hex(token);
  if (existing) {
    await db
      .prepare(
        `UPDATE subscribers SET status = 'pending', confirm_hash = ?2, confirm_sent_at = ?3
         WHERE id = ?1`,
      )
      .bind(existing.id, hash, now)
      .run();
    return { kind: 'confirm', token, unsubscribeToken: existing.unsubscribe_token };
  }
  const unsubscribeToken = randomToken(24);
  await db
    .prepare(
      `INSERT INTO subscribers (id, email, status, confirm_hash, confirm_sent_at, unsubscribe_token, created_at)
       VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?4)`,
    )
    .bind(randomId('u'), email, hash, now, unsubscribeToken)
    .run();
  return { kind: 'confirm', token, unsubscribeToken };
}

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** Confirms the address a confirmation link was sent to. False: unknown or expired. */
export async function confirmSubscription(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  const result = await db
    .prepare(
      `UPDATE subscribers SET status = 'active', confirmed_at = ?2, confirm_hash = NULL
       WHERE confirm_hash = ?1 AND status = 'pending' AND confirm_sent_at > ?3`,
    )
    .bind(await sha256Hex(token), now, now - CONFIRM_MS)
    .run();
  return result.meta.changes > 0;
}

/** Unsubscribes whoever holds this link. True whether or not they were subscribed still. */
export async function unsubscribe(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  const row = await db
    .prepare('SELECT id FROM subscribers WHERE unsubscribe_token = ?1')
    .bind(token)
    .first<{ id: string }>();
  if (!row) return false;
  await db
    .prepare(
      `UPDATE subscribers SET status = 'unsubscribed', confirm_hash = NULL,
         unsubscribed_at = COALESCE(unsubscribed_at, ?2)
       WHERE id = ?1 AND status != 'unsubscribed'`,
    )
    .bind(row.id, now)
    .run();
  return true;
}

export async function activeSubscribers(
  db: D1Database,
): Promise<{ id: string; email: string; unsubscribeToken: string }[]> {
  const { results } = await db
    .prepare(
      "SELECT id, email, unsubscribe_token FROM subscribers WHERE status = 'active' ORDER BY created_at",
    )
    .all<Row>();
  return results.map((row) => ({
    id: row.id,
    email: row.email,
    unsubscribeToken: row.unsubscribe_token,
  }));
}

export async function listSubscribers(db: D1Database): Promise<Subscriber[]> {
  const { results } = await db
    .prepare('SELECT * FROM subscribers ORDER BY created_at DESC')
    .all<Row>();
  return results.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
  }));
}

export async function removeSubscriber(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare('DELETE FROM subscribers WHERE id = ?1').bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, 'No such subscriber');
}

/** Forgets addresses that never confirmed (the cron). */
export async function sweepSubscribers(db: D1Database, now = Date.now()): Promise<void> {
  await db
    .prepare(
      "DELETE FROM subscribers WHERE status = 'pending' AND confirmed_at IS NULL AND confirm_sent_at < ?1",
    )
    .bind(now - CONFIRM_MS)
    .run();
}
