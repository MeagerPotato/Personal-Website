// The card contract (AGENTS.md, invariant 11), held on the BUILT pages by verify-dist: inside
// <main>, every page but the home page and the 404 is a list of cards. A first <div data-card>
// with the one <h1>, then at most eight <section data-card>, each opening with an <h2 id> whose
// words are a link to its own fragment. Pure, like ./html.mjs, so tests/build-scripts.test.ts can
// hold it too; a small scan of our own generated HTML, not a parser, and no dependency.

import { mainContent, parseAttributes } from './html.mjs';

/** How many section cards a page has room for. src/site/cards.ts says the same; a test checks. */
export const MAX_CARDS = 8;

/** What a card never carries: its state is not in <main> (it goes on <html>). */
const STATE_ATTRIBUTES = ['tabindex', 'hidden', 'aria-expanded'];

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
/** Elements whose content is text, not markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
/** A comment, or a tag: 1 = "/" on a closing tag, 2 = its name, 3 = its attributes. */
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

/**
 * @typedef {object} Element
 * @property {string} name the tag name, in lower case
 * @property {Record<string, string>} attrs
 * @property {string} inner what it holds, as HTML
 */

/**
 * Every element in a piece of HTML, in document order, with how deep it sits (0 = not inside
 * another element of the piece). Throws when the tags do not balance.
 * @param {string} html
 * @returns {Array<Element & { depth: number }>}
 */
export function elementsOf(html) {
  /** @type {Array<Element & { depth: number }>} */
  const found = [];
  /** @type {Array<{ element: Element & { depth: number }, innerStart: number }>} */
  const open = [];
  const token = new RegExp(TOKEN.source, 'g');
  for (let match = token.exec(html); match !== null; match = token.exec(html)) {
    const name = match[2]?.toLowerCase();
    // A comment.
    if (name === undefined) continue;

    if (match[1] === '/') {
      const last = open.pop();
      if (last === undefined) throw new Error(`</${name}> closes nothing`);
      if (last.element.name !== name) {
        throw new Error(`</${name}> where <${last.element.name}> is still open`);
      }
      last.element.inner = html.slice(last.innerStart, match.index);
      continue;
    }

    const source = match[3] ?? '';
    const element = { name, attrs: parseAttributes(source), inner: '', depth: open.length };
    found.push(element);
    if (VOID.has(name) || /\/\s*$/.test(source)) continue;

    if (RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'gi');
      close.lastIndex = token.lastIndex;
      const end = close.exec(html);
      if (end === null) throw new Error(`<${name}> is never closed`);
      element.inner = html.slice(token.lastIndex, end.index);
      token.lastIndex = close.lastIndex;
      continue;
    }

    open.push({ element, innerStart: token.lastIndex });
  }
  const unclosed = open.at(-1);
  if (unclosed !== undefined) throw new Error(`<${unclosed.element.name}> is never closed`);
  return found;
}

/**
 * The element children of a piece of HTML.
 * @param {string} html
 * @returns {Element[]}
 */
export const childrenOf = (html) => elementsOf(html).filter((element) => element.depth === 0);

/**
 * Every id in a page, once for each element that carries it. The whole document, not only
 * <main>: a heading called "Main" would take the id of <main> itself. No balance is asked of
 * the markup here (a document may leave tags open that a fragment of our own may not).
 * @param {string} html
 * @returns {string[]}
 */
export function idsOf(html) {
  const ids = [];
  const token = new RegExp(TOKEN.source, 'g');
  for (let match = token.exec(html); match !== null; match = token.exec(html)) {
    const name = match[2]?.toLowerCase();
    if (name === undefined || match[1] === '/') continue;
    const attrs = parseAttributes(match[3] ?? '');
    if ('id' in attrs) ids.push(attrs.id);
    if (RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'gi');
      close.lastIndex = token.lastIndex;
      if (close.exec(html) !== null) token.lastIndex = close.lastIndex;
    }
  }
  return ids;
}

/**
 * What is wrong with a page as a list of cards, as sentences a person can act on (none = fine).
 * For every page the router can swap in, except the home page (see homeCardProblems).
 * @param {string} html the whole page
 * @returns {string[]}
 */
export function cardProblems(html) {
  // (A page without exactly one <main> throws here, as it does for the swap contract.)
  const main = mainContent(html);
  let children;
  try {
    children = childrenOf(main);
  } catch (error) {
    return [`its cards cannot be read: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (children.length === 0) return ['<main> is empty: a page is a head card and section cards'];

  const everyId = idsOf(html);
  const problems = [];
  const sections = [];
  children.forEach((child, index) => {
    const where = `child ${index + 1} of <main> (<${child.name}>)`;
    if (!('data-card' in child.attrs)) {
      problems.push(`${where} is not a card: everything inside <main> goes into a card`);
      return;
    }
    for (const name of STATE_ATTRIBUTES) {
      if (name in child.attrs) {
        problems.push(`${where} has ${name}: a card carries no state (state goes on <html>)`);
      }
    }
    const inside = elementsOf(child.inner);
    if (inside.some((element) => 'data-card' in element.attrs)) {
      problems.push(`${where} has a card inside it: cards do not nest`);
    }

    if (index === 0) {
      const headings = inside.filter((element) => element.name === 'h1').length;
      if (child.name !== 'div' || headings !== 1) {
        problems.push(
          `${where} must be the head, a <div data-card> holding the one <h1> (it holds ${headings})`,
        );
      }
      return;
    }

    sections.push(child);
    if (child.name !== 'section') {
      problems.push(`${where} must be a <section data-card>: only the first card is the head`);
      return;
    }
    if (inside.some((element) => element.name === 'h1')) {
      problems.push(`${where} holds an <h1>: the page's heading belongs to the head card`);
    }
    const title = inside[0];
    const id = title?.attrs.id ?? '';
    if (title === undefined || title.name !== 'h2' || id === '') {
      problems.push(`${where} must open with its title, an <h2 id>`);
      return;
    }
    const links = elementsOf(title.inner).filter((element) => element.name === 'a');
    if (links.length !== 1 || links[0]?.attrs.href !== `#${id}`) {
      problems.push(
        `${where}: the title "${id}" must hold exactly one link, to its own fragment (href="#${id}")`,
      );
    }
    if (child.attrs['aria-labelledby'] !== id) {
      problems.push(`${where} must be named by its title (aria-labelledby="${id}")`);
    }
    const uses = everyId.filter((other) => other === id).length;
    if (uses > 1) {
      problems.push(
        `${where}: the id "${id}" is used ${uses} times in the page; a card's id is its fragment`,
      );
    }
  });

  if (sections.length > MAX_CARDS) {
    problems.push(`${sections.length} section cards; a page has room for ${MAX_CARDS}`);
  }
  return problems;
}

/**
 * The home page is the one page of the site that is NOT a list of cards (its welcome text is one
 * panel, behind a button): what is wrong if it has one.
 * @param {string} html the whole page
 * @returns {string[]}
 */
export function homeCardProblems(html) {
  const main = mainContent(html);
  let elements;
  try {
    elements = elementsOf(main);
  } catch (error) {
    return [`its <main> cannot be read: ${error instanceof Error ? error.message : String(error)}`];
  }
  return elements.some((element) => 'data-card' in element.attrs)
    ? ['the home page has a card: it is the one page whose <main> is not a list of cards']
    : [];
}
