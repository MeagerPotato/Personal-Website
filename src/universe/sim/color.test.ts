import { describe, expect, it } from 'vitest';
import { hexToLinear } from './color';

describe('hexToLinear', () => {
  it('converts the ends and the middle of the sRGB curve', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    // sRGB 128 is about 21.6% linear: the curve is nowhere near a straight line.
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2158605, 6);
    // Below the knee the curve IS a straight line.
    expect(hexToLinear('#0a0a0a')[0]).toBeCloseTo(10 / 255 / 12.92, 9);
  });

  it('reads each channel from its own place, in either case', () => {
    const [r, g, b] = hexToLinear('#FF8000');
    expect(r).toBe(1);
    expect(g).toBeCloseTo(0.2158605, 6);
    expect(b).toBe(0);
  });

  it('refuses anything that is not #rrggbb', () => {
    for (const bad of ['#fff', 'ffffff', '#gggggg', 'red', '#ffffff80', '']) {
      expect(() => hexToLinear(bad)).toThrow(RangeError);
    }
  });
});
