import { describe, expect, it } from 'vitest';
import { THEME_KEYS, tokens } from '../universe/design/tokens';
import { tuning } from '../universe/design/tuning';
import { closestPair, DEFICIENCY_KEYS, difference } from './colour-vision';
import { contrast, luminance, over } from './contrast';

// The colours of the "flat worlds, deep light" pass (design/tokens.ts: color.nebula, color.air,
// the star temperatures). Only the 3D world paints with them, but what they must hold is the
// same kind of promise the stylesheet's pairings make (./contrast.test.ts), so it is checked
// here, where the colour maths lives. (design/tokens.test.ts checks their shape.)

describe('the Milky Way’s haze (color.nebula.band)', () => {
  const space = tokens.color.space[900];
  const { deep, mid, lit, rim } = tokens.color.nebula.band;

  it('keeps the haze barely above space, and its bulge a clear cream', () => {
    // deep and mid are where almost all of the river is: a haze under stars, never a shape.
    expect(contrast(deep, space)).toBeLessThan(1.4);
    expect(contrast(mid, space)).toBeLessThan(1.8);
    // Each tone is lighter than the one under it, or the ramp is not a ramp.
    const steps = [deep, mid, lit, rim].map((tone) => contrast(tone, space));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    // rim is mixed in a little at the bulge: it has to be a light, or it would only grey it.
    expect(contrast(rim, space)).toBeGreaterThanOrEqual(6);
  });
});

describe('the districts of the star map (color.nebula, by family)', () => {
  const space = tokens.color.space[900];
  const families = (key: 'mid' | 'lit'): Record<string, string> =>
    Object.fromEntries(THEME_KEYS.map((family) => [family, tokens.color.nebula[family][key]]));

  it('gives each family a quiet plate and a lit one', () => {
    for (const family of THEME_KEYS) {
      const { mid, lit } = tokens.color.nebula[family];
      // mid is the plate out past a system's reach: a body, never something that reads as a
      // mark or as text (about 2:1 on space; butter, the lightest family, is the strongest).
      expect(contrast(mid, space), `${family}.mid`).toBeGreaterThan(1.4);
      expect(contrast(mid, space), `${family}.mid`).toBeLessThan(2.5);
      // lit is the plate at its reach: lighter than mid, or the two steps are one.
      expect(contrast(lit, space), `${family}.lit`).toBeGreaterThan(contrast(mid, space) * 1.5);
    }
  });

  it('keeps the families apart where a family is told: its lit', () => {
    // Closest pair among the five families, CIEDE2000. mid carries shape, not identity (two of
    // them are nearly one colour under deuteranopia, on purpose). When the palette was set
    // (2026-10-01) the closest lit pair was 7.1 (sky and lilac, deuteranopia): this floor is
    // what "still told apart" means.
    for (const deficiency of [undefined, ...DEFICIENCY_KEYS]) {
      const who = deficiency ?? 'normal';
      expect(closestPair(families('lit'), deficiency).difference, `lit, ${who}`).toBeGreaterThan(7);
    }
  });

  it('paints every district in its family’s colour, home’s too: no plate is grey', () => {
    // A district's inner plate as the chart lays it, in display space (design/materials.ts,
    // createChartMaterial): mid over the sky straight down, then lit over that. How far it is
    // from the grey of its own lightness, CIEDE2000. Home's was 2.0, a grey plate, while butter's
    // mid was a blue-violet under an olive lit; it is 8.5 now, and still the quietest of the five.
    const { districtOuterAlpha, districtInnerAlpha } = tuning.look.chart;
    const greyOf = (hex: string): string => {
      const y = luminance(hex);
      const s = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
      const code = Math.round(s * 255)
        .toString(16)
        .padStart(2, '0');
      return `#${code}${code}${code}`;
    };
    const colourfulness = (family: (typeof THEME_KEYS)[number]): number => {
      const { mid, lit } = tokens.color.nebula[family];
      const under = over(mid, districtOuterAlpha, tokens.color.space[950]);
      const plate = over(lit, districtInnerAlpha, under);
      return difference(plate, greyOf(plate));
    };
    for (const family of THEME_KEYS) expect(colourfulness(family), family).toBeGreaterThan(6);
    for (const family of THEME_KEYS) {
      expect(colourfulness('butter'), family).toBeLessThanOrEqual(colourfulness(family));
    }
    // Butter means "here": home's plate is warm (its red well above its blue), not olive-grey.
    const { mid } = tokens.color.nebula.butter;
    const channel = (at: number): number => Number.parseInt(mid.slice(at, at + 2), 16);
    expect(channel(1) - channel(5)).toBeGreaterThan(20);
    expect(channel(3) - channel(5)).toBeGreaterThan(15);
  });
});

describe('the star temperatures (color.star)', () => {
  const { star, system } = tokens.color;

  it('cannot be taken for "here" or for a coral control', () => {
    // Butter means "here"; the warm stars sit nearest to it and to coral. When they were set:
    // amber 14.4 from butter's base, ember 12.4 from coral's.
    expect(difference(star.amber, system.butter.base)).toBeGreaterThan(10);
    expect(difference(star.ember, system.coral.base)).toBeGreaterThan(10);
  });

  it('shows every tint as a clear point on space', () => {
    for (const [name, tint] of Object.entries(star)) {
      expect(contrast(tint, tokens.color.space[900]), name).toBeGreaterThan(6);
    }
  });
});

describe('air, dusk and night', () => {
  const { air, shading, space } = tokens.color;

  it('makes every air a light on space, never a dark ring', () => {
    for (const [biome, colour] of Object.entries(air)) {
      expect(contrast(colour, space[900]), biome).toBeGreaterThan(10);
    }
  });

  it('keeps the night darker than the dusk, and never black', () => {
    // Both MULTIPLY a surface: white would be no shading at all.
    expect(luminance(shading.dusk)).toBeGreaterThan(luminance(shading.night));
    for (const channel of [1, 3, 5]) {
      const value = Number.parseInt(shading.night.slice(channel, channel + 2), 16) / 255;
      expect(value).toBeGreaterThan(0.4);
    }
  });
});
