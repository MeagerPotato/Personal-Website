/**
 * The studio's "/" menu: the shared blocks (@allenkh/editor), and after "Code" the blog's own:
 * an image, a math block, inline math.
 */
import { BLOCKS, type BlockItem } from '@allenkh/editor';
import type { Editor, Range } from '@tiptap/core';

/** The typed "/query" goes first, when the "/" menu is the caller. */
const from = (editor: Editor, range?: Range) =>
  range ? editor.chain().deleteRange(range) : editor.chain();

/** The system's picker for images; `onPick` gets what was chosen. */
function pickImages(onPick: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener(
    'change',
    () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) onPick(files);
    },
    { once: true },
  );
  input.click();
}

const image: BlockItem = {
  id: 'image',
  label: 'Image',
  hint: 'Upload a picture (or paste or drop one in).',
  keywords: ['image', 'photo', 'picture', 'img', 'figure', 'upload'],
  glyph: '▣',
  convertible: false,
  run: (editor, range) => {
    if (range) editor.chain().focus().deleteRange(range).run();
    pickImages((files) => editor.commands.uploadImages(files));
  },
};

const mathBlock: BlockItem = {
  id: 'mathBlock',
  label: 'Math block',
  hint: 'An equation on its own line, in LaTeX.',
  keywords: ['math', 'equation', 'latex', 'tex', 'formula', 'display'],
  glyph: '∑',
  shortcut: '$$ ',
  convertible: false,
  run: (editor, range) => from(editor, range).insertMathBlock().run(),
};

const mathInline: BlockItem = {
  id: 'mathInline',
  label: 'Inline math',
  hint: 'Math inside a line of text, in LaTeX.',
  keywords: ['math', 'inline', 'equation', 'latex', 'formula'],
  glyph: 'x²',
  shortcut: '$…$',
  convertible: false,
  run: (editor, range) => from(editor, range).insertMathInline().run(),
};

const code = BLOCKS.findIndex((item) => item.id === 'codeBlock') + 1;

export const STUDIO_BLOCKS: BlockItem[] = [
  ...BLOCKS.slice(0, code),
  image,
  mathBlock,
  mathInline,
  ...BLOCKS.slice(code),
];
