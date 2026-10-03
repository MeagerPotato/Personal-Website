import { describe, expect, it } from 'vitest';
import { hexToLinear } from '../color';
import { BIOME_KEYS, THEME_KEYS, tokens } from '../../design/tokens';
import { bandsOf, colorOf, looksLikeColor, rampHex, sunBandsOf } from './palette';

// Rows name colours; tokens.ts holds them. A name that is not there must fail loudly, never
// quietly draw black.

const { color } = tokens;

describe('the palette', () => {
  it('resolves every kind of path from tokens.ts', () => {
    expect(colorOf('coral.base')).toEqual(hexToLinear(color.system.coral.base));
    expect(colorOf('ink.high')).toEqual(hexToLinear(color.ink.high));
    expect(colorOf('space.800')).toEqual(hexToLinear(color.space[800]));
    expect(colorOf('star.warm')).toEqual(hexToLinear(color.star.warm));
    expect(colorOf('biome.dune.high')).toEqual(hexToLinear(color.biome.dune.high));
    expect(colorOf('biome.primer.shore')).toEqual(hexToLinear(color.biome.primer.shore));
    // A lit window: one colour of the tokens, not a group.
    expect(colorOf('lamp.window')).toEqual(hexToLinear(color.window));
  });

  it('throws on a path that names no colour, saying which', () => {
    for (const path of [
      'coral.bse',
      'rose.base',
      'ink',
      'ink.high.x',
      'biome.dune',
      'biome.nowhere.sea',
      'biome.dune.top',
      'ramp.base',
      'lamp.door',
      'lamp.window.lit',
      'hex',
    ]) {
      expect(() => colorOf(path), path).toThrow(`'${path}'`);
    }
  });

  it('paints a family as a biome by rule: shade, light, base, light, ink.high', () => {
    for (const family of THEME_KEYS) {
      const f = color.system[family];
      expect(rampHex(family)).toEqual({
        sea: f.shade,
        shore: f.light,
        low: f.base,
        high: f.light,
        peak: color.ink.high,
      });
      expect(colorOf(`biome.${family}.low`)).toEqual(hexToLinear(f.base));
    }
  });

  it('paints chalk from the inks and the white star', () => {
    expect(rampHex('chalk')).toEqual({
      sea: color.ink.mid,
      shore: color.ink.mid,
      low: color.ink.high,
      high: color.ink.high,
      peak: color.star.white,
    });
  });

  it('gives every biome, family and chalk five bands, and a sun its family', () => {
    for (const ramp of [...BIOME_KEYS, ...THEME_KEYS, 'chalk' as const]) {
      expect(Object.keys(bandsOf(ramp)).sort(), ramp).toEqual([
        'high',
        'low',
        'peak',
        'sea',
        'shore',
      ]);
    }
    const sun = sunBandsOf('mint');
    expect(sun.sea).toEqual(colorOf('mint.base'));
    expect(sun.shore).toEqual(colorOf('mint.light'));
    expect(sun.peak).toEqual(colorOf('mint.shade'));
  });

  it('tells a colour path from the rows’ other strings', () => {
    expect(looksLikeColor('coral.base')).toBe(true);
    expect(looksLikeColor('biome.dune.high')).toBe(true);
    expect(looksLikeColor('space.800')).toBe(true);
    expect(looksLikeColor('13.0')).toBe(false);
    expect(looksLikeColor('coral')).toBe(false);
    expect(looksLikeColor('.076')).toBe(false);
  });
});
