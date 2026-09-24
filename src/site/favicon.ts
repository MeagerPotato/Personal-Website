import type { Tokens } from '../universe/design/tokens';

// The site's icon (the browser tab, bookmarks, a phone's history): a ringed planet on a navy
// tile, flat-shaded like everything else here. Drawn from the design tokens, so it can never drift
// from the palette again; src/pages/favicon.svg.ts serves it as /favicon.svg.
//
// Drawn on a 32 px grid and checked at 16 px: every shape is at least a pixel wide at half size,
// and where the ring crosses in front of the planet a band of navy cuts it free (the same trick
// as a station on a route line), so the two never melt into one blob in a small tab.
//
// Pure: same tokens in, same string out.

export const FAVICON_SIZE = 32;

const n = (value: number): string => String(Math.round(value * 100) / 100);

/** Half of a tilted ellipse, as a path: `far` is the half behind the planet, `near` in front. */
function ringHalf(half: 'far' | 'near'): string {
  const rx = 14.4;
  const ry = 4.9;
  const sweep = half === 'far' ? 1 : 0;
  return `M${n(16 - rx)} 16A${n(rx)} ${n(ry)} 0 0 ${sweep} ${n(16 + rx)} 16`;
}

export function faviconSvg(tokens: Tokens): string {
  const { space, system } = tokens.color;
  const planet = system.sky;
  const ring = system.butter.base;
  const tilt = 'rotate(-22 16 16)';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}">`,
    `<rect width="32" height="32" rx="7" fill="${space[900]}"/>`,
    // The far half of the ring, behind the planet.
    `<path d="${ringHalf('far')}" fill="none" stroke="${ring}" stroke-width="2.4" ` +
      `stroke-linecap="round" transform="${tilt}"/>`,
    // The planet: its shadow side, then the lit side laid over it towards the light (top left).
    '<clipPath id="favicon-planet"><circle cx="16" cy="16" r="9.4"/></clipPath>',
    `<circle cx="16" cy="16" r="9.4" fill="${planet.shade}"/>`,
    `<circle cx="14" cy="14" r="8.8" fill="${planet.base}" clip-path="url(#favicon-planet)"/>`,
    // The near half: where it crosses the planet, a navy band first, so it reads as in front.
    `<path d="${ringHalf('near')}" fill="none" stroke="${space[900]}" stroke-width="4.8" ` +
      `transform="${tilt}" clip-path="url(#favicon-planet)"/>`,
    `<path d="${ringHalf('near')}" fill="none" stroke="${ring}" stroke-width="2.4" ` +
      `stroke-linecap="round" transform="${tilt}"/>`,
    '</svg>',
  ].join('');
}
