/**
 * The key hierarchy (sites/docs/journal-crypto.md has the whole design and its reasons).
 *
 *   account key (AK)   32 random bytes, made once on the first device. Never leaves a device
 *                      unwrapped; the server holds only copies sealed by an unlock method.
 *     ├─ recordWrap    AES-256-GCM, derived by HKDF: wraps each record's own random key
 *     ├─ ids           HMAC-SHA-256, derived: turns a date into a stable id the server can't read
 *     └─ manifest      HMAC-SHA-256, derived: reserved (the rollback check seals its manifests
 *                      like any record instead: journal/manifest.ts)
 *
 *   unlock methods, each a key-encryption key (KEK) that seals a copy of the AK in a "slot":
 *     passkey          HKDF(the passkey's PRF output)       Face ID, Touch ID, Windows Hello
 *     passphrase       HKDF(Argon2id(passphrase))            optional
 *     recovery         HKDF(24-word recovery phrase)         required; printed at setup
 *
 * On unlock, the AK is unwrapped straight into a non-extractable HKDF key, so script never sees
 * its bytes; only adding a new unlock method (after a fresh unlock) reads them, to seal a copy.
 */
import { argon2id } from 'hash-wasm';
import { HKDF_SALT, aad, info, type SlotKind } from './aad';
import {
  VaultFormatError,
  authenticated,
  concat,
  copy,
  fromBase64Url,
  randomBytes,
  toBase64Url,
} from './bytes';

const AES_256 = { name: 'AES-GCM', length: 256 } as const;
const HMAC_256 = { name: 'HMAC', hash: 'SHA-256', length: 256 } as const;
const IV_BYTES = 12;
const AK_BYTES = 32;
const TAG_BYTES = 16;

export interface AccountKeys {
  readonly akId: string;
  readonly recordWrap: CryptoKey;
  readonly ids: CryptoKey;
  readonly manifest: CryptoKey;
}

/** Where a sealed AK copy belongs; all three are bound into its ciphertext. */
export interface SlotRef {
  readonly kind: SlotKind;
  readonly slotId: string;
  readonly akId: string;
}

async function hkdfBase(material: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

type HkdfAlgorithm = { name: 'HKDF'; hash: 'SHA-256'; salt: BufferSource; info: BufferSource };
type Usage =
  'encrypt' | 'decrypt' | 'unwrapKey' | 'wrapKey' | 'sign' | 'verify' | 'deriveKey' | 'deriveBits';

function hkdf(label: Uint8Array<ArrayBuffer>): HkdfAlgorithm {
  return { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: label };
}

/** The working keys, all derived from the AK's HKDF root. */
export async function accountKeysFromRoot(root: CryptoKey, akId: string): Promise<AccountKeys> {
  const [recordWrap, ids, manifest] = await Promise.all([
    crypto.subtle.deriveKey(hkdf(info.recordWrap), root, AES_256, false, ['wrapKey', 'unwrapKey']),
    crypto.subtle.deriveKey(hkdf(info.ids), root, HMAC_256, false, ['sign']),
    crypto.subtle.deriveKey(hkdf(info.manifest), root, HMAC_256, false, ['sign', 'verify']),
  ]);
  return { akId, recordWrap, ids, manifest };
}

/** A brand-new account key. Its bytes are only ever sealed into slots, then dropped. */
export function newAccountKey(): { readonly akId: string; readonly raw: Uint8Array<ArrayBuffer> } {
  return { akId: `ak_${toBase64Url(randomBytes(9))}`, raw: randomBytes(AK_BYTES) };
}

/** The working keys straight from raw AK bytes (setup, and tests). */
export async function accountKeysFromRaw(raw: Uint8Array, akId: string): Promise<AccountKeys> {
  if (raw.length !== AK_BYTES) throw new VaultFormatError('An account key is 32 bytes');
  return accountKeysFromRoot(await hkdfBase(copy(raw)), akId);
}

// --- Key-encryption keys, one per unlock method ------------------------------------------------

const KEK_USAGES: Usage[] = ['encrypt', 'decrypt', 'unwrapKey'];

/**
 * From a passkey's PRF output (32 bytes, evaluated with that credential's own salt and user
 * verification required). The credential id is in the label, so two passkeys never share a KEK.
 */
export async function kekFromPrf(
  prfOutput: BufferSource,
  credentialId: string,
): Promise<CryptoKey> {
  const base = await hkdfBase(prfOutput);
  return crypto.subtle.deriveKey(
    hkdf(info.kekPasskey(credentialId)),
    base,
    AES_256,
    false,
    KEK_USAGES,
  );
}

/** Argon2id cost, stored with the slot so it can be raised later without breaking old slots. */
export interface Argon2Params {
  /** Memory in KiB. */
  readonly m: number;
  /** Passes. */
  readonly t: number;
  /** Lanes. The WebAssembly build is single-threaded, so more lanes only cost time. */
  readonly p: number;
  /** 16 random bytes, base64url. */
  readonly salt: string;
}

/** RFC 9106's second recommendation (64 MiB), single lane: about a second on a recent iPhone. */
export const ARGON2_COST = { m: 64 * 1024, t: 3, p: 1 } as const;

export function newArgon2Params(cost: Omit<Argon2Params, 'salt'> = ARGON2_COST): Argon2Params {
  return { ...cost, salt: toBase64Url(randomBytes(16)) };
}

export async function kekFromPassphrase(
  passphrase: string,
  params: Argon2Params,
): Promise<CryptoKey> {
  const stretched = await argon2id({
    password: passphrase.normalize('NFKC'),
    salt: fromBase64Url(params.salt),
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: 'binary',
  });
  const base = await hkdfBase(copy(stretched));
  return crypto.subtle.deriveKey(hkdf(info.kekPassphrase), base, AES_256, false, KEK_USAGES);
}

/** From the recovery phrase's 32 bytes of entropy (recovery.ts turns words into bytes). */
export async function kekFromRecovery(entropy: Uint8Array): Promise<CryptoKey> {
  const base = await hkdfBase(copy(entropy));
  return crypto.subtle.deriveKey(hkdf(info.kekRecovery), base, AES_256, false, KEK_USAGES);
}

/**
 * A second value from the recovery phrase, for the server: it keeps only the SHA-256 of this, and
 * accepts it (after every passkey is lost) as proof enough to register a new passkey. HKDF with
 * its own label makes it useless for decryption, and the phrase's 256 bits make guessing futile.
 */
export async function recoveryAuth(entropy: Uint8Array): Promise<string> {
  const base = await hkdfBase(copy(entropy));
  return toBase64Url(
    new Uint8Array(await crypto.subtle.deriveBits(hkdf(info.recoveryAuth), base, 256)),
  );
}

// --- Slots: the AK sealed by one KEK -----------------------------------------------------------

const slotParams = (iv: Uint8Array<ArrayBuffer>, ref: SlotRef) => ({
  name: 'AES-GCM' as const,
  iv,
  additionalData: aad.slot(ref.kind, ref.slotId, ref.akId),
});

/** Seals the AK's raw bytes for one slot: base64url(iv ‖ ciphertext ‖ tag). */
export async function sealAccountKey(
  raw: Uint8Array,
  kek: CryptoKey,
  ref: SlotRef,
): Promise<string> {
  if (raw.length !== AK_BYTES) throw new VaultFormatError('An account key is 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const sealed = await crypto.subtle.encrypt(slotParams(iv, ref), kek, copy(raw));
  return toBase64Url(concat(iv, new Uint8Array(sealed)));
}

function splitSlot(sealed: string): { iv: Uint8Array<ArrayBuffer>; body: Uint8Array<ArrayBuffer> } {
  const bytes = fromBase64Url(sealed);
  if (bytes.length !== IV_BYTES + AK_BYTES + TAG_BYTES) {
    throw new VaultFormatError('Not a sealed account key');
  }
  return { iv: bytes.slice(0, IV_BYTES), body: bytes.slice(IV_BYTES) };
}

/** Opens a slot into the working keys; the AK's bytes never reach script. */
export async function openAccountKey(
  sealed: string,
  kek: CryptoKey,
  ref: SlotRef,
): Promise<AccountKeys> {
  const { iv, body } = splitSlot(sealed);
  const root = await authenticated(() =>
    crypto.subtle.unwrapKey('raw', body, kek, slotParams(iv, ref), 'HKDF', false, [
      'deriveKey',
      'deriveBits',
    ]),
  );
  return accountKeysFromRoot(root, ref.akId);
}

/**
 * Opens a slot into the AK's raw bytes. Only for sealing a NEW slot (adding a passkey, setting a
 * passphrase) right after the visitor has proved themselves again; drop the bytes at once.
 */
export async function openAccountKeyRaw(
  sealed: string,
  kek: CryptoKey,
  ref: SlotRef,
): Promise<Uint8Array<ArrayBuffer>> {
  const { iv, body } = splitSlot(sealed);
  const raw = await authenticated(() => crypto.subtle.decrypt(slotParams(iv, ref), kek, body));
  return new Uint8Array(raw);
}
