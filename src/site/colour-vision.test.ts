import { describe, expect, it } from 'vitest';
import { closestPair, DEFICIENCY_KEYS, difference } from './colour-vision';

describe('difference (CIEDE2000)', () => {
  it('is zero for one colour and the same either way round', () => {
    expect(difference('#8bc0f2', '#8bc0f2')).toBe(0);
    expect(difference('#8bc0f2', '#ab86bf')).toBeCloseTo(difference('#ab86bf', '#8bc0f2'), 10);
  });

  it('matches the published reference values', () => {
    // Black against white is exactly 100 in every colour-difference formula of the CIE.
    expect(difference('#000000', '#ffffff')).toBeCloseTo(100, 1);
    // Pure red against pure green and against pure blue, sRGB under D65: the values every
    // implementation of Sharma, Wu and Dalal's formula agrees on.
    expect(difference('#ff0000', '#00ff00')).toBeCloseTo(86.61, 1);
    expect(difference('#ff0000', '#0000ff')).toBeCloseTo(52.88, 1);
  });

  it('tells a just-noticeable step from a plain one', () => {
    expect(difference('#808080', '#818181')).toBeLessThan(1);
    expect(difference('#808080', '#909090')).toBeGreaterThan(4);
  });
});

describe('simulated colour vision (Vienot)', () => {
  it('leaves greys alone: a deficiency confuses hues, never lightness', () => {
    for (const deficiency of DEFICIENCY_KEYS) {
      expect(difference('#808080', '#808080', deficiency)).toBe(0);
      expect(difference('#404040', '#c0c0c0', deficiency)).toBeCloseTo(
        difference('#404040', '#c0c0c0'),
        0,
      );
    }
  });

  it('brings red and green together for a protanope and a deuteranope, not for a tritanope', () => {
    // A red and a green of about the same lightness: far apart to a normal eye.
    const normal = difference('#c0504d', '#6f8f3f');
    expect(normal).toBeGreaterThan(30);
    expect(difference('#c0504d', '#6f8f3f', 'protan')).toBeLessThan(normal / 2);
    expect(difference('#c0504d', '#6f8f3f', 'deutan')).toBeLessThan(normal / 2);
    expect(difference('#c0504d', '#6f8f3f', 'tritan')).toBeGreaterThan(normal / 2);
  });
});

describe('closestPair', () => {
  it('names the two that look most alike', () => {
    const found = closestPair({ navy: '#0a0f1f', ink: '#0c1122', butter: '#f8d98c' });
    expect(found.pair).toEqual(['navy', 'ink']);
    expect(found.difference).toBeLessThan(2);
  });
});
