/**
 * A sealed file: a photo, a thumbnail, a shared image. Stored in R2 under a random id; its key
 * lives only inside the (sealed) record that points at it, so the bucket alone holds nothing
 * readable, and deleting that record is enough to make the file unrecoverable.
 *
 * The file is cut into chunks (1 MiB by default), each sealed with the same file key, a fresh iv,
 * and associated data naming the file, the chunk's position, and whether it is the last one: the
 * server can neither reorder the chunks, mix them with another file's, nor cut the file short.
 *
 * Binary layout, version 1:
 *
 *   'B' (0x42) · 0x01 · chunk size (4 bytes, big-endian)
 *   then per chunk: iv (12) · ciphertext (chunk length + 16 tag); every chunk but the last is full
 */
import { aad } from './aad';
import { VaultFormatError, authenticated, concat, copy, randomBytes } from './bytes';

const MAGIC = 0x42;
const VERSION = 1;
const HEADER_BYTES = 6;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const DEFAULT_CHUNK_BYTES = 1 << 20;

/** A fresh file key: 32 random bytes, kept base64url-encoded inside the owning record. */
export const newFileKey = (): Uint8Array<ArrayBuffer> => randomBytes(32);

const importFileKey = (raw: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', copy(raw), 'AES-GCM', false, [usage]);

export async function sealBlob(
  fileKey: Uint8Array,
  blobId: string,
  data: Uint8Array,
  chunkBytes = DEFAULT_CHUNK_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 0xffffffff) {
    throw new VaultFormatError('Bad chunk size');
  }
  const key = await importFileKey(fileKey, 'encrypt');
  const header = new Uint8Array(HEADER_BYTES);
  header[0] = MAGIC;
  header[1] = VERSION;
  new DataView(header.buffer).setUint32(2, chunkBytes);

  const count = Math.max(1, Math.ceil(data.length / chunkBytes));
  const parts: Uint8Array[] = [header];
  for (let index = 0; index < count; index += 1) {
    const chunk = data.subarray(index * chunkBytes, (index + 1) * chunkBytes);
    const iv = randomBytes(IV_BYTES);
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad.blobChunk(blobId, index, index === count - 1) },
      key,
      copy(chunk),
    );
    parts.push(iv, new Uint8Array(sealed));
  }
  return concat(...parts);
}

export async function openBlob(
  fileKey: Uint8Array,
  blobId: string,
  sealed: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < HEADER_BYTES || sealed[0] !== MAGIC) {
    throw new VaultFormatError('Not a sealed file');
  }
  if (sealed[1] !== VERSION) throw new VaultFormatError(`Unknown file version ${sealed[1]}`);
  const chunkBytes = new DataView(sealed.buffer, sealed.byteOffset + 2, 4).getUint32(0);
  const fullChunk = IV_BYTES + chunkBytes + TAG_BYTES;
  const body = sealed.subarray(HEADER_BYTES);
  if (body.length < IV_BYTES + TAG_BYTES) throw new VaultFormatError('Sealed file is cut short');

  const key = await importFileKey(fileKey, 'decrypt');
  const out: Uint8Array[] = [];
  let at = 0;
  // A chunk is the last one exactly when no more than a full chunk remains; the sealer marked it
  // so, which is why dropping the real last chunk (or appending one) fails to authenticate.
  for (let index = 0; at < body.length; index += 1) {
    const final = body.length - at <= fullChunk;
    const piece = body.subarray(at, final ? body.length : at + fullChunk);
    if (piece.length < IV_BYTES + TAG_BYTES) throw new VaultFormatError('Sealed file is cut short');
    const plain = await authenticated(() =>
      crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: copy(piece.subarray(0, IV_BYTES)),
          additionalData: aad.blobChunk(blobId, index, final),
        },
        key,
        copy(piece.subarray(IV_BYTES)),
      ),
    );
    out.push(new Uint8Array(plain));
    at += piece.length;
  }
  return concat(...out);
}
