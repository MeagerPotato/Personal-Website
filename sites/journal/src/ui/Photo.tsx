/**
 * Showing sealed photos: each file is opened once per unlock and kept as a blob: URL until the
 * journal locks (forgetPhotoUrls), so scrolling back and forth does not decrypt again.
 */
import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openFile } from '../journal/files';
import type { FileRef } from '../model/types';

const urls = new Map<string, Promise<string>>();

export function photoUrl(ref: FileRef): Promise<string> {
  let url = urls.get(ref.id);
  if (!url) {
    url = openFile(ref).then((blob) => URL.createObjectURL(blob));
    url.catch(() => urls.delete(ref.id));
    urls.set(ref.id, url);
  }
  return url;
}

/** On lock: every opened photo goes. */
export function forgetPhotoUrls(): void {
  for (const url of urls.values())
    void url.then(
      (href) => URL.revokeObjectURL(href),
      () => {},
    );
  urls.clear();
}

export function usePhotoUrl(ref: FileRef | null): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });
  // Records are read afresh on every change; the file itself is what matters.
  const id = ref?.id;
  const key = ref?.key;
  const type = ref?.type;
  useEffect(() => {
    if (!id || !key) return undefined;
    let live = true;
    photoUrl({ id, key, size: 0, type: type ?? 'image/jpeg' }).then(
      (url) => live && setState({ url, failed: false }),
      () => live && setState({ url: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [id, key, type]);
  return state;
}

export function SealedImage({
  file,
  alt,
  className,
  width,
  height,
}: {
  file: FileRef;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const { url, failed } = usePhotoUrl(file);
  if (failed) {
    return (
      <span
        className={`photo-missing ${className ?? ''}`}
        role="img"
        aria-label="Photo not available yet"
      >
        <ImageOff aria-hidden="true" />
      </span>
    );
  }
  return url ? (
    <img className={className} src={url} alt={alt} width={width} height={height} decoding="async" />
  ) : (
    <span className={`photo-loading ${className ?? ''}`} aria-hidden="true" />
  );
}
