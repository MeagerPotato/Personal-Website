/**
 * Mirrors the design tokens into CSS custom properties, so the DOM and the 3D world share one
 * palette and there are no generated files for anyone to forget to rebuild.
 *
 *   { color: { ink: { high: '#fff' } }, motion: { easeOut: '...' } }
 *   ->  :root{--color-ink-high:#fff;--motion-ease-out:...}
 */

export interface TokenTree {
  readonly [key: string]: string | TokenTree;
}

const toKebab = (key: string): string => key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

function flatten(
  tree: TokenTree,
  prefix: string,
  path: string,
  omit: ReadonlySet<string>,
  out: string[],
): void {
  for (const [key, value] of Object.entries(tree)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (omit.has(at)) continue;
    const name = `${prefix}-${toKebab(key)}`;
    if (typeof value === 'string') out.push(`${name}:${value}`);
    else flatten(value, name, at, omit, out);
  }
}

/**
 * Tokens that only the 3D world paints with (the star map's districts and the Milky Way's haze,
 * the air of worlds, the extra star temperatures, dusk and night, a lit window), as dotted
 * paths: a whole group or one key. Every page passes this as `omit`, so plain mode does not
 * carry 26 custom properties that no stylesheet reads. The engine reads `tokens` itself and
 * never the CSS.
 */
export const ENGINE_ONLY: readonly string[] = [
  'color.nebula',
  'color.air',
  'color.star.hot',
  'color.star.amber',
  'color.star.ember',
  'color.shading.dusk',
  'color.shading.night',
  'color.window',
];

/** `omit`: dotted paths (`color.nebula`, `color.star.hot`) to leave out, with all they hold. */
export function tokensToCss(
  tree: TokenTree,
  selector = ':root',
  omit: readonly string[] = [],
): string {
  const declarations: string[] = [];
  flatten(tree, '-', '', new Set(omit), declarations);
  return `${selector}{${declarations.join(';')}}`;
}
