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
  slotRoomProblems,
  stackRings,
} from './layout';

const L = tuning.layout;

/**
 * Run `body` with `changes` made to tuning.layout, and put it back afterwards, as a designer's
 * edit of tuning.ts would be (data/layout.ts and data/build.ts read that very object).
 */
function withLayout<T>(changes: Record<string, unknown>, body: () => T): T {
  const live = L as unknown as Record<string, unknown>;
  const saved = structuredClone(live);
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(from)) {
      const inner = into[key];
      if (typeof value === 'object' && value !== null && typeof inner === 'object' && inner) {
        merge(inner as Record<string, unknown>, value as Record<string, unknown>);
      } else into[key] = value;
    }
  };
  try {
    merge(live, changes);
    return body();
  } finally {
    merge(live, saved);
  }
}

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
    // The build's tripwires (data/build.ts) are these: whatever grows in a slot, up to the
    // largest system the build accepts, never makes a build fail for want of room.
    expect(slotRoomProblems()).toEqual([]);
    const points = Array.from({ length: 25 }, (_, order) => slotPosition(order));
    for (const point of points.slice(1)) {
      const out = Math.hypot(point[0], point[1]);
      expect(out).toBeGreaterThanOrEqual(L.homeRoom - 1e-6);
      expect(out).toBeGreaterThanOrEqual(homeReach() + L.maxSystemRadius + L.minSystemGap);
    }
    let closest = Infinity;
    for (const [index, a] of points.entries()) {
      if (index === 0) continue;
      for (const b of points.slice(index + 1)) closest = Math.min(closest, distance(a, b));
    }
    expect(closest).toBeGreaterThanOrEqual(L.slotRoom - 1e-6);
    expect(closest).toBeGreaterThanOrEqual(2 * L.maxSystemRadius + L.minSystemGap);

    // ...and packed, not spread: from slot 4 on, each one sits in a pocket, as close to two of
    // the slots before it as the room allows.
    const { homeRoom, pairRoom } = slotLimits();
    expect([homeRoom, pairRoom]).toEqual([L.homeRoom, L.slotRoom]);
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
    const room = Math.max(L.homeRoom, L.slotRoom / Math.sqrt(3));
    for (const order of [1, 2, 3]) {
      expect(Math.hypot(...slotPosition(order))).toBeCloseTo(room, 6);
    }
    // Slot 1 stands on the axis.
    const [x, z] = slotPosition(1);
    expect(Math.atan2(z, x)).toBeCloseTo((L.clusterAxisDeg * Math.PI) / 180, 9);
    // Four systems: nothing is further apart than two corners of that triangle.
    expect(farthest(4)).toBeCloseTo(Math.sqrt(3) * room, 6);
  });

  it('grows slowly: the farthest two systems stay within 2,000 u up to 8 systems', () => {
    // The sunflower spiral this replaced had 2,935 u at 4 systems and 4,749 u at 8.
    expect(farthest(2)).toBeLessThan(611);
    expect(farthest(4)).toBeLessThan(1060);
    expect(farthest(6)).toBeLessThan(1820);
    expect(farthest(8)).toBeLessThan(1970);
  });

  it('stays where it is: the galaxy is pinned', () => {
    // Where every slot is, to the hundredth of a unit that /universe.json keeps. Systems keep
    // their place for ever (docs/PLAN.md §5.4): a visitor learns where Code is. If this fails,
    // an edit has just moved every system in the galaxy. Meant? Then it is time for Phase 3's
    // galaxy.lock.json, which pins each system where it is, so that the next edit cannot.
    const PINNED: Array<[number, number]> = [
      [0, 0],
      [-431.34, 431.34],
      [-157.88, -589.21],
      [589.21, 157.88],
      [-1011.51, -271.03],
      [271.03, 1011.51],
      [-1329.69, 582.6],
      [-582.6, 1329.69],
      [-1480.95, 1480.95],
    ];
    const now = PINNED.map((_, order) => slotPosition(order).map((value) => round(value)));
    expect(
      now,
      'The galaxy moved: see docs/PLAN.md §5.4. Pin it with galaxy.lock.json, not by editing this.',
    ).toEqual(PINNED);
  });

  it('does not move when a body, a ring or the home planet changes size', () => {
    // A design edit of how big things are must never carry the galaxy off with it. Only
    // homeRoom, slotRoom and clusterAxisDeg place a slot; the build checks that they leave room.
    const before = honeycomb(9, slotLimits());
    for (const changes of [
      { dockMin: 7 },
      { dockScale: 1.1 },
      { moonGap: 6 },
      { home: { planetRadius: 16 } },
      { dockMin: 7, home: { planetRadius: 16, stationRadius: 3 } },
      { maxSystemRadius: 340, minSystemGap: 120 },
    ]) {
      withLayout(changes, () => {
        expect(honeycomb(9, slotLimits()), JSON.stringify(changes)).toEqual(before);
        expect(slotRoomProblems(), JSON.stringify(changes)).toEqual([]);
      });
    }
  });

  it('refuses room it does not have, instead of moving a slot', () => {
    // A home system that outgrows its room, or tripwires that ask for bigger systems than the
    // slots were made for, fail the build (data/build.ts); making room moves every system.
    withLayout({ home: { planetRadius: 40 } }, () => {
      const problems = slotRoomProblems();
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/homeRoom is 610 u, but the home system reaches/);
      expect(problems[0]).toMatch(/galaxy\.lock\.json/);
    });
    withLayout({ maxSystemRadius: 400 }, () => {
      const problems = slotRoomProblems();
      expect(problems.some((problem) => /slotRoom is 911 u/.test(problem))).toBe(true);
    });
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
