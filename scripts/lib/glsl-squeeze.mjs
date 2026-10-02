// THE GLSL SQUEEZE. The shaders (src/universe/design/shaders/*.ts) are written to be read: a
// header of uniforms, comments on every trick, indentation. A minifier leaves a template literal
// alone, so all of that used to ship in the lazy chunk. This takes it out at build time: comments
// go, runs of whitespace become one space, and the spaces round punctuation go too. What the GPU
// compiles is the same program, token for token.
//
// Pure, like ./html.mjs, so tests/build-scripts.test.ts holds it; scripts/vite-glsl-squeeze.mjs
// is the Vite plugin that applies it (to builds only: the dev server and the lab keep the shaders
// as written, so a compile error there names a line a person can find).
//
// Three things in a shader must keep a line of their own, and do:
//   - a preprocessor line (`#define`, `#include <...>`, `#ifdef`): GLSL ends it at the newline,
//     and three.js only resolves an `#include` that starts its line;
//   - a `${...}` that stands alone on its line: what it puts there is not known here (it may be
//     a block of GLSL that ends in a comment or in a directive), so it keeps its newlines;
//   - nothing else. A `${...}` inside a line stays where it is, untouched.

/** Stands in for the nth `${...}` while the text round it is squeezed. Never in a shader. */
const HOLE = '\u0000';
const holeOf = (index) => `${HOLE}${index}${HOLE}`;
const HOLE_RE = new RegExp(`${HOLE}(\\d+)${HOLE}`, 'g');
const LONE_HOLE_RE = new RegExp(`^${HOLE}\\d+${HOLE}$`);

/** Punctuation that needs no space on either side. Never `.`: `1 .x` is not `1.x`. */
const PUNCTUATION = new Set('{}()[];,=+-*/<>!?:&|^%');
/** Pairs that mean something else once they touch: an operator of two signs, or a comment. */
const NEVER_JOIN = new Set(['++', '--', '//', '/*', '*/']);

/** The end of the `${...}` whose `{` is at `open`: the index just past its `}`. */
function endOfHole(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') i += 1;
    else if (char === '`') i = endOfTemplate(text, i + 1) - 1;
    else if (char === "'" || char === '"') i = endOfString(text, i);
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('glsl-squeeze: a ${ that never closes');
}

/** The index of the quote that closes the string opened at `open`. */
function endOfString(text, open) {
  for (let i = open + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === text[open]) return i;
  }
  throw new Error('glsl-squeeze: a string that never closes');
}

/** The end of the template literal whose text starts at `start`: the index just past its backtick. */
function endOfTemplate(text, start) {
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') i += 1;
    else if (char === '`') return i + 1;
    else if (char === '$' && text[i + 1] === '{') i = endOfHole(text, i + 1) - 1;
  }
  throw new Error('glsl-squeeze: a template literal that never closes');
}

/** One line of code, without the spaces that separate nothing. */
function tighten(line) {
  let out = '';
  const words = line.split(/\s+/);
  for (const word of words) {
    if (out === '') {
      out = word;
      continue;
    }
    const before = out[out.length - 1];
    const after = word[0];
    const needless =
      (PUNCTUATION.has(before) || PUNCTUATION.has(after)) && !NEVER_JOIN.has(before + after);
    out += needless ? word : ` ${word}`;
  }
  return out;
}

/**
 * The text of one GLSL template literal (what stands between its backticks, `${...}` and all),
 * squeezed. The same program: only comments and needless whitespace are gone.
 */
export function squeezeGlsl(source) {
  // 1. Put every ${...} aside: what is inside it is JavaScript.
  const holes = [];
  let text = '';
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\\') {
      // GLSL has nothing to escape, and a line continuation would have to survive as a line.
      throw new Error('glsl-squeeze: a backslash in a shader; write it without one');
    }
    if (source[i] === '$' && source[i + 1] === '{') {
      const end = endOfHole(source, i + 1);
      text += holeOf(holes.length);
      holes.push(source.slice(i, end));
      i = end - 1;
    } else text += source[i];
  }

  // 2. Comments. A block comment separates what stands on either side of it, as a space does.
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');

  // 3. Line by line: code runs together, a directive or a lone ${...} keeps its line.
  let out = '';
  let afterCode = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#') || LONE_HOLE_RE.test(line)) {
      out += `\n${line.replace(/\s+/g, ' ')}\n`;
      afterCode = false;
    } else {
      const code = tighten(line);
      if (afterCode) {
        const pair = out[out.length - 1] + code[0];
        const needless =
          (PUNCTUATION.has(pair[0]) || PUNCTUATION.has(pair[1])) && !NEVER_JOIN.has(pair);
        out += needless ? code : ` ${code}`;
      } else out += code;
      afterCode = true;
    }
  }
  // Two hard lines in a row leave an empty line between them: one newline is enough.
  out = out.replace(/\n{2,}/g, '\n');

  // 4. And the ${...} back where they were.
  return out.replace(HOLE_RE, (_, index) => holes[Number(index)]);
}

const TAG_RE = /\/\*\s*glsl\s*\*\/\s*`/g;

/**
 * A module's source with every template literal tagged by a glsl comment squeezed. Untagged
 * literals, and everything else in the file, are not touched.
 */
export function squeezeTemplates(code) {
  let out = '';
  let from = 0;
  TAG_RE.lastIndex = 0;
  for (let match = TAG_RE.exec(code); match !== null; match = TAG_RE.exec(code)) {
    const start = match.index + match[0].length;
    const end = endOfTemplate(code, start);
    out += code.slice(from, start) + squeezeGlsl(code.slice(start, end - 1));
    from = end - 1;
    TAG_RE.lastIndex = end;
  }
  return out + code.slice(from);
}

/** The files the squeeze applies to: the shader modules, and never a test beside them. */
export const isShaderModule = (id) =>
  /\/src\/universe\/design\/shaders\/[^/]+\.ts$/.test(id.replaceAll('\\', '/').split('?')[0]) &&
  !/\.test\.ts$/.test(id.split('?')[0]);
