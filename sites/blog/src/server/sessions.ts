/**
 * The studio's sessions: a random 256-bit token in a __Host- cookie (Secure, HttpOnly,
 * SameSite=Strict, this host only), and only its SHA-256 in D1, so a copy of the database signs
 * nobody in. Framework-free, because both the API (Hono) and the studio's pages (Astro) read it.
 *
 * Long enough to write a post in one sitting and come back to it the next evening: a day idle,
 * a week at most. Signing in again is one Face ID prompt.
 */
import type { StudioSession } from './env';
import { randomToken, sha256Hex } from './util';

export const COOKIE = '__Host-sid';
export const IDLE_MS = 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often, not on every request. */
const TOUCH_MS = 5 * 60 * 1000;

interface SessionRow {
  id_hash: string;
  credential_id: string | null;
  last_seen_at: number;
  expires_at: number;
}

/** The value of one cookie in a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

const setCookie = (value: string, maxAgeSeconds: number): string =>
  `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;

/** Starts a session. Returns it and the Set-Cookie header that carries it. */
export async function startSession(
  db: D1Database,
  credentialId: string | null,
  now = Date.now(),
): Promise<{ session: StudioSession; cookie: string }> {
  const token = randomToken(32);
  const idHash = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO sessions (id_hash, credential_id, created_at, last_seen_at, expires_at)
       VALUES (?1, ?2, ?3, ?3, ?4)`,
    )
    .bind(idHash, credentialId, now, now + ABSOLUTE_MS)
    .run();
  return {
    session: { idHash, credentialId },
    cookie: setCookie(token, Math.floor(ABSOLUTE_MS / 1000)),
  };
}

/** The session a request's cookies carry, if it is still good. */
export async function readSession(
  db: D1Database,
  cookieHeader: string | null | undefined,
  now = Date.now(),
): Promise<StudioSession | null> {
  const token = cookieValue(cookieHeader, COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const idHash = await sha256Hex(token);
  const row = await db
    .prepare(
      'SELECT id_hash, credential_id, last_seen_at, expires_at FROM sessions WHERE id_hash = ?1',
    )
    .bind(idHash)
    .first<SessionRow>();
  if (!row) return null;
  if (row.expires_at <= now || now - row.last_seen_at > IDLE_MS) {
    await db.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(idHash).run();
    return null;
  }
  if (now - row.last_seen_at > TOUCH_MS) {
    await db
      .prepare('UPDATE sessions SET last_seen_at = ?2 WHERE id_hash = ?1')
      .bind(idHash, now)
      .run();
  }
  return { idHash, credentialId: row.credential_id };
}

/** Ends a session. Returns the Set-Cookie header that clears the cookie. */
export async function endSession(db: D1Database, session: StudioSession | null): Promise<string> {
  if (session)
    await db.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(session.idHash).run();
  return setCookie('', 0);
}

/** Drops expired sessions and challenges (the cron). */
export async function sweepSessions(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at < ?2')
      .bind(now, now - IDLE_MS),
    db.prepare('DELETE FROM challenges WHERE expires_at <= ?1').bind(now),
  ]);
}
