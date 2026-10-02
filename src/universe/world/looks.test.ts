import { describe, expect, it } from 'vitest';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { worlds, type WorldRecipe } from '../design/worlds';
import { BODIES } from '../design/worlds/bodies';
import { hexToLinear } from '../sim/color';
import type { BodyRecipe } from '../sim/world/rows';
import {
  biomeBands,
  lookOf as lookWithRows,
  plannedBands,
  sunBands,
  sunLook,
  type LookedAt,
} from './looks';

/** As it was before any body had rows: several ids below are real bodies, which have them now. */
const lookOf = (
  of: LookedAt,
  theme: Parameters<typeof lookWithRows>[1],
  recipes?: Readonly<Partial<Record<string, WorldRecipe>>>,
) => lookWithRows(of, theme, recipes, {});

const body = (over: Partial<LookedAt> & Pick<LookedAt, 'kind'>): LookedAt => ({
  id: `project/${over.kind}`,
  biome: 'ember',
  ...over,
});

describe('lookOf', () => {
  const { detailSun, detailMoon, detailPlanet, detailNear, detailPlanned } = tuning.world;

  it('draws everything as it always was when nobody says otherwise', () => {
    expect(lookOf(body({ kind: 'sun', id: 'system/code' }), 'sky')).toEqual({
      model: null,
      bands: sunBands('sky'),
      look: sunLook(),
      detail: detailSun,
      nearDetail: null,
      rings: false,
    });
    const planet = lookOf(body({ kind: 'planet', rings: true }), 'sky');
    expect(planet).toEqual({
      model: null,
      bands: biomeBands('ember'),
      look: tuning.planet,
      detail: detailPlanet,
      nearDetail: detailNear,
      rings: true,
    });
    // The tuning itself, not a copy: the dev panel's sliders reach every planet built after.
    expect('look' in planet && planet.look).toBe(tuning.planet);
    expect(lookOf(body({ kind: 'moon' }), 'sky')).toMatchObject({
      detail: detailMoon,
      nearDetail: null,
    });
    expect(lookOf(body({ kind: 'home', biome: undefined }), 'butter')).toMatchObject({
      bands: biomeBands('terra'),
      detail: detailPlanet,
      nearDetail: detailNear,
    });
    expect(lookOf(body({ kind: 'station' }), 'butter')).toEqual({ model: 'station', rings: false });
    expect(lookOf(body({ kind: 'satellite' }), 'butter')).toEqual({
      model: 'satellite',
      rings: false,
    });
    // A link (a profile elsewhere) is a relay: built, not grown.
    expect(lookOf(body({ kind: 'link', id: 'link/github' }), 'butter')).toEqual({
      model: 'relay',
      rings: false,
    });
  });

  it('draws planned work as a maquette in its family’s colours, with no close-up', () => {
    for (const kind of ['planet', 'moon'] as const) {
      expect(lookOf(body({ kind, planned: true, rings: true }), 'lilac')).toEqual({
        model: null,
        bands: plannedBands('lilac'),
        look: { ...tuning.planet, reliefShare: 0 },
        detail: detailPlanned,
        nearDetail: null,
        rings: true,
      });
    }
    // Pale everywhere but the high ground: nothing of its biome.
    const light = hexToLinear(tokens.color.system.lilac.light);
    const base = hexToLinear(tokens.color.system.lilac.base);
    expect(plannedBands('lilac')).toEqual({
      sea: light,
      shore: light,
      low: light,
      high: base,
      peak: base,
    });
  });

  it('draws a world of its own as its recipe says, planned or not', () => {
    const recipes = {
      'project/planet': { biome: 'frost', look: { seaLevel: -1 }, rings: true },
      'project/moon': { model: 'station' },
      'system/code': { biome: 'bloom' },
      'page/contact': { rings: true },
    } as const;
    expect(lookOf(body({ kind: 'planet', planned: true }), 'sky', recipes)).toEqual({
      model: null,
      bands: biomeBands('frost'),
      look: { ...tuning.planet, seaLevel: -1 },
      detail: detailPlanet,
      nearDetail: detailNear,
      rings: true,
    });
    expect(lookOf(body({ kind: 'moon', rings: true }), 'sky', recipes)).toEqual({
      model: 'station',
      rings: true,
    });
    expect(lookOf(body({ kind: 'sun', id: 'system/code' }), 'sky', recipes)).toMatchObject({
      bands: biomeBands('bloom'),
      look: sunLook(),
    });
    expect(lookOf(body({ kind: 'satellite', id: 'page/contact' }), 'butter', recipes)).toEqual({
      model: 'satellite',
      rings: true,
    });
    // Only by its id: another body of the same kind is itself.
    expect(lookOf(body({ kind: 'planet', id: 'project/other' }), 'sky', recipes)).toMatchObject({
      bands: biomeBands('ember'),
    });
  });

  it('reads design/worlds.ts when not handed a registry', () => {
    for (const id of ['project/planet', ...Object.keys(worlds)]) {
      expect(lookOf(body({ kind: 'planet', id }), 'sky')).toEqual(
        lookOf(body({ kind: 'planet', id }), 'sky', worlds),
      );
    }
  });

  it('draws a body with rows as its emblem world, after a recipe and before the placeholder', () => {
    // (Never interpreted here: only which object comes back.)
    const rows = { rows: [] } as unknown as BodyRecipe;
    const bodies = { 'project/planet': rows, 'link/github': rows };
    const planet = body({ kind: 'planet', planned: true, rings: true });
    // Its rows draw whatever ring it has, so it has no other; planned work's rows are its maquette.
    expect(lookWithRows(planet, 'sky', {}, bodies)).toEqual({
      model: null,
      world: rows,
      rings: false,
    });
    // A link's relay too: rows beat the built model.
    const relay = body({ kind: 'link', id: 'link/github' });
    expect(lookWithRows(relay, 'butter', {}, bodies)).toMatchObject({ model: null, world: rows });
    // One line in design/worlds.ts takes a body off its rows, without deleting them.
    const recipes = { 'project/planet': { biome: 'frost' } } as const;
    const off = lookWithRows(planet, 'sky', recipes, bodies);
    expect(off).not.toHaveProperty('world');
    expect(off).toMatchObject({ bands: biomeBands('frost') });
    // Only by its id.
    expect(
      lookWithRows(body({ kind: 'planet', id: 'project/other' }), 'sky', {}, bodies),
    ).toMatchObject({ bands: biomeBands('ember') });
  });

  it('reads design/worlds/bodies.ts when not handed rows', () => {
    const ids = Object.keys(BODIES);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(lookWithRows(body({ kind: 'planet', id }), 'sky').world).toBe(BODIES[id]);
    }
  });
});
