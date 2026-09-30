/**
 * This device's copy of the journal, in IndexedDB. Everything in it is sealed exactly as it is on
 * the server (or sealed and waiting to go up), so a copied browser profile holds nothing readable.
 * The only plain values are bookkeeping: the sync cursor, which passkeys this device has, and the
 * sealed key slots (ciphertext too) so the journal can be unlocked without a connection.
 *
 * An installed iOS app has its own storage, separate from Safari's, and is exempt from Safari's
 * seven-day eviction; persist() asks every other browser not to evict it under storage pressure.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RemoteRecord, Slot } from '../api/client';

/** A record as the server last confirmed it. */
export type StoredRecord = RemoteRecord;

/** A local change waiting to go up: sealed as version baseRev + 1. */
export interface PendingChange {
  id: string;
  baseRev: number;
  sealed: string | null;
  /** Bumped on every local save; a push only clears the change it actually sent. */
  stamp: number;
}

/** A sealed file (photo or thumbnail), kept so it opens offline and is not fetched twice. */
export interface CachedFile {
  id: string;
  sealed: Uint8Array<ArrayBuffer>;
  usedAt: number;
}

/** A sealed file waiting to go up. */
export interface QueuedUpload {
  id: string;
  sealed: Uint8Array<ArrayBuffer>;
  queuedAt: number;
}

/** What unlocking needs when the server is out of reach. None of it is secret. */
export interface OfflineUnlock {
  rpId: string;
  akId: string;
  /** Passkeys known to work on this device, with their PRF salts. */
  passkeys: Record<string, string>;
  slots: Slot[];
}

interface Schema extends DBSchema {
  records: { key: string; value: StoredRecord };
  pending: { key: string; value: PendingChange };
  files: { key: string; value: CachedFile; indexes: { usedAt: number } };
  uploads: { key: string; value: QueuedUpload };
  meta: { key: string; value: unknown };
}

const NAME = 'allenkh-journal';
const VERSION = 1;

export type JournalDb = IDBPDatabase<Schema>;

let opening: Promise<JournalDb> | null = null;

export function db(): Promise<JournalDb> {
  opening ??= openDB<Schema>(NAME, VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('records', { keyPath: 'id' });
        database.createObjectStore('pending', { keyPath: 'id' });
        database.createObjectStore('files', { keyPath: 'id' }).createIndex('usedAt', 'usedAt');
        database.createObjectStore('uploads', { keyPath: 'id' });
        database.createObjectStore('meta');
      }
    },
    // Another tab upgraded the database: close ours so it can finish; this tab reloads.
    blocking() {
      void opening?.then((open) => open.close());
      opening = null;
    },
  });
  return opening;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

/** Forgets everything on this device (the server copy is untouched). */
export async function wipe(): Promise<void> {
  const open = await db();
  const tx = open.transaction(['records', 'pending', 'files', 'uploads', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('records').clear(),
    tx.objectStore('pending').clear(),
    tx.objectStore('files').clear(),
    tx.objectStore('uploads').clear(),
    tx.objectStore('meta').clear(),
    tx.done,
  ]);
}

/** Asks the browser to keep this storage under pressure. Harmless if refused. */
export async function persist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
