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
  fineOf,
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
// Since the look pass ("Deep light", step 2, 2026-10-01) the three living suns' balls are 2000
// facets and not 500 (1500 more each: granulation needs facets), each facet in one of six tones
// with its tone in its lighting flag, so their prints moved with their counts. That is as fine
// as the everyday ceiling allows (the design drew 2880); the Hardware sun's frame ball, hidden
// under its gears, keeps its 500.
// Since the worlds were made round ("Deep light", step 2b, 2026-10-02) the print also covers
// every vertex's normal and a facet's other colours with their lines (sim/world/glue.ts,
// `Packed.normals` and `sides`), so every print moved; the colour nudge is gone
// (`planet.colorJitter` 0), a sun's ball is one colour (its tones are the shader's), the
// terrains' relief is lower, and a moon's ball is 1280 facets and not 320 (960 more on the two
// moons that are balls: FishAI and Fish Onboarding). No other count moved: nothing was added to
// any mesh to make it round. And how those lines bend (`Packed.bends`: an outline is an arc
// inside a facet, the same day): the prints of the grounds with a coast or paint moved again.
// Since round things are BUILT round (step 2c, the same day; Allen: "make everything round and
// smooth, except for just the stuff that should have edges (like the hardware cogs)"), every
// count but the Software sun's moved, and every print: a round thing (sim/world/kit.ts says which)
// is measured here as the galaxy builds it, with the sides its size wants (`tuning.world.round`:
// a wheel sketched with 8 sides has 16 every day and 24 up close), a bead is a ball and not an
// octahedron, a planned world's clay is as fine as a built world's (1620 and 1280 facets; it was
// 980 and 320), and the hubs and paint rings of the Hardware sun's gears are circles. The galaxy
// is 40,434 triangles every day (it was 32,538). The ceilings rose with it, on purpose and once:
// 2400 to 2800 every day, 5600 to 6600 up close (the most any body has: 2746 and 6176). What
// they protect is a frame's cost, which did not move (the commit has the frame times).

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
  'page/about':                     { everyday: 2136, closeup: 5382, groups: 2, calls: 2, lowCalls: 1, movers: 3, print: '26d94d60' },
  'page/resume':                    { everyday: 772,  closeup: 1094, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'd8c984b6' },
  'page/contact':                   { everyday: 292,  closeup: 404,  groups: 1, calls: 1, lowCalls: 1, movers: 2, print: 'c1c9a6b8' },
  'link/github':                    { everyday: 420,  closeup: 908,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '944ba5be' },
  'link/linkedin':                  { everyday: 148,  closeup: 160,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '92009a0f' },
  'link/devpost':                   { everyday: 598,  closeup: 912,  groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '3146ad73' },
  'system/hardware':                { everyday: 2612, closeup: 2684, groups: 1, calls: 1, lowCalls: 1, movers: 14, print: '0a97d327' },
  'system/software':                { everyday: 2052, closeup: 2052, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '55bbfcbf' },
  'system/research':                { everyday: 2578, closeup: 2890, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '3e6c91fb' },
  'system/hackathons':              { everyday: 2562, closeup: 2850, groups: 1, calls: 1, lowCalls: 1, movers: 2, print: 'c7f289f7' },
  'project/robotics':               { everyday: 2292, closeup: 6176, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'b5bcdd37' },
  'project/canadian-fish-demo':     { everyday: 1892, closeup: 5188, groups: 1, calls: 1, lowCalls: 1, movers: 2, print: '8b21b2eb' },
  'project/fishai':                 { everyday: 1722, closeup: 2030, groups: 2, calls: 2, lowCalls: 1, movers: 2, print: '44eadb4c' },
  'project/days2meet':              { everyday: 1706, closeup: 4762, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: '13445590' },
  'project/hackgt-13':              { everyday: 1908, closeup: 6156, groups: 2, calls: 2, lowCalls: 1, movers: 2, print: '50d29a94' },
  'project/hackathons-at-berkeley': { everyday: 2474, closeup: 6016, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'aeaecea5' },
  'project/cal-hacks-13':           { everyday: 1950, closeup: 4980, groups: 1, calls: 1, lowCalls: 1, movers: 4, print: 'f71727c0' },
  'project/fish-online':            { everyday: 2084, closeup: 2676, groups: 2, calls: 3, lowCalls: 2, movers: 1, print: 'ff1e7ca6' },
  'project/sports-analysis':        { everyday: 2340, closeup: 3016, groups: 2, calls: 2, lowCalls: 1, movers: 2, print: '2eb57b5b' },
  'project/kalshi':                 { everyday: 676,  closeup: 1260, groups: 1, calls: 2, lowCalls: 2, movers: 2, print: '569d8408' },
  'project/corgi':                  { everyday: 2746, closeup: 3630, groups: 2, calls: 3, lowCalls: 2, movers: 1, print: '7a8df6ff' },
  'project/model-rocketry':         { everyday: 556,  closeup: 1332, groups: 1, calls: 1, lowCalls: 1, movers: 2, print: 'ac353ff1' },
  'project/cyberpatriot':           { everyday: 1968, closeup: 4972, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'edf52fc8' },
  'project/fish-onboarding':        { everyday: 1950, closeup: 2852, groups: 1, calls: 1, lowCalls: 1, movers: 1, print: 'f937f226' },
};

/** The budget's ceilings (build-plan.md, section 7): per body, and for the whole galaxy. */
const CEILING = {
  everyday: 2800,
  closeup: 6600,
  galaxyCalls: 40,
  galaxyLowCalls: 30,
} as const;

const real = buildUniverse(readRealInput(true));
const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };

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
  const fine = (near: boolean) => fineOf(near, false, tuning.world.round);
  const far = make(id, recipe, { detail: detail(false), seed, looks: LOOKS, fine: fine(false) });
  const near = make(id, recipe, {
    detail: detail(true),
    seed,
    looks: LOOKS,
    near: NEAR[id] ?? [],
    fine: fine(true),
  });
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
  ...[turn, hold].flatMap((p) =>
    [p.positions, p.normals, p.colors, p.sides, p.bends, p.unlit, p.decal].map(rounded),
  ),
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
