/**
 * The rollback check (docs/journal-crypto.md, "Sync"). The server cannot forge or alter a record,
 * but it could keep one from a device: show it an older journal, or not every change. So each
 * device publishes a manifest, a sealed record of its own listing the version of every record
 * the server has confirmed to it. Another device that has pulled past a manifest has been sent
 * every version it lists, or a later one (versions reach the server before a manifest can name
 * them, and pulls go in the server's order): whatever it lacks, the server kept from it.
 *
 * A manifest lists the other devices' manifests too, so the server cannot keep one device's news
 * from another without also keeping back every manifest written since by a device that has seen
 * it. A manifest cannot be forged (it is sealed like every record), but it can be held back with
 * the rest: a server that shows a device a consistent older journal, every manifest included, is
 * not caught by this.
 *
 * Read as defensively as model/normalize.ts reads records: it comes from another device.
 */
import type { Doc } from './merge';

export interface Manifest {
  /** When it was written, by its device's clock: only for pacing the next one. */
  updatedAt: number;
  /** The version of every record the server had confirmed to its device, by id. */
  records: ReadonlyMap<string, number>;
}

/** A record id (vault/ids.ts): keyed or random, 128 bits. */
const RECORD_ID = /^[kr]_[A-Za-z0-9_-]{22}$/;

/** A manifest, or null for a document that is not one. */
export function readManifest(doc: Doc): Manifest | null {
  if (doc['kind'] !== 'manifest') return null;
  const at = doc['updatedAt'];
  const listed = doc['records'];
  const records = new Map<string, number>();
  // A later format lists them some other way: then there is nothing here to check.
  if (doc['v'] === 1 && typeof listed === 'object' && listed !== null && !Array.isArray(listed)) {
    for (const [id, rev] of Object.entries(listed)) {
      if (RECORD_ID.test(id) && typeof rev === 'number' && Number.isSafeInteger(rev) && rev > 0) {
        records.set(id, rev);
      }
    }
  }
  return { updatedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0, records };
}

/** The document a device seals as its manifest. */
export function manifestDoc(records: ReadonlyMap<string, number>, now: number): Doc {
  return { kind: 'manifest', v: 1, updatedAt: now, records: Object.fromEntries(records) };
}

/** The records a manifest lists at a later version than this device has: kept from it. */
export function missingFrom(manifest: Manifest, has: (id: string) => number): string[] {
  const missing: string[] = [];
  for (const [id, rev] of manifest.records) if (has(id) < rev) missing.push(id);
  return missing;
}

/** Whether two lists give the same versions, leaving out the ids `skip` names. */
export function sameVersions(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  skip: (id: string) => boolean,
): boolean {
  let left = 0;
  for (const [id, rev] of a) {
    if (skip(id)) continue;
    if (b.get(id) !== rev) return false;
    left += 1;
  }
  for (const id of b.keys()) if (!skip(id)) left -= 1;
  return left === 0;
}
