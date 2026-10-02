import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import type { BodyKind, ManifestBody } from '../src/universe/data/types';
import { buildRocket } from '../src/universe/design/models/rocket';
import { tuning } from '../src/universe/design/tuning';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { MOTION } from '../src/universe/design/worlds/motion';
import { NEAR } from '../src/universe/design/worlds/near';
import { REACH } from '../src/universe/design/worlds/reach';
import { assemble, fineOf, groundDetail } from '../src/universe/sim/world/glue';
import type { GroundLooks } from '../src/universe/sim/world/ground';
import { absentAtRest, drive, type MotionRow } from '../src/universe/sim/world/motion';
import { FLAG, make, type Build, type Pivot } from '../src/universe/sim/world/rows';

// THE REACH OF A WORLD'S SOLID, and the ship's lane through it. The ship flies in the plane y = 0,
// and an emblem world stands out past its radius there: a sign on a mast, a ring, a crane. The
// collision field (sim/surroundings.ts) takes each body's declared reach (design/worlds/reach.ts)
// as its surface, so the ship cannot fly into what is drawn. This measures, headless, the solid
// triangles of every world in the LANE (|y| < 0.3 radii: the ship's own size and a margin; on a
// body so small that this is less than the ship's own band, the band) everywhere they are ever
// drawn: far and near, at rest and at every moment of every motion (at the frame cadence, and
// just before every period ends, where a slide that starts over is furthest out), planned work at
// its maquette's scale; ghost parts (planned work still to come, a blueprint) are not solid and
// are left out. What is measured must be inside what is declared, and what is declared must leave
// the cushion room under the docking ring: (dockRadius - cushion depth) / radius, or the cushion
// would push a ship off its ring.

const LANE = 0.3;
/** The ship's own band: 1 u either side of the plane it flies in (it is 2 u long, and banks). */
const SHIP_BAND_U = 1;
/** A motion is sampled this often (s): a frame at 120 Hz... */
const SAMPLE_SEC = 1 / 120;
/** ...and this long (s) before each of its periods ends. */
const BEFORE_END_SEC = 1e-6;
const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
/** How far the rocket's nose is ahead of its centre, u: what of it meets a part first. */
const NOSE_U = Math.max(...buildRocket().mesh.positions.filter((_, index) => index % 3 === 2));

const real = buildUniverse(readRealInput(true));
const relay = real.bodies.find((body) => body.kind === 'link');

/** The lane, in radii of a body of `radius` u: 0.3 radii, or the ship's own band where wider. */
const laneOfBody = (radius: number): number => Math.max(LANE, SHIP_BAND_U / radius);

/** A body of the real galaxy (a relay still waiting for its URL is sized as the others are). */
function bodyOf(id: string): ManifestBody {
  const body = real.bodies.find((candidate) => candidate.id === id);
  if (body) return body;
  if (id.startsWith('link/') && relay) return { ...relay, id, seed: id };
  throw new Error(`${id} is no body of the real galaxy`);
}

/**
 * How far out (in radii of the rows) a triangle reaches within the lane, or 0 if it misses it. A
 * triangle that reaches no further than `beyond` anywhere is not clipped at all: on a segment, the
 * point furthest from an axis is one of its ends.
 */
function laneReachOf(p: readonly number[], share: number, lane: number, beyond: number): number {
  let most = 0;
  for (let v = 0; v < 3; v += 1) {
    most = Math.max(most, Math.hypot(p[v * 3] ?? NaN, p[v * 3 + 2] ?? NaN) * share);
  }
  if (!(most > beyond)) return 0;
  // Sutherland-Hodgman against y <= lane, then y >= -lane.
  let poly: Vector3[] = [0, 1, 2].map((v) =>
    new Vector3(p[v * 3] ?? NaN, p[v * 3 + 1] ?? NaN, p[v * 3 + 2] ?? NaN).multiplyScalar(share),
  );
  for (const sign of [1, -1]) {
    const inside = (q: Vector3): boolean => sign * q.y <= lane;
    const next: Vector3[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length] as Vector3;
      if (inside(a)) next.push(a);
      if (inside(a) !== inside(b)) {
        const t = (sign * lane - a.y) / (b.y - a.y);
        next.push(a.clone().lerp(b, t));
      }
    });
    poly = next;
    if (poly.length === 0) return 0;
  }
  return Math.max(...poly.map((q) => Math.hypot(q.x, q.z)));
}

const matrixOf = ({ origin, basis }: Pivot): Matrix4 => {
  const [r0, r1, r2] = basis;
  // prettier-ignore
  return new Matrix4().set(
    r0[0], r0[1], r0[2], origin[0],
    r1[0], r1[1], r1[2], origin[1],
    r2[0], r2[1], r2[2], origin[2],
    0, 0, 0, 1,
  );
};

/** A mover's own transform at `time`, as world/BodyMesh.ts sets it (null: not drawn then). */
function moverAt(rows: readonly MotionRow[], time: number): Matrix4 | null {
  const position = new Vector3();
  const rotation = new Euler();
  const scale = new Vector3(1, 1, 1);
  for (const row of rows) {
    const { target, axis, value } = drive(row, time);
    if (target === 'glow') continue;
    if (target === 'scale') {
      if (axis === 'x' || axis === 'y' || axis === 'z') scale[axis] = value;
      else scale.setScalar(value);
    } else if (axis === 'x' || axis === 'y' || axis === 'z') {
      if (target === 'rot') rotation[axis] = value;
      else position[axis] = value;
    }
  }
  if (Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) <= 1e-4) return null;
  return new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * When to look at a part that `rows` move: every SAMPLE_SEC until they all start over together
 * (the least common multiple of their periods), and just before each of their periods ends.
 */
function momentsOf(rows: readonly MotionRow[]): number[] {
  const quarters = rows.map((row) => {
    const period = row[5];
    if (!Number.isInteger(period * 4)) throw new Error(`${row[0]}: a period of ${period} s`);
    return period * 4;
  });
  const together = quarters.reduce((a, b) => (a * b) / gcd(a, b), 1) / 4;
  const moments: number[] = [];
  for (let k = 0; k * SAMPLE_SEC <= together; k += 1) moments.push(k * SAMPLE_SEC);
  for (const row of rows) {
    const [, , , , , period, phase = 0] = row;
    for (let k = 1; ; k += 1) {
      const end = (k - (phase - Math.floor(phase))) * period;
      if (end > together + 1e-9) break;
      if (end > 0) moments.push(end - BEFORE_END_SEC);
    }
  }
  return moments;
}

interface Reach {
  /** The worst reach in the lane anywhere, in the body's radii. */
  readonly worst: number;
  /** What reaches it. */
  readonly by: string;
}

/** Every solid triangle of a build, by the part it belongs to (the ground is ''). */
function solidParts(build: Build): Map<string, (readonly number[])[]> {
  const parts = new Map<string, (readonly number[])[]>([['', build.ground.map((t) => t.p)]]);
  for (const part of build.parts) {
    if (part.flags & FLAG.ghost) continue;
    parts.set(part.name, [...(parts.get(part.name) ?? []), ...part.tris.map((t) => t.p)]);
  }
  return parts;
}

function measure(id: string, laneOf: (radius: number) => number = laneOfBody): Reach {
  const recipe = BODIES[id];
  if (!recipe) throw new Error(`no rows for ${id}`);
  const body = bodyOf(id);
  const kind: BodyKind = body.kind;
  const planned = body.planned === true;
  const share = planned ? tuning.world.plannedScale : 1;
  const lane = laneOf(body.radius);
  const detail = (near: boolean): number => groundDetail(kind, planned, near, tuning.world);
  // As the galaxy builds them (world/BodyMesh.ts): round things with the sides their size wants.
  const fine = (near: boolean) => fineOf(near, false, tuning.world.round);
  const far = make(id, recipe, {
    detail: detail(false),
    seed: body.seed,
    looks: LOOKS,
    fine: fine(false),
  });
  const near = make(id, recipe, {
    detail: detail(true),
    seed: body.seed,
    looks: LOOKS,
    near: NEAR[id] ?? [],
    fine: fine(true),
  });
  const motion = MOTION[id] ?? [];
  const absent = absentAtRest(motion);
  let worst = 0;
  let by = '';
  const moved = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const v = new Vector3();
  const see = (tris: Iterable<readonly number[]>, name: () => string, at?: Matrix4): void => {
    for (const p of tris) {
      let points: readonly number[] = p;
      if (at) {
        for (let k = 0; k < 3; k += 1) {
          v.set(p[k * 3] ?? NaN, p[k * 3 + 1] ?? NaN, p[k * 3 + 2] ?? NaN).applyMatrix4(at);
          moved[k * 3] = v.x;
          moved[k * 3 + 1] = v.y;
          moved[k * 3 + 2] = v.z;
        }
        points = moved;
      }
      const reach = laneReachOf(points, share, lane, worst);
      if (reach > worst) {
        worst = reach;
        by = name();
      }
    }
  };

  // At rest, far and near: everything but what only exists while it plays.
  for (const build of [far, near]) {
    for (const [name, tris] of solidParts(build))
      if (!absent.has(name)) see(tris, () => name || 'ground');
  }

  // Moving, near by (and far off under reduced motion and on the low tier it is the still, above).
  // A glow moves nothing.
  const moving = motion.filter(([, target]) => target !== 'glow');
  if (moving.length > 0) {
    const { movers } = assemble(near, {
      kind,
      still: recipe.still ?? false,
      motion,
      near: true,
      moving: true,
    });
    const parts = solidParts(near);
    const whole = movers[0]?.name === '*' ? movers[0] : undefined;
    const wholeRows = moving.filter(([part]) => part === '*');
    const own = new Set(movers.map((m) => m.name));
    /** The whole body's own transform at `time` (none without one), or null: not drawn then. */
    const wholeAt = (time: number): Matrix4 | null => {
      if (!whole) return new Matrix4();
      const at = moverAt(wholeRows, time);
      if (!at) return null;
      const pivot = matrixOf(whole.pivot);
      return pivot.clone().multiply(at).multiply(pivot.invert());
    };
    for (const mover of movers) {
      if (mover === whole) {
        // Everything of the body that is not a mover of its own rides the whole.
        for (const time of momentsOf(wholeRows)) {
          const frame = wholeAt(time);
          if (!frame) continue;
          for (const [name, tris] of parts) {
            if (own.has(name) || absent.has(name)) continue;
            see(tris, () => `* ${name || 'ground'} at ${time.toFixed(3)} s`, frame);
          }
        }
        continue;
      }
      const tris = parts.get(mover.name);
      if (!tris) continue; // a ghost
      const rows = moving.filter(([part]) => part === mover.name);
      const pivot = matrixOf(mover.pivot);
      const back = pivot.clone().invert();
      // A part's triangles are in the body's frame: into its pivot's, moved, and back.
      for (const time of momentsOf([...rows, ...wholeRows])) {
        const wholeFrame = wholeAt(time);
        const at = moverAt(rows, time);
        if (!wholeFrame || !at) continue;
        const frame = wholeFrame.multiply(pivot).multiply(at).multiply(back);
        see(tris, () => `${mover.name} at ${time.toFixed(3)} s`, frame);
      }
    }
  }
  return { worst, by };
}

/** The most a body may declare: its cushion must fit under its docking ring. */
function capOf(id: string): number {
  const body = bodyOf(id);
  return (body.dockRadius - tuning.cushion.depth) / body.radius;
}

/**
 * The worlds declared at their cap, though they reach further in the lane (design/worlds/reach.ts
 * says why), and what reaches there. None today.
 */
const AT_CAP: Readonly<Record<string, string>> = {};

const MEASURED = new Map(Object.keys(BODIES).map((id) => [id, measure(id)]));

describe('the reach of the emblem worlds', () => {
  it('declares a reach for every body with rows, and for nothing else', () => {
    expect(Object.keys(REACH).sort()).toEqual(Object.keys(BODIES).sort());
  });

  it.each(Object.keys(BODIES).filter((id) => !(id in AT_CAP)))(
    'keeps %s within its declared reach in the lane',
    (id) => {
      const declared = REACH[id] ?? NaN;
      const { worst, by } = MEASURED.get(id) ?? { worst: NaN, by: '' };
      expect(worst, `${id}: ${by}`).toBeLessThanOrEqual(declared);
      // Declared to the hundredth above what is drawn, and never below the radius itself.
      expect(declared, id).toBe(Math.max(1, Math.ceil(worst * 100) / 100));
    },
  );

  it.each(Object.keys(BODIES))('leaves %s room for its cushion under its docking ring', (id) => {
    expect(REACH[id] ?? NaN).toBeLessThanOrEqual(capOf(id) + 1e-9);
  });

  it.each(Object.entries(AT_CAP))(
    'declares %s at its cap, where %s, and keeps all of the ship clear of it',
    (id) => {
      const declared = REACH[id] ?? NaN;
      expect(declared).toBe(Math.floor(capOf(id) * 100 + 1e-9) / 100);
      // Still further in the lane than its cap (or it belongs with the others)...
      expect(MEASURED.get(id)?.worst).toBeGreaterThan(declared);
      // ...but never where any of the ship can be. Its centre is held shellGap outside the
      // declared surface (sim/collide.ts) and its nose is NOSE_U ahead of that, so in the ship's
      // own band nothing may reach past where the nose can come.
      const { radius } = bodyOf(id);
      const band = measure(id, () => SHIP_BAND_U / radius);
      const nose = declared + (tuning.cushion.shellGap - NOSE_U) / radius;
      expect(band.worst, band.by).toBeLessThanOrEqual(nose);
    },
  );

  it('sizes the collision field by the declared reach, rounded up', () => {
    for (const body of real.bodies) {
      const declared = REACH[body.id];
      if (declared === undefined || declared === 1) {
        expect(body.solidRadius, body.id).toBeUndefined();
      } else {
        expect(body.solidRadius, body.id).toBeGreaterThanOrEqual(body.radius * declared - 1e-9);
        expect(body.solidRadius, body.id).toBeLessThan(body.radius * declared + 0.01);
      }
    }
  });
});
