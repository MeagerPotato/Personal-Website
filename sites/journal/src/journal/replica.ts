/**
 * This device's copy of the journal, and how it keeps in step with the server.
 *
 * Two layers, both kept sealed in IndexedDB (store/db.ts) and open in memory while unlocked:
 *   confirmed   each record as the server last confirmed it: the "base" of any local change
 *   local       changes made here that the server has not confirmed yet
 * What the app shows is local over confirmed.
 *
 * Sync is pull, then push. A pull brings every record changed since the cursor; a local change
 * to one of them is merged with it at once (merge.ts). A push sends each local change as a
 * compare-and-set on the version it was based on; if another device wrote first, the server
 * answers with what is there now, the device merges, seals again on the new version, and
 * retries. Nothing here knows about kinds of record: it moves JSON documents.
 *
 * It never goes back. A version older than the one it has, another version under the same
 * number, or none at all where it had one, is the server going back (restored from a backup,
 * or keeping changes from it: journal-crypto.md, "Sync"): the record is counted as `behind`,
 * this device's copy stays as it is, and its changes to it wait here until repair() has put
 * this device's version back.
 *
 * Headless and testable: the server, the storage and the sealing are all passed in.
 */
import type { Change, PushResult, RemoteRecord } from '../api/client';
import type { PendingChange, StoredRecord } from '../store/db';
import { isEqual, merge3, type Doc } from './merge';

export interface ReplicaStore {
  load(): Promise<{ records: StoredRecord[]; pending: PendingChange[]; cursor: number }>;
  /** Saves records the server confirmed and, when given, the new cursor, together. */
  confirm(records: StoredRecord[], cursor?: number): Promise<void>;
  savePending(change: PendingChange): Promise<void>;
  /** Drops a pending change: only the one with this stamp, or whatever is there if none given. */
  clearPending(id: string, stamp?: number): Promise<void>;
}

export interface ReplicaRemote {
  pull(since: number): Promise<{ changes: RemoteRecord[]; cursor: number; more: boolean }>;
  push(changes: Change[]): Promise<{ results: PushResult[] }>;
}

/** Seals and opens one version of one record (vault/envelope.ts binds both to the ciphertext). */
export interface Codec {
  seal(id: string, rev: number, doc: Doc): Promise<string>;
  open(id: string, rev: number, sealed: string): Promise<Doc>;
}

interface Confirmed {
  rev: number;
  seq: number;
  /** null: deleted. */
  doc: Doc | null;
  /** Sealed by a key this device does not have: kept, never overwritten. */
  unreadable?: boolean;
}

interface Local {
  doc: Doc | null;
  /** Bumped by every change made here. */
  stamp: number;
  /** The stamp of the version sealed into the store (0: not sealed yet). */
  savedStamp: number;
  /** What that sealed version was based on, and the sealed text itself. */
  baseRev: number;
  sealed: string | null;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  merged: number;
}

const PUSH_BATCH = 100;
const PUSH_ROUNDS = 5;
const OPEN_BATCH = 64;

export class Replica {
  private readonly confirmed = new Map<string, Confirmed>();
  private readonly local = new Map<string, Local>();
  private readonly listeners = new Set<(ids: readonly string[]) => void>();
  /** Records whose conflicts cannot be merged here (the server copy is unreadable). */
  private readonly stuck = new Set<string>();
  /** Records the server has gone back on (see above). */
  private readonly behind = new Set<string>();
  private cursor = 0;
  private clock = 0;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly store: ReplicaStore,
    private readonly remote: ReplicaRemote,
    private readonly codec: Codec,
  ) {}

  /** Opens this device's copy: everything is decrypted into memory once, at unlock. */
  static async open(store: ReplicaStore, remote: ReplicaRemote, codec: Codec): Promise<Replica> {
    const replica = new Replica(store, remote, codec);
    const { records, pending, cursor } = await store.load();
    replica.cursor = cursor;
    await inBatches(records, async (record) => {
      replica.confirmed.set(record.id, await replica.openConfirmed(record));
    });
    await inBatches(pending, async (change) => {
      let doc: Doc | null = null;
      if (change.sealed !== null) {
        try {
          doc = await codec.open(change.id, change.baseRev + 1, change.sealed);
        } catch {
          return; // not ours to read; leave it be
        }
      }
      replica.local.set(change.id, {
        doc,
        stamp: change.stamp,
        savedStamp: change.stamp,
        baseRev: change.baseRev,
        sealed: change.sealed,
      });
      replica.clock = Math.max(replica.clock, change.stamp);
    });
    return replica;
  }

  // --- Reading ---------------------------------------------------------------------------------

  get(id: string): Doc | null | undefined {
    const mine = this.local.get(id);
    if (mine) return mine.doc;
    return this.confirmed.get(id)?.doc;
  }

  /** Every live document, local changes included. */
  *entries(): IterableIterator<[string, Doc]> {
    for (const [id, entry] of this.local) if (entry.doc) yield [id, entry.doc];
    for (const [id, entry] of this.confirmed) {
      if (entry.doc && !this.local.has(id)) yield [id, entry.doc];
    }
  }

  get status(): {
    pending: number;
    unreadable: number;
    stuck: number;
    behind: number;
    cursor: number;
  } {
    let unreadable = 0;
    for (const entry of this.confirmed.values()) if (entry.unreadable) unreadable += 1;
    return {
      pending: this.local.size,
      unreadable,
      stuck: this.stuck.size,
      behind: this.behind.size,
      cursor: this.cursor,
    };
  }

  /** The version of a record the server last confirmed to this device (0: none). */
  revision(id: string): number {
    return this.confirmed.get(id)?.rev ?? 0;
  }

  /** Every record the server has confirmed to this device, with its version. */
  *versions(): IterableIterator<[string, number]> {
    for (const [id, entry] of this.confirmed) yield [id, entry.rev];
  }

  subscribe(listener: (ids: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Writing ---------------------------------------------------------------------------------

  /** Changes a record here (null deletes it). Sealed and saved by the next flush(). */
  write(id: string, doc: Doc | null): void {
    const known = this.local.get(id);
    if (known ? isEqual(known.doc, doc) : isEqual(this.confirmed.get(id)?.doc ?? null, doc)) return;
    this.clock += 1;
    this.local.set(id, {
      doc,
      stamp: this.clock,
      savedStamp: known?.savedStamp ?? 0,
      baseRev: known?.baseRev ?? 0,
      sealed: known?.sealed ?? null,
    });
    this.emit([id]);
  }

  /** Seals every unsaved local change into the store. */
  flush(): Promise<void> {
    return this.exclusive(() => this.flushNow());
  }

  /** Pull, then push. One sync at a time; writes may go on meanwhile. */
  sync(): Promise<SyncReport> {
    return this.exclusive(async () => {
      const report: SyncReport = { pulled: 0, pushed: 0, merged: 0 };
      await this.pullNow(report);
      await this.pushNow(report);
      return report;
    });
  }

  /**
   * Puts what this device says about itself (its manifest, manifest.ts) on the server now, over
   * whichever version is there. A statement, not a change: never merged, never kept to send
   * later, never counted as waiting. 'behind' if the server has gone back on it: best given up
   * for a new id.
   */
  publish(id: string, doc: Doc): Promise<'published' | 'behind'> {
    return this.exclusive(async () => {
      for (let round = 0; round < PUSH_ROUNDS; round += 1) {
        const known = this.confirmed.get(id);
        const baseRev = known?.rev ?? 0;
        const sealed = await this.codec.seal(id, baseRev + 1, doc);
        const [result] = (await this.remote.push([{ id, baseRev, sealed }])).results;
        if (result?.id !== id) break;
        if (result.ok) {
          this.confirmed.set(id, { rev: result.rev, seq: result.seq, doc });
          await this.store.confirm([{ id, rev: result.rev, seq: result.seq, sealed }]);
          this.emit([id]);
          return 'published';
        }
        if (wentBack(known, result.current)) {
          this.behind.add(id);
          return 'behind';
        }
        // Written first by another tab of this browser (the same device): say it again on top.
        if (result.current) {
          this.confirmed.set(id, await this.openConfirmed(result.current));
          await this.store.confirm([result.current]);
        }
      }
      throw new Error('The server would not take this device’s manifest');
    });
  }

  /**
   * Puts back what the server has lost (journal-crypto.md, "Sync"), once it has gone back on a
   * version this device had: restored from a backup, most likely. Reads the whole log once, as a
   * pull reads it, then sends this device's version of each record the server has an older
   * version of, another version in place of, or none at all, numbered past both, so that every
   * device takes it. A version the server took after going back holds another device's changes:
   * the two are merged first, like two devices writing apart, but with nothing to say which came
   * first, so everything written is kept. How many records it put back.
   */
  repair(): Promise<number> {
    return this.exclusive(async () => {
      // Every change made here sealed and saved first, so that each one sent is the one cleared.
      await this.flushNow();
      const report: SyncReport = { pulled: 0, pushed: 0, merged: 0 };
      const seen = new Set<string>();
      const back = new Map<string, RemoteRecord>();
      let since = 0;
      for (;;) {
        const page = await this.remote.pull(since);
        await this.take(page.changes, report);
        for (const change of page.changes) {
          seen.add(change.id);
          if (wentBack(this.confirmed.get(change.id), change)) back.set(change.id, change);
        }
        since = page.cursor;
        if (!page.more) break;
      }
      if (since > this.cursor) {
        await this.store.confirm([], since);
        this.cursor = since;
      }
      // Read whole, the log has this device's version of these after all (one answer was wrong).
      for (const id of [...this.behind]) if (seen.has(id) && !back.has(id)) this.behind.delete(id);

      const outgoing: { change: Change; sent: Local; shown: Doc | null }[] = [];
      for (const [id, known] of this.confirmed) {
        const server = back.get(id) ?? null;
        if (known.unreadable || (seen.has(id) && !server)) continue;
        const mine = this.local.get(id);
        const shown = mine ? mine.doc : known.doc;
        let doc = shown;
        if (server && !(server.rev < known.rev && server.seq < known.seq)) {
          // Not an older version of this device's: another device wrote it after the server went back.
          const theirs = await this.openConfirmed(server);
          if (theirs.unreadable) continue;
          doc = merge3(null, shown, theirs.doc);
        }
        const baseRev = server?.rev ?? 0;
        const rev = Math.max(known.rev, baseRev) + 1;
        const sealed = doc === null ? null : await this.codec.seal(id, rev, doc);
        const stamp = mine?.stamp ?? -1;
        outgoing.push({
          change: { id, baseRev, rev, sealed },
          sent: { doc, stamp, savedStamp: stamp, baseRev, sealed },
          shown,
        });
      }

      const putBack: string[] = [];
      for (let start = 0; start < outgoing.length; start += PUSH_BATCH) {
        const batch = outgoing.slice(start, start + PUSH_BATCH);
        const { results } = await this.remote.push(batch.map((item) => item.change));
        for (const [i, result] of results.entries()) {
          const item = batch[i];
          // Refused: written meanwhile by another device, and left to the next sync or repair.
          if (!item || item.change.id !== result.id || !result.ok) continue;
          await this.accepted(result.id, item.sent, result.rev, result.seq);
          // Changed here while it went up: merged with it, as with any version from the server.
          if (this.local.has(result.id)) await this.settle(result.id, item.shown, item.sent.doc);
          this.behind.delete(result.id);
          putBack.push(result.id);
        }
      }
      this.emit(putBack);
      return putBack.length;
    });
  }

  // --- Internals -------------------------------------------------------------------------------

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(ids: readonly string[]): void {
    if (ids.length === 0) return;
    for (const listener of this.listeners) listener(ids);
  }

  private async openConfirmed(record: StoredRecord): Promise<Confirmed> {
    if (record.sealed === null) return { rev: record.rev, seq: record.seq, doc: null };
    try {
      const doc = await this.codec.open(record.id, record.rev, record.sealed);
      return { rev: record.rev, seq: record.seq, doc };
    } catch {
      return { rev: record.rev, seq: record.seq, doc: null, unreadable: true };
    }
  }

  private async flushNow(): Promise<void> {
    for (const [id, entry] of [...this.local]) {
      if (entry.savedStamp === entry.stamp) continue;
      const { doc, stamp } = entry;
      const baseRev = this.confirmed.get(id)?.rev ?? 0;
      if (doc === null && baseRev === 0) {
        // Made and deleted before it ever went up: nothing to tell the server.
        await this.store.clearPending(id);
        if (this.local.get(id)?.stamp === stamp) this.local.delete(id);
        continue;
      }
      const sealed = doc === null ? null : await this.codec.seal(id, baseRev + 1, doc);
      await this.store.savePending({ id, baseRev, sealed, stamp });
      const now = this.local.get(id);
      if (now) Object.assign(now, { savedStamp: stamp, baseRev, sealed });
    }
  }

  /** Makes `doc` this device's version of `id`, on top of whatever the server has confirmed. */
  private async settle(id: string, base: Doc | null, remote: Doc | null): Promise<boolean> {
    const mine = this.local.get(id);
    if (!mine) return false;
    const merged = merge3(base, mine.doc, remote);
    if (isEqual(merged, remote)) {
      this.local.delete(id);
      await this.store.clearPending(id);
    } else {
      this.clock += 1;
      Object.assign(mine, { doc: merged, stamp: this.clock });
    }
    return true;
  }

  private async pullNow(report: SyncReport): Promise<void> {
    for (;;) {
      const page = await this.remote.pull(this.cursor);
      await this.take(page.changes, report, page.cursor);
      if (!page.more) return;
    }
  }

  /**
   * Takes a page of the server's log: a newer version replaces this device's (a change made here
   * is merged with it), and our own coming back is nothing new. Anything else is the server
   * going back. Saved with the cursor, when given, in one go.
   */
  private async take(changes: RemoteRecord[], report: SyncReport, cursor?: number): Promise<void> {
    const changed: string[] = [];
    const fresh: StoredRecord[] = [];
    for (const change of changes) {
      const known = this.confirmed.get(change.id);
      if (known && known.rev >= change.rev) {
        if (wentBack(known, change)) this.behind.add(change.id);
        continue;
      }
      this.behind.delete(change.id);
      const next = await this.openConfirmed(change);
      this.confirmed.set(change.id, next);
      fresh.push(change);
      changed.push(change.id);
      if (!next.unreadable && (await this.settle(change.id, known?.doc ?? null, next.doc))) {
        report.merged += 1;
      }
    }
    await this.store.confirm(fresh, cursor);
    if (cursor !== undefined) this.cursor = cursor;
    report.pulled += fresh.length;
    this.emit(changed);
  }

  private async pushNow(report: SyncReport): Promise<void> {
    for (let round = 0; round < PUSH_ROUNDS; round += 1) {
      await this.flushNow();
      const outgoing = [...this.local].filter(
        ([id, entry]) =>
          entry.savedStamp === entry.stamp && !this.stuck.has(id) && !this.behind.has(id),
      );
      if (outgoing.length === 0) return;

      const changed: string[] = [];
      for (let start = 0; start < outgoing.length; start += PUSH_BATCH) {
        const batch = outgoing.slice(start, start + PUSH_BATCH).map(([id, entry]) => ({
          id,
          sent: { ...entry },
        }));
        const { results } = await this.remote.push(
          batch.map(({ id, sent }) => ({ id, baseRev: sent.baseRev, sealed: sent.sealed })),
        );
        for (const [i, result] of results.entries()) {
          const item = batch[i];
          if (!item || item.id !== result.id) continue;
          changed.push(item.id);
          if (result.ok) {
            await this.accepted(item.id, item.sent, result.rev, result.seq);
            report.pushed += 1;
          } else {
            await this.rejected(item.id, result.current);
            report.merged += 1;
          }
        }
      }
      this.emit(changed);
    }
  }

  private async accepted(id: string, sent: Local, rev: number, seq: number): Promise<void> {
    this.confirmed.set(id, { rev, seq, doc: sent.doc });
    await this.store.confirm([{ id, rev, seq, sealed: sent.sealed }]);
    await this.store.clearPending(id, sent.stamp);
    const now = this.local.get(id);
    // Changed again while the push was out: it stays, and is sealed again on the new version.
    if (now?.stamp === sent.stamp) this.local.delete(id);
    else if (now) now.savedStamp = 0;
  }

  private async rejected(id: string, current: RemoteRecord | null): Promise<void> {
    const known = this.confirmed.get(id);
    if (wentBack(known, current)) {
      // Merged with, the server's older version would undo what this device has: keep it as is.
      this.behind.add(id);
      return;
    }
    const mine = this.local.get(id);
    if (!mine) return;
    if (current === null) {
      // Neither the server nor this device has a version of it: send it again, as new.
      mine.savedStamp = 0;
      return;
    }
    const base = known?.doc ?? null;
    const next = await this.openConfirmed(current);
    this.confirmed.set(id, next);
    await this.store.confirm([current]);
    if (next.unreadable) {
      this.stuck.add(id);
      return;
    }
    await this.settle(id, base, next.doc);
    const now = this.local.get(id);
    if (now) now.savedStamp = 0;
  }
}

/**
 * Whether the server's version of a record goes back on the one this device had confirmed: an
 * older one, another under the same number (each version has one seq, for good), or none.
 */
function wentBack(known: Confirmed | undefined, current: RemoteRecord | null): boolean {
  if (!known) return false;
  if (current === null) return true;
  return current.rev < known.rev || (current.rev === known.rev && current.seq !== known.seq);
}

async function inBatches<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += OPEN_BATCH) {
    await Promise.all(items.slice(start, start + OPEN_BATCH).map(task));
  }
}
