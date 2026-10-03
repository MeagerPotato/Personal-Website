import { describe, expect, it } from 'vitest';
import { buildGalaxy, grow, readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import type { ManifestBody, UniverseManifest } from '../src/universe/data/types';
import { tuning } from '../src/universe/design/tuning';
import {
  boundsOf,
  displayScales,
  fitView,
  pointOn,
  unitsPerPx,
  type MapBounds,
} from '../src/universe/sim/mapView';
import {
  GALAXY,
  PIN_DEPTH,
  markDepth,
  miniBounds,
  pickMini,
  projectMini,
  type MiniBodies,
} from '../src/universe/sim/minimap';
import { bodyPositions, createOrbitTable } from '../src/universe/sim/orbits';
import { createScreenMap, type ScreenMap } from '../src/universe/sim/screen';

// THE MINIMAP IN THE GALAXIES THERE ARE (sim/minimap.ts, wired as ui/MiniMap.ts wires it): the
// real one, read from src/content as the build reads it, the journeys harness's grown ones of 6
// and 8 systems, and the real one pulled out wide and pulled out tall. Whatever the galaxy's
// shape, whatever is fitted (the galaxy, or any one system), at the smallest plate and the
// largest, and wherever the bodies are on their way round:
//
//   every body a ship can dock at in what is fitted is inside the frame, whole;
//   every OTHER system is exactly one mark inside it, in place or pinned at the rim, and a
//   press on that mark means that system: any system is one press away;
//   the ship is on it.
//
// Nothing here pins a number of today's galaxy: content, and the layout, may move every system.

const P = tuning.minimap;
const MOUSE = tuning.picking.mouse;
/** The plate, CSS px: its smallest and its largest. */
const SIZES = [132, 168];
/** Seconds: the bodies are on their way round. */
const TIMES = [0, 137, 4321];
/** The ship keeps its system's scope until it is this many radii out (sim/instruments.ts). */
const { leaveRadii } = tuning.instruments;
/** Two pins at the rim are never closer than this, middle to middle (CSS px): they only touch. */
const PINS_APART = 2 * P.rimRadiusPx;

/** The same galaxy with every system `kx` times as far out along X and `kz` along Z. */
function stretched(manifest: UniverseManifest, kx: number, kz: number): UniverseManifest {
  return {
    ...manifest,
    systems: manifest.systems.map((system) => ({
      ...system,
      position: [system.position[0] * kx, system.position[1] * kz] as const,
    })),
  };
}

const input = readRealInput();
const real = buildUniverse(input);
const GALAXIES: Array<[string, UniverseManifest]> = [
  ['the real galaxy', real],
  ['a galaxy grown to 6 systems', buildGalaxy(grow(input, 6))],
  ['a galaxy grown to 8 systems', buildGalaxy(grow(input, 8))],
  ['the real galaxy, pulled out wide', stretched(real, 4, 1)],
  ['the real galaxy, pulled out tall', stretched(real, 1, 4)],
];

/** A galaxy as the minimap reads it: every array by row of the orbit table. */
function tableOf(manifest: UniverseManifest) {
  const orbits = createOrbitTable(manifest.systems, manifest.bodies);
  const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
  const rows = orbits.ids.map((id): ManifestBody => {
    const body = byId.get(id);
    if (!body) throw new Error(`no body '${id}'`);
    return body;
  });
  /** By system: the row of the body at its heart. */
  const centers = manifest.systems.map((system) => orbits.indexOf(system.center));
  const bodies: MiniBodies = {
    count: orbits.count,
    radius: rows.map((body) => body.solidRadius ?? body.radius),
    depth: rows.map((body) => (body.docks === false ? 0 : markDepth(body.kind))),
    centers,
  };
  const systemOf = rows.map((body) =>
    manifest.systems.findIndex((system) => system.id === body.system),
  );
  return { manifest, orbits, rows, bodies, centers, systemOf, all: boundsOf(manifest.systems) };
}

type Table = ReturnType<typeof tableOf>;

/** The minimap of `scope` with the ship at (x, z), `t` seconds in, on a plate `size` px square. */
function look(table: Table, scope: number, x: number, z: number, size: number, t: number) {
  const { manifest, orbits, rows, bodies, all } = table;
  const frame = { width: size, height: size };
  const positions = bodyPositions(orbits, t, new Float64Array(orbits.count * 2));
  const bounds = miniBounds(scope, manifest.systems, all, x, z, {
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  });
  const view = fitView(bounds, frame, P, { x: 0, z: 0, span: 0 });
  const perPx = unitsPerPx(view.span, frame);
  const sizes = scope === GALAXY ? P.minRadiusPx.galaxy : P.minRadiusPx.system;
  const scales = displayScales(
    {
      count: orbits.count,
      parent: orbits.parent,
      orbitRadius: orbits.radius,
      radius: bodies.radius,
      minRadiusPx: rows.map((body) => sizes[body.kind]),
    },
    perPx,
    1,
    P,
    new Float64Array(orbits.count),
  );
  const map = projectMini(view, frame, positions, bodies, scales, P, createScreenMap(orbits.count));
  const ship = pointOn(view, x, z, frame, new Float64Array(2));
  return {
    map,
    /** Where body `row` really is, CSS px from the MIDDLE of the plate: on it or far off it. */
    truly: (row: number): [number, number] => [
      (view.x - (positions[row * 2] ?? NaN)) / perPx,
      (view.z - (positions[row * 2 + 1] ?? NaN)) / perPx,
    ],
    shipX: size / 2 + (ship[0] ?? NaN),
    shipY: size / 2 + (ship[1] ?? NaN),
  };
}

/** How far inside the frame a point is, CSS px: negative outside it. */
const inside = (x: number, y: number, size: number): number => Math.min(x, size - x, y, size - y);

/** Where the ship may be while a system is the scope: at its heart, at its edge, and as far out as the scope is kept. */
function* placesIn(system: { position: readonly [number, number]; radius: number }) {
  const [cx, cz] = system.position;
  yield [cx, cz] as const;
  for (const out of [1, leaveRadii]) {
    for (let turn = 0; turn < 8; turn += 1) {
      const angle = (turn * Math.PI) / 4;
      yield [
        cx + out * system.radius * Math.sin(angle),
        cz + out * system.radius * Math.cos(angle),
      ] as const;
    }
  }
}

/**
 * Where the ship may be while the galaxy is the scope: at the heart of a system (headed for
 * another), between systems, and out beyond the edge.
 */
function* placesAbout(manifest: UniverseManifest, all: MapBounds) {
  for (const system of manifest.systems) yield system.position;
  const [first, ...others] = manifest.systems;
  for (const other of others) {
    if (!first) continue;
    yield [
      (first.position[0] + other.position[0]) / 2,
      (first.position[1] + other.position[1]) / 2,
    ] as const;
  }
  yield [all.minX - 600, all.minZ - 600] as const;
  yield [all.maxX + 600, (all.minZ + all.maxZ) / 2] as const;
  yield [(all.minX + all.maxX) / 2, all.maxZ + 600] as const;
}

const marks = (map: ScreenMap): number[] =>
  Array.from({ length: map.count }, (_, row) => row).filter((row) => (map.depth[row] ?? 0) > 0);

describe('the galaxies themselves', () => {
  it('come in every shape: about square, wide and tall', () => {
    const shape = (manifest: UniverseManifest): number => {
      const all = boundsOf(manifest.systems);
      return (all.maxX - all.minX) / (all.maxZ - all.minZ);
    };
    expect(shape(stretched(real, 4, 1))).toBeGreaterThan(1.5);
    expect(shape(stretched(real, 1, 4))).toBeLessThan(1 / 1.5);
    // The grown ones really have that many systems: home, and a slot each for the rest (a
    // binary's two suns share theirs).
    const slots = (manifest: UniverseManifest): number => manifest.systems.length;
    expect(slots(buildGalaxy(grow(input, 6)))).toBe(6);
    expect(slots(buildGalaxy(grow(input, 8)))).toBe(8);
  });
});

describe.each(GALAXIES)('the minimap of %s', (_name, manifest) => {
  const table = tableOf(manifest);
  const { rows, bodies, centers, systemOf, all } = table;

  it('shows the whole galaxy from between systems: every sun and home, whole, and the ship', () => {
    for (const size of SIZES) {
      for (const t of TIMES) {
        for (const [x, z] of placesAbout(manifest, all)) {
          const { map, shipX, shipY } = look(table, GALAXY, x, z, size, t);
          const where = `${size} px, t ${t}, ship at ${Math.round(x)}, ${Math.round(z)}`;
          expect(inside(shipX, shipY, size), where).toBeGreaterThanOrEqual(0);
          rows.forEach((body, row) => {
            if ((bodies.depth[row] ?? 0) === 0) return;
            const at = `${body.id}, ${where}`;
            // Every body a ship can dock at is on the plate, whether it is big enough for a mark
            // or not; and nothing is pinned: all of it is there.
            const [mx = NaN, my = NaN] = [map.x[row], map.y[row]];
            expect(inside(mx, my, size), at).toBeGreaterThanOrEqual(0);
            expect(map.depth[row], at).not.toBe(PIN_DEPTH);
            if (body.kind !== 'sun' && body.kind !== 'home') return;
            const radius = map.radius[row] ?? 0;
            expect(radius, at).toBeGreaterThanOrEqual(P.minRadiusPx.galaxy[body.kind] - 1e-9);
            expect(inside(mx, my, size), at).toBeGreaterThanOrEqual(radius);
          });
          // The heart of every system can be pressed.
          for (const row of centers) {
            const [mx = NaN, my = NaN] = [map.x[row], map.y[row]];
            expect(pickMini(map, mx, my, MOUSE, false, P.ambiguityPx), `${row}, ${where}`).toBe(
              row,
            );
          }
        }
      }
    }
  });

  it('shows a system whole from inside it, with every other system one mark at the rim or in place', () => {
    manifest.systems.forEach((system, scope) => {
      for (const size of SIZES) {
        for (const t of TIMES) {
          for (const [x, z] of placesIn(system)) {
            const { map, truly, shipX, shipY } = look(table, scope, x, z, size, t);
            const where = `${system.id}, ${size} px, t ${t}, ship at ${Math.round(x)}, ${Math.round(z)}`;
            expect(inside(shipX, shipY, size), where).toBeGreaterThanOrEqual(0);

            // Every mark is on the plate, and is big enough to see.
            for (const row of marks(map)) {
              const [mx = NaN, my = NaN] = [map.x[row], map.y[row]];
              expect(inside(mx, my, size), `${rows[row]?.id}, ${where}`).toBeGreaterThanOrEqual(0);
              expect(map.radius[row], `${rows[row]?.id}, ${where}`).toBeGreaterThanOrEqual(
                P.minVisiblePx,
              );
            }

            // Its own bodies: on the plate, whole, never pinned; its heart is always a mark.
            rows.forEach((body, row) => {
              if (systemOf[row] !== scope || (bodies.depth[row] ?? 0) === 0) return;
              const at = `${body.id}, ${where}`;
              const [mx = NaN, my = NaN] = [map.x[row], map.y[row]];
              expect(map.depth[row], at).not.toBe(PIN_DEPTH);
              expect(inside(mx, my, size), at).toBeGreaterThanOrEqual(map.radius[row] ?? 0);
            });
            const heart = centers[scope] ?? -1;
            expect(map.depth[heart], where).toBe(markDepth(rows[heart]?.kind ?? 'link'));

            // Every other system: one mark for it, its heart's, in place or pinned at the rim.
            manifest.systems.forEach((other, index) => {
              if (index === scope) return;
              const row = centers[index] ?? -1;
              const at = `${other.id} from ${where}`;
              const [mx = NaN, my = NaN] = [map.x[row], map.y[row]];
              const depth = map.depth[row] ?? 0;
              expect(depth, at).toBeGreaterThan(0);
              expect(inside(mx, my, size), at).toBeGreaterThanOrEqual(P.rimInsetPx - 1e-9);
              if (depth !== PIN_DEPTH) {
                expect(depth, at).toBe(markDepth(rows[row]?.kind ?? 'link'));
                return;
              }
              expect(map.radius[row], at).toBe(P.rimRadiusPx);
              // A pin is on the line from the middle of the plate toward where its heart is...
              const [tx, ty] = truly(row);
              const [px, py] = [mx - size / 2, my - size / 2];
              expect((px * ty - py * tx) / Math.hypot(tx, ty), at).toBeCloseTo(0, 6);
              expect(px * tx + py * ty, at).toBeGreaterThan(0);
              // ...and at the rim, unless the pin of a system before it is in its way there: then
              // it has stepped back until it touches one.
              const gaps = centers
                .slice(0, index)
                .filter((earlier) => map.depth[earlier] === PIN_DEPTH)
                .map((earlier) =>
                  Math.hypot(mx - (map.x[earlier] ?? NaN), my - (map.y[earlier] ?? NaN)),
                );
              const atRim = Math.abs(inside(mx, my, size) - P.rimInsetPx) < 1e-6;
              const touching = Math.abs(Math.min(...gaps) - PINS_APART) < 1e-6;
              expect(atRim || touching, at).toBe(true);
            });
          }
        }
      }
    });
  });

  it('keeps every other system one press away: no pin lies on another', () => {
    manifest.systems.forEach((system, scope) => {
      for (const size of SIZES) {
        for (const t of TIMES) {
          for (const [x, z] of placesIn(system)) {
            const { map } = look(table, scope, x, z, size, t);
            const where = `from ${system.id}, ${size} px, t ${t}, ship at ${Math.round(x)}, ${Math.round(z)}`;
            const place = (row: number): [number, number] => [map.x[row] ?? NaN, map.y[row] ?? NaN];

            const pins = centers.filter((row) => map.depth[row] === PIN_DEPTH);
            pins.forEach((pin, i) => {
              for (const other of pins.slice(i + 1)) {
                const [ax, ay] = place(pin);
                const [bx, by] = place(other);
                expect(
                  Math.hypot(ax - bx, ay - by),
                  `${rows[pin]?.id} and ${rows[other]?.id}, ${where}`,
                ).toBeGreaterThanOrEqual(PINS_APART - 1e-9);
              }
            });

            // A press on the middle of another system's mark means that system; or something
            // smaller that lies on it just now (a planet passing in front of a pin), which is
            // on top by design, and leaves the rest of the mark to press.
            manifest.systems.forEach((other, index) => {
              if (index === scope) return;
              const row = centers[index] ?? -1;
              const picked = pickMini(map, ...place(row), MOUSE, false, P.ambiguityPx);
              expect(
                picked === row || (map.depth[picked] ?? Infinity) < (map.depth[row] ?? 0),
                `${other.id} ${where}: picked ${rows[picked]?.id}`,
              ).toBe(true);
            });
          }
        }
      }
    });
  });
});
