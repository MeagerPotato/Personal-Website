/** The replica's storage (journal/replica.ts), in this device's IndexedDB (db.ts). */
import type { ReplicaStore } from '../journal/replica';
import { db } from './db';

export const replicaStore: ReplicaStore = {
  async load() {
    const open = await db();
    const [records, pending, cursor] = await Promise.all([
      open.getAll('records'),
      open.getAll('pending'),
      open.get('meta', 'cursor'),
    ]);
    return { records, pending, cursor: typeof cursor === 'number' ? cursor : 0 };
  },

  async confirm(records, cursor) {
    const tx = (await db()).transaction(['records', 'meta'], 'readwrite');
    const writes: Promise<unknown>[] = records.map((record) =>
      tx.objectStore('records').put(record),
    );
    if (cursor !== undefined) writes.push(tx.objectStore('meta').put(cursor, 'cursor'));
    await Promise.all([...writes, tx.done]);
  },

  async savePending(change) {
    await (await db()).put('pending', change);
  },

  async clearPending(id, stamp) {
    const tx = (await db()).transaction('pending', 'readwrite');
    const current = await tx.store.get(id);
    if (current && (stamp === undefined || current.stamp === stamp)) await tx.store.delete(id);
    await tx.done;
  },
};
