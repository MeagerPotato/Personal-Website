import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import type { BodyKind } from '../src/universe/data/types';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { MOTION } from '../src/universe/design/worlds/motion';
import { NEAR } from '../src/universe/design/worlds/near';
import { assemble, callsOf, groundDetail } from '../src/universe/sim/world/glue';
import { make, trianglesOf, type BodyRecipe } from '../src/universe/sim/world/rows';

// THE BUDGET of the emblem worlds, body by body: the triangles of the everyday mesh (flight and
// the star map) and of the close-up, the draw groups and calls at rest, on the low tier, and the
// moving meshes up close. These are the numbers the design was accepted on (the concept set's
// budget.json), measured here through the real interpreter and glue: a change to a body's rows
// that moves one fails here, and the table is updated on purpose, with the reason in the commit.
//
// Two rows differ from budget.json, on purpose: About Me has 18 triangles fewer (1896 and 4982
// instead of 1914 and 5000, and 276 of its own instead of 294), because the Circle Line's Blog
// stop (a rose bookmark) waits for the Blog; there is no rose family yet.

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
}

// prettier-ignore
const GOLDEN: Readonly<Record<string, Budget>> = {
  'page/about':                     { everyday: 1896, closeup: 4982, groups: 2, calls: 2, lowCalls: 1, movers: 3 },
  'page/resume':                    { everyday: 540,  closeup: 540,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'page/contact':                   { everyday: 218,  closeup: 218,  groups: 1, calls: 1, lowCalls: 1, movers: 2 },
  'link/github':                    { everyday: 160,  closeup: 160,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'link/linkedin':                  { everyday: 140,  closeup: 140,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'link/devpost':                   { everyday: 268,  closeup: 268,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'system/hardware':                { everyday: 812,  closeup: 812,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'system/software':                { everyday: 552,  closeup: 552,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'system/research':                { everyday: 790,  closeup: 814,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'system/hackathons':              { everyday: 814,  closeup: 834,  groups: 1, calls: 1, lowCalls: 1, movers: 2 },
  'project/robotics':               { everyday: 2004, closeup: 5116, groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'project/canadian-fish-demo':     { everyday: 1844, closeup: 4902, groups: 1, calls: 1, lowCalls: 1, movers: 2 },
  'project/fishai':                 { everyday: 558,  closeup: 718,  groups: 2, calls: 2, lowCalls: 1, movers: 2 },
  'project/days2meet':              { everyday: 1706, closeup: 4674, groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'project/hackgt-13':              { everyday: 1764, closeup: 5184, groups: 2, calls: 2, lowCalls: 1, movers: 1 },
  'project/hackathons-at-berkeley': { everyday: 2006, closeup: 5060, groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'project/cal-hacks-13':           { everyday: 1878, closeup: 4870, groups: 1, calls: 1, lowCalls: 1, movers: 4 },
  'project/fish-online':            { everyday: 820,  closeup: 820,  groups: 2, calls: 3, lowCalls: 2, movers: 1 },
  'project/sports-analysis':        { everyday: 1392, closeup: 1464, groups: 2, calls: 2, lowCalls: 1, movers: 2 },
  'project/kalshi':                 { everyday: 428,  closeup: 572,  groups: 1, calls: 2, lowCalls: 2, movers: 2 },
  'project/corgi':                  { everyday: 1336, closeup: 1406, groups: 2, calls: 3, lowCalls: 2, movers: 1 },
  'project/model-rocketry':         { everyday: 1776, closeup: 4910, groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'project/cyberpatriot':           { everyday: 1892, closeup: 4784, groups: 1, calls: 1, lowCalls: 1, movers: 1 },
  'project/fish-onboarding':        { everyday: 462,  closeup: 600,  groups: 1, calls: 1, lowCalls: 1, movers: 1 },
};

const real = buildUniverse(readRealInput(true));

/** A body's kind and state from the real galaxy; Devpost's relay waits for its URL (site.socials). */
function bodyOf(id: string): { kind: BodyKind; planned: boolean; seed: string } {
  const body = real.bodies.find((b) => b.id === id);
  if (body) return { kind: body.kind, planned: body.planned === true, seed: body.seed };
  if (id.startsWith('link/')) return { kind: 'link', planned: false, seed: id };
  throw new Error(`${id} is no body of the real galaxy`);
}

function measure(id: string, recipe: BodyRecipe): Budget {
  const { kind, planned, seed } = bodyOf(id);
  const motion = MOTION[id] ?? [];
  const still = recipe.still ?? false;
  const far = make(id, recipe, { detail: groundDetail(kind, planned, false), seed });
  const near = make(id, recipe, {
    detail: groundDetail(kind, planned, true),
    seed,
    near: NEAR[id] ?? [],
  });
  const rest = assemble(far, { kind, still, motion });
  return {
    everyday: trianglesOf(far),
    closeup: trianglesOf(near),
    groups: (rest.turn.triangleCount > 0 ? 1 : 0) + (rest.hold.triangleCount > 0 ? 1 : 0),
    calls: callsOf(rest),
    lowCalls: callsOf(assemble(far, { kind, still, motion, low: true })),
    movers: assemble(near, { kind, still, motion, near: true, moving: true }).movers.length,
  };
}

describe('the emblem worlds', () => {
  it('has a budget row for every body, and a body for every row', () => {
    expect(Object.keys(BODIES).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  it.each(Object.entries(GOLDEN))('builds %s within its budget', (id, budget) => {
    const recipe = BODIES[id];
    if (!recipe) throw new Error(`no rows for ${id}`);
    expect(measure(id, recipe)).toEqual(budget);
  });

  it('resolves every colour of every body, far and near, in flight and on the map', () => {
    // colorOf throws on a path that names nothing, so building is the check.
    for (const [id, recipe] of Object.entries(BODIES)) {
      for (const map of [false, true]) {
        expect(() => make(id, recipe, { detail: 1, map, near: NEAR[id] ?? [] }), id).not.toThrow();
      }
    }
  });

  it('moves only parts that exist', () => {
    for (const [id, rows] of Object.entries(MOTION)) {
      const recipe = BODIES[id];
      if (!recipe) throw new Error(`motion for ${id}, which has no rows`);
      const names = new Set([
        '*',
        ...make(id, recipe, { detail: 0, near: NEAR[id] ?? [] }).parts.map((p) => p.name),
      ]);
      expect(
        rows.map(([part]) => part).filter((part) => !names.has(part)),
        id,
      ).toEqual([]);
    }
  });

  it('gives close-up parts and motions only to bodies that have rows', () => {
    const bodies = new Set(Object.keys(BODIES));
    expect(Object.keys(NEAR).filter((id) => !bodies.has(id))).toEqual([]);
    expect(Object.keys(MOTION).filter((id) => !bodies.has(id))).toEqual([]);
  });
});
