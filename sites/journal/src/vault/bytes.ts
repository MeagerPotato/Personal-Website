/**
 * Byte helpers for the vault. Pure; the same code runs in the browser, in the Worker and in Node.
 */

export const encodeUtf8 = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(text));

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
export const decodeUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Copies a view into a fresh buffer of exactly its length (WebCrypto wants plain ArrayBuffers). */
export const copy = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

/** base64url without padding (RFC 4648 §5): the vault's text form for keys and ciphertexts. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new VaultFormatError('Not base64url');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Something that is not a vault structure at all (as opposed to one that fails to decrypt). */
export class VaultFormatError extends Error {
  override name = 'VaultFormatError';
}

/**
 * A structure that parsed but did not authenticate: the wrong key, or bytes that were changed,
 * swapped from another record, or cut short. The vault never says which.
 */
export class VaultAuthError extends Error {
  override name = 'VaultAuthError';
  constructor() {
    super('The data could not be decrypted with this key');
  }
}

/** Runs a WebCrypto decryption and turns its opaque OperationError into a VaultAuthError. */
export async function authenticated<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DOMException || (error as Error)?.name === 'OperationError') {
      throw new VaultAuthError();
    }
    throw error;
  }
}
