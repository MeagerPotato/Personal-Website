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

  get status(): { pending: number; unreadable: number; stuck: number; cursor: number } {
    let unreadable = 0;
    for (const entry of this.confirmed.values()) if (entry.unreadable) unreadable += 1;
    return { pending: this.local.size, unreadable, stuck: this.stuck.size, cursor: this.cursor };
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
      const changed: string[] = [];
      const fresh: StoredRecord[] = [];
      for (const change of page.changes) {
        const known = this.confirmed.get(change.id);
        // Our own write coming back, or an old version replayed: nothing new.
        if (known && known.rev >= change.rev) continue;
        const next = await this.openConfirmed(change);
        this.confirmed.set(change.id, next);
        fresh.push(change);
        changed.push(change.id);
        if (!next.unreadable && (await this.settle(change.id, known?.doc ?? null, next.doc))) {
          report.merged += 1;
        }
      }
      await this.store.confirm(fresh, page.cursor);
      this.cursor = page.cursor;
      report.pulled += fresh.length;
      this.emit(changed);
      if (!page.more) return;
    }
  }

  private async pushNow(report: SyncReport): Promise<void> {
    for (let round = 0; round < PUSH_ROUNDS; round += 1) {
      await this.flushNow();
      const outgoing = [...this.local].filter(
        ([id, entry]) => entry.savedStamp === entry.stamp && !this.stuck.has(id),
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
    const mine = this.local.get(id);
    if (!mine) return;
    if (current === null) {
      // The server has no such record (it was reset?): start again from nothing.
      this.confirmed.delete(id);
      mine.savedStamp = 0;
      return;
    }
    const base = this.confirmed.get(id)?.doc ?? null;
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

async function inBatches<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += OPEN_BATCH) {
    await Promise.all(items.slice(start, start + OPEN_BATCH).map(task));
  }
}
