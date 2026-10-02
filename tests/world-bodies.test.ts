import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import type { BodyKind } from '../src/universe/data/types';
import { tuning } from '../src/universe/design/tuning';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { MOTION } from '../src/universe/design/worlds/motion';
import { NEAR } from '../src/universe/design/worlds/near';
import {
  assemble,
  callsOf,
  groundDetail,
  type Assembly,
  type Mover,
} from '../src/universe/sim/world/glue';
import { groundLook, type GroundLooks, type GroundSpec } from '../src/universe/sim/world/ground';
import { centroidOf, corner, mulM, rotm, type Vec3 } from '../src/universe/sim/world/kit';
import { absentAtRest, drive, type MotionRow } from '../src/universe/sim/world/motion';
import { colorOf } from '../src/universe/sim/world/palette';
import {
  FLAG,
  fromPivot,
  make,
  rowsOf,
  trianglesOf,
  type BodyRecipe,
  type Build,
  type Hull,
} from '../src/universe/sim/world/rows';

// THE BUDGET of the emblem worlds, body by body: the triangles of the everyday mesh (flight and
// the star map) and of the close-up, the draw groups and calls at rest, on the low tier, and the
// moving meshes up close. These are the numbers the design was accepted on (the concept set's
// budget.json), measured here through the real interpreter and glue.
//
// A GOLDEN TABLE OF DESIGN-SURFACE ROWS, on purpose: it pins exact counts of what design/worlds
// says, which is free to change, because it is the proof that the port draws what the concept set
// drew. A change to a body's rows that moves a number, a part or a colour fails here, and the
// table is updated on purpose, with the reason in the commit. The `print` column is a fingerprint
// of everything the body packs at rest, far and near (positions, colours, lighting and decal
// flags rounded to 1e-5, the ghost edges and their colour) and of every part's name, tier and
// flags, generated once from the verified port (2026-09-30) and again after the judges' pass
// that day, which fixed what they found against the art (the commit says what, body by body):
// it catches a moved part or a swapped colour that leaves every count alone. The CEILINGS below
// are the budget itself (build-plan.md, section 7), which a change to the rows may approach but
// never pass.
//
// Rows that differ from budget.json, on purpose: About Me has 18 triangles fewer (1896 and 4982
// instead of 1914 and 5000, and 276 of its own instead of 294), because the Circle Line's Blog
// stop (a rose bookmark) waits for the Blog; there is no rose family yet. Since the judges' pass,
// Devpost's cup is open (12 more), the bus's windows and belt are skins of small quads that
// follow its curve (84 more), and Cal Hacks' scoreboard has its digits on both faces (38 more).

interface Budget {
  readonly everyday: number;
  readonly closeup: number;
  /** Draw groups at rest: what turns and what holds. */
  readonly groups: number;
  /** Draw calls at rest (the groups and a planned body's edge pass). */
  readonly calls: number;
  readonly lowCalls: number;
  /** Meshes of their own when it moves, up close. */
  readonly movers: number;
  /** A fingerprint of what it packs, far and near, and of its parts' flags. */
  readonly print: string;
}

// prettier-ignore
const GOLDEN: Readonly<Record<string, Budget>> = {
  'page/about':                     { everyday: 1896, closeup: 4982, groups: 2, calls: 2, lowCalls: 1, movers: 3, print: '533c53d7' },
  'page/resume':                    { everyday: 540,  closeup: 540,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '8b35877c' },
  'page/contact':                   { everyday: 218,  closeup: 218,  groups: 1, calls: 1, lowCalls: 1, movers: 2, print: '56cc4cf2' },
  'link/github':                    { everyday: 160,  closeup: 160,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '0adc41b2' },
  'link/linkedin':                  { everyday: 140,  closeup: 140,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '4c9b505e' },
  'link/devpost':                   { everyday: 280,  closeup: 280,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '4da94c42' },
  'system/hardware':                { everyday: 2084, closeup: 2156, groups: 1, calls: 1, lowCalls: 1, movers: 14, print: 'c63e8f97' },
  'system/software':                { everyday: 552,  closeup: 552,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '5f3841ab' },
  'system/research':                { everyday: 790,  closeup: 814,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'b9de84be' },
  'system/hackathons':              { everyday: 814,  closeup: 834,  groups: 1, calls: 1, lowCalls: 1, movers: 2, print: 'f5048eb4' },
  'project/robotics':               { everyday: 2004, closeup: 5116, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'c4a93309' },
  'project/canadian-fish-demo':     { everyday: 1844, closeup: 4902, groups: 1, calls: 1, lowCalls: 1, movers: 2, print: '17985b9c' },
  'project/fishai':                 { everyday: 558,  closeup: 718,  groups: 2, calls: 2, lowCalls: 1, movers: 2, print: 'e060fe48' },
  'project/days2meet':              { everyday: 1706, closeup: 4674, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'de4f98f2' },
  'project/hackgt-13':              { everyday: 1764, closeup: 5184, groups: 2, calls: 2, lowCalls: 1, movers: 2, print: 'ffbc301c' },
  'project/hackathons-at-berkeley': { everyday: 2090, closeup: 5144, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '10588279' },
  'project/cal-hacks-13':           { everyday: 1916, closeup: 4908, groups: 1, calls: 1, lowCalls: 1, movers: 4, print: '2f3a0ec3' },
  'project/fish-online':            { everyday: 820,  closeup: 820,  groups: 2, calls: 3, lowCalls: 2, movers: 1, print: '88fd9df7' },
  'project/sports-analysis':        { everyday: 1392, closeup: 1464, groups: 2, calls: 2, lowCalls: 1, movers: 2, print: '0384991d' },
  'project/kalshi':                 { everyday: 428,  closeup: 572,  groups: 1, calls: 2, lowCalls: 2, movers: 2, print: '73711e6b' },
  'project/corgi':                  { everyday: 1336, closeup: 1406, groups: 2, calls: 3, lowCalls: 2, movers: 1, print: '596eb13a' },
  'project/model-rocketry':         { everyday: 432,  closeup: 558,  groups: 1, calls: 1, lowCalls: 1, movers: 2, print: '03d5ef85' },
  'project/cyberpatriot':           { everyday: 1892, closeup: 4784, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'f574d453' },
  'project/fish-onboarding':        { everyday: 462,  closeup: 600,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '3602a756' },
};

/** The budget's ceilings (build-plan.md, section 7): per body, and for the whole galaxy. */
const CEILING = {
  everyday: 2400,
  closeup: 5600,
  galaxyCalls: 40,
  galaxyLowCalls: 30,
} as const;

const real = buildUniverse(readRealInput(true));
const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain };

/** A body's kind and state from the real galaxy; Devpost's relay waits for its URL (site.socials). */
function bodyOf(id: string): { kind: BodyKind; planned: boolean; seed: string } {
  const body = real.bodies.find((b) => b.id === id);
  if (body) return { kind: body.kind, planned: body.planned === true, seed: body.seed };
  if (id.startsWith('link/')) return { kind: 'link', planned: false, seed: id };
  throw new Error(`${id} is no body of the real galaxy`);
}

/** A body built both ways, and the options its assemblies share. */
function built(id: string, recipe: BodyRecipe) {
  const { kind, planned, seed } = bodyOf(id);
  const motion = MOTION[id] ?? [];
  const still = recipe.still ?? false;
  const detail = (near: boolean): number => groundDetail(kind, planned, near, tuning.world);
  const far = make(id, recipe, { detail: detail(false), seed, looks: LOOKS });
  const near = make(id, recipe, { detail: detail(true), seed, looks: LOOKS, near: NEAR[id] ?? [] });
  return { far, near, kind, still, motion };
}

/** FNV-1a over text. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
const rounded = (values: ArrayLike<number>): string =>
  Array.from(values, (v) => Math.round(v * 1e5)).join();
const packedText = ({ turn, hold, edges }: Assembly): string[] => [
  ...[turn, hold].flatMap((p) => [p.positions, p.colors, p.unlit, p.decal].map(rounded)),
  rounded(edges.turn),
  rounded(edges.hold),
  edges.color ? rounded(edges.color) : 'none',
];
function fingerprintOf(near: Build, far: Assembly, close: Assembly): string {
  const flags = near.parts.map((p) => `${p.name}:${p.tier}:${p.flags}`).join();
  return fnv([flags, ...packedText(far), ...packedText(close)].join('|'));
}

function measure(id: string, recipe: BodyRecipe): Budget {
  const { far, near, kind, still, motion } = built(id, recipe);
  const rest = assemble(far, { kind, still, motion });
  return {
    everyday: trianglesOf(far),
    closeup: trianglesOf(near),
    groups: (rest.turn.triangleCount > 0 ? 1 : 0) + (rest.hold.triangleCount > 0 ? 1 : 0),
    calls: callsOf(rest),
    lowCalls: callsOf(assemble(far, { kind, still, motion, low: true })),
    movers: assemble(near, { kind, still, motion, near: true, moving: true }).movers.length,
    print: fingerprintOf(near, rest, assemble(near, { kind, still, motion, near: true })),
  };
}

/** A body's ground is a hull (items that ARE the body) rather than a generated ground. */
const isHull = (ground: GroundSpec | Hull): ground is Hull => Array.isArray(ground);

const recipeOf = (id: string): BodyRecipe => {
  const recipe = BODIES[id];
  if (!recipe) throw new Error(`no rows for ${id}`);
  return recipe;
};

/** A mover's vertices drawn at their still, back in the body's frame (inside the whole body if it moves). */
function stillOf(mover: Mover, rows: readonly MotionRow[], inWhole: Mover | undefined): Vec3[] {
  const place = (p: Vec3, m: Mover): Vec3 => {
    let q: Vec3 = p;
    for (const row of rows.filter(([part]) => part === m.name)) {
      const { target, axis, value } = drive(row, 'still');
      const on = (k: 0 | 1 | 2): boolean => axis === '*' || axis === ['x', 'y', 'z'][k];
      const each = (f: (v: number, k: 0 | 1 | 2) => number): Vec3 => [
        f(q[0], 0),
        f(q[1], 1),
        f(q[2], 2),
      ];
      if (target === 'scale') q = each((v, k) => (on(k) ? v * value : v));
      else if (target === 'pos') q = each((v, k) => (on(k) ? v + value : v));
      else if (target === 'rot') {
        q = mulM(
          rotm(axis === 'x' ? value : 0, axis === 'y' ? value : 0, axis === 'z' ? value : 0),
          q,
        );
      }
    }
    return fromPivot(q, m.pivot);
  };
  const { positions } = mover.mesh;
  return Array.from({ length: positions.length / 3 }, (_, i) => {
    const own = place(
      [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0],
      mover,
    );
    return inWhole ? place(own, inWhole) : own;
  });
}

describe('the emblem worlds', () => {
  it('has a budget row for every body, and a body for every row', () => {
    expect(Object.keys(BODIES).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  it.each(Object.entries(GOLDEN))('builds %s within its budget', (id, budget) => {
    expect(measure(id, recipeOf(id))).toEqual(budget);
  });

  it('keeps every body under the ceilings, and the whole galaxy under its draw calls', () => {
    let calls = 0;
    let lowCalls = 0;
    for (const [id, recipe] of Object.entries(BODIES)) {
      const { everyday, closeup, calls: rest, lowCalls: low } = measure(id, recipe);
      expect(everyday, id).toBeLessThanOrEqual(CEILING.everyday);
      expect(closeup, id).toBeLessThanOrEqual(CEILING.closeup);
      calls += rest;
      lowCalls += low;
    }
    expect(calls).toBeLessThanOrEqual(CEILING.galaxyCalls);
    expect(lowCalls).toBeLessThanOrEqual(CEILING.galaxyLowCalls);
  });

  it('outlines every ghost in its family, and draws no lines for a body without one', () => {
    for (const [id, recipe] of Object.entries(BODIES)) {
      const { near, kind, still, motion } = built(id, recipe);
      const ghosts = near.parts.filter((p) => p.flags & FLAG.ghost);
      const a = assemble(near, { kind, still, motion, near: true });
      const lines = a.edges.turn.length + a.edges.hold.length;
      if (ghosts.length === 0) {
        expect(lines, id).toBe(0);
        continue;
      }
      expect(lines, id).toBeGreaterThan(0);
      expect(recipe.ghost, id).toBeDefined();
      expect(a.edges.color, id).toEqual(colorOf(`${recipe.ghost ?? 'coral'}.base`));
    }
  });

  it('hangs each mover from the group its part is drawn in', () => {
    const groups = (id: string): [string, string][] => {
      const { near, kind, still, motion } = built(id, recipeOf(id));
      return assemble(near, { kind, still, motion, near: true, moving: true }).movers.map((m) => [
        m.name,
        m.group,
      ]);
    };
    // About Me's train runs on the held Circle Line; the twin rocket stands on the turning ground.
    expect(groups('page/about')).toEqual([
      ['train', 'hold'],
      ['twin-rocket', 'turn'],
      ['twin-flame', 'turn'],
    ]);
    // The planned crane stands on the ground; the ball rides the held ring.
    expect(groups('project/sports-analysis')).toEqual([
      ['crane', 'turn'],
      ['ball', 'hold'],
    ]);
    // The coin never turns: it rocks as a whole, carrying its crane.
    expect(groups('project/kalshi')).toEqual([
      ['*', 'hold'],
      ['crane', 'hold'],
    ]);
  });

  it('draws every mover at its still exactly where the still mesh has its part', () => {
    for (const [id, rows] of Object.entries(MOTION)) {
      const { near, kind, still, motion } = built(id, recipeOf(id));
      const rest = assemble(near, { kind, still, motion, near: true });
      const live = assemble(near, { kind, still, motion, near: true, moving: true });
      const absent = absentAtRest(rows);
      const whole = live.movers[0]?.name === '*' ? live.movers[0] : undefined;
      const own = new Set(live.movers.map((m) => m.name));
      let drawn = live.turn.triangleCount + live.hold.triangleCount;
      for (const mover of live.movers) {
        // A part that only exists while it plays is not in the still at all.
        if (absent.has(mover.name)) continue;
        drawn += mover.mesh.triangleCount;
        const expected =
          mover === whole
            ? [
                ...near.ground,
                ...near.parts
                  .filter((p) => !own.has(p.name) && !absent.has(p.name))
                  .flatMap((p) => p.tris),
              ]
            : (near.parts.find((p) => p.name === mover.name)?.tris ?? []);
        const at = stillOf(mover, rows, mover === whole ? undefined : whole);
        expect(at.length, `${id} ${mover.name}`).toBe(expected.length * 3);
        expected.forEach((t, i) => {
          for (let v = 0; v < 3; v += 1) {
            for (let k = 0; k < 3; k += 1) {
              expect(at[i * 3 + v]?.[k], `${id} ${mover.name}`).toBeCloseTo(
                t.p[v * 3 + k] ?? NaN,
                4,
              );
            }
          }
        });
      }
      expect(drawn, id).toBe(rest.turn.triangleCount + rest.hold.triangleCount);
    }
  });

  it('resolves every colour of every body, far and near, in flight and on the map', () => {
    // colorOf throws on a path that names nothing, so building is the check.
    for (const [id, recipe] of Object.entries(BODIES)) {
      for (const map of [false, true]) {
        expect(
          () => make(id, recipe, { detail: 1, looks: LOOKS, map, near: NEAR[id] ?? [] }),
          id,
        ).not.toThrow();
      }
    }
  });

  it('moves only parts that exist', () => {
    for (const [id, rows] of Object.entries(MOTION)) {
      const names = new Set([
        '*',
        ...make(id, recipeOf(id), { detail: 0, looks: LOOKS, near: NEAR[id] ?? [] }).parts.map(
          (p) => p.name,
        ),
      ]);
      expect(
        rows.map(([part]) => part).filter((part) => !names.has(part)),
        id,
      ).toEqual([]);
    }
  });

  it('draws every body whole at rest far away without the motion table (it is in the close-up chunk)', () => {
    // world/BodyMesh.ts builds the everyday world before design/worlds/motion.ts has arrived, so
    // no part may be one that only exists while it plays (a scale row at 0 at rest): far away,
    // such a part would be drawn, and up close it would not be.
    for (const [id, recipe] of Object.entries(BODIES)) {
      const { far, kind, still, motion } = built(id, recipe);
      const absent = absentAtRest(motion);
      expect(
        far.parts.filter((part) => absent.has(part.name)).map((part) => part.name),
        id,
      ).toEqual([]);
      expect(packedText(assemble(far, { kind, still })), id).toEqual(
        packedText(assemble(far, { kind, still, motion })),
      );
    }
  });

  it('keeps every decal off a smooth ground: no corner, edge or middle of it inside', () => {
    // A ground with no relief is its shape exactly at the corners of its facets, and the facets
    // lie inside it. A decal that dips inside the shape anywhere (a flat plate on a rounded box)
    // is covered there by the ground: half a windshield, the foot of a sign.
    let checked = 0;
    for (const [id, recipe] of Object.entries(BODIES)) {
      const [ground] = rowsOf(recipe, { map: false });
      if (isHull(ground) || groundLook(ground, LOOKS).flat === undefined) continue;
      const { p, s } = ground.shape ?? { p: 2, s: [1, 1, 1] };
      const level = (q: Vec3): number =>
        q.reduce((sum, v, i) => sum + Math.abs(v / (s[i] ?? 1)) ** p, 0);
      const { near } = built(id, recipe);
      for (const part of near.parts.filter((x) => x.flags & FLAG.decal)) {
        for (const t of part.tris) {
          const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
          const mid = (u: Vec3, v: Vec3): Vec3 => [
            (u[0] + v[0]) / 2,
            (u[1] + v[1]) / 2,
            (u[2] + v[2]) / 2,
          ];
          for (const q of [a, b, c, mid(a, b), mid(b, c), mid(c, a), centroidOf(t)]) {
            expect(level(q), `${id} ${part.name}`).toBeGreaterThan(1);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('gives close-up parts and motions only to bodies that have rows', () => {
    const bodies = new Set(Object.keys(BODIES));
    expect(Object.keys(NEAR).filter((id) => !bodies.has(id))).toEqual([]);
    expect(Object.keys(MOTION).filter((id) => !bodies.has(id))).toEqual([]);
  });
});
