import type { AssetId } from '../design/assets';
import { tokens, type BiomeKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { worlds as recipes, type WorldRecipe } from '../design/worlds';
import type { ManifestBody } from '../manifest';
import { hexToLinear } from '../sim/color';
import type { PlanetBands, PlanetLook } from '../sim/planet';

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

/** What a body is drawn as: a registered model, or a generated globe and how it is generated. */
export type BodyLook =
  | { readonly model: AssetId; readonly rings: boolean }
  | {
      readonly model: null;
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
 * 1. A world of its own (design/worlds.ts, by its id): a model, or the generator with what the
 *    recipe says. A recipe is a design, so it wins over the planned placeholder too.
 * 2. Planned work: the placeholder (`plannedBands`, no relief, `detailPlanned`, no close-up).
 * 3. Everything else, as it has always been: the station, the satellite and a link's relay are
 *    their models, a sun is lit from inside in its family's colours, and the rest is its biome.
 * `theme` is the colour family of the body's system.
 */
export function lookOf(
  body: LookedAt,
  theme: ThemeKey,
  worlds: Readonly<Partial<Record<string, WorldRecipe>>> = recipes,
): BodyLook {
  const recipe = worlds[body.id];
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
