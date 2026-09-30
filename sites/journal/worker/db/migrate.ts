/**
 * Brings the database up to MIGRATIONS.length, once per isolate per database.
 *
 * Two isolates may start at the same time and both try the same step. D1 runs batches one after
 * another, each in a transaction; every statement of a step is written to be harmless the second
 * time (IF NOT EXISTS), and the version bump only lands if the version is still the old one. A
 * step that does fail on a race (a future ALTER TABLE, say) is re-read: if someone else finished
 * it, carry on.
 */
import { MIGRATIONS } from './migrations';

const done = new WeakMap<D1Database, Promise<void>>();

export function migrate(db: D1Database): Promise<void> {
  let pending = done.get(db);
  if (!pending) {
    pending = run(db).catch((error: unknown) => {
      done.delete(db);
      throw error;
    });
    done.set(db, pending);
  }
  return pending;
}

async function currentVersion(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT version FROM schema WHERE id = 1')
    .first<{ version: number }>();
  return row?.version ?? 0;
}

async function run(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
    ),
    db.prepare('INSERT OR IGNORE INTO schema (id, version) VALUES (1, 0)'),
  ]);
  let version = await currentVersion(db);
  while (version < MIGRATIONS.length) {
    const step = MIGRATIONS[version] ?? [];
    try {
      await db.batch([
        ...step.map((sql) => db.prepare(sql)),
        db
          .prepare('UPDATE schema SET version = ?1 WHERE id = 1 AND version = ?2')
          .bind(version + 1, version),
      ]);
    } catch (error) {
      if ((await currentVersion(db)) <= version) throw error;
    }
    version = await currentVersion(db);
  }
}
