import { describe, expect, it } from 'vitest';
import { fbm3, noise3 } from './skyNoise';

// The recipe's own values (the look pass's CPU twin, `look/sky.js`: noise3, fbm3 with 3 octaves
// and no offset, fbm3 with 2 octaves and offset 1), at five points near and far from the origin.
// The baked sky's shader computes the same function, so these are what keep the three in step.
const GOLDEN: ReadonlyArray<readonly [[number, number, number], number, number, number]> = [
  [[0.1, 0.2, 0.3], -0.4213652235277772, 0.3705548079597147, 0.40712302021285635],
  [[-1.7, 2.4, 5.9], -0.08130393137227808, 0.5552800728766922, 0.6309934664741508],
  [[12.25, -3.5, 0.75], 0.06670010089874268, 0.48399279796343353, 0.5380938644644254],
  [[-0.35, -0.2, -0.9], 0.24921252405547537, 0.6561299961003768, 0.740521650283805],
  [[100.3, 50.7, -25.1], -0.1942226212873944, 0.47006928293609185, 0.3799952341085048],
];

describe('the sky’s noise', () => {
  it('is the recipe’s, to the last bit', () => {
    for (const [[x, y, z], noise, coarse, fine] of GOLDEN) {
      expect(noise3(x, y, z)).toBe(noise);
      expect(fbm3(x, y, z, 3)).toBe(coarse);
      expect(fbm3(x, y, z, 2, 1)).toBe(fine);
    }
  });

  it('is zero on the lattice, smooth across it, and stays in range', () => {
    expect(noise3(3, -2, 7)).toBe(0);
    // No jump where a cell ends and the next begins.
    expect(Math.abs(noise3(1 - 1e-6, 0.4, 0.4) - noise3(1 + 1e-6, 0.4, 0.4))).toBeLessThan(1e-4);
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 4000; i += 1) {
      const value = fbm3(i * 0.137, i * 0.071 - 9, 4 - i * 0.053, 3);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
    // It is centred on a half, and it does vary.
    expect(low).toBeLessThan(0.35);
    expect(high).toBeGreaterThan(0.65);
  });
});
