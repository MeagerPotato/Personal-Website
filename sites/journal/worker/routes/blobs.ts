/**
 * Sealed files in R2 (photos, thumbnails). Immutable: a file is written once under a random id
 * and never changed; an edited photo is a new file. The bucket stays private: every read goes
 * through here, behind the session.
 *
 * Which record owns a file is written inside that record, so the server cannot tell which files
 * are still in use. The device can: it asks for the list and deletes what nothing points at.
 */
import { Hono } from 'hono';
import type { AppContext } from '../env';
import { HttpError } from '../lib/http';

/** A sealed photo is at most a few MB (the app re-encodes to 2560 px); this is a backstop. */
const MAX_BYTES = 25 * 1024 * 1024;
const BLOB_ID = /^b_[A-Za-z0-9_-]{22}$/;

export const blobs = new Hono<AppContext>();

blobs.use('/blobs/*', async (c, next) => {
  const session = c.get('session');
  if (!session || session.scope !== 'full') throw new HttpError(401, 'Sign in first');
  await next();
});
blobs.use('/blobs', async (c, next) => {
  const session = c.get('session');
  if (!session || session.scope !== 'full') throw new HttpError(401, 'Sign in first');
  await next();
});

blobs.get('/blobs', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, size, created_at FROM blobs ORDER BY created_at',
  ).all<{
    id: string;
    size: number;
    created_at: number;
  }>();
  return c.json(
    rows.results.map((row) => ({ id: row.id, size: row.size, createdAt: row.created_at })),
  );
});

blobs.put('/blobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!BLOB_ID.test(id)) return c.json({ error: 'Bad file id' }, 400);
  const length = Number(c.req.header('content-length'));
  if (!Number.isSafeInteger(length) || length <= 0)
    return c.json({ error: 'Length required' }, 411);
  if (length > MAX_BYTES) return c.json({ error: 'File too large' }, 413);

  const exists = await c.env.DB.prepare('SELECT size FROM blobs WHERE id = ?1')
    .bind(id)
    .first<{ size: number }>();
  if (exists) {
    // Written already (a retried upload): fine if it is the same size, a conflict otherwise.
    return exists.size === length ? c.json({ ok: true }) : c.json({ error: 'File exists' }, 409);
  }
  // Read whole (at most 25 MB): the declared length is checked against what arrived, and R2 gets a
  // body of known length in every runtime.
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength !== length) return c.json({ error: 'Length mismatch' }, 400);
  await c.env.BLOBS.put(id, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  await c.env.DB.prepare('INSERT OR IGNORE INTO blobs (id, size, created_at) VALUES (?1, ?2, ?3)')
    .bind(id, length, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

blobs.get('/blobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!BLOB_ID.test(id)) return c.json({ error: 'Bad file id' }, 400);
  const object = await c.env.BLOBS.get(id);
  if (!object) return c.json({ error: 'No such file' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
      // Ciphertext that never changes under this id: the device may keep it.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

blobs.delete('/blobs/:id', async (c) => {
  const id = c.req.param('id');
  if (!BLOB_ID.test(id)) return c.json({ error: 'Bad file id' }, 400);
  await c.env.BLOBS.delete(id);
  await c.env.DB.prepare('DELETE FROM blobs WHERE id = ?1').bind(id).run();
  return c.json({ ok: true });
});
