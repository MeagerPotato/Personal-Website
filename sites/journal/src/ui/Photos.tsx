/** A record's photos: thumbnails with captions, and a button to add more (journal/files.ts). */
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { addPhoto, PhotoError } from '../journal/files';
import type { Photo } from '../model/types';
import { SealedImage } from './Photo';

export function Photos(props: {
  photos: Photo[];
  onChange: (change: (photos: Photo[]) => Photo[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const add = async (files: FileList) => {
    setError(null);
    setAdding((count) => count + files.length);
    for (const file of Array.from(files)) {
      try {
        const photo = await addPhoto(file);
        props.onChange((photos) => [...photos, photo]);
      } catch (caught) {
        setError(caught instanceof PhotoError ? caught.message : 'A photo could not be added.');
      } finally {
        setAdding((count) => count - 1);
      }
    }
  };

  return (
    <section className="section">
      <h2 className="section__title">Photos</h2>
      {props.photos.length > 0 || adding > 0 ? (
        <ul className="photos">
          {props.photos.map((photo) => (
            <li key={photo.id} className="photo">
              <SealedImage
                file={photo.thumb}
                alt={photo.caption || 'Photo'}
                width={photo.width}
                height={photo.height}
              />
              <input
                key={photo.caption}
                className="bare-input photo__caption"
                placeholder="Caption"
                aria-label="Caption"
                defaultValue={photo.caption}
                onBlur={(event) => {
                  const caption = event.target.value;
                  if (caption !== photo.caption) {
                    props.onChange((photos) =>
                      photos.map((other) =>
                        other.id === photo.id ? { ...other, caption } : other,
                      ),
                    );
                  }
                }}
              />
              <button
                type="button"
                className="icon-button photo__remove"
                aria-label="Remove photo"
                onClick={() =>
                  props.onChange((photos) => photos.filter((other) => other.id !== photo.id))
                }
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
          {Array.from({ length: adding }, (_, i) => (
            <li key={`adding-${i}`} className="photo">
              <span className="photo-loading" role="progressbar" aria-label="Adding a photo" />
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) void add(event.target.files);
          event.target.value = '';
        }}
      />
      <button type="button" className="chip chip--add" onClick={() => input.current?.click()}>
        <ImagePlus aria-hidden="true" />
        Add photos
      </button>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
