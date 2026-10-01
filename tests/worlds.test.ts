import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { site } from '../src/config/site';
import { PROFILE } from '../src/site/profiles';
import { buildUniverse } from '../src/universe/data/build';
import type { UniverseManifest } from '../src/universe/data/types';
import { worlds, type WorldRecipe } from '../src/universe/design/worlds';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { MOTION } from '../src/universe/design/worlds/motion';
import { NEAR } from '../src/universe/design/worlds/near';

// design/worlds.ts gives a body a world of its own BY ITS ID. Rename a project, move a page to
// another dock, or delete one, and its recipe would quietly stop being read: so every key must
// name a body of the real galaxy, as the build makes it from src/content (drafts included, since
// a recipe may well be ready before its project is).

/** The keys of `recipes` that name no body of `manifest`. */
function orphans(
  recipes: Readonly<Partial<Record<string, WorldRecipe>>>,
  manifest: UniverseManifest,
): string[] {
  const ids = new Set(manifest.bodies.map((body) => body.id));
  return Object.keys(recipes).filter((id) => !ids.has(id));
}

describe('design/worlds.ts', () => {
  const real = buildUniverse(readRealInput(true));

  it('gives a world of its own only to bodies that exist', () => {
    expect(
      orphans(worlds, real),
      'a recipe in src/universe/design/worlds.ts names no body: rename its key to the body’s ' +
        'id in /universe.json (system/<id>, project/<id>, page/<id>), or remove it',
    ).toEqual([]);
  });

  it('would notice one that names nothing', () => {
    const someone = real.bodies[0]?.id ?? '';
    expect(orphans({ [someone]: { rings: true }, 'project/gone': { rings: true } }, real)).toEqual([
      'project/gone',
    ]);
  });
});

// The emblem worlds (design/worlds/) are keyed the same way, with one allowance: a profile's
// relay may have its rows before its URL. PROFILE (src/site/profiles.ts) knows Devpost and gives
// it a slot, but site.socials has no Devpost URL yet, so the galaxy has no 'link/devpost'; its
// rows wait, ready, for that one line. A 'link/<name>' that PROFILE does not know is still an
// orphan.
describe('design/worlds/', () => {
  const real = buildUniverse(readRealInput(true));
  const ids = new Set(real.bodies.map((body) => body.id));
  const waiting = new Set(
    Object.keys(PROFILE)
      .filter((key) => !Object.hasOwn(site.socials, key))
      .map((key) => `link/${key}`),
  );
  const orphansOf = (table: Readonly<Record<string, unknown>>): string[] =>
    Object.keys(table).filter((id) => !ids.has(id) && !waiting.has(id));

  it.each([
    ['bodies.ts', BODIES],
    ['near.ts', NEAR],
    ['motion.ts', MOTION],
  ] as const)('keys %s by bodies that exist (or relays waiting for their URL)', (file, table) => {
    expect(
      orphansOf(table),
      `a key in src/universe/design/worlds/${file} names no body: rename it to the body’s id in ` +
        '/universe.json (system/<id>, project/<id>, page/<id>, link/<profile>), or remove it',
    ).toEqual([]);
  });

  it('lets a body face along its orbit only if it circles something and holds still', () => {
    for (const [id, recipe] of Object.entries(BODIES)) {
      if (recipe.faces === undefined) continue;
      const body = real.bodies.find((candidate) => candidate.id === id);
      expect(body?.parent, `${id} faces ${recipe.faces} but circles nothing`).toBeTruthy();
      expect(recipe.still, `${id} faces ${recipe.faces}: it must be still`).toBe(true);
    }
  });

  it('knows which relays are waiting, and would notice a stranger', () => {
    expect([...waiting]).toEqual(ids.has('link/devpost') ? [] : ['link/devpost']);
    expect(orphansOf({ 'link/myspace': 1, 'project/gone': 1, 'page/about': 1 })).toEqual([
      'link/myspace',
      'project/gone',
    ]);
  });
});
