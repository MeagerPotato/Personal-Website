import type { AssetId } from '../design/assets';
import type { AirWorld } from '../design/lookTypes';
import { tokens, type AirKey, type BiomeKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { worlds as recipes, type WorldRecipe } from '../design/worlds';
import { BODIES } from '../design/worlds/bodies';
import type { ManifestBody } from '../manifest';
import { hexToLinear } from '../sim/color';
import type { PlanetBands, PlanetLook } from '../sim/planet';
import { isLivingSun, type GroundSpec } from '../sim/world/ground';
import { rowsOf, type BodyRecipe } from '../sim/world/rows';

/** A planet's five colours, from its biome's tokens, in the linear space the generator paints in. */
export function biomeBands(biome: BiomeKey): PlanetBands {
  const colors = tokens.color.biome[biome];
  return {
    sea: hexToLinear(colors.sea),
    shore: hexToLinear(colors.shore),
    low: hexToLinear(colors.low),
    high: hexToLinear(colors.high),
    peak: hexToLinear(colors.peak),
  };
}

/** A sun in its system's colour family: mostly `base`, with lighter and darker patches. */
export function sunBands(theme: ThemeKey): PlanetBands {
  const colors = tokens.color.system[theme];
  const base = hexToLinear(colors.base);
  return {
    sea: base,
    shore: hexToLinear(colors.light),
    low: base,
    high: base,
    peak: hexToLinear(colors.shade),
  };
}

/**
 * Planned work, not built yet: an unpainted maquette in its system's colour family. Everything
 * low is the family's pale `light`, and only the high ground its `base`, so it reads as a sketch
 * of a world beside the painted ones, in flight and on the map, without a colour of its own.
 */
export function plannedBands(theme: ThemeKey): PlanetBands {
  const colors = tokens.color.system[theme];
  const light = hexToLinear(colors.light);
  const base = hexToLinear(colors.base);
  return { sea: light, shore: light, low: light, high: base, peak: base };
}

/** A sun is a smooth ball whose "heights" only choose between its colours. */
export function sunLook(): PlanetLook {
  return { ...tuning.planet, reliefShare: 0, seaLevel: -2 };
}

/**
 * What a body is drawn as: a registered model, an emblem world drawn from its rows (world/BodyMesh.ts),
 * or a generated globe and how it is generated.
 */
export type BodyLook =
  | { readonly model: AssetId; readonly world?: undefined; readonly rings: boolean }
  | {
      readonly model: null;
      /** Its rows (design/worlds/): they draw whatever ring it has, so it has no other. */
      readonly world: BodyRecipe;
      readonly rings: false;
    }
  | {
      readonly model: null;
      readonly world?: undefined;
      readonly bands: PlanetBands;
      readonly look: PlanetLook;
      /** Detail of the everyday mesh, and of the close-up (null: it never needs one). */
      readonly detail: number;
      readonly nearDetail: number | null;
      readonly rings: boolean;
    };

/** The bodies that are built, not grown: each is drawn as its model (design/assets.ts). */
const BUILT: Partial<Record<LookedAt['kind'], AssetId>> = {
  station: 'station',
  satellite: 'satellite',
  link: 'relay',
};

/** What of a body its look depends on. (The lab makes up one of its own.) */
export type LookedAt = Pick<ManifestBody, 'id' | 'kind' | 'biome' | 'rings' | 'planned'>;

/**
 * HOW A BODY LOOKS, decided in one place (world/Galaxy.ts asks, and so does the lab), in this
 * order:
 * 1. A recipe (design/worlds.ts, by its id): a model, or the generator with what the recipe says.
 *    It is the coarse override, and it comes first on purpose: one line there takes a body off
 *    its rows (to a model, or back to the generator with a biome) without deleting them, say
 *    while a world is being reworked. Today there are none.
 * 2. An emblem world (design/worlds/, by its id): drawn from its rows by world/BodyMesh.ts. Rows
 *    are a whole design, planned work's included (the primer maquette and its kit), so they win
 *    over the placeholder below.
 * 3. Planned work: the placeholder (`plannedBands`, no relief, `detailPlanned`, no close-up), for
 *    planned work that has no rows yet.
 * 4. Everything else, as it has always been: the station, the satellite and a link's relay are
 *    their models, a sun is lit from inside in its family's colours, and the rest is its biome.
 * `theme` is the body's colour family (manifest.ts, `familiesOf`). `bodies` are the rows, by id
 * (design/worlds/bodies.ts unless a test hands others).
 */
export function lookOf(
  body: LookedAt,
  theme: ThemeKey,
  worlds: Readonly<Partial<Record<string, WorldRecipe>>> = recipes,
  bodies: Readonly<Partial<Record<string, BodyRecipe>>> = BODIES,
): BodyLook {
  const recipe = worlds[body.id];
  const rows = recipe === undefined ? bodies[body.id] : undefined;
  if (rows !== undefined) return { model: null, world: rows, rings: false };
  const rings = recipe?.rings ?? body.rings === true;
  const { kind } = body;
  const model = recipe?.model ?? BUILT[kind] ?? null;
  if (model !== null) return { model, rings };

  const { detailSun, detailMoon, detailPlanet, detailNear, detailPlanned } = tuning.world;
  if (body.planned && recipe === undefined) {
    return {
      model: null,
      bands: plannedBands(theme),
      look: { ...tuning.planet, reliefShare: 0 },
      detail: detailPlanned,
      nearDetail: null,
      rings,
    };
  }

  const isSun = kind === 'sun';
  const isMoon = kind === 'moon';
  const look = isSun ? sunLook() : tuning.planet;
  return {
    model: null,
    bands: recipe?.biome
      ? biomeBands(recipe.biome)
      : isSun
        ? sunBands(theme)
        : biomeBands(body.biome ?? 'terra'),
    look: recipe?.look ? { ...look, ...recipe.look } : look,
    detail: isSun ? detailSun : isMoon ? detailMoon : detailPlanet,
    nearDetail: isSun || isMoon ? null : detailNear,
    rings,
  };
}

/** Which worlds have air, by body id (design/tuning.ts, `look.air.worlds`). */
export type AirTable = Readonly<Partial<Record<string, AirWorld>>>;

const isAir = (biome: string): biome is AirKey => Object.hasOwn(tokens.color.air, biome);

/**
 * THE AIR OF A BODY, decided in one place (world/Galaxy.ts asks, and so does the lab):
 * 1. A row of the table, by its id: that air, those clouds, and lamps if it says so.
 * 2. A generated globe (`globe`: no rows and no model: world/looks.ts, `lookOf`) that is a planet
 *    or home, and not planned work: the air of its biome, with neither clouds nor lamps. Primer,
 *    the clay of planned work, has no air. Nobody is one today: every body has rows.
 * 3. Everything else has none: a sun, a moon, a station, a model, an emblem that is not a globe.
 */
export function airOf(
  body: Pick<LookedAt, 'id' | 'kind' | 'biome' | 'planned'>,
  globe: boolean,
  table: AirTable = tuning.look.air.worlds,
): AirWorld | undefined {
  if (body.kind === 'sun') return undefined;
  const row = table[body.id];
  if (row) return row;
  if (!globe || body.planned || (body.kind !== 'planet' && body.kind !== 'home')) return undefined;
  const biome = body.biome ?? 'terra';
  return isAir(biome) ? { air: biome } : undefined;
}

/**
 * Is a sun, looked at this way, a LIVING one: a ball whose facets carry tones (sim/sunSurface.ts),
 * so that it gets the whole corona? The Hardware sun's ball is painted under its gears, and a sun
 * with no rows is a generated globe: both are plain, and get only the halo and the glow.
 */
export function livingSun(look: BodyLook): boolean {
  if (!look.world) return false;
  const [ground] = rowsOf(look.world, { map: false });
  return !Array.isArray(ground) && isLivingSun(ground as GroundSpec);
}
