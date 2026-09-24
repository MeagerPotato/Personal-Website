import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  dockRadius,
  homeReach,
  homeRings,
  honeycomb,
  orbitPeriod,
  orbitPhase,
  reach,
  round,
  slotLimits,
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

describe('homeRings', () => {
  it('stacks the station inside the satellite, round the home planet', () => {
    const rings = homeRings();
    expect(rings.map((ring) => ring.item.kind)).toEqual(['station', 'satellite']);
    const [station, satellite] = rings;
    expect(station?.radius).toBeGreaterThan(dockRadius(L.home.planetRadius));
    expect(satellite?.radius).toBeGreaterThan(station?.radius ?? Infinity);
    expect(homeReach()).toBeCloseTo((satellite?.radius ?? 0) + (satellite?.item.footprint ?? 0));
  });
});

describe('slotPosition', () => {
  const distance = (a: readonly number[], b: readonly number[]): number =>
    Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0));
  /** The farthest two of the first `count` slots: the longest trip between system centres. */
  const farthest = (count: number): number => {
    const points = Array.from({ length: count }, (_, order) => slotPosition(order));
    let most = 0;
    for (const [index, a] of points.entries()) {
      for (const b of points.slice(index + 1)) most = Math.max(most, distance(a, b));
    }
    return most;
  };

  it('puts slot 0 at the origin', () => {
    expect(slotPosition(0)).toEqual([0, 0]);
  });

  it('is a pure function of the order, whatever was asked for before', () => {
    const late = slotPosition(3);
    slotPosition(24);
    expect(slotPosition(3)).toEqual(late);
    expect(slotPosition(3)).not.toEqual(slotPosition(4));
    expect(() => slotPosition(-1)).toThrow(RangeError);
    expect(() => slotPosition(1.5)).toThrow(RangeError);
  });

  it('places each slot from the slots before it alone: adding systems never moves one', () => {
    const limits = slotLimits();
    const many = honeycomb(25, limits);
    for (let count = 1; count <= 25; count += 1) {
      expect(honeycomb(count, limits)).toEqual(many.slice(0, count));
    }
    expect(slotPosition(7)).toEqual(many[7]);
  });

  it('keeps every slot far enough from home, and any two apart, for full-size systems', () => {
    // The build's tripwires (data/build.ts) are exactly these: whatever grows in a slot, up to
    // the largest system the build accepts, never makes a build fail for want of room.
    const points = Array.from({ length: 25 }, (_, order) => slotPosition(order));
    for (const point of points.slice(1)) {
      expect(Math.hypot(point[0], point[1])).toBeGreaterThanOrEqual(
        homeReach() + L.maxSystemRadius + L.minSystemGap,
      );
    }
    let closest = Infinity;
    for (const [index, a] of points.entries()) {
      if (index === 0) continue;
      for (const b of points.slice(index + 1)) closest = Math.min(closest, distance(a, b));
    }
    expect(closest).toBeGreaterThanOrEqual(2 * L.maxSystemRadius + L.minSystemGap);

    // ...and packed, not spread: from slot 4 on, each one sits in a pocket, as close to two of
    // the slots before it as that allows (1 u of slack keeps rounding from closing a gap).
    const { homeRoom, pairRoom } = slotLimits();
    expect(homeRoom).toBeCloseTo(homeReach() + L.maxSystemRadius + L.minSystemGap + 1, 9);
    expect(pairRoom).toBeCloseTo(2 * L.maxSystemRadius + L.minSystemGap + 1, 9);
    for (const [order, point] of points.entries()) {
      if (order < 4) continue;
      const touching = points
        .slice(0, order)
        .filter(
          (other, k) => Math.abs(distance(point, other) - (k === 0 ? homeRoom : pairRoom)) < 1e-6,
        );
      expect(touching.length, `slot ${order}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('stands the first three round home in a triangle, as tight as allowed', () => {
    const room = homeReach() + L.maxSystemRadius + L.minSystemGap;
    for (const order of [1, 2, 3]) {
      expect(Math.hypot(...slotPosition(order))).toBeCloseTo(room + 1, 6);
    }
    // Slot 1 stands on the axis.
    const [x, z] = slotPosition(1);
    expect(Math.atan2(z, x)).toBeCloseTo((L.clusterAxisDeg * Math.PI) / 180, 9);
    // Four systems: nothing is further apart than two corners of that triangle.
    expect(farthest(4)).toBeCloseTo(Math.sqrt(3) * (room + 1), 6);
  });

  it('grows slowly: the farthest two systems stay within 2,000 u up to 8 systems', () => {
    // The sunflower spiral this replaced had 2,935 u at 4 systems and 4,749 u at 8.
    expect(farthest(2)).toBeLessThan(600);
    expect(farthest(4)).toBeLessThan(1040);
    expect(farthest(6)).toBeLessThan(1820);
    expect(farthest(8)).toBeLessThan(1950);
  });

  it('is symmetric about its axis with an even number of systems: balanced on the map', () => {
    const axis = (L.clusterAxisDeg * Math.PI) / 180;
    const ux = Math.cos(axis);
    const uz = Math.sin(axis);
    const mirror = ([x, z]: readonly number[]): [number, number] => {
      const along = (x ?? 0) * ux + (z ?? 0) * uz;
      return [2 * along * ux - (x ?? 0), 2 * along * uz - (z ?? 0)];
    };
    for (const count of [2, 4, 6, 8]) {
      const points = Array.from({ length: count }, (_, order) => slotPosition(order));
      for (const point of points) {
        const image = mirror(point);
        const match = Math.min(...points.map((other) => distance(other, image)));
        expect(match, `${count} systems`).toBeLessThan(1e-6);
      }
      // On a diagonal, symmetric means as wide as it is tall.
      const xs = points.map((point) => point[0]);
      const zs = points.map((point) => point[1]);
      const wide = Math.max(...xs) - Math.min(...xs);
      const tall = Math.max(...zs) - Math.min(...zs);
      expect(Math.abs(wide - tall), `${count} systems`).toBeLessThan(1e-6);
    }
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
