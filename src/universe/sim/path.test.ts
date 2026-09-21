import { describe, expect, it } from 'vitest';
import { PATH_SAMPLES, createPath, planPath, pointAlong, type Disc, type Path } from './path';
import { createRng } from './rng';

const PARAMS = { sampleStep: 4, clearance: 1.15, leadSec: 0.5, corridor: 6, squeeze: 0.6 };

const plan = (x0: number, z0: number, x1: number, z1: number, discs: Disc[] = []): Path =>
  planPath(createPath(), x0, z0, x1, z1, discs, discs.length, PARAMS);

/** The closest the path comes to the centre of `disc`, in disc radii. */
function closest(path: Path, disc: Disc): number {
  let best = Infinity;
  for (let i = 0; i < path.count; i += 1) {
    best = Math.min(best, Math.hypot((path.x[i] ?? 0) - disc.x, (path.z[i] ?? 0) - disc.z));
  }
  return best / disc.r;
}

describe('planPath', () => {
  it('is a straight line when nothing is in the way', () => {
    const path = plan(10, -20, 310, 380);
    expect(path.length).toBeCloseTo(500, 9);
    expect(path.cornerCount).toBe(2);
    expect(path.count).toBe(126); // every 4 u, both ends included
    expect([path.x[0], path.z[0]]).toEqual([10, -20]);
    expect(path.x[path.count - 1]).toBeCloseTo(310, 9);
    expect(path.z[path.count - 1]).toBeCloseTo(380, 9);
    expect(Math.max(...path.curvature.subarray(0, path.count))).toBeLessThan(1e-9);
    // Distance along the path grows by the step, to the end.
    expect(path.s[1]).toBeCloseTo(4, 9);
    expect(path.s[path.count - 1]).toBe(path.length);
  });

  it('goes round a body in the way, on the side the line already leaned to', () => {
    const sun = { x: 250, z: 10, r: 42 };
    const path = plan(0, 0, 500, 0, [sun]);
    expect(closest(path, sun)).toBeGreaterThan(1);
    expect(path.cornerCount).toBeGreaterThanOrEqual(3);
    // The sun lies a little to the +z side of the line, so the way round is on the -z side.
    const middle = pointAlong(path, path.length / 2, 0, new Float64Array(2));
    expect(path.z[middle]).toBeLessThan(-30);
    // A detour, not an excursion.
    expect(path.length).toBeGreaterThan(500);
    expect(path.length).toBeLessThan(530);
  });

  it('picks a side when the body sits exactly on the line', () => {
    const sun = { x: 250, z: 0, r: 42 };
    const path = plan(0, 0, 500, 0, [sun]);
    expect(closest(path, sun)).toBeGreaterThan(1);
  });

  it('leaves alone what is merely near the line', () => {
    const path = plan(0, 0, 500, 0, [{ x: 250, z: 60, r: 42 }]);
    expect(path.cornerCount).toBe(2);
    expect(path.length).toBeCloseTo(500, 9);
  });

  it('finds a way through a row of bodies, and round a way round that lands in another', () => {
    const discs = [
      { x: 200, z: 0, r: 40 },
      { x: 200, z: -75, r: 30 }, // just where the way round the first would go
      { x: 420, z: 15, r: 50 },
      { x: 640, z: -10, r: 35 },
    ];
    const path = plan(0, 0, 900, 0, discs);
    for (const disc of discs) expect(closest(path, disc)).toBeGreaterThan(1);
    expect(path.length).toBeLessThan(900 * 1.25);
  });

  it('leaving an orbit, keeps off the body itself though it starts inside its keep-out', () => {
    // On a ring 22.8 u from a planet whose keep-out is 26.8 u; the goal is straight through it.
    const planet = { x: 0, z: 0, r: 26.8 };
    const path = plan(22.8, 0, -400, 5, [planet]);
    // The body is at most half of its docking ring (manifest: ring = R + max(6, 0.9 R)).
    expect(closest(path, planet) * planet.r).toBeGreaterThan(22.8 * 0.6);
  });

  it('arriving at a moon, keeps off its planet though the goal lies inside the keep-out', () => {
    const planet = { x: 0, z: 0, r: 26.8 };
    const path = plan(300, 0, -24, 3, [planet]);
    expect(closest(path, planet) * planet.r).toBeGreaterThan(24 * 0.6);
  });

  it('keeps clear of everything in 300 random skies, and never wanders', () => {
    const rng = createRng('paths');
    const range = (from: number, to: number): number => from + (to - from) * rng();
    let detours = 0;
    let wanderers = 0;
    for (let run = 0; run < 300; run += 1) {
      const x1 = range(300, 1500);
      const discs: Disc[] = [];
      for (let k = Math.floor(range(1, 9)); k > 0; k -= 1) {
        const r = range(8, 60);
        const disc = { x: range(r + 40, x1 - r - 40), z: range(-150, 150), r };
        // Bodies may touch and overlap a little (a moon and its planet do), but not pile up.
        const crowded = discs.some(
          (other) => Math.hypot(other.x - disc.x, other.z - disc.z) < (other.r + r) * 0.8,
        );
        if (!crowded) discs.push(disc);
      }
      const path = plan(0, 0, x1, range(-60, 60), discs);
      if (path.cornerCount > 2) detours += 1;
      discs.forEach((disc, k) => {
        // Discs that crowd each other give way to leave a corridor, but only so far.
        const kept = path.keeps[k] ?? 0;
        expect(kept, `run ${run}`).toBeGreaterThanOrEqual(disc.r * PARAMS.squeeze - 1e-9);
        expect(kept, `run ${run}`).toBeLessThanOrEqual(disc.r);
        expect(closest(path, disc) * disc.r, `run ${run}`).toBeGreaterThan(kept - 0.26);
      });
      if (path.length > Math.hypot(x1, 60) * 1.25) wanderers += 1;
    }
    expect(detours).toBeGreaterThan(100);
    // Going round a whole cluster is sometimes the way; it must stay the exception.
    expect(wanderers).toBeLessThan(10);
  });

  it('gives up on a wall of bodies and flies straight, rather than tie itself in knots', () => {
    // The goal is ringed in completely, by bodies that all but touch: there IS no way.
    const wall: Disc[] = [];
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2;
      wall.push({ x: 400 + 80 * Math.sin(a), z: 80 * Math.cos(a), r: 45 });
    }
    const path = plan(0, 0, 400, 0, wall);
    expect(path.cornerCount).toBe(2);
    expect(path.length).toBeCloseTo(400, 9);
  });

  it('fits any journey into its buffers by taking longer steps', () => {
    const path = plan(-3000, -2500, 3200, 2900, [{ x: 0, z: 0, r: 80 }]);
    expect(path.count).toBeLessThanOrEqual(PATH_SAMPLES);
    expect(path.count).toBeGreaterThan(PATH_SAMPLES * 0.8);
    expect(path.x[path.count - 1]).toBeCloseTo(3200, 6);
    expect(path.s[1]).toBeGreaterThan(4);
  });

  it('plans into the same path again without leaving anything of the old one', () => {
    const path = createPath();
    planPath(path, 0, 0, 900, 0, [{ x: 450, z: 0, r: 50 }], 1, PARAMS);
    planPath(path, 0, 0, 40, 0, [], 0, PARAMS);
    expect(path.count).toBe(11);
    expect(path.cornerCount).toBe(2);
    expect(path.length).toBeCloseTo(40, 9);
  });
});

describe('planning again', () => {
  it('from further along the path, finds the rest of the same path', () => {
    const rng = createRng('again');
    const range = (from: number, to: number): number => from + (to - from) * rng();
    const out = new Float64Array(2);
    let detours = 0;
    for (let run = 0; run < 100; run += 1) {
      const discs: Disc[] = [];
      for (let k = 0; k < 6; k += 1) {
        discs.push({ x: range(150, 850), z: range(-120, 120), r: range(15, 55) });
      }
      const walls = new Float64Array(discs.length * 2);
      const first = planPath(createPath(), 0, 0, 1000, 0, discs, discs.length, PARAMS, walls);
      if (first.cornerCount > 2) detours += 1;
      // A quarter of the way along, outside every keep-out: where a ship might be a second later.
      const along = first.length / 4;
      pointAlong(first, along, 0, out);
      if (
        discs.some((disc) => Math.hypot((out[0] ?? 0) - disc.x, (out[1] ?? 0) - disc.z) < disc.r)
      ) {
        continue;
      }
      const again = planPath(
        createPath(),
        out[0] ?? 0,
        out[1] ?? 0,
        1000,
        0,
        discs,
        discs.length,
        PARAMS,
        walls,
      );
      // The same way: what is left of it, give or take how a curve rounds a different first corner.
      expect(Math.abs(again.length - (first.length - along)), `run ${run}`).toBeLessThan(8);
    }
    expect(detours).toBeGreaterThan(50);
  });

  it('keeps to the side it passed a body on, unless the other side is MUCH the shorter', () => {
    const walls = new Float64Array(2);
    const side = (path: Path): number => {
      const middle = pointAlong(path, path.length / 2, 0, new Float64Array(2));
      return Math.sign(path.z[middle] ?? 0);
    };
    const at = (z: number): Disc[] => [{ x: 150, z, r: 80 }];

    // The body leans to -z, so the way round is on the +z side, and that is remembered.
    expect(side(planPath(createPath(), 0, 0, 300, 0, at(-5), 1, PARAMS, walls))).toBe(1);
    expect(Math.hypot(walls[0] ?? 0, walls[1] ?? 0)).toBeCloseTo(1, 9);
    expect(walls[1]).toBeLessThan(-0.9); // the wall stands on the far side from the path: -z

    // It drifts across the line. Someone who has never been here would now go round by -z...
    expect(side(planPath(createPath(), 0, 0, 300, 0, at(5), 1, PARAMS))).toBe(-1);
    // ...but a ship on its way does not change sides for a few units' gain.
    expect(side(planPath(createPath(), 0, 0, 300, 0, at(5), 1, PARAMS, walls))).toBe(1);
    // When staying costs far more than changing, it changes.
    expect(side(planPath(createPath(), 0, 0, 300, 0, at(75), 1, PARAMS, walls))).toBe(-1);
    expect(walls[1]).toBeGreaterThan(0.9);
  });

  it('remembers the side of a body it wraps half round, too', () => {
    // From one side of the body to the other: the path sweeps half a turn round it.
    const body = [{ x: 100, z: 0, r: 50 }];
    const walls = new Float64Array(2);
    const path = planPath(createPath(), 30, 0, 170, 8, body, 1, PARAMS, walls);
    const middle = pointAlong(path, path.length / 2, 0, new Float64Array(2));
    const went = Math.sign(path.z[middle] ?? 0);
    expect(closest(path, body[0] as Disc)).toBeGreaterThan(1);
    // The wall stands opposite the MIDDLE of the wrap, not opposite its nearest point.
    expect(Math.abs(walls[0] ?? 0)).toBeLessThan(0.25);
    expect(Math.sign(walls[1] ?? 0)).toBe(-went);
  });
});

describe('a moving ship', () => {
  const moving = (vx: number, vz: number, x1: number, z1: number, discs: Disc[] = []): Path =>
    planPath(createPath(), 0, 0, x1, z1, discs, discs.length, PARAMS, null, vx, vz);

  it('begins its path the way it is going, for half a second of travel', () => {
    const path = moving(100, 0, 0, 500);
    expect(path.cornerCount).toBe(3);
    expect([path.corners[2], path.corners[3]]).toEqual([50, 0]);
    // It sets out along +x, though the goal lies along +z.
    expect(path.x[1]).toBeGreaterThan(3.5);
    expect(Math.abs(path.z[1] ?? 1)).toBeLessThan(0.5);
  });

  it('going the wrong way, gets a hairpin: somewhere to brake, then back', () => {
    const path = moving(-100, 0, 500, 0);
    expect([path.corners[2], path.corners[3]]).toEqual([-50, 0]);
    expect(path.length).toBeGreaterThan(590);
    expect(Math.max(...path.curvature.subarray(0, path.count))).toBeGreaterThan(0.1);
  });

  it('gets a shorter run-up when a body lies ahead, and none when it is slow', () => {
    // 50 u ahead would end inside the body's keep-out; 25 u does not.
    const ahead = moving(100, 0, 0, 500, [{ x: 60, z: 0, r: 20 }]);
    expect([ahead.corners[2], ahead.corners[3]]).toEqual([25, 0]);
    // A slow ship goes where its pilot points it: no run-up.
    expect(moving(10, 0, 0, 500).cornerCount).toBe(2);
    // Nor when a body is right in front of it.
    const blocked = moving(100, 0, 0, 500, [{ x: 28, z: 0, r: 20 }]);
    expect(blocked.corners[2]).not.toBe(25);
    expect(closest(blocked, { x: 28, z: 0, r: 20 })).toBeGreaterThan(0.3);
  });

  it('never runs up more than half the way to the goal', () => {
    const path = moving(100, 0, 30, 0);
    expect([path.corners[2], path.corners[3]]).toEqual([15, 0]);
  });
});

describe('bodies that crowd each other', () => {
  it('always leave a corridor between them: no gap is ever planned shut', () => {
    // Two keep-outs that touch. The line between them used to be a wall.
    const pair = [
      { x: 200, z: 30, r: 30 },
      { x: 200, z: -30, r: 30 },
    ];
    const path = plan(0, 0, 400, 0, pair);
    expect(path.cornerCount).toBe(2);
    expect(path.length).toBeCloseTo(400, 9);
    // Both gave way by the same share, just enough for a corridor of 6 u between their sights.
    expect(path.keeps[0]).toBeCloseTo(path.keeps[1] ?? 0, 9);
    const sight = (path.keeps[0] ?? 0) * (1 + (PARAMS.clearance - 1) / 3);
    expect(60 - 2 * sight).toBeCloseTo(PARAMS.corridor, 6);
  });

  it('give way in proportion to their size, and only so far', () => {
    const big = { x: 200, z: 40, r: 60 };
    const small = { x: 200, z: -35, r: 15 };
    const path = plan(0, 0, 400, 0, [big, small]);
    expect((path.keeps[0] ?? 0) / big.r).toBeCloseTo((path.keeps[1] ?? 0) / small.r, 9);
    expect(path.keeps[0]).toBeLessThan(big.r);

    // All but on top of each other: they give way as far as they may, and the way leads round.
    const close = [
      { x: 200, z: 15, r: 30 },
      { x: 200, z: -15, r: 30 },
    ];
    const round = plan(0, 0, 400, 0, close);
    expect(round.keeps[0]).toBeCloseTo(30 * PARAMS.squeeze, 9);
    expect(round.cornerCount).toBeGreaterThan(2);
    for (const disc of close) expect(closest(round, disc) * disc.r).toBeGreaterThan(18 - 0.26);
  });

  it('are left whole when there is room enough between them', () => {
    const pair = [
      { x: 200, z: 60, r: 30 },
      { x: 200, z: -60, r: 30 },
    ];
    const path = plan(0, 0, 400, 0, pair);
    expect([path.keeps[0], path.keeps[1]]).toEqual([30, 30]);
  });
});

describe('an end of the path inside a keep-out', () => {
  it('lets only the leg that begins there cut that keep-out: every other leg respects it whole', () => {
    // On a sun's docking ring, the goal on the far side: the way wraps round the sun. Only the
    // first leg may be inside the keep-out; the wrap itself stays outside ALL of it.
    const sun = { x: 0, z: 0, r: 42 };
    const path = plan(-38, 0, 400, 10, [sun]);
    let inside = 0;
    for (let i = 0; i < path.count; i += 1) {
      const d = Math.hypot(path.x[i] ?? 0, path.z[i] ?? 0);
      if (d < sun.r - 0.26) {
        inside += 1;
        expect(path.legOf[i]).toBe(0);
      }
      // And it never goes deeper in than it started.
      expect(d).toBeGreaterThan(38 * 0.9);
    }
    expect(inside).toBeGreaterThan(0);
  });
});

describe('pointAlong', () => {
  it('finds the point at a distance along the path, and stops at the ends', () => {
    const path = plan(0, 0, 100, 0);
    const out = new Float64Array(2);
    pointAlong(path, 37.5, 0, out);
    expect(out[0]).toBeCloseTo(37.5, 9);
    expect(out[1]).toBeCloseTo(0, 9);
    pointAlong(path, 500, 0, out);
    expect(out[0]).toBeCloseTo(100, 9);
    pointAlong(path, -5, 0, out);
    expect(out[0]).toBeCloseTo(0, 9);
    // From a sample further on it never looks back.
    expect(pointAlong(path, 37.5, 20, out)).toBe(20);
  });
});
