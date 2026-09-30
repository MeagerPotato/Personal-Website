/**
 * The blog's own blocks, on top of the shared schema (@allenkh/editor): images with captions,
 * math (inline and on its own line), and code that is highlighted. Schema only, so the Worker's
 * renderer (server/render.ts) and the studio's editor (studio/editor/) read documents the same
 * way; the studio adds its node views on top with `.extend()`.
 *
 * STORED FORMAT: node names and attributes are API (sites/AGENTS.md, invariant 8).
 */
import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import type { SchemaOptions } from '@allenkh/editor/schema';
import { lowlight } from './lowlight';

export type ImageExt = 'webp' | 'jpg' | 'png';

/** An uploaded image, as a block. Its caption is the node's own (inline) content. */
export interface ImageAttrs {
  /** The media id (server/media.ts). */
  id: string;
  ext: ImageExt;
  /** The original's size, so the page reserves the right space before it loads. */
  width: number;
  height: number;
  /** Every width stored in R2, smallest first. */
  widths: number[];
  alt: string;
}

/** Where one stored width of an image is served. */
export const mediaUrl = (id: string, width: number, ext: ImageExt): string =>
  `/media/${id}/${width}.${ext}`;

/** The stored width closest to `target` from above (or the largest there is). */
export function pickWidth(widths: readonly number[], target: number): number {
  const sorted = [...widths].sort((a, b) => a - b);
  return sorted.find((width) => width >= target) ?? sorted.at(-1) ?? 0;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blogImage: {
      /** Inserts an uploaded image (with an empty caption) where the selection is. */
      insertImage: (attrs: ImageAttrs) => ReturnType;
    };
    blogMath: {
      insertMathInline: (latex?: string) => ReturnType;
      insertMathBlock: (latex?: string) => ReturnType;
    };
  }
}

/** Attributes that live only on the node (the figure markup is built from them by hand). */
const plain = <T>(fallback: T) => ({ default: fallback, rendered: false });

export const BlogImage = Node.create({
  name: 'image',
  group: 'block',
  content: 'inline*',
  marks: '_',
  draggable: true,
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      id: plain(''),
      ext: plain<ImageExt>('webp'),
      width: plain(0),
      height: plain(0),
      widths: plain<number[]>([]),
      alt: plain(''),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        contentElement: 'figcaption',
        getAttrs: (element) => {
          const image = element.querySelector('img');
          const data = (name: string) => element.getAttribute(`data-${name}`) ?? '';
          return {
            id: data('id'),
            ext: data('ext') || 'webp',
            width: Number(image?.getAttribute('width') ?? 0),
            height: Number(image?.getAttribute('height') ?? 0),
            widths: data('widths').split(',').map(Number).filter(Boolean),
            alt: image?.getAttribute('alt') ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as ImageAttrs;
    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'image',
        'data-id': attrs.id,
        'data-ext': attrs.ext,
        'data-widths': attrs.widths.join(','),
      }),
      [
        'img',
        {
          src: mediaUrl(attrs.id, pickWidth(attrs.widths, 1280), attrs.ext),
          alt: attrs.alt,
          width: String(attrs.width),
          height: String(attrs.height),
        },
      ],
      ['figcaption', 0],
    ];
  },

  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-latex': String(attributes['latex'] ?? ''),
    }),
  },
};

/** Math inside a line: `$E = mc^2$` as you type, or "Inline math" in the "/" menu. */
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes: () => latexAttribute,

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'math-inline' }, HTMLAttributes)];
  },

  addInputRules() {
    return [
      // `$…$`, not `$ …` (a price) and not `$$` (a block).
      new InputRule({
        find: /(?:^|\s)\$([^$\s](?:[^$]*[^$\s])?)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1] ?? '';
          const start = range.from + (match[0].startsWith('$') ? 0 : 1);
          state.tr.replaceWith(start, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertMathInline:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

/** Math on its own line: `$$` then space, or "Math block" in the "/" menu. */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes: () => latexAttribute,

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'math-block' }, HTMLAttributes)];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const block = { from: $from.before(), to: $from.after() };
          state.tr.replaceWith(block.from, block.to, this.type.create({ latex: '' }));
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

/** The code block, highlighted in the editor as it will be on the page (the same lowlight). */
export const BlogCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: null,
  enableTabIndentation: true,
});

/** The blog's schema options for @allenkh/editor: the shared blocks plus the blog's own. */
export function blogSchema(): SchemaOptions {
  return { extra: [BlogImage, MathInline, MathBlock], codeBlock: BlogCodeBlock };
}
