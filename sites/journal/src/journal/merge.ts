/**
 * Three-way merge of one record: what a device does when two devices changed the same record
 * while apart (the phone offline on the train, the laptop at home). Only the devices can read the
 * content, so the server cannot merge; it tells the device what is there now, and the device
 * merges that with its own change, knowing the version both started from (the "base").
 *
 * Field by field:
 *   - changed on one side only        that side's value
 *   - changed on both, the same way   that value
 *   - lists of plain values (activity ids) and of { id } objects (photos): merged as sets, so an
 *     activity ticked on the phone and another on the laptop both stay ticked
 *   - objects: merged key by key
 *   - rich text (an editor document) cannot be merged mechanically: the newer version wins and
 *     the other is kept in `conflicts`, so no writing is ever lost
 *   - anything else: the newer version wins (by the record's updatedAt)
 *   - deleted on one side, edited on the other: the edit wins; deleting loses less than nothing
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Doc = { [key: string]: Json };

/**
 * A version that lost a merge, kept inside the record (in its `conflicts` list) so the writing
 * survives until someone reads it and dismisses it.
 */
export interface ConflictCopy {
  /** `${path}@${at}`: the same loss found by two devices is kept once. */
  id: string;
  /** Where it was: 'note', or a path like 'photos.r_abc.caption'. */
  path: string;
  value: Json;
  /** When that version was written (its record's updatedAt). */
  at: number;
}

export function isEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
  }
  const left = a as Doc;
  const right = b as Doc;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && isEqual(left[key], right[key]));
}

const isObject = (value: Json | undefined): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rich text: an editor document (ProseMirror JSON), merged only as a whole. */
const isRichText = (value: Json | undefined): boolean => isObject(value) && value['type'] === 'doc';

const isPrimitiveList = (value: Json[]): boolean =>
  value.every((item) => typeof item === 'string' || typeof item === 'number');

const idOf = (item: Json): string | null =>
  isObject(item) && typeof item['id'] === 'string' ? item['id'] : null;

const isIdList = (value: Json[]): boolean => value.every((item) => idOf(item) !== null);

interface Side {
  /** Whether the local version is the newer one. */
  localWins: boolean;
  localAt: number;
  remoteAt: number;
  conflicts: ConflictCopy[];
}

function mergeValue(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
  path: string,
  side: Side,
): Json | undefined {
  if (isEqual(local, remote)) return local;
  if (isEqual(local, base)) return remote;
  if (isEqual(remote, base)) return local;

  // Both changed, differently.
  if (local === undefined) return remote; // removed here, edited there: the edit wins
  if (remote === undefined) return local;

  if (isRichText(local) || isRichText(remote)) {
    const [winner, loser, loserAt] = side.localWins
      ? [local, remote, side.remoteAt]
      : [remote, local, side.localAt];
    side.conflicts.push({ id: `${path}@${loserAt}`, path, value: loser, at: loserAt });
    return winner;
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const was = Array.isArray(base) ? base : [];
    if (isPrimitiveList(local) && isPrimitiveList(remote) && isPrimitiveList(was)) {
      return mergeSet(was, local, remote);
    }
    if (isIdList(local) && isIdList(remote) && isIdList(was)) {
      return mergeById(was, local, remote, path, side);
    }
  }
  if (isObject(local) && isObject(remote)) {
    return mergeObject(isObject(base) ? base : {}, local, remote, path, side);
  }
  return side.localWins ? local : remote;
}

function mergeSet(base: Json[], local: Json[], remote: Json[]): Json[] {
  const inBase = new Set(base);
  const inLocal = new Set(local);
  const inRemote = new Set(remote);
  const keep = (item: Json) => (inLocal.has(item) && inRemote.has(item)) || !inBase.has(item);
  return [...local.filter(keep), ...remote.filter((item) => !inLocal.has(item) && keep(item))];
}

function mergeById(base: Json[], local: Json[], remote: Json[], path: string, side: Side): Json[] {
  const byId = (list: Json[]) => new Map(list.map((item) => [idOf(item) as string, item]));
  const was = byId(base);
  const mine = byId(local);
  const theirs = byId(remote);
  const out: Json[] = [];
  const order = [...mine.keys(), ...[...theirs.keys()].filter((id) => !mine.has(id))];
  for (const id of order) {
    const merged = mergeValue(was.get(id), mine.get(id), theirs.get(id), `${path}.${id}`, side);
    if (merged === undefined) continue;
    // Present in the base and dropped by one side: gone, unless the other side changed it.
    const dropped = was.has(id) && (!mine.has(id) || !theirs.has(id));
    if (dropped && isEqual(merged, was.get(id))) continue;
    out.push(merged);
  }
  return out;
}

function mergeObject(base: Doc, local: Doc, remote: Doc, path: string, side: Side): Doc {
  const out: Doc = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const merged = mergeValue(
      base[key],
      local[key],
      remote[key],
      path ? `${path}.${key}` : key,
      side,
    );
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

const updatedAt = (doc: Doc): number =>
  typeof doc['updatedAt'] === 'number' ? doc['updatedAt'] : 0;

/** The record without its stamp, which is merged on its own (the later of the two). */
const unstamped = (doc: Doc): Doc =>
  Object.fromEntries(Object.entries(doc).filter(([key]) => key !== 'updatedAt'));

/**
 * Merges a local and a remote version of one record, given the version both started from
 * (null for "did not exist", or "deleted"). Returns null only when both sides deleted it, or
 * one side deleted it and the other left it alone.
 */
export function merge3(base: Doc | null, local: Doc | null, remote: Doc | null): Doc | null {
  if (isEqual(local, remote)) return local;
  if (isEqual(local, base)) return remote;
  if (isEqual(remote, base)) return local;
  if (local === null) return remote;
  if (remote === null) return local;

  const localAt = updatedAt(local);
  const remoteAt = updatedAt(remote);
  const side: Side = { localWins: localAt > remoteAt, localAt, remoteAt, conflicts: [] };
  const mine = unstamped(local);
  const theirs = unstamped(remote);
  const was = unstamped(base ?? {});
  // `conflicts` is an ordinary list of { id } objects here, so a copy dismissed on one device
  // stays dismissed; only the copies made by this merge are added afterwards.
  const merged = mergeObject(was, mine, theirs, '', side);
  if (side.conflicts.length > 0) {
    const kept = Array.isArray(merged['conflicts']) ? merged['conflicts'] : [];
    const known = new Set(kept.map(idOf));
    const added = side.conflicts.filter((copy) => !known.has(copy.id));
    merged['conflicts'] = [...kept, ...(added as unknown as Json[])];
  }
  return { ...merged, updatedAt: Math.max(localAt, remoteAt) };
}
