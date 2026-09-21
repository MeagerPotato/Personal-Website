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

function flatten(tree: TokenTree, prefix: string, out: string[]): void {
  for (const [key, value] of Object.entries(tree)) {
    const name = `${prefix}-${toKebab(key)}`;
    if (typeof value === 'string') out.push(`${name}:${value}`);
    else flatten(value, name, out);
  }
}

export function tokensToCss(tree: TokenTree, selector = ':root'): string {
  const declarations: string[] = [];
  flatten(tree, '-', declarations);
  return `${selector}{${declarations.join(';')}}`;
}
