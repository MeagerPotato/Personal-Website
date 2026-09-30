/**
 * The tokens as CSS custom properties, so stylesheets never hold a colour of their own.
 *
 *   day theme on :root                       --bg, --ink-high, --coral-tint, ...
 *   night theme when the system asks for it   @media (prefers-color-scheme: dark)
 *   night or day when the visitor chooses     html[data-theme='night'] / html[data-theme='day']
 *   shared values                             --font-body, --text-base, --space-4, --radius-md, ...
 *
 * Pure: tokens in, a string out. Served to both apps by the Vite plugin in vite.ts as the virtual
 * stylesheet `virtual:allenkh/tokens.css`, so there is no generated file to forget to rebuild.
 */
import { FAMILY_KEYS, shared, themes } from './tokens.ts';

type Tree = { readonly [key: string]: string | Tree };

const kebab = (key: string): string => key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

function flatten(tree: Tree, prefix: string, out: string[]): void {
  for (const [key, value] of Object.entries(tree)) {
    const name = prefix ? `${prefix}-${kebab(key)}` : kebab(key);
    if (typeof value === 'string') out.push(`--${name}:${value}`);
    else flatten(value, name, out);
  }
}

/** One theme's declarations. Families are flattened as --coral-base, --coral-tint, --coral-ink. */
export function themeDeclarations(theme: (typeof themes)[keyof typeof themes]): string[] {
  const { family, ...rest } = theme;
  const out: string[] = [];
  flatten(rest as unknown as Tree, '', out);
  for (const key of FAMILY_KEYS) flatten(family[key] as unknown as Tree, key, out);
  return out;
}

export function sharedDeclarations(): string[] {
  const out: string[] = [];
  flatten(shared as unknown as Tree, '', out);
  return out;
}

/** The whole stylesheet. `color-scheme` tells the browser to draw its own controls to match. */
export function tokensCss(): string {
  const day = themeDeclarations(themes.day).join(';');
  const night = themeDeclarations(themes.night).join(';');
  const common = sharedDeclarations().join(';');
  return [
    `:root{${common};${day};color-scheme:light}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme='day']){${night};color-scheme:dark}}`,
    `:root[data-theme='night']{${night};color-scheme:dark}`,
    '',
  ].join('\n');
}
