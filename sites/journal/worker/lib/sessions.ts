/**
 * Sessions: a random 256-bit token in a __Host- cookie (Secure, HttpOnly, SameSite=Strict, this
 * host only), and only its SHA-256 in D1, so a copy of the database logs nobody in.
 *
 * Short on purpose: unlocking the journal is a Face ID prompt anyway, and the session only lets a
 * device talk to the server (it opens nothing; the keys never leave the device).
 */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContext, Session } from '../env';
import { randomToken, sha256Hex } from './tokens';

const NAME = 'sid';
export const IDLE_MS = 60 * 60 * 1000;
export const ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const ENROLL_MS = 15 * 60 * 1000;
/** last_seen_at is written at most this often, not on every request. */
const TOUCH_MS = 60 * 1000;

type Ctx = Context<AppContext>;

interface SessionRow {
  id_hash: string;
  credential_id: string | null;
  scope: 'full' | 'enroll';
  last_seen_at: number;
  expires_at: number;
}

export async function startSession(
  c: Ctx,
  credentialId: string | null,
  scope: Session['scope'],
): Promise<Session> {
  const token = randomToken(32);
  const idHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + (scope === 'enroll' ? ENROLL_MS : ABSOLUTE_MS);
  await c.env.DB.prepare(
    `INSERT INTO sessions (id_hash, credential_id, scope, created_at, last_seen_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
  )
    .bind(idHash, credentialId, scope, now, expiresAt)
    .run();
  setCookie(c, NAME, token, {
    prefix: 'host',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: Math.floor((expiresAt - now) / 1000),
  });
  return { idHash, credentialId, scope };
}

export async function readSession(c: Ctx): Promise<Session | null> {
  const token = getCookie(c, NAME, 'host');
  if (!token || token.length > 64) return null;
  const idHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    'SELECT id_hash, credential_id, scope, last_seen_at, expires_at FROM sessions WHERE id_hash = ?1',
  )
    .bind(idHash)
    .first<SessionRow>();
  if (!row) return null;

  const now = Date.now();
  if (row.expires_at <= now || now - row.last_seen_at > IDLE_MS) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(idHash).run();
    return null;
  }
  if (now - row.last_seen_at > TOUCH_MS) {
    await c.env.DB.prepare('UPDATE sessions SET last_seen_at = ?2 WHERE id_hash = ?1')
      .bind(idHash, now)
      .run();
  }
  return { idHash, credentialId: row.credential_id, scope: row.scope };
}

export async function endSession(c: Ctx): Promise<void> {
  const session = c.get('session');
  if (session) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(session.idHash).run();
  }
  deleteCookie(c, NAME, { prefix: 'host', path: '/', secure: true });
}

/** Drops expired sessions and challenges (called from the scheduled handler). */
export async function sweep(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at < ?2')
      .bind(now, now - IDLE_MS),
    db.prepare('DELETE FROM challenges WHERE expires_at <= ?1').bind(now),
  ]);
}
