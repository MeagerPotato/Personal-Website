/**
 * The document schema both sites write in: which blocks and marks exist, and how each becomes
 * HTML. The editor (Editor.tsx) and the blog's server-side renderer (render.ts) are built from
 * this one list, so a document always renders as it was written. The stored form is the
 * editor's JSON; adding a block is backwards compatible, renaming or removing one is not.
 *
 *   blocks   paragraph, heading 1–3 (drawn as h2–h4), bulleted / numbered / to-do lists, quote,
 *            callout, toggle, code, divider (+ image and math on the blog: blog/src/editor)
 *   marks    bold, italic, underline, strikethrough, inline code, link, highlight
 */
import { Node, mergeAttributes, type AnyExtension, type Extensions } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Heading, type Level } from '@tiptap/extension-heading';
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

/**
 * A heading sits one level below the page's own title, the page's only <h1> (a post's title, a
 * day's date): "Heading 1" is an <h2>, down to "Heading 3", an <h4>, in the editor as on the
 * page. The stored level stays 1–3. Pasting keeps levels: the editor's own headings say theirs in
 * `data-level` (a copied "Heading 1" is an <h2>), anyone else's h1–h3 are read by their tag.
 */
export const DocumentHeading = Heading.extend({
  parseHTML() {
    return [
      ...this.options.levels.map((level) => ({
        tag: `h${level + 1}[data-level="${level}"]`,
        attrs: { level },
        priority: 60,
      })),
      ...this.options.levels.map((level) => ({ tag: `h${level}`, attrs: { level } })),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const stored = node.attrs['level'] as Level;
    const level = this.options.levels.includes(stored) ? stored : (this.options.levels[0] ?? 1);
    return [
      `h${level + 1}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-level': level }),
      0,
    ];
  },
}).configure({ levels: [1, 2, 3] });

export interface SchemaOptions {
  /** Extra blocks (the blog's images and math), appended to the shared set. */
  extra?: Extensions;
  /**
   * A code block to use instead of StarterKit's: the blog's highlights its code. It must keep the
   * node's name (`codeBlock`) and its `language` attribute, so every document still reads.
   */
  codeBlock?: AnyExtension;
}

/** The extension list for the editor and for the renderer. Editor-only behaviour is added on top. */
export function schemaExtensions(options: SchemaOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: false,
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
      ...(options.codeBlock ? { codeBlock: false as const } : {}),
    }),
    ...(options.codeBlock ? [options.codeBlock] : []),
    DocumentHeading,
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
