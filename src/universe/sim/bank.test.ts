import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { bankOf } from './bank';

const LOOK = tuning.ship;
const FULL = tuning.flight.yawRateSlow;

describe('leaning into a turn', () => {
  it('leans left wing down into a left turn, and right into a right one', () => {
    expect(bankOf(1, 100, FULL, LOOK)).toBeLessThan(0);
    expect(bankOf(-1, 100, FULL, LOOK)).toBeGreaterThan(0);
    expect(bankOf(0, 100, FULL, LOOK)).toBeCloseTo(0, 12);
  });

  it('leans bankRad at the pilot’s full turn rate, and never more, however fast the autopilot turns', () => {
    expect(bankOf(FULL, 100, FULL, LOOK)).toBeCloseTo(-LOOK.bankRad, 12);
    const fastest = tuning.cruise.flight.yawRateSlow;
    expect(fastest).toBeGreaterThan(FULL);
    for (let rate = -fastest; rate <= fastest; rate += fastest / 50) {
      expect(Math.abs(bankOf(rate, 700, FULL, LOOK))).toBeLessThanOrEqual(LOOK.bankRad + 1e-12);
    }
  });

  it('does not lean a ship that turns on the spot', () => {
    expect(bankOf(FULL, 0, FULL, LOOK)).toBeCloseTo(0, 12);
    expect(Math.abs(bankOf(FULL, LOOK.bankFullSpeed / 2, FULL, LOOK))).toBeLessThan(LOOK.bankRad);
  });
});
