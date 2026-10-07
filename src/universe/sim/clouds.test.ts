import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { cloudAt, cloudCut, cloudField, cloudOffset, cloudSeed } from './clouds';
import type { Point } from './meshBuilder';

// The clouds are drawn by a shader (design/shaders/air.ts); this is its twin, with the numbers
// of the real look and the real worlds. What must hold: a world's clouds are its own and always
// the same, and a sky is mostly clear, more clouded the bigger the share it was given.

const { cloud: look, worlds } = tuning.look.air;

/** Evenly spread unit directions (a Fibonacci sphere). */
const directions = (count: number): Point[] =>
  Array.from({ length: count }, (_, i): Point => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });
const SPHERE = directions(4000);
/** How much of the sky is cloud at all, and how much is a cloud's body. */
const shares = (id: string, share: number): { any: number; body: number } => {
  const seed = cloudSeed(id);
  let any = 0;
  let body = 0;
  for (const n of SPHERE) {
    const level = cloudAt(n, seed, share, look);
    if (level > 0) any += 1;
    if (level > 1) body += 1;
  }
  return { any: any / SPHERE.length, body: body / SPHERE.length };
};

describe('a world’s clouds', () => {
  it('are its own, and the same every time', () => {
    const seeds = Object.keys(worlds).map(cloudSeed);
    for (const seed of seeds) {
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(10);
    }
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(cloudSeed('page/about')).toBe(cloudSeed('page/about'));
    expect(cloudOffset(2)).toEqual([2, 0.8, 1.8]);
    const n: Point = [0.36, 0.48, 0.8];
    expect(cloudField(n, 3.5, look)).toBe(cloudField(n, 3.5, look));
    expect(cloudField(n, 3.5, look)).not.toBe(cloudField(n, 4.5, look));
  });

  it('asks less of the field the bigger the share of sky', () => {
    expect(cloudCut(0, look)).toBe(look.threshold);
    expect(cloudCut(1, look)).toBeCloseTo(look.threshold - look.shareGain);
    expect(cloudCut(0.8, look)).toBeLessThan(cloudCut(0.3, look));
  });

  it('leaves every real sky mostly clear, with clouds enough to see', () => {
    for (const [id, world] of Object.entries(worlds)) {
      const { any, body } = shares(id, world.cloud.share);
      expect(any, id).toBeGreaterThan(0.04);
      expect(any, id).toBeLessThan(0.4);
      // A cloud has a body inside its thin edge.
      expect(body, id).toBeGreaterThan(0.01);
      expect(body, id).toBeLessThan(any);
    }
  });

  it('clouds a sky more the bigger its share', () => {
    for (const id of Object.keys(worlds)) {
      const few = shares(id, 0.1).any;
      const some = shares(id, 0.5).any;
      const many = shares(id, 0.9).any;
      expect(some, id).toBeGreaterThan(few);
      expect(many, id).toBeGreaterThan(some);
    }
  });

  it('stays a field in about 0 to 1, banded by latitude', () => {
    let low = Infinity;
    let high = -Infinity;
    for (const n of SPHERE) {
      const field = cloudField(n, 1.2, look);
      low = Math.min(low, field);
      high = Math.max(high, field);
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(look.noiseWeight + look.bandWeight);
    // The threshold lies inside what the field reaches, at every share.
    expect(cloudCut(0, look)).toBeLessThan(high);
    expect(cloudCut(1, look)).toBeGreaterThan(low);
  });
});
