import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, pickWeighted } from './rng';

describe('hashSeed', () => {
  it('is stable: these values are load-bearing for every generated world', () => {
    expect(hashSeed('')).toBe(hashSeed(''));
    expect(hashSeed('fishai')).toBe(hashSeed('fishai'));
    expect(Number.isInteger(hashSeed('fishai'))).toBe(true);
    expect(hashSeed('fishai')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('fishai')).toBeLessThan(2 ** 32);
  });

  it('separates near-identical slugs', () => {
    const seeds = new Set(['fishai', 'fishai2', 'fisha', 'days2meet', 'Fishai'].map(hashSeed));
    expect(seeds.size).toBe(5);
  });
});

describe('createRng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng('allenkh-starfield');
    const b = createRng('allenkh-starfield');
    expect(Array.from({ length: 50 }, a)).toEqual(Array.from({ length: 50 }, b));
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng('a')()).not.toBe(createRng('b')());
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const rng = createRng(42);
    const buckets = Array.from({ length: 10 }, () => 0);
    for (let i = 0; i < 20000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const index = Math.floor(value * 10);
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
    for (const count of buckets) expect(Math.abs(count - 2000)).toBeLessThan(200);
  });
});

describe('pickWeighted', () => {
  it('respects weights', () => {
    const rng = createRng('weights');
    const counts = { common: 0, rare: 0 };
    for (let i = 0; i < 10000; i += 1) {
      counts[
        pickWeighted(rng, [
          ['common', 0.9],
          ['rare', 0.1],
        ] as const)
      ] += 1;
    }
    expect(counts.rare).toBeGreaterThan(800);
    expect(counts.rare).toBeLessThan(1200);
  });

  it('never returns undefined, even at the top of the range', () => {
    expect(pickWeighted(() => 0.999999, [['only', 1]] as const)).toBe('only');
    expect(() => pickWeighted(() => 0.5, [])).toThrow();
  });
});
