/**
 * The document schema both sites write in: which blocks and marks exist, and how each becomes
 * HTML. The editor (Editor.tsx) and the blog's server-side renderer (render.ts) are built from
 * this one list, so a document always renders as it was written. The stored form is the
 * editor's JSON; adding a block is backwards compatible, renaming or removing one is not.
 *
 *   blocks   paragraph, heading 1–3, bulleted / numbered / to-do lists, quote, callout, toggle,
 *            code, divider (+ image and math on the blog: blog/src/editor)
 *   marks    bold, italic, underline, strikethrough, inline code, link, highlight
 */
import { Node, mergeAttributes, type Extensions } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { StarterKit } from '@tiptap/starter-kit';

export const FAMILIES = ['coral', 'butter', 'mint', 'sky', 'lilac'] as const;
export type Family = (typeof FAMILIES)[number];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selected blocks in a callout. */
      setCallout: (attributes?: { icon?: string; family?: Family | null }) => ReturnType;
      /** Changes the callout around the selection. */
      updateCallout: (attributes: { icon?: string; family?: Family | null }) => ReturnType;
    };
  }
}

/** A Notion callout: an icon and a tinted box around any blocks. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: '💡',
        parseHTML: (element) => element.getAttribute('data-icon') || '💡',
        renderHTML: (attributes) => ({ 'data-icon': attributes['icon'] as string }),
      },
      family: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-family');
          return FAMILIES.includes(value as Family) ? value : null;
        },
        renderHTML: (attributes) =>
          attributes['family'] ? { 'data-family': attributes['family'] as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'callout' }, HTMLAttributes), ['div', 0]];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      updateCallout:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },
});

export interface SchemaOptions {
  /** Extra blocks (the blog's images and math), appended to the shared set. */
  extra?: Extensions;
}

/** The extension list for the editor and for the renderer. Editor-only behaviour is added on top. */
export function schemaExtensions(options: SchemaOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Tiptap's own URI check already refuses javascript: and other script schemes (its
      // `protocols` option only ADDS schemes, so it is left alone).
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      },
      // The editor's own undo history; nothing to render.
      undoRedo: { depth: 200 },
      dropcursor: { width: 2, class: 'drop-cursor' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight,
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Callout,
    ...(options.extra ?? []),
  ];
}
