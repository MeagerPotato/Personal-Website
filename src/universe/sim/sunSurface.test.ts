import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import type { Point } from './meshBuilder';
import { createNoise3 } from './noise';
import { finish } from './planet';
import { SUN_TONE, SUN_TONE_COUNT, sunLadder, sunSeed, sunTone, toneUnlit } from './sunSurface';
import { groundOf, type GroundLooks } from './world/ground';
import { colorOf } from './world/palette';

const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
const look = tuning.look.sun;
/** The suns of the galaxy as their rows seed them, and four more: seven. */
const SEEDS = ['sun-sky', 'sun-mint', 'sun-lilac', 'sun-coral', 'sun-butter', 'lab', 'another'];
/** A sun's ball as the engine generates it, as the tone of each facet (read back from its flag). */
const tonesOf = (seed: string, detail: number): number[] =>
  finish(groundOf({ seed, sun: 'sky', recipe: 'sun' }, 'body', detail, LOOKS)).map(
    (facet) => Math.floor(facet.g / 4) - 1,
  );

describe('a living sun’s surface', () => {
  it('cuts the granulation about 15 / 45 / 30 / 10, so that the middle facet is the base', () => {
    for (const detail of [tuning.world.detailSun, look.detailLow]) {
      for (const seed of SEEDS) {
        const grain = tonesOf(seed, detail).filter((tone) => tone <= SUN_TONE.hot);
        const share = (tone: number): number =>
          (100 * grain.filter((t) => t === tone).length) / grain.length;
        const where = `${seed} at detail ${detail}`;
        expect(Math.abs(share(SUN_TONE.shade) - 15), where).toBeLessThan(4);
        expect(Math.abs(share(SUN_TONE.base) - 45), where).toBeLessThan(4);
        expect(Math.abs(share(SUN_TONE.light) - 30), where).toBeLessThan(4);
        expect(Math.abs(share(SUN_TONE.hot) - 10), where).toBeLessThan(4);
        const median = [...grain].sort((a, b) => a - b)[Math.floor(grain.length / 2)];
        expect(median, where).toBe(SUN_TONE.base);
      }
    }
  });

  it('lays its tones in cells, not as confetti: few facets have no neighbour of their tone', () => {
    // At facet-sized noise one facet in six stood alone and the ball read as a mirror ball.
    for (const seed of SEEDS) {
      const facets = finish(
        groundOf({ seed, sun: 'sky', recipe: 'sun' }, 'body', tuning.world.detailSun, LOOKS),
      );
      const tones = facets.map((facet) => Math.floor(facet.g / 4) - 1);
      const centres = facets.map(({ p }) =>
        [0, 1, 2].map((axis) => ((p[axis] ?? 0) + (p[axis + 3] ?? 0) + (p[axis + 6] ?? 0)) / 3),
      );
      const gap = (a: number[], b: number[]): number =>
        Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
      let alone = 0;
      centres.forEach((centre, i) => {
        // The three facets across its edges are the three nearest centres.
        const near = centres
          .map((other, j) => [gap(centre, other), j] as const)
          .filter(([distance, j]) => j !== i && distance < 0.15)
          .sort((a, b) => a[0] - b[0])
          .slice(0, 3);
        if (near.every(([, j]) => tones[j] !== tones[i])) alone += 1;
      });
      expect(alone / facets.length, seed).toBeLessThan(0.08);
    }
  });

  it('has 2000 facets, 1280 on the low tier, each glowing and in its tone’s colour', () => {
    expect(tonesOf('sun-sky', tuning.world.detailSun)).toHaveLength(2000);
    expect(tonesOf('sun-sky', look.detailLow)).toHaveLength(1280);
    const ladder = sunLadder(
      { shade: colorOf('mint.shade'), base: colorOf('mint.base'), light: colorOf('mint.light') },
      look.hotMix,
    );
    const facets = finish(groundOf({ sun: 'mint', recipe: 'sun' }, 'sun', 6, LOOKS));
    for (const facet of facets) {
      // Every reader of the flag but the sun's own shader sees plain glow.
      expect(facet.g).toBeGreaterThan(1.5);
      const tone = Math.floor(facet.g / 4) - 1;
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(SUN_TONE_COUNT);
      expect(facet.c).toEqual(ladder[tone]);
    }
    expect(new Set(facets.map((facet) => facet.g)).size).toBe(SUN_TONE_COUNT);
  });

  it('puts its three spots where the design says: a core, and a ring out to 1.5 radii', () => {
    const unit = ([x, y, z]: Point): Point => {
      const length = Math.hypot(x, y, z);
      return [x / length, y / length, z / length];
    };
    /** The direction `angle` away from `n`, toward the pole or (at the pole) toward +X. */
    const off = (n: Point, angle: number): Point => {
      const side = unit(
        Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]],
      );
      return unit([
        n[0] * Math.cos(angle) + side[0] * Math.sin(angle),
        n[1] * Math.cos(angle) + side[1] * Math.sin(angle),
        n[2] * Math.cos(angle) + side[2] * Math.sin(angle),
      ]);
    };
    const noise = createNoise3('any sun');
    expect(look.spots).toHaveLength(3);
    for (const spot of look.spots) {
      const n = unit(spot.normal);
      expect(sunTone(n, noise, look)).toBe(SUN_TONE.core);
      expect(sunTone(off(n, spot.radius * 0.9), noise, look)).toBe(SUN_TONE.core);
      expect(sunTone(off(n, spot.radius * 1.1), noise, look)).toBe(SUN_TONE.ring);
      expect(sunTone(off(n, spot.radius * 1.4), noise, look)).toBe(SUN_TONE.ring);
      expect(sunTone(off(n, spot.radius * 1.6), noise, look)).toBeLessThanOrEqual(SUN_TONE.hot);
    }
    // They are places on the sun, whatever its seed: the far side has none.
    expect(sunTone([0, 0, -1], noise, look)).toBeLessThanOrEqual(SUN_TONE.hot);
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

  it('carries a tone above the glow flag, and gives every sun a number of its own', () => {
    expect([0, 1, 2, 3, 4, 5].map(toneUnlit)).toEqual([6, 10, 14, 18, 22, 26]);
    // A plain glow (a lamp, a gear) reads back as no tone at all.
    expect(Math.floor(2 / 4) - 1).toBe(-1);
    expect(sunSeed('system/software')).toBe(sunSeed('system/software'));
    expect(sunSeed('system/software')).not.toBe(sunSeed('system/research'));
    for (const name of SEEDS) {
      expect(sunSeed(name)).toBeGreaterThanOrEqual(0);
      expect(sunSeed(name)).toBeLessThan(10);
    }
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
    expect(frame.every((facet) => String(facet.c) === shade)).toBe(true);
  });
});
