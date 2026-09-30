/**
 * A sealed record: what the server stores for every day, event, person, photo's details, setting.
 *
 * Each seal makes a fresh random record key, encrypts the (padded) content with it, and wraps it
 * with the account's recordWrap key. Both ciphertexts are bound to the record's id and version,
 * so the server can neither swap two records nor pass off an old version as a new one.
 *
 * Binary layout, version 1, sent and stored as base64url:
 *
 *   'J' (0x4a) · 0x01 · akId length (1 byte) · akId (UTF-8)
 *   wrap iv (12) · wrapped record key (32 + 16 tag)
 *   iv (12) · ciphertext (padded length + 16 tag)
 *
 * Padding (ISO/IEC 7816-4: 0x80 then zeros, to a multiple of 256 bytes) keeps the length of a
 * short entry from saying much about how much was written.
 */
import { aad } from './aad';
import {
  VaultAuthError,
  VaultFormatError,
  authenticated,
  concat,
  decodeUtf8,
  encodeUtf8,
  fromBase64Url,
  randomBytes,
  toBase64Url,
} from './bytes';
import type { AccountKeys } from './keys';

const MAGIC = 0x4a;
const VERSION = 1;
const IV_BYTES = 12;
const WRAPPED_KEY_BYTES = 32 + 16;
const PAD_BLOCK = 256;
const AES_256 = { name: 'AES-GCM', length: 256 } as const;

export interface RecordRef {
  readonly id: string;
  /** The version being written (or read): 1 for a new record, then one more per save. */
  readonly rev: number;
}

export function pad(plain: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = Math.ceil((plain.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(length);
  out.set(plain);
  out[plain.length] = 0x80;
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array<ArrayBuffer> {
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (end < 0 || padded[end] !== 0x80) throw new VaultFormatError('Bad padding');
  return padded.slice(0, end);
}

export async function sealRecord(
  keys: AccountKeys,
  ref: RecordRef,
  plain: Uint8Array,
): Promise<string> {
  const recordKey = await crypto.subtle.generateKey(AES_256, true, ['encrypt']);
  const wrapIv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey('raw', recordKey, keys.recordWrap, {
    name: 'AES-GCM',
    iv: wrapIv,
    additionalData: aad.recordKey(ref.id, ref.rev),
  });
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad.record(ref.id, ref.rev) },
    recordKey,
    pad(plain),
  );
  const akId = encodeUtf8(keys.akId);
  if (akId.length > 255) throw new VaultFormatError('Account key id too long');
  return toBase64Url(
    concat(
      Uint8Array.of(MAGIC, VERSION, akId.length),
      akId,
      wrapIv,
      new Uint8Array(wrapped),
      iv,
      new Uint8Array(ciphertext),
    ),
  );
}

interface Parsed {
  readonly akId: string;
  readonly wrapIv: Uint8Array<ArrayBuffer>;
  readonly wrapped: Uint8Array<ArrayBuffer>;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}

function parse(sealed: string): Parsed {
  const bytes = fromBase64Url(sealed);
  if (bytes.length < 3 || bytes[0] !== MAGIC) throw new VaultFormatError('Not a sealed record');
  if (bytes[1] !== VERSION) throw new VaultFormatError(`Unknown record version ${bytes[1]}`);
  const idLength = bytes[2] ?? 0;
  let at = 3;
  const take = (length: number): Uint8Array<ArrayBuffer> => {
    if (at + length > bytes.length) throw new VaultFormatError('Sealed record is cut short');
    const part = bytes.slice(at, at + length);
    at += length;
    return part;
  };
  const akId = decodeUtf8(take(idLength));
  const wrapIv = take(IV_BYTES);
  const wrapped = take(WRAPPED_KEY_BYTES);
  const iv = take(IV_BYTES);
  const ciphertext = bytes.slice(at);
  if (ciphertext.length < PAD_BLOCK + 16) throw new VaultFormatError('Sealed record is cut short');
  return { akId, wrapIv, wrapped, iv, ciphertext };
}

/** Which account key sealed a record, without opening it (for a future key rotation). */
export const sealedBy = (sealed: string): string => parse(sealed).akId;

export async function openRecord(
  keys: AccountKeys,
  ref: RecordRef,
  sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const parts = parse(sealed);
  if (parts.akId !== keys.akId) throw new VaultAuthError();
  const recordKey = await authenticated(() =>
    crypto.subtle.unwrapKey(
      'raw',
      parts.wrapped,
      keys.recordWrap,
      { name: 'AES-GCM', iv: parts.wrapIv, additionalData: aad.recordKey(ref.id, ref.rev) },
      AES_256,
      false,
      ['decrypt'],
    ),
  );
  const padded = await authenticated(() =>
    crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: parts.iv, additionalData: aad.record(ref.id, ref.rev) },
      recordKey,
      parts.ciphertext,
    ),
  );
  return unpad(new Uint8Array(padded));
}

export async function sealJson(keys: AccountKeys, ref: RecordRef, value: unknown): Promise<string> {
  return sealRecord(keys, ref, encodeUtf8(JSON.stringify(value)));
}

export async function openJson<T = unknown>(
  keys: AccountKeys,
  ref: RecordRef,
  sealed: string,
): Promise<T> {
  return JSON.parse(decodeUtf8(await openRecord(keys, ref, sealed))) as T;
}
