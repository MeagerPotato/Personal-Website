/**
 * Plain text out of a stored document: for search, previews, word counts, and the blog's
 * excerpts and feed. Pure; runs anywhere.
 */

interface Node {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

/** Blocks that end a line of text. */
const BLOCKS = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'detailsSummary',
  'callout',
]);

/** Words in a document. */
export function wordCount(doc: unknown): number {
  let words = 0;
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const { text, content } = node as Node;
    if (typeof text === 'string') words += text.split(/\s+/).filter(Boolean).length;
    if (Array.isArray(content)) content.forEach(walk);
  };
  walk(doc);
  return words;
}

/** The document's text, one line per block, at most `limit` characters. */
export function plainText(doc: unknown, limit = Infinity): string {
  const parts: string[] = [];
  let length = 0;
  const walk = (node: unknown): void => {
    if (length >= limit || typeof node !== 'object' || node === null) return;
    const { text, content, type } = node as Node;
    if (typeof text === 'string') {
      parts.push(text);
      length += text.length;
    }
    if (Array.isArray(content)) content.forEach(walk);
    if (typeof type === 'string' && BLOCKS.has(type)) parts.push('\n');
  };
  walk(doc);
  return parts
    .join('')
    .replace(/[ \t]*\n[\s]*/g, '\n')
    .trim()
    .slice(0, limit);
}
