/**
 * Record ids. The server sees every id, so an id must say nothing: not when a record was made
 * (so no ULIDs or timestamps), not what kind of record it is (so no "person_" or "photo_"
 * prefixes), and not which day an entry is about.
 *
 *   k_…   keyed: an HMAC of a name under a key derived from the account key. Every device
 *         computes the same id on its own, so two devices writing the same day (or the settings)
 *         offline meet in one record instead of making two. Meaningless to anyone else.
 *   r_…   random: 128 bits, for everything that is created once (an event, a person, a photo).
 *   b_…   a sealed file in R2 (random).
 */
import { encodeUtf8, randomBytes, toBase64Url } from './bytes';
import type { AccountKeys } from './keys';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function keyedId(keys: AccountKeys, name: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', keys.ids, encodeUtf8(name));
  return `k_${toBase64Url(new Uint8Array(mac).subarray(0, 16))}`;
}

export async function dayId(keys: AccountKeys, date: string): Promise<string> {
  if (!DATE.test(date)) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  return keyedId(keys, `day:${date}`);
}

export async function monthId(keys: AccountKeys, month: string): Promise<string> {
  if (!MONTH.test(month)) throw new RangeError(`Not a YYYY-MM month: ${month}`);
  return keyedId(keys, `month:${month}`);
}

/** Records there is exactly one of (settings, the activity set). */
export const singletonId = (keys: AccountKeys, name: 'settings' | 'activities'): Promise<string> =>
  keyedId(keys, `singleton:${name}`);

/** Any record created once: 128 random bits. */
export const randomId = (): string => `r_${toBase64Url(randomBytes(16))}`;

/** A sealed file in R2. */
export const blobId = (): string => `b_${toBase64Url(randomBytes(16))}`;
