/**
 * Images: uploaded from the studio, served to readers.
 *
 * The studio makes every size on the device (studio/images.ts): it decodes the photo, draws it
 * at a few widths and encodes each one again, which also drops the camera's EXIF data, location
 * included. The server checks what arrives (its type, from the bytes themselves, and its size),
 * stores each width in R2 at media/<id>/<width>.<ext>, and serves them with a year of caching:
 * an id is never reused, so a file never changes.
 */
import type { ImageExt } from '../editor/nodes';
import type { BlogEnv } from './env';
import { HttpError, randomId } from './util';

export const TYPES = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const satisfies Record<string, ImageExt>;
type MediaType = keyof typeof TYPES;

const CONTENT_TYPE: Record<ImageExt, MediaType> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_WIDTH = 4096;
const MAX_FILES = 6;

export interface StoredImage {
  id: string;
  ext: ImageExt;
  width: number;
  height: number;
  widths: number[];
}

/** What the bytes say they are: the first few bytes of each format, nothing else. */
export function sniff(bytes: Uint8Array): MediaType | null {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, i) => bytes[offset + i] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

const whole = (value: FormDataEntryValue | null, max: number): number => {
  const number = typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 1 && number <= max ? number : 0;
};

/**
 * POST /api/media (multipart): `type`, `width`, `height` of the original, and one file per size,
 * named `w<width>` ("w640", "w1280"…). Every size must be the declared type.
 */
export async function storeUpload(
  env: BlogEnv,
  form: FormData,
  now = Date.now(),
): Promise<StoredImage> {
  const type = form.get('type');
  if (typeof type !== 'string' || !(type in TYPES))
    throw new HttpError(415, 'Use a JPEG, PNG or WebP image');
  const mediaType = type as MediaType;
  const width = whole(form.get('width'), 20_000);
  const height = whole(form.get('height'), 20_000);
  if (!width || !height) throw new HttpError(400, 'The image has no size');

  const files: { width: number; bytes: Uint8Array }[] = [];
  for (const [name, value] of form.entries()) {
    const match = /^w(\d{2,4})$/.exec(name);
    if (!match) continue;
    if (typeof value === 'string') throw new HttpError(400, 'Malformed upload');
    const size = Number(match[1]);
    if (size < 16 || size > MAX_WIDTH) throw new HttpError(400, 'An image size is out of range');
    if (value.size > MAX_FILE_BYTES) throw new HttpError(413, 'That image is too large');
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (sniff(bytes) !== mediaType)
      throw new HttpError(415, 'That file is not the image it says it is');
    files.push({ width: size, bytes });
  }
  if (files.length === 0 || files.length > MAX_FILES) throw new HttpError(400, 'Malformed upload');
  const widths = files.map((file) => file.width).sort((a, b) => a - b);
  if (new Set(widths).size !== widths.length) throw new HttpError(400, 'Malformed upload');

  const id = randomId('m');
  const ext = TYPES[mediaType];
  await Promise.all(
    files.map((file) =>
      env.MEDIA.put(`media/${id}/${file.width}.${ext}`, file.bytes, {
        httpMetadata: { contentType: mediaType },
      }),
    ),
  );
  await env.DB.prepare(
    `INSERT INTO media (id, type, width, height, widths, bytes, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      id,
      mediaType,
      width,
      height,
      JSON.stringify(widths),
      files.reduce((sum, file) => sum + file.bytes.length, 0),
      now,
    )
    .run();
  return { id, ext, width, height, widths };
}

/** A stored image's sizes, for the studio (a post's cover), or null. */
export async function mediaInfo(db: D1Database, id: string): Promise<StoredImage | null> {
  const row = await db
    .prepare('SELECT id, type, width, height, widths FROM media WHERE id = ?1')
    .bind(id)
    .first<{ id: string; type: string; width: number; height: number; widths: string }>();
  if (!row || !(row.type in TYPES)) return null;
  return {
    id: row.id,
    ext: TYPES[row.type as MediaType],
    width: row.width,
    height: row.height,
    widths: JSON.parse(row.widths) as number[],
  };
}

const PATH = /^\/media\/(m_[A-Za-z0-9_-]{8,40})\/(\d{2,4})\.(webp|jpg|png)$/;

/** GET /media/<id>/<width>.<ext>: from the edge cache, else from R2. */
export async function serveMedia(
  request: Request,
  env: BlogEnv,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const match = PATH.exec(new URL(request.url).pathname);
  if (!match) return new Response('Not found', { status: 404 });
  const [, id, width, ext] = match as unknown as [string, string, string, ImageExt];

  const cache = typeof caches === 'undefined' ? null : await caches.open('media');
  const cached = request.method === 'GET' ? await cache?.match(request) : undefined;
  if (cached) return cached;

  const object = await env.MEDIA.get(`media/${id}/${width}.${ext}`, {
    onlyIf: request.headers,
  });
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'Content-Type': CONTENT_TYPE[ext],
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  const response = new Response(request.method === 'HEAD' ? null : object.body, { headers });
  if (cache && request.method === 'GET') ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}
