import { describe, expect, it } from 'vitest';
import {
  DISC_SIDES,
  discMesh,
  gridCell,
  PAD_FREE,
  RING_SIDES,
  ringMesh,
  type ChartDisc,
  type ChartPartMesh,
} from './chartMesh';

const discs: readonly ChartDisc[] = [
  { x: 0, z: 0, radius: 66 },
  { x: -488, z: 488, radius: 400 },
  { x: 120, z: -37, radius: 9 },
];

type Point = readonly [x: number, z: number];

/** Where the shader puts every vertex when it asks for `room` world units (shaders/chart.ts). */
function placed(mesh: ChartPartMesh, room: number): Point[] {
  return Array.from(mesh.owners, (_, vertex): Point => {
    const step = Math.min(room, mesh.pads[vertex * 3 + 2] ?? 0);
    return [
      (mesh.positions[vertex * 3] ?? NaN) + (mesh.pads[vertex * 3] ?? NaN) * step,
      (mesh.positions[vertex * 3 + 2] ?? NaN) + (mesh.pads[vertex * 3 + 1] ?? NaN) * step,
    ];
  });
}

const trianglesOf = (mesh: ChartPartMesh): [number, number, number][] =>
  Array.from({ length: mesh.indices.length / 3 }, (_, t) => [
    mesh.indices[t * 3] ?? NaN,
    mesh.indices[t * 3 + 1] ?? NaN,
    mesh.indices[t * 3 + 2] ?? NaN,
  ]);

/** Twice a triangle's area, positive when it faces up (+y) as the chart's plane does. */
function facing(a: Point, b: Point, c: Point): number {
  // The y of (b - a) x (c - a), with z the third axis.
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
}

/** How near the segment from a to b comes to p. */
function nearest(p: Point, a: Point, b: Point): number {
  const [abx, abz] = [b[0] - a[0], b[1] - a[1]];
  const along = ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz || 1);
  const t = Math.min(1, Math.max(0, along));
  return Math.hypot(a[0] + abx * t - p[0], a[1] + abz * t - p[1]);
}

describe('the polygons round the discs', () => {
  it('is a fan a district, facing up, each vertex its district’s own', () => {
    const mesh = discMesh(discs, 1.18);
    expect(mesh.owners).toHaveLength(discs.length * DISC_SIDES);
    expect(mesh.indices).toHaveLength(discs.length * (DISC_SIDES - 2) * 3);
    expect(Array.from(mesh.positions.filter((_, i) => i % 3 === 1))).toEqual(
      Array.from(mesh.owners, () => 0),
    );
    const at = placed(mesh, 0);
    trianglesOf(mesh).forEach(([a, b, c], t) => {
      const district = Math.floor(t / (DISC_SIDES - 2));
      expect([mesh.owners[a], mesh.owners[b], mesh.owners[c]]).toEqual([
        district,
        district,
        district,
      ]);
      expect(facing(at[a] ?? [0, 0], at[b] ?? [0, 0], at[c] ?? [0, 0])).toBeGreaterThan(0);
    });
  });

  it('holds its disc and all the room asked for, at any zoom, and little more', () => {
    for (const room of [0, 1.5, 12, 400]) {
      const at = placed(discMesh(discs, 1.18), room);
      discs.forEach(({ x, z, radius }, d) => {
        const reach = radius * 1.18 + room;
        const corners = at.slice(d * DISC_SIDES, (d + 1) * DISC_SIDES);
        const sides = corners.map((corner, i) =>
          nearest([x, z], corner, corners[(i + 1) % DISC_SIDES] ?? corner),
        );
        // Every side touches the circle and none cuts it (to a 32-bit float's rounding).
        expect(Math.min(...sides)).toBeGreaterThan(reach - 1e-3);
        expect(Math.max(...sides)).toBeLessThan(reach + 1e-3);
        // A corner is under 1% further out.
        for (const corner of corners) {
          expect(Math.hypot(corner[0] - x, corner[1] - z)).toBeLessThan(reach * 1.01);
        }
      });
    }
  });
});

describe('the strips along the rings', () => {
  it('is a closed strip a district, facing up, each vertex its district’s own', () => {
    const mesh = ringMesh(discs);
    expect(mesh.owners).toHaveLength(discs.length * RING_SIDES * 2);
    expect(mesh.indices).toHaveLength(discs.length * RING_SIDES * 6);
    const at = placed(mesh, 3);
    trianglesOf(mesh).forEach(([a, b, c], t) => {
      const district = Math.floor(t / (RING_SIDES * 2));
      expect([mesh.owners[a], mesh.owners[b], mesh.owners[c]]).toEqual([
        district,
        district,
        district,
      ]);
      expect(facing(at[a] ?? [0, 0], at[b] ?? [0, 0], at[c] ?? [0, 0])).toBeGreaterThan(0);
    });
  });

  it('holds every point within the room asked for of its ring', () => {
    for (const room of [0.5, 3, 8]) {
      const at = placed(ringMesh(discs), room);
      discs.forEach(({ x, z, radius }, d) => {
        const corners = at.slice(d * RING_SIDES * 2, (d + 1) * RING_SIDES * 2);
        const inner = corners.filter((_, i) => i % 2 === 0);
        const outer = corners.filter((_, i) => i % 2 === 1);
        // Inner corners stand ON the inner circle: the sides between them run inside it.
        for (const corner of inner) {
          expect(Math.hypot(corner[0] - x, corner[1] - z)).toBeCloseTo(radius - room, 3);
        }
        // Outer sides touch the outer circle and none cuts it.
        const sides = outer.map((corner, i) =>
          nearest([x, z], corner, outer[(i + 1) % RING_SIDES] ?? corner),
        );
        expect(Math.min(...sides)).toBeGreaterThan(radius + room - 1e-3);
        expect(Math.max(...sides)).toBeLessThan(radius + room + 1e-3);
      });
    }
  });

  it('never lies over itself: its triangles add up to the ground between its two edges', () => {
    // Asked for more room than a ring is wide, its inner corners meet in the middle and stay
    // there: a strip turned inside out would lay its paint twice.
    for (const room of [0, 3, 8.99, 9, 50, 1000]) {
      const mesh = ringMesh(discs);
      const at = placed(mesh, room);
      const areas = discs.map(() => 0);
      trianglesOf(mesh).forEach(([a, b, c], t) => {
        const twice = facing(at[a] ?? [0, 0], at[b] ?? [0, 0], at[c] ?? [0, 0]);
        const district = Math.floor(t / (RING_SIDES * 2));
        // No triangle is turned over. (Corners that meet in the middle meet to the rounding of
        // a 32-bit float, a ten-thousandth of a unit: slivers as long as the strip is wide.)
        expect(twice).toBeGreaterThanOrEqual(-1e-4 * ((discs[district]?.radius ?? 0) + room));
        areas[district] = (areas[district] ?? 0) + twice / 2;
      });
      discs.forEach(({ radius }, d) => {
        // Regular polygons: half n r^2 sin(turn / n), the outer one round its circle.
        const polygon = (r: number): number =>
          0.5 * RING_SIDES * r * r * Math.sin((2 * Math.PI) / RING_SIDES);
        const outer = (radius + room) / Math.cos(Math.PI / RING_SIDES);
        const inner = Math.max(0, radius - room);
        const expected = polygon(outer) - polygon(inner);
        // (To the rounding of 32-bit corners: a strip laid twice would be out by all of itself.)
        expect(Math.abs((areas[d] ?? NaN) - expected)).toBeLessThan(expected * 1e-3 + 0.01);
      });
    }
    // Only the inner corners stop anywhere.
    const { pads } = ringMesh(discs);
    const most = Array.from({ length: pads.length / 3 }, (_, vertex) => pads[vertex * 3 + 2]);
    expect(new Set(most.filter((_, i) => i % 2 === 1))).toEqual(new Set([PAD_FREE]));
    expect(most.filter((_, i) => i % 2 === 0)).toEqual(
      discs.flatMap(({ radius }) => Array.from({ length: RING_SIDES }, () => radius)),
    );
    expect(new Set(discMesh(discs, 1.18).pads.filter((_, i) => i % 3 === 2))).toEqual(
      new Set([PAD_FREE]),
    );
  });

  it('is nothing at all for a galaxy with no system', () => {
    expect(ringMesh([]).indices).toHaveLength(0);
    expect(discMesh([], 1.18).indices).toHaveLength(0);
  });
});

describe('the dot grid’s spacing', () => {
  it('is 1, 2 or 5 times a power of ten, as near the spacing asked for as that comes', () => {
    for (let zoom = 0.004; zoom < 400; zoom *= 1.0371) {
      const cell = gridCell(zoom, 34);
      const mantissa = cell / 10 ** Math.floor(Math.log10(cell) + 1e-9);
      expect([1, 2, 5].some((step) => Math.abs(mantissa - step) < 1e-6)).toBe(true);
      expect(cell / (zoom * 34)).toBeGreaterThan(0.57);
      expect(cell / (zoom * 34)).toBeLessThanOrEqual(1.43);
    }
  });

  it('only ever grows as the map pulls out, a step at a time', () => {
    let last = gridCell(0.004, 34);
    for (let zoom = 0.004; zoom < 400; zoom *= 1.0371) {
      const cell = gridCell(zoom, 34);
      expect(cell).toBeGreaterThanOrEqual(last);
      // A step is to the next of 1, 2, 5, 10: never past one (every second or fifth dot goes).
      expect(cell / last).toBeLessThanOrEqual(2.5 + 1e-9);
      last = cell;
    }
  });

  it('is what the shader worked out for itself until 2026-10-03, at every zoom', () => {
    // (shaders/chart.ts did this sum for every pixel; world/Chart.ts now does it once a frame.)
    const before = (unitsPerPx: number, spacingPx: number): number => {
      const spacing = unitsPerPx * spacingPx;
      const decade = 10 ** Math.floor(Math.log(spacing) / 2.302585);
      const m = spacing / decade;
      return decade * (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10);
    };
    for (let zoom = 0.004; zoom < 400; zoom *= 1.0371) {
      expect(gridCell(zoom, 34) / before(zoom, 34)).toBeCloseTo(1, 9);
    }
    // And at the powers of ten themselves, where a logarithm may land on either side.
    for (const spacing of [0.01, 0.1, 1, 10, 100, 1000, 10000]) {
      expect(gridCell(spacing / 34, 34)).toBeCloseTo(spacing, 9);
      expect(gridCell(spacing, 1)).toBe(spacing);
    }
  });

  it('is a number whatever it is asked', () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gridCell(zoom, 34)).toBe(1);
    }
  });
});
