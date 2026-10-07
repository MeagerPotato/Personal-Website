import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { finish } from './planet';
import {
  SUN_SURFACE,
  SUN_TONE,
  SUN_TONE_COUNT,
  sunFlag,
  sunLadder,
  sunOffset,
  sunSeed,
} from './sunSurface';
import { groundOf, type GroundLooks } from './world/ground';
import { colorOf } from './world/palette';

const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
const look = tuning.look.sun;

// What the generator hands the sun's shader. The picture the shader draws with it is held by
// sunGrain.test.ts, on the shader's twin.

describe('a living sun’s surface', () => {
  it('is a ball of 2000 facets, 1280 on the low tier, every one flagged as the surface of ITS sun', () => {
    for (const [detail, count] of [
      [tuning.world.detailSun, 2000],
      [look.detailLow, 1280],
    ] as const) {
      const facets = finish(
        groundOf({ seed: 'sun-mint', sun: 'mint', recipe: 'sun' }, 'x', detail, LOOKS),
      );
      expect(facets).toHaveLength(count);
      const flag = sunFlag(sunSeed('sun-mint'));
      const base = String(colorOf('mint.base'));
      for (const facet of facets) {
        expect(facet.g).toBe(flag);
        // To a material that knows nothing of tones it is the family's base, and one colour.
        expect(String(facet.c)).toBe(base);
        expect(facet.s).toBeUndefined();
      }
    }
  });

  it('is round: every corner lies on the ball and carries the ball’s normal', () => {
    const facets = finish(groundOf({ sun: 'sky', recipe: 'sun' }, 'sun', 6, LOOKS));
    for (const { p, n } of facets) {
      if (!n) throw new Error('a sun’s facet has its normals');
      for (let i = 0; i < 9; i += 3) {
        expect(Math.hypot(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0)).toBeCloseTo(1, 6);
        for (let k = 0; k < 3; k += 1) expect(n[i + k]).toBeCloseTo(p[i + k] ?? NaN, 6);
      }
    }
  });

  it('flags the surface above every other reading of the flag, with the sun’s own number', () => {
    // Every reader but the sun's shader asks "above a half?" and "above one and a half?"; the
    // shader asks "above four?", and reads the number back as the flag less 6.
    expect(SUN_SURFACE).toBe(6);
    expect(sunFlag(0)).toBeGreaterThan(4);
    expect(sunFlag(3.25) - SUN_SURFACE).toBe(3.25);
    expect(sunSeed('system/software')).toBe(sunSeed('system/software'));
    expect(sunSeed('system/software')).not.toBe(sunSeed('system/research'));
    for (const name of ['sun-sky', 'sun-mint', 'sun-lilac', 'lab', 'another']) {
      expect(sunSeed(name)).toBeGreaterThanOrEqual(0);
      expect(sunSeed(name)).toBeLessThan(10);
      // Its place in the noise, as the shader works it out from the number.
      const seed = sunSeed(name);
      expect(sunOffset(seed)).toEqual([seed, 0.4 * seed, 0.9 * seed]);
    }
  });

  it('makes the ladder from the family’s three tokens: hot toward white, the spots darker', () => {
    const family = {
      shade: [0.1, 0.2, 0.3],
      base: [0.2, 0.4, 0.6],
      light: [0.5, 0.6, 0.8],
    } as const;
    const ladder = sunLadder(family, 0.5);
    expect(ladder.slice(0, 3)).toEqual([family.shade, family.base, family.light]);
    expect(ladder[SUN_TONE.hot]).toEqual([0.75, 0.8, 0.9]);
    expect(ladder[SUN_TONE.ring]?.[2]).toBeCloseTo(0.3 * 0.86, 12);
    expect(ladder[SUN_TONE.core]?.[2]).toBeCloseTo(0.15, 12);
    expect(ladder).toHaveLength(SUN_TONE_COUNT);
  });

  it('leaves a painted sun alone: the Hardware sun’s frame is one shade, and plain glow', () => {
    const frame = finish(
      groundOf(
        { sun: 'coral', recipe: 'sun', detail: 4, paint: [['band', 0, 1.01, 'coral.shade']] },
        'sun',
        tuning.world.detailSun,
        LOOKS,
      ),
    );
    expect(frame).toHaveLength(500);
    expect(frame.every((facet) => facet.g === 2)).toBe(true);
    const shade = String(Array.from(new Float32Array(colorOf('coral.shade'))));
    expect(frame.every((facet) => String(facet.c) === shade && !facet.s)).toBe(true);
  });
});
