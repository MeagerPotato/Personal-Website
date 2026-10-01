import { describe, expect, it } from 'vitest';
import { tuning } from '../src/universe/design/tuning';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { GEARS, Z } from '../src/universe/design/worlds/gears';
import { MOTION } from '../src/universe/design/worlds/motion';
import { TAU } from '../src/universe/sim/math';
import { groundDetail } from '../src/universe/sim/world/glue';
import { cross, dot, norm, type Vec3 } from '../src/universe/sim/world/kit';
import { fromPivot, make, toPivot, type BuiltPart } from '../src/universe/sim/world/rows';

// THE HARDWARE SUN IS A MACHINE, AND IT MUST NOT JAM. Fourteen gears cover the ball (six cogs on
// the cube's faces, eight pinions on its corners: design/worlds/gears.ts) and every cog meshes
// with four pinions: 24 contacts. This pins what makes that true, on the parts as they are built
// and turned the way world/BodyMesh.ts turns a mover (about its own pivot's y, by the motion
// table's amount): the two gears of a contact turn in opposite senses at the ratio of their teeth,
// a whole tooth a click; all through the click a tooth of one sits in a gap of the other (their
// tooth phases at the contact point add up to half a tooth); and no plate ever lies over its
// neighbour's. A change to a tooth count, the tooth profile, a spin or an amount that would make
// the ball grind fails here, where the golden fingerprint would only say that something moved.

type P2 = readonly [number, number];
const ID = 'system/hardware';
const THETA = Math.acos(1 / Math.sqrt(3)); // a cube-face axis to a cube-corner axis

const recipe = BODIES[ID];
if (!recipe) throw new Error(`no rows for ${ID}`);
const build = make(ID, recipe, {
  detail: groundDetail('sun', false, false, tuning.world),
  looks: { planet: tuning.planet, terrain: tuning.terrain },
});

interface Gear {
  readonly name: string;
  readonly teeth: number;
  readonly part: BuiltPart;
  /** Its axis, out of the ball: its apex sits on the unit sphere on it. */
  readonly axis: Vec3;
  /** What one click turns it by, from the motion table (radians about its own y). */
  readonly click: number;
}
const gears: Gear[] = GEARS.map(([name, kind]) => {
  const part = build.parts.find((candidate) => candidate.name === name);
  const row = (MOTION[ID] ?? []).find(([moved]) => moved === name);
  if (!part || !row) throw new Error(`${name}: a gear needs its part and its motion row`);
  return { name, teeth: Z[kind], part, axis: norm(part.pivot.origin), click: row[4] };
});
const cogs = gears.filter((gear) => gear.teeth === Z.big);
const pinions = gears.filter((gear) => gear.teeth === Z.pin);
const contacts = cogs.flatMap((cog) =>
  pinions
    .filter((pinion) => Math.abs(Math.acos(dot(cog.axis, pinion.axis)) - THETA) < 1e-6)
    .map((pinion) => [cog, pinion] as const),
);

/** A point of the body turned with its gear by `angle`, as BodyMesh turns a mover (`rot y`). */
const turned = (p: Vec3, { part }: Gear, angle: number): Vec3 => {
  const [x, y, z] = toPivot(p, part.pivot);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return fromPivot([c * x + s * z, y, -s * x + c * z], part.pivot);
};

/** Where the two pitch circles of a contact touch, on the unit sphere. */
function touchOf(cog: Gear, pinion: Gear): Vec3 {
  const pitch = Math.atan2(Math.sin(THETA), Z.pin / Z.big + Math.cos(THETA)); // the cog's, as an angle
  const d = dot(cog.axis, pinion.axis);
  const toward = norm([
    pinion.axis[0] - d * cog.axis[0],
    pinion.axis[1] - d * cog.axis[1],
    pinion.axis[2] - d * cog.axis[2],
  ]);
  return [0, 1, 2].map(
    (k) => Math.cos(pitch) * (cog.axis[k] ?? 0) + Math.sin(pitch) * (toward[k] ?? 0),
  ) as unknown as Vec3;
}

/** The contact point's place among a gear's teeth, in teeth, when the gear has turned by `angle`. */
function toothPhase(gear: Gear, touch: Vec3, angle: number): number {
  const [x, , z] = toPivot(turned(touch, gear, -angle), gear.part.pivot);
  return Math.atan2(x, -z) / (TAU / gear.teeth);
}

const area = (poly: readonly P2[]): number =>
  poly.reduce((sum, [x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length] ?? [0, 0];
    return sum + (x * ny - nx * y) / 2;
  }, 0);

/** Sutherland-Hodgman: `subject` clipped to the convex, counter-clockwise `window`. */
function clip(subject: readonly P2[], window: readonly P2[]): P2[] {
  let out = [...subject];
  for (let i = 0; i < window.length && out.length > 0; i += 1) {
    const a = window[i] ?? [0, 0];
    const b = window[(i + 1) % window.length] ?? [0, 0];
    const side = (p: P2): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const next: P2[] = [];
    out.forEach((p, k) => {
      const q = out[(k + 1) % out.length] ?? p;
      const [sp, sq] = [side(p), side(q)];
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    });
    out = next;
  }
  return out;
}

/** A gear's toothed plate (the first four triangles a tooth of its part), turned by `angle`. */
const plateOf = (gear: Gear, angle: number): Vec3[][] =>
  gear.part.tris
    .slice(0, 4 * gear.teeth)
    .map((tri) =>
      [0, 1, 2].map((k) =>
        turned([tri.p[k * 3] ?? 0, tri.p[k * 3 + 1] ?? 0, tri.p[k * 3 + 2] ?? 0], gear, angle),
      ),
    );

/** How much of the two plates of a contact lie over each other, seen from outside at the contact. */
function overlap(cog: Gear, pinion: Gear, u: number): number {
  const touch = touchOf(cog, pinion);
  const ex = norm(cross(cog.axis, touch));
  const ey = cross(touch, ex);
  const flat = (tri: Vec3[]): P2[] => {
    const poly = tri.map((p): P2 => [dot(p, ex), dot(p, ey)]);
    return area(poly) < 0 ? poly.reverse() : poly;
  };
  const centre: P2 = [dot(touch, ex), dot(touch, ey)];
  const near = (poly: readonly P2[]): boolean =>
    poly.some(([x, y]) => Math.hypot(x - centre[0], y - centre[1]) < 0.45);
  const a = plateOf(cog, cog.click * u)
    .map(flat)
    .filter(near);
  const b = plateOf(pinion, pinion.click * u)
    .map(flat)
    .filter(near);
  let total = 0;
  for (const pa of a) {
    for (const pb of b) {
      const both = clip(pa, pb);
      if (both.length >= 3) total += Math.abs(area(both));
    }
  }
  return total;
}

const MOMENTS = Array.from({ length: 41 }, (_, i) => i / 40);

describe('the Hardware sun: a ball of gears that mesh', () => {
  it('is six cogs and eight pinions, every cog on four pinions: 24 contacts, none between equals', () => {
    expect(cogs).toHaveLength(6);
    expect(pinions).toHaveLength(8);
    expect(contacts).toHaveLength(24);
    for (const cog of cogs) {
      expect(contacts.filter(([c]) => c === cog)).toHaveLength(4);
    }
    for (const pinion of pinions) {
      expect(contacts.filter(([, p]) => p === pinion)).toHaveLength(3);
    }
  });

  it('turns meshing gears in opposite senses at the ratio of their teeth, a whole tooth a click', () => {
    for (const [cog, pinion] of contacts) {
      expect(Math.sign(cog.click), `${cog.name}/${pinion.name}`).toBe(-Math.sign(pinion.click));
      expect(Math.abs(cog.click)).toBeCloseTo(TAU / cog.teeth, 12);
      expect(Math.abs(pinion.click)).toBeCloseTo(TAU / pinion.teeth, 12);
      expect(Math.abs(pinion.click / cog.click)).toBeCloseTo(cog.teeth / pinion.teeth, 12);
    }
    const table = MOTION[ID] ?? [];
    expect(new Set(table.map((row) => `${row[1]} ${row[2]} ${row[3]} ${row[5]}`))).toEqual(
      new Set(['rot y step 12']),
    );
  });

  it('keeps a tooth in a gap at every contact, all through the click', () => {
    let worst = 0;
    for (const [cog, pinion] of contacts) {
      const touch = touchOf(cog, pinion);
      for (const u of MOMENTS) {
        const sum =
          toothPhase(cog, touch, cog.click * u) + toothPhase(pinion, touch, pinion.click * u);
        const off = sum - 0.5 - Math.round(sum - 0.5);
        worst = Math.max(worst, Math.abs(off));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('would be tooth on tooth if the pinions turned the cogs’ way: the test can fail', () => {
    const [cog, pinion] = contacts[0] ?? [];
    if (!cog || !pinion) throw new Error('there are contacts');
    const touch = touchOf(cog, pinion);
    const sum =
      toothPhase(cog, touch, cog.click * 0.25) + toothPhase(pinion, touch, -pinion.click * 0.25);
    expect(Math.abs(sum - 0.5 - Math.round(sum - 0.5))).toBeGreaterThan(0.4);
    expect(overlap(cog, { ...pinion, click: -pinion.click }, 0.25)).toBeGreaterThan(1e-3);
  });

  it('never puts one plate over its neighbour’s', () => {
    let worst = 0;
    let where = '';
    for (const [cog, pinion] of contacts) {
      for (const u of MOMENTS) {
        const lapped = overlap(cog, pinion, u);
        if (lapped > worst) [worst, where] = [lapped, `${cog.name}/${pinion.name} at ${u}`];
      }
    }
    expect(worst, where).toBeLessThan(1e-9);
  });
});
