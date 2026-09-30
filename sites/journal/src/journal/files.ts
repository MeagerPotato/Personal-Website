/**
 * Photos: made small, sealed and sent on this device; fetched, opened and shown on the others.
 *
 *   add      the picked file is decoded and drawn again (which drops its EXIF, location
 *            included), as a display copy (2048 px on the long edge) and a thumbnail (480 px),
 *            each sealed with its own new key (vault/blob.ts) and queued for upload
 *   upload   in the background, whenever there is a connection; the queue survives a restart
 *   show     from this device's cache, or fetched from the server, opened, shown as a blob: URL
 *   delete   never eagerly: a photo removed on one device may be kept by an edit on another
 *            (merge.ts). collectGarbage() removes files no record points to any more.
 */
import { api } from '../api/client';
import type { FileRef, JournalRecord, Photo } from '../model/types';
import { db } from '../store/db';
import { fromBase64Url, toBase64Url } from '../vault/bytes';
import { newFileKey, openBlob, sealBlob } from '../vault/blob';
import { blobId, randomId } from '../vault/ids';

const DISPLAY_PX = 2048;
const THUMB_PX = 480;
const QUALITY = 0.86;
const THUMB_QUALITY = 0.8;
/** Full-size photos kept on this device beyond this many bytes are dropped, oldest used first. */
const CACHE_BYTES = 300 * 1024 * 1024;
/** Unreferenced files younger than this are left alone (another device may be mid-edit). */
const GARBAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class PhotoError extends Error {
  override name = 'PhotoError';
}

async function draw(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError('This browser cannot resize photos.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new PhotoError('That photo could not be converted.');
  return { blob, width, height };
}

async function seal(blob: Blob): Promise<{ ref: FileRef; sealed: Uint8Array<ArrayBuffer> }> {
  const key = newFileKey();
  const id = blobId();
  const sealed = await sealBlob(key, id, new Uint8Array(await blob.arrayBuffer()));
  return { ref: { id, key: toBase64Url(key), size: blob.size, type: blob.type }, sealed };
}

/** Turns a picked file into a Photo and queues its two sealed files for upload. */
export async function addPhoto(file: File): Promise<Photo> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(`${file.name || 'That file'} is not a photo this browser can open.`);
  }
  try {
    const display = await draw(bitmap, DISPLAY_PX, QUALITY);
    const thumb = await draw(bitmap, THUMB_PX, THUMB_QUALITY);
    const [full, small] = await Promise.all([seal(display.blob), seal(thumb.blob)]);
    const now = Date.now();
    const tx = (await db()).transaction(['uploads', 'files'], 'readwrite');
    await Promise.all([
      tx.objectStore('uploads').put({ id: full.ref.id, sealed: full.sealed, queuedAt: now }),
      tx.objectStore('uploads').put({ id: small.ref.id, sealed: small.sealed, queuedAt: now }),
      tx.objectStore('files').put({ id: full.ref.id, sealed: full.sealed, usedAt: now }),
      tx.objectStore('files').put({ id: small.ref.id, sealed: small.sealed, usedAt: now }),
      tx.done,
    ]);
    void uploadQueued();
    return {
      id: randomId(),
      file: full.ref,
      thumb: small.ref,
      width: display.width,
      height: display.height,
      caption: '',
      takenAt: file.lastModified || null,
    };
  } finally {
    bitmap.close();
  }
}

let uploading: Promise<void> | null = null;

/** Sends every queued file. Safe to call often: one run at a time. */
export function uploadQueued(): Promise<void> {
  uploading ??= (async () => {
    try {
      const open = await db();
      for (const id of await open.getAllKeys('uploads')) {
        const item = await open.get('uploads', id);
        if (!item) continue;
        await api.putFile(item.id, item.sealed);
        await open.delete('uploads', id);
      }
    } catch {
      // Offline or signed out: the queue stays, and the next sync tries again.
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}

export async function queuedUploads(): Promise<number> {
  return (await db()).count('uploads');
}

/** A file's bytes, opened: from this device's cache, or fetched and cached. */
export async function openFile(ref: FileRef): Promise<Blob> {
  const open = await db();
  let sealed = (await open.get('files', ref.id))?.sealed;
  if (!sealed) {
    sealed = await api.getFile(ref.id);
    await open.put('files', { id: ref.id, sealed, usedAt: Date.now() });
    void trimCache();
  } else {
    void open.put('files', { id: ref.id, sealed, usedAt: Date.now() });
  }
  const plain = await openBlob(fromBase64Url(ref.key), ref.id, sealed);
  return new Blob([plain], { type: ref.type || 'image/jpeg' });
}

async function trimCache(): Promise<void> {
  const open = await db();
  const pending = new Set(await open.getAllKeys('uploads'));
  let total = 0;
  const files = await open.getAllFromIndex('files', 'usedAt');
  for (const file of files) total += file.sealed.byteLength;
  for (const file of files) {
    if (total <= CACHE_BYTES) break;
    if (pending.has(file.id)) continue;
    await open.delete('files', file.id);
    total -= file.sealed.byteLength;
  }
}

/** Every file the given records point to. */
export function referencedFiles(records: Iterable<JournalRecord>): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if ('photos' in record && Array.isArray(record.photos)) {
      for (const photo of record.photos as Photo[]) {
        ids.add(photo.file.id);
        ids.add(photo.thumb.id);
      }
    }
  }
  return ids;
}

/**
 * Deletes files on the server that no record points to and that are old enough that no other
 * device can be about to point at them. Run only after a complete sync.
 */
export async function collectGarbage(records: Iterable<JournalRecord>): Promise<number> {
  const keep = referencedFiles(records);
  const open = await db();
  for (const id of await open.getAllKeys('uploads')) keep.add(id);
  let removed = 0;
  for (const file of await api.files()) {
    if (keep.has(file.id) || Date.now() - file.createdAt < GARBAGE_AGE_MS) continue;
    await api.removeFile(file.id);
    await open.delete('files', file.id);
    removed += 1;
  }
  return removed;
}
