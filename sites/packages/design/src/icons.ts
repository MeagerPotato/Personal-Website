/**
 * The apps' icons, drawn from the tokens (like the main site's favicon, src/site/favicon.ts):
 * a change of palette repaints them on the next build, and no picture with colours of its own
 * sits in a public/ folder.
 *
 *   journal   a mood bean on warm paper
 *   blog      a page corner folded over, on warm paper
 *
 * Each comes in two cuts: "any" (the mark fills most of the tile, corners rounded) and
 * "maskable" (full bleed, the mark inside the middle 60% so any mask shape keeps it whole).
 */
import { themes, type FamilyKey } from './tokens.ts';

export type AppMark = 'journal' | 'blog';

const BEAN =
  'M25.2 6.2c8.9.6 15.4 7.2 15.9 15.9.5 9.8-5.3 18.9-15.4 19.8C15.4 42.8 6.9 36.6 6.9 26.4 6.9 15 14.7 5.5 25.2 6.2Z';

function mark(kind: AppMark, family: FamilyKey): string {
  const day = themes.day;
  const colour = day.family[family].base;
  const ink = day.onFamily;
  if (kind === 'journal') {
    // The bean from ui/Bean.tsx (a 48-unit box), smiling.
    return [
      `<path d="${BEAN}" fill="${colour}"/>`,
      `<circle cx="19" cy="22.4" r="1.9" fill="${ink}"/>`,
      `<circle cx="29.4" cy="22.4" r="1.9" fill="${ink}"/>`,
      `<path d="M19.2 29q4.8 4 9.6 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`,
    ].join('');
  }
  // A page with its corner folded, and three lines of text.
  return [
    `<path d="M11 6h19l9 9v27H11z" fill="${day.raised}" stroke="${day.ink.high}" stroke-width="2.4" stroke-linejoin="round"/>`,
    `<path d="M30 6v9h9" fill="${colour}" stroke="${day.ink.high}" stroke-width="2.4" stroke-linejoin="round"/>`,
    `<path d="M17 22h15M17 28h15M17 34h10" stroke="${day.ink.high}" stroke-width="2.4" stroke-linecap="round"/>`,
  ].join('');
}

/** The icon as SVG. `maskable`: full-bleed background, mark in the safe zone. */
export function appIconSvg(
  kind: AppMark,
  options: { family?: FamilyKey; maskable?: boolean } = {},
): string {
  const family = options.family ?? (kind === 'journal' ? 'mint' : 'butter');
  const bg = themes.day.bg;
  const size = 48;
  // The mark's box inside the 48-unit tile: most of it, or the middle 60% for maskable icons.
  const scale = options.maskable ? 0.6 : 0.86;
  const offset = (size - size * scale) / 2;
  const tile = options.maskable
    ? `<rect width="${size}" height="${size}" fill="${bg}"/>`
    : `<rect width="${size}" height="${size}" rx="11" fill="${bg}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    tile,
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${mark(kind, family)}</g>`,
    '</svg>',
  ].join('');
}
