import { tokens, type BiomeKey, type ThemeKey, type Tokens } from '../../design/tokens';
import { hexToLinear } from '../color';
import type { Rgb } from '../meshBuilder';
import type { PlanetBands } from '../planet';

/**
 * THE PALETTE of the worlds: how a colour is named in a body's rows, and the one function that
 * turns that name into a colour. Rows never carry a hex value (AGENTS.md, invariant 8): they say
 * `'coral.base'`, `'ink.high'`, `'star.warm'` or `'biome.dune.high'`, and `colorOf` looks it up
 * in tokens.ts. A name it does not know THROWS, with the name in the message: a typo must fail a
 * test, not become black. The type `ColorPath` makes the same typo a compile error first.
 *
 * Two ramps are rules, not tokens (tokens.md in the concept set): a colour FAMILY as a biome
 * (sea its shade, shore and high its light, low its base, peak ink.high: a world painted in its
 * system's colours with no hex of its own) and CHALK (ink.mid, ink.mid, ink.high, ink.high,
 * star.white: Model Rocketry's white airframe). Both follow any change to the tokens they read.
 */

type Family = Tokens['color']['system'][ThemeKey];
type Band = keyof PlanetBands;

/** What a ground can be painted with: a biome of the tokens, a colour family, or chalk. */
export type Ramp = BiomeKey | ThemeKey | 'chalk';

export type ColorPath =
  | `${ThemeKey}.${keyof Family}`
  | `ink.${keyof Tokens['color']['ink']}`
  | `space.${keyof Tokens['color']['space']}`
  | `surface.${keyof Tokens['color']['surface']}`
  | `star.${keyof Tokens['color']['star']}`
  | 'lamp.window'
  | `biome.${Ramp}.${Band}`;

/** What a colour path looks like; the rows' other strings (a glyph's family, a sign's text) do not. */
const PATH = /^[a-z]+\.[a-z0-9]+(\.[a-z]+)?$/;
export const looksLikeColor = (text: string): boolean => PATH.test(text);

const { color } = tokens;
const isTheme = (key: string): key is ThemeKey => Object.hasOwn(color.system, key);
const isBiome = (key: string): key is BiomeKey => Object.hasOwn(color.biome, key);

/** A ramp's five colours, as hex. */
export function rampHex(ramp: Ramp): Readonly<Record<Band, string>> {
  if (ramp === 'chalk') {
    return {
      sea: color.ink.mid,
      shore: color.ink.mid,
      low: color.ink.high,
      high: color.ink.high,
      peak: color.star.white,
    };
  }
  if (isTheme(ramp)) {
    const family = color.system[ramp];
    return {
      sea: family.shade,
      shore: family.light,
      low: family.base,
      high: family.light,
      peak: color.ink.high,
    };
  }
  return color.biome[ramp];
}

function hexOf(path: string): string | undefined {
  const [a = '', b = '', c, extra] = path.split('.');
  if (extra !== undefined) return undefined;
  if (a === 'biome') {
    if (c === undefined || !(b === 'chalk' || isTheme(b) || isBiome(b))) return undefined;
    const ramp = rampHex(b);
    return Object.hasOwn(ramp, c) ? ramp[c as Band] : undefined;
  }
  if (c !== undefined) return undefined;
  // A lit window (color.window is one colour, not a group).
  if (a === 'lamp') return b === 'window' ? color.window : undefined;
  const group: Readonly<Record<string, string>> | undefined = isTheme(a)
    ? color.system[a]
    : a === 'ink' || a === 'space' || a === 'surface' || a === 'star'
      ? color[a]
      : undefined;
  return group && Object.hasOwn(group, b) ? group[b] : undefined;
}

const cache = new Map<string, Rgb>();

/** A colour path as linear RGB, from tokens.ts. Throws on a path that names no colour. */
export function colorOf(path: string): Rgb {
  let rgb = cache.get(path);
  if (!rgb) {
    const hex = hexOf(path);
    if (hex === undefined) {
      throw new Error(
        `colorOf: '${path}' names no colour in tokens.ts (a family, ink, space, surface, star, lamp.window or biome.<ramp>.<band>)`,
      );
    }
    rgb = hexToLinear(hex);
    cache.set(path, rgb);
  }
  return rgb;
}

/** A ramp's five colours as the bands the planet generator paints with. */
export function bandsOf(ramp: Ramp): PlanetBands {
  const path = (band: Band): Rgb => colorOf(`biome.${ramp}.${band}`);
  return {
    sea: path('sea'),
    shore: path('shore'),
    low: path('low'),
    high: path('high'),
    peak: path('peak'),
  };
}

/** A sun's ball: mostly its family's base, with lighter (shore) and darker (peak) patches. */
export function sunBandsOf(family: ThemeKey): PlanetBands {
  const base = colorOf(`${family}.base`);
  return {
    sea: base,
    shore: colorOf(`${family}.light`),
    low: base,
    high: base,
    peak: colorOf(`${family}.shade`),
  };
}
