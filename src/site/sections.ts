// A page's Markdown, cut into the cards of its page: what comes before the first `##` heading
// (the intro), then one section per heading. A card's title is a link to the card's own
// fragment (src/components/Card.astro), so the heading itself is not printed again: a section
// is its id, its title as plain text, and the HTML under it.
//
// The input is what Astro's Markdown step made (an entry's `rendered.html`): well-formed, with
// every `##` a top-level <h2 id>. A small tag-depth scan, not a parser, and no dependency: where
// the input is not what that step makes today, this throws and says what it met, at build time.

export interface Section {
  /** The heading's id: the fragment that names the card (`/about/#rockets`). */
  id: string;
  /** The heading's words, as plain text (entities decoded). */
  title: string;
  /** Everything under the heading, up to the next one. */
  html: string;
}

export interface Sections {
  /** What comes before the first heading ("" when the text opens with one). */
  intro: string;
  sections: Section[];
}

export class SectionError extends Error {}

/** Elements that never have a closing tag. */
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

/** Elements whose content is text, not markup: nothing in them is a tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/** A comment, or a tag: 1 = "/" on a closing tag, 2 = its name, 3 = its attributes. */
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ID = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const HEADING_END = '</h2>';

/** The few named references Markdown's output uses in running text. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** A heading's words as plain text: character references decoded, white space as one space. */
function plainText(source: string): string {
  const decoded = source.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    } else {
      const named = NAMED[body];
      if (named !== undefined) return named;
    }
    throw new SectionError(
      `the heading "${source.trim()}" has a character reference, ${whole}, that is not known here`,
    );
  });
  return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * Split rendered Markdown at its top-level `<h2 id>` headings. Throws a SectionError that names
 * the problem: a heading without an id, markup inside a heading (its words become a link's text),
 * a heading that is not at the top level, an id used twice, or markup that does not balance.
 */
export function sectionize(html: string): Sections {
  const token = new RegExp(TOKEN.source, 'g');
  /** The elements that are open where the scan is, outermost first. */
  const open: string[] = [];
  const cuts: Array<{ start: number; bodyStart: number; id: string; title: string }> = [];
  const seen = new Set<string>();

  for (let match = token.exec(html); match !== null; match = token.exec(html)) {
    const name = match[2]?.toLowerCase();
    // A comment.
    if (name === undefined) continue;

    if (match[1] === '/') {
      const last = open.pop();
      if (last !== name) {
        throw new SectionError(
          last === undefined
            ? `</${name}> closes nothing: the markup does not balance`
            : `</${name}> where <${last}> is still open: the markup does not balance`,
        );
      }
      continue;
    }

    const attributes = match[3] ?? '';
    if (name === 'h2') {
      const end = html.indexOf(HEADING_END, token.lastIndex);
      if (end < 0) throw new SectionError('an <h2> is never closed');
      const inner = html.slice(token.lastIndex, end);
      const words = inner.replace(/<[^>]*>/g, '').trim();
      const outer = open.at(-1);
      if (outer !== undefined) {
        throw new SectionError(
          `the heading "${words}" is inside <${outer}>: a section's heading must be at the top level of the text`,
        );
      }
      const found = ID.exec(attributes);
      const id = found?.[1] ?? found?.[2] ?? found?.[3] ?? '';
      if (id === '') throw new SectionError(`the heading "${words}" has no id`);
      if (inner.includes('<')) {
        throw new SectionError(
          `the heading "${words}" has markup in it (${inner.trim()}): a section's title is plain text, because it becomes a link`,
        );
      }
      const title = plainText(inner);
      if (title === '') throw new SectionError(`the heading with the id "${id}" has no words`);
      if (seen.has(id)) throw new SectionError(`two headings share the id "${id}"`);
      seen.add(id);
      cuts.push({ start: match.index, bodyStart: end + HEADING_END.length, id, title });
      token.lastIndex = end + HEADING_END.length;
      continue;
    }

    if (VOID.has(name) || /\/\s*$/.test(attributes)) continue;

    if (RAW_TEXT.has(name)) {
      // Its content is text: whatever looks like a tag in there is not one.
      const close = new RegExp(`</${name}\\s*>`, 'gi');
      close.lastIndex = token.lastIndex;
      if (close.exec(html) === null) throw new SectionError(`<${name}> is never closed`);
      token.lastIndex = close.lastIndex;
      continue;
    }

    open.push(name);
  }

  const unclosed = open.at(-1);
  if (unclosed !== undefined) throw new SectionError(`<${unclosed}> is never closed`);

  return {
    intro: html.slice(0, cuts[0]?.start ?? html.length).trim(),
    sections: cuts.map((cut, index) => ({
      id: cut.id,
      title: cut.title,
      html: html.slice(cut.bodyStart, cuts[index + 1]?.start ?? html.length).trim(),
    })),
  };
}
