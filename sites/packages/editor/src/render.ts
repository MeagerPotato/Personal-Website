/**
 * A stored document as HTML, without a browser: for the blog, whose Worker renders a post once,
 * when it is published (sites/blog/src/server/render.ts). Uses the same schema as the editor
 * (schema.ts), so the page shows exactly the blocks that were written.
 *
 * Text and attributes are escaped by Tiptap's renderer. `nodes` replaces how a block becomes
 * HTML (the blog highlights code, typesets math and gives images their sizes): a node renderer
 * gets the ProseMirror node and its children's HTML, and returns HTML it is responsible for
 * escaping.
 */
import type { JSONContent } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import { schemaExtensions, type SchemaOptions } from './schema';

export type NodeRenderer = (props: { node: PmNode; children?: string | string[] }) => string;

export interface RenderOptions {
  schema?: SchemaOptions;
  nodes?: Record<string, NodeRenderer>;
}

/** Children as one string, however the renderer handed them over. */
export const joinChildren = (children?: string | string[]): string =>
  Array.isArray(children) ? children.join('') : (children ?? '');

/** The elements HTML lets end in "/>": any other one written that way stays open in a browser. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * Tiptap's renderer writes an empty element as `<span/>`, which an HTML parser reads as an open
 * `<span>` that swallows what follows (a to-do's checkbox label has one). Every element that is
 * not void gets its closing tag. Text and attribute values are escaped by then, so every "<" in
 * the string starts a real tag.
 */
export const closeEmptyElements = (html: string): string =>
  html.replace(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?\s*\/>/g, (tag, name: string, attributes = '') =>
    VOID.has(name.toLowerCase()) ? tag : `<${name}${attributes as string}></${name}>`,
  );

export function renderHtml(doc: JSONContent, options: RenderOptions = {}): string {
  return closeEmptyElements(
    renderToHTMLString({
      content: doc,
      extensions: schemaExtensions(options.schema),
      options: { nodeMapping: options.nodes ?? {} },
    }),
  );
}
