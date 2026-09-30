import { beforeEach, describe, expect, it } from 'vitest';
import type { Change, PushResult, RemoteRecord } from '../api/client';
import type { PendingChange, StoredRecord } from '../store/db';
import { openJson, sealJson } from '../vault/envelope';
import { accountKeysFromRaw, newAccountKey, type AccountKeys } from '../vault/keys';
import { manifestDoc, missingFrom, readManifest } from './manifest';
import { merge3, type Doc } from './merge';
import { Replica, type Codec, type ReplicaRemote, type ReplicaStore } from './replica';

/** The server's sync rules (worker/routes/sync.ts), in memory. */
class FakeServer implements ReplicaRemote {
  records = new Map<string, RemoteRecord>();
  seq = 0;
  offline = false;
  pushes = 0;
  pageSize = 500;
  /** Records a dishonest server leaves out of every pull. */
  withhold = new Set<string>();

  async pull(since: number) {
    if (this.offline) throw new Error('offline');
    const all = [...this.records.values()]
      .filter((r) => r.seq > since && !this.withhold.has(r.id))
      .sort((a, b) => a.seq - b.seq);
    const changes = all.slice(0, this.pageSize).map((r) => ({ ...r }));
    return { changes, cursor: changes.at(-1)?.seq ?? since, more: all.length > this.pageSize };
  }

  async push(changes: Change[]) {
    if (this.offline) throw new Error('offline');
    this.pushes += 1;
    const results: PushResult[] = changes.map((change) => {
      const current = this.records.get(change.id);
      if ((current?.rev ?? 0) !== change.baseRev) {
        return { id: change.id, ok: false, current: current ? { ...current } : null };
      }
      this.seq += 1;
      const next = { id: change.id, rev: change.baseRev + 1, seq: this.seq, sealed: change.sealed };
      this.records.set(change.id, next);
      return { id: change.id, ok: true, rev: next.rev, seq: next.seq };
    });
    return { results };
  }
}

class MemoryStore implements ReplicaStore {
  records = new Map<string, StoredRecord>();
  pending = new Map<string, PendingChange>();
  cursor = 0;

  async load() {
    return {
      records: [...this.records.values()],
      pending: [...this.pending.values()],
      cursor: this.cursor,
    };
  }
  async confirm(records: StoredRecord[], cursor?: number) {
    for (const record of records) this.records.set(record.id, { ...record });
    if (cursor !== undefined) this.cursor = cursor;
  }
  async savePending(change: PendingChange) {
    this.pending.set(change.id, { ...change });
  }
  async clearPending(id: string, stamp?: number) {
    if (stamp === undefined || this.pending.get(id)?.stamp === stamp) this.pending.delete(id);
  }
}

const codecFor = (keys: AccountKeys): Codec => ({
  seal: (id, rev, doc) => sealJson(keys, { id, rev }, doc),
  open: (id, rev, sealed) => openJson<Doc>(keys, { id, rev }, sealed),
});

let keys: AccountKeys;
let server: FakeServer;

beforeEach(async () => {
  const ak = newAccountKey();
  keys = await accountKeysFromRaw(ak.raw, ak.akId);
  server = new FakeServer();
});

async function device(store = new MemoryStore()) {
  const replica = await Replica.open(store, server, codecFor(keys));
  return { replica, store };
}

const DAY = 'k_day0000000000000000000';
const EVENT = 'r_event00000000000000000';
const note = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('sync between two devices', () => {
  it('carries a record from one device to another', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 4, updatedAt: 1 });
    await phone.replica.sync();
    expect(laptop.replica.get(DAY)).toBeUndefined();
    await laptop.replica.sync();
    expect(laptop.replica.get(DAY)).toEqual({ kind: 'day', mood: 4, updatedAt: 1 });
    expect(server.records.get(DAY)?.rev).toBe(1);
  });

  it('never sends the server anything readable', async () => {
    const phone = await device();
    phone.replica.write(DAY, { kind: 'day', text: 'a very private sentence', updatedAt: 1 });
    await phone.replica.sync();
    const sealed = [...server.records.values()].map((record) => record.sealed).join();
    expect(sealed).not.toContain('private');
    expect(sealed).not.toContain('kind');
    expect(atob(sealed.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('private');
  });

  it('merges changes to different fields made on both devices while apart', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 3, activities: ['a'], updatedAt: 1 });
    await phone.replica.sync();
    await laptop.replica.sync();

    server.offline = true;
    phone.replica.write(DAY, { kind: 'day', mood: 5, activities: ['a', 'b'], updatedAt: 2 });
    laptop.replica.write(DAY, {
      kind: 'day',
      mood: 3,
      activities: ['a', 'c'],
      note: note('dinner with friends'),
      updatedAt: 3,
    });
    server.offline = false;

    await phone.replica.sync();
    await laptop.replica.sync(); // conflicts, merges, pushes the merge
    await phone.replica.sync();

    const expected = {
      kind: 'day',
      mood: 5,
      activities: ['a', 'c', 'b'],
      note: note('dinner with friends'),
      updatedAt: 3,
    };
    expect(laptop.replica.get(DAY)).toEqual(expected);
    expect(phone.replica.get(DAY)).toEqual(expected);
    expect(phone.replica.status.pending).toBe(0);
    expect(laptop.replica.status.pending).toBe(0);
  });

  it('keeps the older writing as a conflict copy when both devices rewrote the note', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(DAY, { kind: 'day', note: note('draft'), updatedAt: 1 });
    await phone.replica.sync();
    await laptop.replica.sync();

    phone.replica.write(DAY, { kind: 'day', note: note('written on the train'), updatedAt: 5 });
    laptop.replica.write(DAY, { kind: 'day', note: note('written at home'), updatedAt: 9 });
    await phone.replica.sync();
    await laptop.replica.sync();
    await phone.replica.sync();

    const day = phone.replica.get(DAY) as Doc;
    expect(day['note']).toEqual(note('written at home'));
    expect(day['conflicts']).toEqual([
      { id: 'note@5', path: 'note', value: note('written on the train'), at: 5 },
    ]);
    expect(laptop.replica.get(DAY)).toEqual(day);
  });

  it('lets an edit win over a deletion made elsewhere', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(EVENT, { kind: 'event', title: 'Launch', updatedAt: 1 });
    await phone.replica.sync();
    await laptop.replica.sync();

    phone.replica.write(EVENT, null);
    laptop.replica.write(EVENT, { kind: 'event', title: 'Launch day!', updatedAt: 2 });
    await phone.replica.sync();
    expect(server.records.get(EVENT)?.sealed).toBeNull();
    await laptop.replica.sync();
    await phone.replica.sync();
    expect(phone.replica.get(EVENT)).toEqual({ kind: 'event', title: 'Launch day!', updatedAt: 2 });
  });

  it('deletes everywhere when nobody else changed the record', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(EVENT, { kind: 'event', title: 'Launch', updatedAt: 1 });
    await phone.replica.sync();
    await laptop.replica.sync();
    laptop.replica.write(EVENT, null);
    await laptop.replica.sync();
    await phone.replica.sync();
    expect(phone.replica.get(EVENT)).toBeNull();
    expect([...phone.replica.entries()]).toEqual([]);
  });

  it('meets in one record when two devices create the same day offline', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 4, updatedAt: 1 });
    laptop.replica.write(DAY, { kind: 'day', activities: ['gym'], updatedAt: 2 });
    await phone.replica.sync();
    await laptop.replica.sync();
    await phone.replica.sync();
    const expected = { kind: 'day', mood: 4, activities: ['gym'], updatedAt: 2 };
    expect(phone.replica.get(DAY)).toEqual(expected);
    expect(laptop.replica.get(DAY)).toEqual(expected);
    expect(server.records.get(DAY)?.rev).toBe(2);
  });

  it('never sends a record that was made and deleted before it went up', async () => {
    const phone = await device();
    phone.replica.write(EVENT, { kind: 'event', title: 'oops', updatedAt: 1 });
    await phone.replica.flush();
    phone.replica.write(EVENT, null);
    await phone.replica.sync();
    expect(server.records.has(EVENT)).toBe(false);
    expect(phone.store.pending.size).toBe(0);
  });
});

describe('a device on its own', () => {
  it('keeps changes made offline, sealed, across a restart, and sends them later', async () => {
    const first = await device();
    server.offline = true;
    first.replica.write(DAY, { kind: 'day', mood: 2, updatedAt: 1 });
    await expect(first.replica.sync()).rejects.toThrow('offline');
    await first.replica.flush();
    expect(JSON.stringify([...first.store.pending.values()])).not.toContain('mood');

    const restarted = await device(first.store);
    expect(restarted.replica.get(DAY)).toEqual({ kind: 'day', mood: 2, updatedAt: 1 });
    server.offline = false;
    await restarted.replica.sync();
    expect(server.records.get(DAY)?.rev).toBe(1);
    expect(first.store.pending.size).toBe(0);
  });

  it('seals a change made during a push again, on the new version', async () => {
    const phone = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 1, updatedAt: 1 });
    const push = server.push.bind(server);
    server.push = async (changes) => {
      phone.replica.write(DAY, { kind: 'day', mood: 2, updatedAt: 2 }); // typed mid-flight
      server.push = push;
      return push(changes);
    };
    await phone.replica.sync();
    expect(phone.replica.get(DAY)).toEqual({ kind: 'day', mood: 2, updatedAt: 2 });
    await phone.replica.sync();
    expect(server.records.get(DAY)?.rev).toBe(2);
    const laptop = await device();
    await laptop.replica.sync();
    expect(laptop.replica.get(DAY)).toEqual({ kind: 'day', mood: 2, updatedAt: 2 });
  });

  it('ignores a server that replays an older version', async () => {
    const phone = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 1, updatedAt: 1 });
    await phone.replica.sync();
    const old = { ...(server.records.get(DAY) as RemoteRecord) };
    phone.replica.write(DAY, { kind: 'day', mood: 5, updatedAt: 2 });
    await phone.replica.sync();
    server.seq += 1;
    server.records.set(DAY, { ...old, seq: server.seq }); // rev 1 again, as if new
    await phone.replica.sync();
    expect(phone.replica.get(DAY)).toEqual({ kind: 'day', mood: 5, updatedAt: 2 });
    expect(phone.replica.status.behind).toBe(1);
  });

  it('keeps, and never overwrites, a record it cannot read', async () => {
    const stranger = newAccountKey();
    const strangerKeys = await accountKeysFromRaw(stranger.raw, stranger.akId);
    server.seq += 1;
    server.records.set(DAY, {
      id: DAY,
      rev: 1,
      seq: server.seq,
      sealed: await sealJson(strangerKeys, { id: DAY, rev: 1 }, { secret: true }),
    });
    const phone = await device();
    await phone.replica.sync();
    expect(phone.replica.get(DAY)).toBeNull();
    expect(phone.replica.status.unreadable).toBe(1);
  });

  it('pulls a long history in pages', async () => {
    server.pageSize = 7;
    const phone = await device();
    for (let i = 0; i < 20; i += 1) {
      phone.replica.write(`r_${String(i).padStart(22, '0')}`, { kind: 'person', i, updatedAt: i });
    }
    await phone.replica.sync();
    const laptop = await device();
    const report = await laptop.replica.sync();
    expect(report.pulled).toBe(20);
    expect([...laptop.replica.entries()]).toHaveLength(20);
  });

  it('tells listeners what changed', async () => {
    const phone = await device();
    const heard: string[][] = [];
    phone.replica.subscribe((ids) => heard.push([...ids]));
    phone.replica.write(DAY, { kind: 'day', updatedAt: 1 });
    phone.replica.write(DAY, { kind: 'day', updatedAt: 1 }); // no change, no news
    expect(heard).toEqual([[DAY]]);
  });
});

describe('a server that goes back', () => {
  it('answering a write with an older version: the device keeps its own', async () => {
    const phone = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 1, updatedAt: 1 });
    await phone.replica.sync();
    const backup = { ...(server.records.get(DAY) as RemoteRecord) };
    phone.replica.write(DAY, { kind: 'day', mood: 1, activities: ['gym'], updatedAt: 2 });
    await phone.replica.sync();
    server.records.set(DAY, backup); // restored from a backup: rev 1 again

    phone.replica.write(DAY, { kind: 'day', mood: 4, activities: ['gym'], updatedAt: 3 });
    await phone.replica.sync();
    // Merged with rev 1, the gym would have gone: rev 1 never had it.
    expect(phone.replica.get(DAY)).toEqual({
      kind: 'day',
      mood: 4,
      activities: ['gym'],
      updatedAt: 3,
    });
    expect(phone.replica.status).toMatchObject({ behind: 1, pending: 1 });
    expect(server.records.get(DAY)).toEqual(backup); // and nothing was written over it
    // The change waits here: not sent again this session.
    const pushes = server.pushes;
    await phone.replica.sync();
    expect(server.pushes).toBe(pushes);
  });

  it('with another version under the same number: noticed, until a newer one comes', async () => {
    const phone = await device();
    const laptop = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 1, updatedAt: 1 });
    await phone.replica.sync();
    await laptop.replica.sync();
    // The server loses the day, and a new device writes it afresh: rev 1 again, another one.
    server.records.delete(DAY);
    const tablet = await device();
    tablet.replica.write(DAY, { kind: 'day', mood: 5, updatedAt: 2 });
    await tablet.replica.sync();

    await laptop.replica.sync();
    expect(laptop.replica.get(DAY)).toEqual({ kind: 'day', mood: 1, updatedAt: 1 });
    expect(laptop.replica.status.behind).toBe(1);

    tablet.replica.write(DAY, { kind: 'day', mood: 3, updatedAt: 3 });
    await tablet.replica.sync();
    await laptop.replica.sync();
    expect(laptop.replica.get(DAY)).toEqual({ kind: 'day', mood: 3, updatedAt: 3 });
    expect(laptop.replica.status.behind).toBe(0);
  });

  it('with nothing where it had a record: noticed, and not written again as new', async () => {
    const phone = await device();
    phone.replica.write(EVENT, { kind: 'event', title: 'Launch', updatedAt: 1 });
    await phone.replica.sync();
    server.records.delete(EVENT);
    phone.replica.write(EVENT, { kind: 'event', title: 'Launch day', updatedAt: 2 });
    await phone.replica.sync();
    expect(phone.replica.status).toMatchObject({ behind: 1, pending: 1 });
    expect(server.records.has(EVENT)).toBe(false);
    expect(phone.replica.get(EVENT)).toEqual({ kind: 'event', title: 'Launch day', updatedAt: 2 });
  });
});

describe('what a device publishes about itself', () => {
  const MANIFEST = 'r_manifest00000000000000';

  it('goes up at once over whatever is there, and never waits as a change', async () => {
    const phone = await device();
    expect(await phone.replica.publish(MANIFEST, { kind: 'manifest', n: 1 })).toBe('published');
    expect(phone.replica.status.pending).toBe(0);
    expect(phone.store.pending.size).toBe(0);
    expect(server.records.get(MANIFEST)?.rev).toBe(1);
    // A tab of the same browser that has not seen that version says it again, on top.
    const tab = await device();
    expect(await tab.replica.publish(MANIFEST, { kind: 'manifest', n: 2 })).toBe('published');
    expect(server.records.get(MANIFEST)?.rev).toBe(2);
    const laptop = await device();
    await laptop.replica.sync();
    expect(laptop.replica.get(MANIFEST)).toEqual({ kind: 'manifest', n: 2 });
  });

  it('is given up when the server has gone back on it', async () => {
    const phone = await device();
    await phone.replica.publish(MANIFEST, { kind: 'manifest', n: 1 });
    const backup = { ...(server.records.get(MANIFEST) as RemoteRecord) };
    await phone.replica.publish(MANIFEST, { kind: 'manifest', n: 2 });
    server.records.set(MANIFEST, backup);
    expect(await phone.replica.publish(MANIFEST, { kind: 'manifest', n: 3 })).toBe('behind');
    expect(phone.replica.status.behind).toBe(1);
    expect(server.records.get(MANIFEST)).toEqual(backup);
  });

  it('lets another device tell what the server kept from it', async () => {
    const phone = await device();
    phone.replica.write(DAY, { kind: 'day', mood: 4, updatedAt: 1 });
    phone.replica.write(EVENT, { kind: 'event', title: 'Launch', updatedAt: 1 });
    await phone.replica.sync();
    const records = new Map(phone.replica.versions());
    await phone.replica.publish(MANIFEST, manifestDoc(records, 1));

    server.withhold.add(EVENT);
    const laptop = await device();
    await laptop.replica.sync();
    const manifest = readManifest(laptop.replica.get(MANIFEST) as Doc);
    if (!manifest) throw new Error('The laptop has no manifest');
    expect(manifest.records).toEqual(records);
    const has = (id: string) => laptop.replica.revision(id);
    expect(missingFrom(manifest, has)).toEqual([EVENT]);

    // Held back no more, the event reaches the laptop with its next version.
    server.withhold.clear();
    phone.replica.write(EVENT, { kind: 'event', title: 'Launch day', updatedAt: 2 });
    await phone.replica.sync();
    await laptop.replica.sync();
    expect(missingFrom(manifest, has)).toEqual([]);
  });
});

describe('merge3', () => {
  it('removes an item dropped on one side and keeps one added on the other', () => {
    const base = { list: ['a', 'b'], updatedAt: 1 };
    expect(
      merge3(base, { list: ['a'], updatedAt: 2 }, { list: ['a', 'b', 'c'], updatedAt: 3 }),
    ).toEqual({
      list: ['a', 'c'],
      updatedAt: 3,
    });
  });

  it('merges photos by id, captions included', () => {
    const base = {
      photos: [
        { id: 'p1', caption: '' },
        { id: 'p2', caption: '' },
      ],
      updatedAt: 1,
    };
    const local = { photos: [{ id: 'p1', caption: 'the pad' }], updatedAt: 2 };
    const remote = {
      photos: [
        { id: 'p1', caption: '' },
        { id: 'p2', caption: '' },
        { id: 'p3', caption: '' },
      ],
      updatedAt: 3,
    };
    expect(merge3(base, local, remote)).toEqual({
      photos: [
        { id: 'p1', caption: 'the pad' },
        { id: 'p3', caption: '' },
      ],
      updatedAt: 3,
    });
  });

  it('keeps a photo removed on one side if the other side changed it', () => {
    const base = { photos: [{ id: 'p1', caption: '' }], updatedAt: 1 };
    expect(
      merge3(
        base,
        { photos: [], updatedAt: 2 },
        { photos: [{ id: 'p1', caption: 'keep me' }], updatedAt: 3 },
      ),
    ).toEqual({ photos: [{ id: 'p1', caption: 'keep me' }], updatedAt: 3 });
  });

  it('lets the newer side win a plain value', () => {
    const base = { mood: 3, updatedAt: 1 };
    expect(merge3(base, { mood: 4, updatedAt: 9 }, { mood: 1, updatedAt: 5 })).toEqual({
      mood: 4,
      updatedAt: 9,
    });
    expect(merge3(base, { mood: 4, updatedAt: 5 }, { mood: 1, updatedAt: 9 })).toEqual({
      mood: 1,
      updatedAt: 9,
    });
  });

  it('keeps a dismissed conflict copy dismissed', () => {
    const copy = { id: 'note@5', path: 'note', value: note('old'), at: 5 };
    const base = { note: note('new'), conflicts: [copy], updatedAt: 9 };
    const local = { note: note('new'), updatedAt: 10 }; // dismissed here
    const remote = { note: note('new'), conflicts: [copy], mood: 2, updatedAt: 11 };
    expect(merge3(base, local, remote)).toEqual({ note: note('new'), mood: 2, updatedAt: 11 });
  });
});
