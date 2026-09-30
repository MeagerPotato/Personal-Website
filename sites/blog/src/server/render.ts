/**
 * A post's document as the page's HTML, made once, when it is published (and for the studio's
 * preview). The shared schema renders every block (@allenkh/editor/render); the blog adds:
 *
 *   headings   one level down (the post's title is the page's only <h1>), each with an id for
 *              its table of contents and anchor links
 *   code       highlighted by lowlight, the editor's own highlighter (editor/lowlight.ts)
 *   math       typeset by Temml as MathML, which every current browser draws natively
 *   images     <figure> with every stored width in srcset, and the size reserved
 *   to-dos     their boxes shown, not tickable
 *   toggles    native <details>, so they open without JavaScript
 *
 * Temml writes a few style attributes (display math, \color, \boxed). The CSP allows no inline
 * style, except exactly those: their hashes travel with the post (`styleHashes`) and the page
 * adds them to its policy (server/headers.ts).
 */
import type { JSONContent } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { toHtml } from 'hast-util-to-html';
import temml from 'temml';
import { joinChildren, renderHtml, type NodeRenderer } from '@allenkh/editor/render';
import { plainText, wordCount } from '@allenkh/editor/text';
import { lowlight, knownLanguage } from '../editor/lowlight';
import { blogSchema, mediaUrl, pickWidth, type ImageAttrs } from '../editor/nodes';
import { escapeHtml } from './util';

export interface Heading {
  /** 1 to 3, as written (the page shows them one level down). */
  level: number;
  text: string;
  id: string;
}

export interface RenderedPost {
  html: string;
  /** The words, one line per block: the feed's excerpt when there is no summary, search later. */
  text: string;
  words: number;
  headings: Heading[];
  /** CSP hashes ('sha256-…') of the style attributes in `html`. */
  styleHashes: string[];
}

/** A heading's id: its words, lower case, joined by hyphens; unique within the page. */
export function headingId(text: string, taken: Set<string>): string {
  const base =
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'section';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** LaTeX as MathML, or the source marked as an error (Temml's own error markup uses styles). */
export function renderMath(latex: string, display: boolean): string {
  const source = latex.trim();
  if (source === '') return '';
  try {
    return temml.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      annotate: true,
      trust: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'Could not typeset';
    return `<code class="math-error" title="${escapeHtml(message ?? '')}">${escapeHtml(source)}</code>`;
  }
}

/** Code as highlighted HTML (the language named, or plain when it is unknown). */
export function highlightCode(code: string, language: unknown): string {
  const known = knownLanguage(language);
  const tree = known ? lowlight.highlight(known, code) : null;
  const inner = tree ? toHtml(tree) : escapeHtml(code);
  const label = known ? ` data-language="${escapeHtml(known)}"` : '';
  return `<pre class="code"${label}><code class="hljs${known ? ` language-${known}` : ''}">${inner}</code></pre>`;
}

/** The sizes the column shows an image at: the reading column on wide screens, the screen on phones. */
const IMAGE_SIZES = '(min-width: 48rem) 45rem, 100vw';

export function figureHtml(attrs: ImageAttrs, caption: string): string {
  const widths = [...attrs.widths].sort((a, b) => a - b);
  if (!attrs.id || widths.length === 0) return '';
  const srcset = widths.map((width) => `${mediaUrl(attrs.id, width, attrs.ext)} ${width}w`);
  const img =
    `<img src="${mediaUrl(attrs.id, pickWidth(widths, 1280), attrs.ext)}" ` +
    `srcset="${srcset.join(', ')}" sizes="${IMAGE_SIZES}" ` +
    `width="${attrs.width}" height="${attrs.height}" alt="${escapeHtml(attrs.alt)}" ` +
    `loading="lazy" decoding="async">`;
  return `<figure class="figure">${img}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const decodeAttribute = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The CSP hash of every distinct style attribute in `html`, as the browser will compute it. */
export async function styleHashes(html: string): Promise<string[]> {
  const values = new Set<string>();
  for (const match of html.matchAll(/\sstyle="([^"]*)"/g))
    values.add(decodeAttribute(match[1] ?? ''));
  const hashes = await Promise.all(
    [...values].map(async (value) => `'sha256-${await sha256Base64(value)}'`),
  );
  return hashes.sort();
}

export async function renderPost(doc: JSONContent | null): Promise<RenderedPost> {
  if (!doc) return { html: '', text: '', words: 0, headings: [], styleHashes: [] };
  const headings: Heading[] = [];
  const taken = new Set<string>();
  const text = (node: PmNode) => node.textContent;

  const nodes: Record<string, NodeRenderer> = {
    heading: ({ node, children }) => {
      const level = Number(node.attrs['level']) || 1;
      const id = headingId(text(node), taken);
      headings.push({ level, text: text(node), id });
      const tag = `h${Math.min(level + 1, 4)}`;
      return `<${tag} id="${id}">${joinChildren(children)}</${tag}>`;
    },
    codeBlock: ({ node }) => highlightCode(text(node), node.attrs['language']),
    mathInline: ({ node }) =>
      `<span class="math-inline">${renderMath(String(node.attrs['latex'] ?? ''), false)}</span>`,
    mathBlock: ({ node }) =>
      `<div class="math-block">${renderMath(String(node.attrs['latex'] ?? ''), true)}</div>`,
    image: ({ node, children }) => figureHtml(node.attrs as ImageAttrs, joinChildren(children)),
    // The editor's own markup (prose.css draws both the same), with the box read-only.
    taskItem: ({ node, children }) => {
      const checked = node.attrs['checked'] === true;
      return (
        `<li data-checked="${checked}"><label>` +
        `<input type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? 'Done' : 'To do'}">` +
        `</label><div>${joinChildren(children)}</div></li>`
      );
    },
    taskList: ({ children }) => `<ul data-type="taskList">${joinChildren(children)}</ul>`,
    details: ({ node, children }) =>
      `<details class="toggle"${node.attrs['open'] ? ' open' : ''}>${joinChildren(children)}</details>`,
    detailsSummary: ({ children }) => `<summary>${joinChildren(children)}</summary>`,
    detailsContent: ({ children }) => `<div class="toggle__body">${joinChildren(children)}</div>`,
  };

  const html = renderHtml(doc, { schema: blogSchema(), nodes });
  return {
    html,
    text: plainText(doc),
    words: wordCount(doc),
    headings,
    styleHashes: await styleHashes(html),
  };
}
