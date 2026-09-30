import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import type { UniverseManifest } from '../src/universe/data/types';
import { worlds, type WorldRecipe } from '../src/universe/design/worlds';

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
