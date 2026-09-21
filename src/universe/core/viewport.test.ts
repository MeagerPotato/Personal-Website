import { describe, expect, it } from 'vitest';
import { computePixelRatio } from './viewport';

const limits = { maxPixelRatio: 2, maxMegapixels: 4, minPixelRatio: 0.5 };

describe('computePixelRatio', () => {
  it('passes a modest screen through untouched', () => {
    expect(computePixelRatio(1280, 720, 1, limits)).toBe(1);
  });

  it('caps a DPR-3 phone at the ratio limit', () => {
    expect(computePixelRatio(390, 844, 3, limits)).toBe(2);
  });

  it('caps absolute pixels on a large hi-dpi display', () => {
    const ratio = computePixelRatio(2560, 1440, 2, limits);
    expect(ratio).toBeLessThan(2);
    expect(2560 * 1440 * ratio * ratio).toBeCloseTo(4_000_000, -2);
  });

  it('never drops below the floor, even on a wall of monitors', () => {
    expect(computePixelRatio(7680, 4320, 1, limits)).toBe(0.5);
  });

  it('tolerates a zero-sized mount (hidden tab, first layout pass)', () => {
    expect(computePixelRatio(0, 0, 2, limits)).toBe(2);
  });
});
