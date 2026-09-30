/**
 * Images are made ready on the device before they leave it: decoded (turned upright), drawn at
 * the widths the page offers, and encoded again. Re-encoding drops the camera's EXIF data, and
 * with it any location. WebP where the browser can write it; otherwise JPEG for photos and PNG
 * for images that may be transparent.
 */
import { MAX_FILE_BYTES } from '../server/media';

/** The widths a post offers (server/render.ts picks among them with srcset). */
export const WIDTHS = [640, 1280, 1920] as const;

export interface PreparedImage {
  type: 'image/webp' | 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  files: { width: number; blob: Blob }[];
}

async function encode(canvas: OffscreenCanvas, type: PreparedImage['type']): Promise<Blob> {
  return canvas.convertToBlob({ type, quality: type === 'image/png' ? undefined : 0.84 });
}

let webp: boolean | null = null;
async function canWriteWebp(): Promise<boolean> {
  if (webp === null) {
    const probe = new OffscreenCanvas(2, 2);
    probe.getContext('2d')?.fillRect(0, 0, 2, 2);
    webp = (await probe.convertToBlob({ type: 'image/webp' })).type === 'image/webp';
  }
  return webp;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This browser cannot open that image. Try a JPEG or PNG.');
  }
  const { width, height } = bitmap;
  const type: PreparedImage['type'] = (await canWriteWebp())
    ? 'image/webp'
    : file.type === 'image/jpeg'
      ? 'image/jpeg'
      : 'image/png';
  const widths = [
    ...new Set([...WIDTHS.filter((w) => w < width), Math.min(width, WIDTHS.at(-1) ?? width)]),
  ]
    .filter((w) => w >= 16)
    .sort((a, b) => a - b);
  const files: PreparedImage['files'] = [];
  for (const target of widths) {
    const scaled = Math.max(1, Math.round((height * target) / width));
    const canvas = new OffscreenCanvas(target, scaled);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw images');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, target, scaled);
    const blob = await encode(canvas, type);
    if (blob.size > MAX_FILE_BYTES) throw new Error('That image is too large, even made smaller');
    files.push({ width: target, blob });
  }
  bitmap.close();
  return { type, width, height, files };
}

/** The upload's form (server/media.ts, storeUpload). */
export function uploadForm(image: PreparedImage): FormData {
  const form = new FormData();
  form.set('type', image.type);
  form.set('width', String(image.width));
  form.set('height', String(image.height));
  for (const file of image.files) form.set(`w${file.width}`, file.blob, `w${file.width}`);
  return form;
}
