import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  dockRadius,
  orbitPeriod,
  orbitPhase,
  reach,
  round,
  slotPosition,
  stackRings,
} from './layout';

const L = tuning.layout;

describe('dockRadius', () => {
  it('gives small bodies a minimum standoff and large bodies a proportional one', () => {
    expect(dockRadius(1.2)).toBeCloseTo(1.2 + L.dockMin);
    expect(dockRadius(12)).toBeCloseTo(12 + L.dockScale * 12);
    expect(dockRadius(L.sunRadius)).toBeLessThanOrEqual(L.sunRadius + L.sunClearance);
  });
});

describe('orbitPeriod', () => {
  it('matches the reference ring and slows down further out', () => {
    expect(orbitPeriod(L.orbitStart)).toBeCloseTo(L.periodAtStartSec);
    expect(orbitPeriod(L.orbitStart * 4)).toBeCloseTo(L.periodAtStartSec * 4 ** L.periodExponent);
  });
});

describe('orbitPhase', () => {
  it('depends on the id alone and lands in one turn', () => {
    expect(orbitPhase('project/fishai')).toBe(orbitPhase('project/fishai'));
    expect(orbitPhase('project/fishai')).not.toBe(orbitPhase('project/days2meet'));
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(orbitPhase(id)).toBeGreaterThanOrEqual(0);
      expect(orbitPhase(id)).toBeLessThan(Math.PI * 2);
    }
  });
});

describe('slotPosition', () => {
  it('puts slot 0 at the origin and never jitters it', () => {
    expect(slotPosition(0, 'home')).toEqual([0, 0]);
  });

  it('is a pure function of (order, id)', () => {
    expect(slotPosition(3, 'rocketry')).toEqual(slotPosition(3, 'rocketry'));
    expect(slotPosition(3, 'rocketry')).not.toEqual(slotPosition(3, 'berkeley'));
  });

  it('stays within the jitter of its spiral slot', () => {
    for (let order = 1; order <= 24; order += 1) {
      const [x, z] = slotPosition(order, `system-${order}`);
      const ideal = L.slotDistance * Math.sqrt(order);
      expect(Math.abs(Math.hypot(x, z) - ideal)).toBeLessThanOrEqual(L.slotJitter + 1e-9);
    }
  });

  it('keeps any two of the first 25 systems far enough apart for two full-size systems', () => {
    const points = Array.from({ length: 25 }, (_, order) => slotPosition(order, `system-${order}`));
    let closest = Infinity;
    for (const [index, a] of points.entries()) {
      for (const b of points.slice(index + 1)) {
        closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
    expect(closest).toBeGreaterThan(2 * L.maxSystemRadius + L.minSystemGap);
  });
});

describe('stackRings', () => {
  it('packs rings outwards without overlap and respects the inner edge', () => {
    const items = [{ footprint: 10 }, { footprint: 30 }, { footprint: 5 }];
    const rings = stackRings(items, 45, 8);
    expect(rings.map((ring) => ring.radius)).toEqual([55, 103, 146]);
    expect(reach(rings, 0)).toBe(151);
  });

  it('honours a minimum radius for the first ring only', () => {
    const rings = stackRings([{ footprint: 5 }, { footprint: 5 }], 10, 2, 60);
    expect(rings.map((ring) => ring.radius)).toEqual([60, 72]);
  });

  it('reach falls back when there are no rings', () => {
    expect(reach(stackRings([], 45, 8), 38)).toBe(38);
  });
});

describe('round', () => {
  it('rounds to the given number of places', () => {
    expect(round(1.23456)).toBe(1.23);
    expect(round(1.23456, 4)).toBe(1.2346);
    expect(round(-0.004)).toBe(-0);
  });
});
