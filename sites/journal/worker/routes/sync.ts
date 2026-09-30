/**
 * Sync: an append-only log of ciphertext (docs/journal-crypto.md, "Sync").
 *
 *   pull   GET  /api/sync?since=<seq>   every record whose seq is newer, in seq order, in pages
 *   push   POST /api/sync               compare-and-set writes: each names the rev it was based on
 *
 * A write lands only if the record is still at the rev the device last saw (0 for a new record);
 * it then gets rev + 1 and the next seq. Otherwise the device is told what is there now, merges
 * on its own (it can read the content; the server cannot), and tries again. D1 runs a batch as one
 * transaction, statement after statement, so seq numbers come out unique and in order without a
 * lock or a Durable Object. A deletion is a tombstone (sealed = NULL) so other devices learn of it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env';
import { HttpError } from '../lib/http';

const PAGE = 500;
/** A sealed record, as base64url. Entries are small; a year of writing is not one record. */
const MAX_SEALED = 1_500_000;
const MAX_CHANGES = 100;

/** Keyed (k_) or random (r_) ids, 128 bits each: src/vault/ids.ts. */
const recordId = z.string().regex(/^[kr]_[A-Za-z0-9_-]{22}$/);

const pushBody = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        id: recordId,
        baseRev: z.number().int().min(0),
        sealed: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .max(MAX_SEALED)
          .nullable(),
      }),
    )
    .min(1)
    .max(MAX_CHANGES),
});

interface RecordRow {
  id: string;
  rev: number;
  seq: number;
  sealed: string | null;
}

export const sync = new Hono<AppContext>();

sync.use('/sync', async (c, next) => {
  const session = c.get('session');
  if (!session || session.scope !== 'full') throw new HttpError(401, 'Sign in first');
  await next();
});

sync.get('/sync', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'Bad cursor' }, 400);
  const rows = await c.env.DB.prepare(
    'SELECT id, rev, seq, sealed FROM records WHERE seq > ?1 ORDER BY seq LIMIT ?2',
  )
    .bind(since, PAGE + 1)
    .all<RecordRow>();
  const page = rows.results.slice(0, PAGE);
  return c.json({
    changes: page,
    cursor: page.at(-1)?.seq ?? since,
    more: rows.results.length > PAGE,
  });
});

sync.post('/sync', async (c) => {
  const parsed = pushBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Malformed changes' }, 400);
  const { changes } = parsed.data;
  if (new Set(changes.map((change) => change.id)).size !== changes.length) {
    return c.json({ error: 'One change per record per push' }, 400);
  }

  const now = Date.now();
  const nextSeq = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM records)';
  const statements = changes.map((change) =>
    change.baseRev === 0
      ? c.env.DB.prepare(
          `INSERT INTO records (id, rev, seq, sealed, size, updated_at)
           VALUES (?1, 1, ${nextSeq}, ?2, ?3, ?4) ON CONFLICT (id) DO NOTHING`,
        ).bind(change.id, change.sealed, change.sealed?.length ?? 0, now)
      : c.env.DB.prepare(
          `UPDATE records SET rev = rev + 1, seq = ${nextSeq}, sealed = ?2, size = ?3, updated_at = ?4
           WHERE id = ?1 AND rev = ?5`,
        ).bind(change.id, change.sealed, change.sealed?.length ?? 0, now, change.baseRev),
  );
  const results = await c.env.DB.batch(statements);

  const placeholders = changes.map((_, i) => `?${i + 1}`).join(', ');
  const current = await c.env.DB.prepare(
    `SELECT id, rev, seq, sealed FROM records WHERE id IN (${placeholders})`,
  )
    .bind(...changes.map((change) => change.id))
    .all<RecordRow>();
  const byId = new Map(current.results.map((row) => [row.id, row]));

  return c.json({
    results: changes.map((change, i) => {
      const row = byId.get(change.id);
      if ((results[i]?.meta.changes ?? 0) === 1 && row) {
        return { id: change.id, ok: true as const, rev: row.rev, seq: row.seq };
      }
      // Someone else wrote first: here is what is there now, to merge with and retry.
      return { id: change.id, ok: false as const, current: row ?? null };
    }),
  });
});
