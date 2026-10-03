import { describe, expect, it } from 'vitest';
import { gradientNoise } from '../design/shaders/noise';
import { SUN_SPOTS, toonFlat } from '../design/shaders/toonFlat';
import { tuning } from '../design/tuning';
import type { Point } from './meshBuilder';
import { SUN_FINE_OFFSET, sunGrain, sunLevel, sunLimb, sunSpot, sunTone } from './sunGrain';
import { SUN_RING_RADII, SUN_TONE, sunOffset, sunSeed } from './sunSurface';

const look = tuning.look.sun;
/** The suns of the galaxy as their rows seed them, and four more: seven. */
const SEEDS = ['sun-sky', 'sun-mint', 'sun-lilac', 'sun-coral', 'sun-butter', 'lab', 'another'];

/** `count` directions spread evenly over the ball. */
function ball(count: number): Point[] {
  return Array.from({ length: count }, (_, i): Point => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963229728653;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });
}

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

describe('the picture on a sun’s ball (the twin of the shader’s)', () => {
  it('cuts the granulation about 15 / 45 / 30 / 10, so that the middle of the ball is the base', () => {
    const places = ball(12000);
    for (const seed of SEEDS) {
      const offset = sunOffset(sunSeed(seed));
      const grains = places.map((n) => sunGrain(n, offset, look));
      const tones = grains.map((grain) => Math.round(sunLevel(grain, look, 1e-9)));
      const share = (tone: number): number =>
        (100 * tones.filter((t) => t === tone).length) / tones.length;
      // Cells a quarter of the ball across: one sun strays further from the mean than a ball of
      // small facets did.
      expect(Math.abs(share(SUN_TONE.shade) - 15), seed).toBeLessThan(5);
      expect(Math.abs(share(SUN_TONE.base) - 45), seed).toBeLessThan(5);
      expect(Math.abs(share(SUN_TONE.light) - 30), seed).toBeLessThan(5);
      expect(Math.abs(share(SUN_TONE.hot) - 10), seed).toBeLessThan(5);
      expect([...tones].sort((a, b) => a - b)[tones.length / 2], seed).toBe(SUN_TONE.base);
    }
  });

  it('lays the tones in round cells: a small step on the ball almost never changes the tone', () => {
    // A step of 0.03 radians is a quarter of a facet of the ball. A tone changes within it only
    // where the step crosses an outline, and the outlines are few and long: cells, not confetti.
    const places = ball(4000);
    for (const seed of SEEDS) {
      const offset = sunOffset(sunSeed(seed));
      const tone = (n: Point): number =>
        Math.round(sunLevel(sunGrain(n, offset, look), look, 1e-9));
      const changed = places.filter((n) => tone(n) !== tone(off(n, 0.03))).length;
      expect(changed / places.length, seed).toBeLessThan(0.2);
      // And the noise is smooth: its slope is bounded, so an edge between tones is a line.
      const steepest = Math.max(
        ...places.map((n) =>
          Math.abs(sunGrain(n, offset, look) - sunGrain(off(n, 0.01), offset, look)),
        ),
      );
      expect(steepest, seed).toBeLessThan(0.12);
    }
  });

  it('gives a tone a soft edge: between two cells the level passes through every share', () => {
    const [, cut] = look.granulation.thresholds;
    const { soft } = look.granulation;
    expect(sunLevel(cut - soft, look)).toBeCloseTo(1, 12);
    expect(sunLevel(cut, look)).toBeCloseTo(1.5, 12);
    expect(sunLevel(cut + soft, look)).toBeCloseTo(2, 12);
    // Far from any cut it is a whole tone.
    expect(sunLevel(-1, look)).toBe(0);
    expect(sunLevel(1, look)).toBe(3);
    // The edge is thin: a few hundredths of the noise's reach.
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(0.05);
  });

  it('puts its three spots where the design says: a core, and a ring out to 1.5 radii', () => {
    const offset = sunOffset(sunSeed('any sun'));
    expect(look.spots).toHaveLength(SUN_SPOTS);
    expect(SUN_RING_RADII).toBe(1.5);
    for (const spot of look.spots) {
      const n = unit(spot.normal);
      expect(sunTone(n, offset, look)).toBe(SUN_TONE.core);
      expect(sunTone(off(n, spot.radius * 0.9), offset, look)).toBe(SUN_TONE.core);
      expect(sunTone(off(n, spot.radius * 1.1), offset, look)).toBe(SUN_TONE.ring);
      expect(sunTone(off(n, spot.radius * 1.4), offset, look)).toBe(SUN_TONE.ring);
      expect(sunTone(off(n, spot.radius * 1.6), offset, look)).toBeLessThanOrEqual(SUN_TONE.hot);
      // A soft rim: half core, half ring, exactly on the core's edge.
      expect(sunSpot(off(n, spot.radius), look).core).toBeCloseTo(0.5, 6);
    }
    // They are places on the sun, whatever its seed: the far side has none.
    expect(sunSpot([0, 0, -1], look)).toEqual({ ring: 0, core: 0 });
  });

  it('darkens the limb in two round bands, and not the middle of the ball', () => {
    const [outer, inner] = look.limbNz;
    expect(sunLimb(1, look)).toBe(0);
    expect(sunLimb((outer + inner) / 2, look)).toBe(1);
    expect(sunLimb(0, look)).toBe(2);
    expect(sunLimb(inner, look)).toBeCloseTo(0.5, 12);
  });

  it('is the shader’s arithmetic: the same noise, offsets and ring', () => {
    const { fragmentShader } = toonFlat;
    // The twin's noise is sim/gradientNoise.ts; the shader's is its GLSL, constant for constant.
    expect(fragmentShader).toContain(gradientNoise);
    expect(gradientNoise).toContain('v * 1664525u + 1013904223u');
    expect(gradientNoise).toContain('f * f * f * (f * (f * 6.0 - 15.0) + 10.0)');
    expect(gradientNoise).toContain(') * 1.15;');
    expect(gradientNoise).toContain('uvec3(i + 4096)');
    // Where the sun is cut from the noise (sunOffset), the fine layer beside it, and the ring.
    expect(fragmentShader).toContain('vec3 at = vec3(1.0, 0.4, 0.9) * (vUnlit - 6.0);');
    expect(fragmentShader).toContain(`vec3(${SUN_FINE_OFFSET.join(', ')})`);
    expect(fragmentShader).toContain(`uSunSpot[i].w * ${SUN_RING_RADII.toFixed(1)}`);
    expect(fragmentShader).toContain(
      'uSunGrain.y * noise3(n * uSunGrain.x + at)\n          + (1.0 - uSunGrain.y) * noise3(n * uSunGrain.z + at + vec3(2.2, 7.1, 1.3))',
    );
  });
});
