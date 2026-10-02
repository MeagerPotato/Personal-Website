import { describe, expect, it } from 'vitest';
import { THEME_KEYS, tokens } from '../universe/design/tokens';
import { closestPair, DEFICIENCY_KEYS, difference } from './colour-vision';
import { contrast, luminance } from './contrast';

// The colours of the "flat worlds, deep light" pass (design/tokens.ts: color.nebula, color.air,
// the star temperatures). Only the 3D world paints with them, but what they must hold is the
// same kind of promise the stylesheet's pairings make (./contrast.test.ts), so it is checked
// here, where the colour maths lives. (design/tokens.test.ts checks their shape.)

describe('the sky’s gas (color.nebula)', () => {
  it('keeps the body of the gas barely above space and its rim a clear line', () => {
    const space = tokens.color.space[900];
    for (const [family, ramp] of Object.entries(tokens.color.nebula)) {
      // deep holds the shapes: a body, never something that reads as a mark or as text.
      expect(contrast(ramp.deep, space), `${family}.deep`).toBeLessThan(1.4);
      // ...and each tone is lighter than the one under it, or the ramp is not a ramp.
      const steps = [ramp.deep, ramp.mid, ramp.lit, ramp.rim].map((tone) => contrast(tone, space));
      expect(steps, family).toEqual([...steps].sort((a, b) => a - b));
      // rim is a hairline and a hot core: it must show.
      expect(contrast(ramp.rim, space), `${family}.rim`).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps the families of gas apart where a family is told: its lit and its rim', () => {
    // Closest pair among the five families, CIEDE2000. deep and mid carry shape, not identity
    // (they are nearly one colour under deuteranopia, on purpose). When the palette was set
    // (2026-10-01) the closest lit pair was 7.1 (sky and lilac, deuteranopia) and the closest
    // rim pair 8.5 (the same): these floors are what "still told apart" means.
    const tone = (key: 'lit' | 'rim'): Record<string, string> =>
      Object.fromEntries(THEME_KEYS.map((family) => [family, tokens.color.nebula[family][key]]));
    for (const deficiency of [undefined, ...DEFICIENCY_KEYS]) {
      const who = deficiency ?? 'normal';
      expect(closestPair(tone('lit'), deficiency).difference, `lit, ${who}`).toBeGreaterThan(7);
      expect(closestPair(tone('rim'), deficiency).difference, `rim, ${who}`).toBeGreaterThan(8);
    }
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
