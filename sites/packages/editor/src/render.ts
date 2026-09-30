/**
 * A stored document as HTML, without a browser: for the blog, whose Worker renders a post when
 * it is published (sites/blog). Uses the same schema as the editor (schema.ts), so the page
 * shows exactly the blocks that were written.
 */
import type { Extensions, JSONContent } from '@tiptap/core';
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import { schemaExtensions } from './schema';

export function renderHtml(doc: JSONContent, extra?: Extensions): string {
  return renderToHTMLString({ content: doc, extensions: schemaExtensions({ extra }) });
}
