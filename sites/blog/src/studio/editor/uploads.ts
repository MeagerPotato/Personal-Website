/**
 * Images into a post: picked from the "/" menu, pasted, or dropped. Each is made ready on the
 * device (studio/images.ts), uploaded, and put where it was asked for. While they upload, a
 * placeholder holds the spot, and it moves with the text if the writing goes on around it.
 */
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ImageAttrs } from '../../editor/nodes';
import { api } from '../api';
import { prepareImage, uploadForm } from '../images';
import { describe } from '../ui/common';

/** Images that could not be added, in words for a person, for whoever shows them. */
export const uploadProblems = new EventTarget();

export class UploadProblem extends Event {
  constructor(readonly message: string) {
    super('problem');
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageUploads: {
      /** Uploads images and puts them at `pos` (where the selection is, by default). */
      uploadImages: (files: readonly File[], pos?: number) => ReturnType;
    };
  }
}

type Meta = { add: { id: number; pos: number; count: number } } | { remove: number };

const key = new PluginKey<DecorationSet>('imageUploads');
let nextId = 1;

function placeholder(count: number): HTMLElement {
  const element = document.createElement('span');
  element.className = 'upload-placeholder';
  element.setAttribute('role', 'status');
  element.textContent = count === 1 ? 'Uploading the image…' : `Uploading ${count} images…`;
  return element;
}

function placeholderAt(state: EditorState, id: number): number | null {
  const found = key.getState(state)?.find(undefined, undefined, (spec) => spec['id'] === id);
  return found?.[0]?.from ?? null;
}

/** Makes one image ready and uploads it: its attributes, with no alt text yet. */
export async function uploadImage(file: File): Promise<ImageAttrs> {
  const stored = await api.upload(uploadForm(await prepareImage(file)));
  return { ...stored, alt: '' };
}

/** Only image files, from a paste or a drop. */
export const imageFiles = (data: DataTransfer | null): File[] =>
  [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'));

async function upload(editor: Editor, files: readonly File[], pos: number) {
  const id = nextId++;
  editor.view.dispatch(editor.state.tr.setMeta(key, { add: { id, pos, count: files.length } }));
  const images: ImageAttrs[] = [];
  // One at a time, in order: they land in the order they were chosen.
  for (const file of files) {
    try {
      images.push(await uploadImage(file));
    } catch (error) {
      uploadProblems.dispatchEvent(
        new UploadProblem(`${file.name || 'An image'}: ${describe(error)}`),
      );
    }
  }
  if (editor.isDestroyed) return;
  const at = placeholderAt(editor.state, id);
  const chain = editor.chain().command(({ tr }) => {
    tr.setMeta(key, { remove: id } satisfies Meta);
    return true;
  });
  if (at !== null && images.length > 0) {
    chain.insertContentAt(
      at,
      images.map((attrs) => ({ type: 'image', attrs })),
    );
  }
  chain.run();
}

export const ImageUploads = Extension.create({
  name: 'imageUploads',

  addCommands() {
    return {
      uploadImages:
        (files, pos) =>
        ({ editor }) => {
          if (files.length === 0) return false;
          void upload(editor, files, pos ?? editor.state.selection.from);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta && 'add' in meta) {
              const { id, pos, count } = meta.add;
              next = next.add(tr.doc, [
                Decoration.widget(pos, () => placeholder(count), {
                  id,
                  key: `upload-${id}`,
                  side: -1,
                }),
              ]);
            } else if (meta && 'remove' in meta) {
              next = next.remove(
                next.find(undefined, undefined, (spec) => spec['id'] === meta.remove),
              );
            }
            return next;
          },
        },
        props: {
          decorations: (state) => key.getState(state),
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            return editor.commands.uploadImages(files);
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            return editor.commands.uploadImages(files, at?.pos);
          },
        },
      }),
    ];
  },
});
