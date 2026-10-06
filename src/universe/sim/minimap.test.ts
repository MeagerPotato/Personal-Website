import { describe, expect, it } from 'vitest';
import type { BodyKind } from '../data/types';
import { tuning } from '../design/tuning';
import { boundsOf, displayScales, fitView, unitsPerPx, type MapBodies } from './mapView';
import {
  GALAXY,
  PIN_DEPTH,
  glyphPath,
  markDepth,
  miniBounds,
  miniScope,
  pickMini,
  projectMini,
  routePoints,
  type MiniBodies,
} from './minimap';
import { createPath } from './path';
import { createScreenMap, type ScreenMap } from './screen';
import { GLYPHS } from './world/glyphs';

const P = tuning.minimap;
const MOUSE = tuning.picking.mouse;
const TOUCH = tuning.picking.touch;
const FRAME = { width: 132, height: 132 };

// A galaxy of two: the home system, and one sun up and to the right of it (as the star map draws
// them: +Z is up, and +X is to the LEFT) with two planets, one of which has a moon.
const SYSTEMS = [
  { position: [0, 0], radius: 66 },
  { position: [-735, 618], radius: 203 },
] as const;
const ALL = boundsOf(SYSTEMS);
const HOME = 0;
const STATION = 1;
const SATELLITE = 2;
const RELAY = 3;
const SUN = 4;
const PLANET = 5;
const MOON = 6;
const OUTER = 7;
const KINDS: readonly BodyKind[] = [
  'home',
  'station',
  'satellite',
  'link',
  'sun',
  'planet',
  'moon',
  'planet',
];
const COUNT = KINDS.length;
const PARENT = [-1, HOME, HOME, HOME, -1, SUN, PLANET, SUN];
const ORBIT = [0, 34, 52, 52, 0, 90, 26, 180];
const RADIUS = [12, 3, 2.5, 2, 20, 6, 2, 8];
// [x, z] by row: the station east of home... the planet 90 u from its sun, its moon north of it.
const POSITIONS = Float64Array.from(
  [
    [0, 0],
    [34, 0],
    [0, -52],
    [-52, 0],
    [-735, 618],
    [-645, 618],
    [-645, 644],
    [-735, 438],
  ].flat(),
);
const BODIES: MiniBodies = {
  count: COUNT,
  radius: RADIUS,
  depth: KINDS.map(markDepth),
  centers: [HOME, SUN],
};

/** The minimap as the engine builds it: fit the scope, size the bodies for it, place the marks. */
function look(scope: number, shipX: number, shipZ: number, frame = FRAME) {
  const bounds = miniBounds(scope, SYSTEMS, ALL, shipX, shipZ, {
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  });
  const view = fitView(bounds, frame, P, { x: 0, z: 0, span: 0 });
  const perPx = unitsPerPx(view.span, frame);
  const sizes = scope === GALAXY ? P.minRadiusPx.galaxy : P.minRadiusPx.system;
  const table: MapBodies = {
    count: COUNT,
    parent: PARENT,
    orbitRadius: ORBIT,
    radius: RADIUS,
    minRadiusPx: KINDS.map((kind) => sizes[kind]),
  };
  const scales = displayScales(table, perPx, 1, P, new Float64Array(COUNT));
  const map = projectMini(view, frame, POSITIONS, BODIES, scales, P, createScreenMap(COUNT));
  return { view, perPx, map };
}

/** The rows that have a mark. */
const marks = (map: ScreenMap): number[] =>
  Array.from({ length: map.count }, (_, row) => row).filter((row) => (map.depth[row] ?? 0) > 0);

const at = (map: ScreenMap, row: number): [number, number] => [
  map.x[row] ?? NaN,
  map.y[row] ?? NaN,
];

/** The disc a square of bounds stands round: its middle and its radius. */
const discOf = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => ({
  x: (b.minX + b.maxX) / 2,
  z: (b.minZ + b.maxZ) / 2,
  r: (b.maxX - b.minX) / 2,
  square: b.maxX - b.minX - (b.maxZ - b.minZ),
});

/** A map of marks put down by hand: [x, y, radius, depth] each. */
function handMap(...rows: Array<[number, number, number, number]>): ScreenMap {
  const map = createScreenMap(rows.length);
  map.count = rows.length;
  rows.forEach(([x, y, radius, depth], row) => {
    map.x[row] = x;
    map.y[row] = y;
    map.radius[row] = radius;
    map.depth[row] = depth;
  });
  return map;
}

describe('what the minimap shows', () => {
  it('is the system the ship is in, and the galaxy between systems', () => {
    expect(miniScope(1, -1)).toBe(1);
    expect(miniScope(0, -1)).toBe(0);
    expect(miniScope(-1, -1)).toBe(GALAXY);
  });

  it('stays on a system while the ship is headed for a body of it, and opens on the galaxy when it leaves for another', () => {
    expect(miniScope(1, 1)).toBe(1);
    expect(miniScope(1, 0)).toBe(GALAXY);
    expect(miniScope(-1, 1)).toBe(GALAXY);
  });

  it('fits a disc: the one that holds every system, or one system’s own, and the ship wherever it is', () => {
    const out = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    // The galaxy: the disc about the middle of its bounds that holds every system whole, given
    // as the square round it.
    const midX = (ALL.minX + ALL.maxX) / 2;
    const midZ = (ALL.minZ + ALL.maxZ) / 2;
    const reach = Math.max(
      ...SYSTEMS.map(({ position: [x, z], radius }) => Math.hypot(x - midX, z - midZ) + radius),
    );
    expect(miniBounds(GALAXY, SYSTEMS, ALL, midX, midZ, out)).toEqual({
      minX: midX - reach,
      maxX: midX + reach,
      minZ: midZ - reach,
      maxZ: midZ + reach,
    });
    // Out beyond it, the ship is still on it: the disc grows toward the ship by half of what is
    // missing, so that the ship stands on its edge and no system leaves it.
    const grown = discOf(miniBounds(GALAXY, SYSTEMS, ALL, 1400, -1300, out));
    expect(grown.square).toBeCloseTo(0, 9);
    expect(Math.hypot(1400 - grown.x, -1300 - grown.z)).toBeCloseTo(grown.r, 9);
    expect(grown.r).toBeGreaterThan(reach);
    for (const { position, radius } of SYSTEMS) {
      const far = Math.hypot(position[0] - grown.x, position[1] - grown.z) + radius;
      expect(far).toBeLessThanOrEqual(grown.r + 1e-9);
    }
    // One system: its own disc.
    expect(miniBounds(1, SYSTEMS, ALL, -735, 618, out)).toEqual({
      minX: -938,
      maxX: -532,
      minZ: 415,
      maxZ: 821,
    });
    // The scope is kept until the ship is 1.3 radii out: it never leaves the face on the way, and
    // the far side of its system stays where it was.
    expect(miniBounds(1, SYSTEMS, ALL, -735 + 264, 618, out)).toEqual({
      minX: -938,
      maxX: -471,
      minZ: 618 - 233.5,
      maxZ: 618 + 233.5,
    });
    expect(miniBounds(0, SYSTEMS, ALL, 0, 0, out)).toEqual({
      minX: -66,
      maxX: 66,
      minZ: -66,
      maxZ: 66,
    });
    // A system the galaxy does not have is no scope: everything, then.
    expect(miniBounds(7, SYSTEMS, ALL, midX, midZ, out)).toEqual({
      minX: midX - reach,
      maxX: midX + reach,
      minZ: midZ - reach,
      maxZ: midZ + reach,
    });
  });
});

describe('where the marks are', () => {
  it('has +Z up and +X to the left, as on the star map', () => {
    const { map, perPx } = look(HOME, 0, 0);
    expect(at(map, HOME)).toEqual([66, 66]);
    // The station is at +X: to the left. The satellite at -Z: below. The relay at -X: right.
    expect(map.x[STATION]).toBeCloseTo(66 - 34 / perPx, 9);
    expect(map.y[STATION]).toBeCloseTo(66, 9);
    expect(map.x[SATELLITE]).toBeCloseTo(66, 9);
    expect(map.y[SATELLITE]).toBeCloseTo(66 + 52 / perPx, 9);
    expect(map.x[RELAY]).toBeGreaterThan(66);
  });

  it('draws only the suns and home from the galaxy', () => {
    const { map } = look(GALAXY, 0, 0);
    expect(marks(map)).toEqual([HOME, SUN]);
    expect(map.radius[HOME]).toBeCloseTo(P.minRadiusPx.galaxy.home, 9);
    expect(map.radius[SUN]).toBeCloseTo(P.minRadiusPx.galaxy.sun, 9);
    expect(map.depth[SUN]).toBe(markDepth('sun'));
    // Home is left of the sun and below it: +X is left, and the sun is further north.
    expect(map.x[HOME]).toBeLessThan(map.x[SUN] ?? NaN);
    expect(map.y[HOME]).toBeGreaterThan(map.y[SUN] ?? NaN);
  });

  it('draws a system’s planets and moons inside it, each no smaller than its kind', () => {
    const { map } = look(1, -735, 618);
    expect(marks(map)).toEqual([HOME, SUN, PLANET, MOON, OUTER]);
    expect(at(map, SUN)).toEqual([66, 66]);
    expect(map.radius[SUN]).toBeCloseTo(P.minRadiusPx.system.sun, 9);
    expect(map.radius[PLANET]).toBeCloseTo(P.minRadiusPx.system.planet, 9);
    expect(map.radius[MOON]).toBeCloseTo(P.minRadiusPx.system.moon, 9);
    expect([map.depth[SUN], map.depth[PLANET], map.depth[MOON]]).toEqual([3, 2, 1]);
  });

  it('never marks a relay: nothing docks at it', () => {
    expect(markDepth('link')).toBe(0);
    for (const scope of [GALAXY, HOME]) {
      const { map } = look(scope, 0, 0);
      expect(map.depth[RELAY], `scope ${scope}`).toBe(0);
      expect(map.radius[RELAY], `scope ${scope}`).toBe(0);
    }
    // The station and the satellite are home's own, and marked from inside its system.
    expect(marks(look(HOME, 0, 0).map)).toEqual([HOME, STATION, SATELLITE, SUN]);
  });

  it('pins a system that is off the face on a circle inside its rim, in its direction', () => {
    // From inside the sun's system, home is far off to the left and below.
    const { map } = look(1, -735, 618);
    expect(map.depth[HOME]).toBe(PIN_DEPTH);
    expect(map.radius[HOME]).toBe(P.rimRadiusPx);
    const [x, y] = at(map, HOME);
    // On the circle rimInsetPx inside the face's edge, on the side it lies...
    expect(Math.hypot(x - 66, y - 66)).toBeCloseTo(66 - P.rimInsetPx, 9);
    expect(x).toBeLessThan(66);
    expect(y).toBeGreaterThan(66);
    // ...on the line from the middle of the face toward where home really is: the view's middle
    // is the sun, at (-735, 618), and home is at (0, 0).
    expect((y - 66) / (x - 66)).toBeCloseTo((618 - 0) / (-735 - 0), 9);
    // Home's own docks are not there: a system off the face is one mark.
    expect(map.depth[STATION]).toBe(0);
    expect(map.depth[SATELLITE]).toBe(0);

    // And from inside home, the sun: up and to the right.
    const home = look(HOME, 0, 0).map;
    const [sx, sy] = at(home, SUN);
    expect(home.depth[SUN]).toBe(PIN_DEPTH);
    expect(Math.hypot(sx - 66, sy - 66)).toBeCloseTo(66 - P.rimInsetPx, 9);
    expect(sx).toBeGreaterThan(66);
    expect(sy).toBeLessThan(66);
    expect(home.depth[PLANET]).toBe(0);
  });

  it('slides a mark to the rim without a jump as the view closes in, whichever way it lies', () => {
    // The body at the heart of a system, a pixel inside the circle of the pins and a pixel
    // outside it.
    const bodies: MiniBodies = { count: 1, radius: [10], depth: [3], centers: [0] };
    const view = { x: 0, z: 0, span: 132 };
    const edge = 66 - P.rimInsetPx;
    const place = (x: number, z = 0): ScreenMap =>
      projectMini(view, FRAME, [x, z], bodies, [1], P, createScreenMap(1));
    const inside = place(edge - 1);
    expect(inside.depth[0]).toBe(3);
    expect(inside.x[0]).toBeCloseTo(66 - (edge - 1), 9);
    const outside = place(edge + 1);
    expect(outside.depth[0]).toBe(PIN_DEPTH);
    expect(outside.x[0]).toBeCloseTo(66 - edge, 9);
    // Dead centre is nobody's direction: no pin, and no division by nothing.
    expect(place(0).depth[0]).toBe(3);
    // The rim is a circle: along a diagonal (-X is right, +Z is up) the step from "in place" to
    // "pinned" comes at the same distance from the middle...
    const near = (edge - 1) / Math.SQRT2;
    const past = (edge + 1) / Math.SQRT2;
    expect(place(-near, near).depth[0]).toBe(3);
    expect(place(-past, past).depth[0]).toBe(PIN_DEPTH);
    // ...and far off along it, the pin is on that circle, up and to the right, at 45 degrees.
    const corner = place(-900, 900);
    expect(corner.x[0]).toBeCloseTo(66 + edge / Math.SQRT2, 9);
    expect(corner.y[0]).toBeCloseTo(66 - edge / Math.SQRT2, 9);
  });

  it('draws nothing beyond the face: the corners of its square are no map', () => {
    // A planet (no system's heart, so never a pin), 10 px in radius at 1 u to the px.
    const bodies: MiniBodies = { count: 1, radius: [10], depth: [1], centers: [] };
    const view = { x: 0, z: 0, span: 132 };
    const place = (x: number, z: number): ScreenMap =>
      projectMini(view, FRAME, [x, z], bodies, [1], P, createScreenMap(1));
    // 60 px out along an axis it is on the face; 60 px out both ways it is in the corner, 85 px
    // from the middle of a face 66 px in radius.
    expect(place(-60, 0).depth[0]).toBe(1);
    expect(place(-60, 60).depth[0]).toBe(0);
    // On the very edge it is still drawn; a hair beyond it, not.
    expect(place(-66, 0).depth[0]).toBe(1);
    expect(place(-66.5, 0).depth[0]).toBe(0);
  });

  it('reads what the tuning must keep true: a pin stands clear of the edge of the galaxy’s view', () => {
    // On the galaxy's view a system at the very edge of the fitted disc stands
    // (R - fitPadPx) / fitMargin from the middle of a face R px in radius; a pin stands at
    // R - rimInsetPx. The pin must be the further out, or a system on the face would be pinned.
    // (R is the smallest face's: the stylesheet's --minimap-size at its least, less 28 px.)
    const smallest = 120 / 2;
    expect(smallest - P.rimInsetPx).toBeGreaterThan((smallest - P.fitPadPx) / P.fitMargin);
  });

  it('queues the pins of systems that lie one behind the other, so that each can be pressed', () => {
    // Three systems off to the right of the view (-X is right), at 1 u to the px: two dead in
    // line, and a third a little below that line.
    const bodies: MiniBodies = {
      count: 3,
      radius: [10, 10, 10],
      depth: [3, 3, 3],
      centers: [0, 1, 2],
    };
    const view = { x: 0, z: 0, span: 132 };
    const edge = 132 - P.rimInsetPx;
    const apart = 2 * P.rimRadiusPx;
    const map = projectMini(
      view,
      FRAME,
      [-500, 0, -1000, 0, -1000, -40],
      bodies,
      [1, 1, 1],
      P,
      createScreenMap(3),
    );
    expect(Array.from(map.depth)).toEqual([PIN_DEPTH, PIN_DEPTH, PIN_DEPTH]);
    expect(Array.from(map.radius)).toEqual([P.rimRadiusPx, P.rimRadiusPx, P.rimRadiusPx]);
    // The first is at the rim. The second has stepped back along the same line until they touch.
    expect(map.x[0]).toBeCloseTo(edge, 9);
    expect(map.y[0]).toBeCloseTo(66, 9);
    expect(map.x[1]).toBeCloseTo(edge - apart, 9);
    expect(map.y[1]).toBeCloseTo(66, 9);
    // The third makes way for both, on its own line (40 down in 1000 across): it touches the
    // second and is clear of the first.
    const [x, y] = at(map, 2);
    expect((y - 66) / (x - 66)).toBeCloseTo(40 / 1000, 9);
    expect(x).toBeLessThan(map.x[1] ?? NaN);
    expect(Math.hypot(x - (map.x[1] ?? NaN), y - (map.y[1] ?? NaN))).toBeCloseTo(apart, 9);
    expect(Math.hypot(x - (map.x[0] ?? NaN), y - (map.y[0] ?? NaN))).toBeGreaterThan(apart);
    // Each is the mark a press on it means.
    for (const row of [0, 1, 2]) {
      expect(pickMini(map, ...at(map, row), MOUSE, false, P.ambiguityPx), `row ${row}`).toBe(row);
    }
  });

  it('keeps a pin on its own line, clear of the pin before it, and at the rim whenever there is room', () => {
    const bodies: MiniBodies = { count: 2, radius: [10, 10], depth: [3, 3], centers: [0, 1] };
    const view = { x: 0, z: 0, span: 132 };
    const reach = 66 - P.rimInsetPx;
    const apart = 2 * P.rimRadiusPx;
    let queued = 0;
    let atRim = 0;
    // The second system swings from dead behind the first to well beside it (down the screen).
    for (let z = 0; z >= -400; z -= 2) {
      const map = projectMini(
        view,
        FRAME,
        [-500, 0, -1000, z],
        bodies,
        [1, 1],
        P,
        createScreenMap(2),
      );
      const [x, y] = at(map, 1);
      const gap = Math.hypot(x - (map.x[0] ?? NaN), y - (map.y[0] ?? NaN));
      const out = Math.hypot(x - 66, y - 66);
      // The first never moves. The second is never on it, never off its own line (-z down in
      // 1000 across), never past the circle of the pins...
      expect(map.x[0], `z ${z}`).toBeCloseTo(66 + reach, 9);
      expect(map.y[0], `z ${z}`).toBeCloseTo(66, 9);
      expect(gap, `z ${z}`).toBeGreaterThanOrEqual(apart - 1e-9);
      expect((y - 66) * 1000, `z ${z}`).toBeCloseTo((x - 66) * -z, 6);
      expect(out, `z ${z}`).toBeLessThanOrEqual(reach + 1e-9);
      // ...and is either on it, or as near it as the first lets it be: touching.
      if (Math.abs(out - reach) < 1e-9) atRim += 1;
      else {
        queued += 1;
        expect(gap, `z ${z}`).toBeCloseTo(apart, 9);
        // It only ever steps back as long as their two places on the circle are too close: the
        // chord between them.
        expect(2 * reach * Math.sin(Math.atan2(-z, 1000) / 2), `z ${z}`).toBeLessThan(apart);
      }
    }
    expect(queued).toBeGreaterThan(50);
    expect(atRim).toBeGreaterThan(100);
  });

  it('never sends a pin past the middle, however many systems are in line', () => {
    // Nine systems dead in line: more pins than the line from the rim to the middle has room for.
    const count = 9;
    const bodies: MiniBodies = {
      count,
      radius: Array.from({ length: count }, () => 10),
      depth: Array.from({ length: count }, () => 3),
      centers: Array.from({ length: count }, (_, row) => row),
    };
    const positions = Array.from({ length: count }, (_, row) => [-500 * (row + 1), 0]).flat();
    const map = projectMini(
      { x: 0, z: 0, span: 132 },
      FRAME,
      positions,
      bodies,
      Array.from({ length: count }, () => 1),
      P,
      createScreenMap(count),
    );
    for (let row = 0; row < count; row += 1) {
      expect(map.depth[row], `row ${row}`).toBe(PIN_DEPTH);
      expect(map.y[row], `row ${row}`).toBeCloseTo(66, 9);
      // In a queue from the rim inward, a pin's width apart, until the middle: there they stay.
      expect(map.x[row], `row ${row}`).toBeCloseTo(
        Math.max(66, 132 - P.rimInsetPx - row * 2 * P.rimRadiusPx),
        9,
      );
    }
  });

  it('fits a frame of any shape: the face is the disc in the middle of it', () => {
    for (const frame of [
      { width: 120, height: 120 },
      { width: 156, height: 156 },
      { width: 200, height: 120 },
      { width: 120, height: 200 },
    ]) {
      const { map } = look(1, -735, 618, frame);
      const face = Math.min(frame.width, frame.height) / 2;
      const out = (x: number, y: number): number =>
        Math.hypot(x - frame.width / 2, y - frame.height / 2);
      for (const row of [SUN, PLANET, MOON, OUTER]) {
        const [x, y] = at(map, row);
        const radius = map.radius[row] ?? 0;
        expect(radius, `row ${row}`).toBeGreaterThan(0);
        expect(out(x, y) + radius, `row ${row}`).toBeLessThanOrEqual(face);
      }
      const [x, y] = at(map, HOME);
      expect(map.depth[HOME]).toBe(PIN_DEPTH);
      expect(out(x, y)).toBeCloseTo(face - P.rimInsetPx, 9);
    }
  });
});

describe('what a pointer aims at', () => {
  it('is what is drawn, no more and no less', () => {
    for (const [scope, x, z] of [
      [GALAXY, 0, 0],
      [HOME, 0, 0],
      [1, -735, 618],
    ] as const) {
      const { map } = look(scope, x, z);
      for (let row = 0; row < COUNT; row += 1) {
        const drawn = (map.depth[row] ?? 0) > 0;
        expect((map.radius[row] ?? 0) >= P.minVisiblePx, `scope ${scope}, row ${row}`).toBe(drawn);
        const picked = pickMini(map, ...at(map, row), MOUSE, false, P.ambiguityPx);
        if (drawn) expect(picked, `scope ${scope}, row ${row}`).toBe(row);
        else expect(picked, `scope ${scope}, row ${row}`).not.toBe(row);
      }
    }
  });

  it('lets a mouse 12 px from a mark pick it, and no further', () => {
    const { map } = look(1, -735, 618);
    const [x, y] = at(map, OUTER);
    expect(pickMini(map, x + 12, y, MOUSE, false, P.ambiguityPx)).toBe(OUTER);
    expect(pickMini(map, x, y + 12, MOUSE, false, P.ambiguityPx)).toBe(OUTER);
    expect(pickMini(map, x + 12.5, y, MOUSE, false, P.ambiguityPx)).toBe(-1);
    // A system pinned at the rim is a mark like any other: pressing it flies to its heart.
    const [pinX, pinY] = at(map, HOME);
    expect(pickMini(map, pinX - 3, pinY, MOUSE, false, P.ambiguityPx)).toBe(HOME);
  });

  it('lets a finger pick the mark it is on, and neither of two it is between', () => {
    const { map } = look(1, -735, 618);
    const [x, y] = at(map, PLANET);
    const [, moonY] = at(map, MOON);
    // The planet and its moon are 7 px apart. On the planet: the planet. On the moon: the moon.
    expect(pickMini(map, x, y, TOUCH, true, P.ambiguityPx)).toBe(PLANET);
    expect(pickMini(map, x, moonY, TOUCH, true, P.ambiguityPx)).toBe(MOON);
    // Between them a finger means either: nothing is aimed at. (A mouse there has the nearer.)
    const between = (y + moonY) / 2 - 0.5;
    expect(pickMini(map, x, between, TOUCH, true, P.ambiguityPx)).toBe(-1);
    expect(pickMini(map, x, between, MOUSE, false, P.ambiguityPx)).toBe(MOON);
    // Beside the outer planet there is nothing else within a finger's reach: it is meant.
    const [outerX, outerY] = at(map, OUTER);
    expect(pickMini(map, outerX + 15, outerY, TOUCH, true, P.ambiguityPx)).toBe(OUTER);
    expect(pickMini(map, outerX + 23, outerY, TOUCH, true, P.ambiguityPx)).toBe(-1);
  });

  it('gives a finger the nearer of two marks only when it is clearly the nearer', () => {
    // Two planets 24 px apart, both within a finger's reach (22 px) of anything between them.
    const map = handMap([40, 60, 2.5, 2], [64, 60, 2.5, 2]);
    // 4 px from the first's middle and 20 from the second's: 16 px nearer. The first.
    expect(pickMini(map, 44, 60, TOUCH, true, P.ambiguityPx)).toBe(0);
    // 8 px nearer is just enough...
    expect(pickMini(map, 48, 60, TOUCH, true, P.ambiguityPx)).toBe(0);
    // ...6 px is not, and half way between the finger means neither.
    expect(pickMini(map, 49, 60, TOUCH, true, P.ambiguityPx)).toBe(-1);
    expect(pickMini(map, 52, 60, TOUCH, true, P.ambiguityPx)).toBe(-1);
    expect(pickMini(map, 55, 60, TOUCH, true, P.ambiguityPx)).toBe(-1);
    // The same finger with nothing to mix it up with (the other is where the ship is going).
    expect(pickMini(map, 49, 60, TOUCH, true, P.ambiguityPx, 1)).toBe(0);
    // A mouse has a point, not a pad: the nearer one, however little nearer.
    expect(pickMini(map, 49, 60, MOUSE, false, P.ambiguityPx)).toBe(0);
    expect(pickMini(map, 55, 60, MOUSE, false, P.ambiguityPx)).toBe(1);
  });

  it('never picks the row to ignore: where the ship is, or is going', () => {
    const { map } = look(1, -735, 618);
    const [x, y] = at(map, OUTER);
    expect(pickMini(map, x, y, MOUSE, false, P.ambiguityPx, OUTER)).toBe(-1);
    expect(pickMini(map, x, y, TOUCH, true, P.ambiguityPx, OUTER)).toBe(-1);
    // On the sun's own mark with the sun ignored, the planet beside it is still out of reach.
    const [sunX, sunY] = at(map, SUN);
    expect(pickMini(map, sunX, sunY, MOUSE, false, P.ambiguityPx, SUN)).toBe(-1);
  });

  it('gives the smaller mark where two overlap: a planet on its sun’s disc, a moon on its planet’s', () => {
    // A sun, a planet whose mark lies on the sun's, and a moon on the planet's.
    const map = handMap([60, 60, 5.5, 3], [64, 60, 2.5, 2], [66, 60, 1.75, 1]);
    for (const coarse of [false, true]) {
      const reach = coarse ? TOUCH : MOUSE;
      expect(pickMini(map, 58, 60, reach, coarse, P.ambiguityPx), `${coarse}`).toBe(0);
      expect(pickMini(map, 63, 60, reach, coarse, P.ambiguityPx), `${coarse}`).toBe(1);
      expect(pickMini(map, 66.5, 60, reach, coarse, P.ambiguityPx), `${coarse}`).toBe(2);
    }
    // A system pinned at the rim lies under everything that is really there.
    const rim = handMap([125, 60, P.rimRadiusPx, PIN_DEPTH], [123, 60, 2.5, 2]);
    expect(pickMini(rim, 124, 60, MOUSE, false, P.ambiguityPx)).toBe(1);
  });
});

describe('the rest of a journey', () => {
  /** A path of `count` samples along a line: sample i is at (i, 2i). */
  function line(count: number) {
    const path = createPath();
    path.count = count;
    for (let i = 0; i < count; i += 1) {
      path.x[i] = i;
      path.z[i] = 2 * i;
    }
    return path;
  }

  it('starts where the ship is and ends on the path’s end, in at most as many points as asked', () => {
    const out = new Float64Array(64);
    const count = routePoints(line(100), 10, P.routePoints, out);
    expect(count).toBe(32);
    expect([out[0], out[1]]).toEqual([10, 20]);
    expect([out[62], out[63]]).toEqual([99, 198]);
    // In order, and evenly: never more than three samples on from the one before.
    for (let k = 1; k < count; k += 1) {
      const step = (out[k * 2] ?? NaN) - (out[k * 2 - 2] ?? NaN);
      expect(step, `point ${k}`).toBeGreaterThanOrEqual(2);
      expect(step, `point ${k}`).toBeLessThanOrEqual(3);
    }
  });

  it('takes every sample when few are left, and draws no line from the last one', () => {
    const out = new Float64Array(64);
    expect(routePoints(line(100), 95, 32, out)).toBe(5);
    expect(Array.from(out.subarray(0, 10))).toEqual([95, 190, 96, 192, 97, 194, 98, 196, 99, 198]);
    expect(routePoints(line(100), 99, 32, out)).toBe(1);
    expect(routePoints(line(100), 100, 32, out)).toBe(0);
    expect(routePoints(line(0), 0, 32, out)).toBe(0);
    // No more points than the caller has room for.
    expect(routePoints(line(100), 0, 32, new Float64Array(8))).toBe(4);
    expect(routePoints(line(100), -5, 2, out)).toBe(2);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, 0, 99, 198]);
  });
});

describe('a family’s glyph, as a path', () => {
  it('closes, stands apex up, and keeps to its size', () => {
    for (const theme of Object.keys(GLYPHS) as Array<keyof typeof GLYPHS>) {
      // (Home's circle is drawn as one: below.)
      if (theme === 'butter') continue;
      const d = glyphPath(theme, 5.5);
      expect(d, theme).toMatch(/^M-?[\d.]+ -?[\d.]+(L-?[\d.]+ -?[\d.]+){2,}Z$/);
      const numbers = (d.match(/-?[\d.]+/g) ?? []).map(Number);
      expect(numbers.length, theme).toBe(GLYPHS[theme](5.5).length * 2);
      for (const value of numbers) expect(Math.abs(value), theme).toBeLessThanOrEqual(5.5 * 1.2);
    }
    // Research's triangle points up the screen (north), as on the star map; +X is to the left.
    expect(glyphPath('mint', 10)).toBe('M0 -10L-9.3 7.5L9.3 7.5Z');
    // Hardware's square, and a size of nothing.
    expect(glyphPath('coral', 10)).toBe('M8.2 8.2L-8.2 8.2L-8.2 -8.2L8.2 -8.2Z');
    expect(glyphPath('coral', 0)).toBe('M0 0L0 0L0 0L0 0Z');
    // Home's circle: two half turns, from the top round to the top.
    expect(glyphPath('butter', 5.5)).toBe('M0 -5.5A5.5 5.5 0 1 0 0 5.5A5.5 5.5 0 1 0 0 -5.5Z');
    expect(glyphPath('butter', 0)).toBe('M0 0A0 0 0 1 0 0 0A0 0 0 1 0 0 0Z');
  });
});
