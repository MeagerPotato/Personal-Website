import type { PlanetLook } from '../sim/planet';
import type { AssetId } from './assets';
import type { BiomeKey } from './tokens';

/**
 * WORLDS OF THEIR OWN: a body that should not look like any other planet of its biome gets a
 * recipe here, by its manifest id ('project/model-rocketry', 'system/hardware', 'page/about').
 * Everything else is generated from its content (biome, size, rings) and its seed, as it always
 * was: world/looks.ts, `lookOf`, reads this first, then the planned placeholder, then the
 * generator.
 *
 * A key is only honoured while a body has that id: tests/worlds.test.ts builds the real galaxy
 * and fails on a key that names none (a project renamed or moved to another id), so a recipe can
 * never be left behind silently.
 *
 * DESIGN SURFACE: recipes are free to change. What a recipe can SAY is what the engine can
 * honour today; a new field is a logic change, like any key.
 */
export interface WorldRecipe {
  /** Paint it with this biome's colours instead of the one its content chose. */
  readonly biome?: BiomeKey;
  /** The generator's shape, changed only where it says (relief, sea level, continents...). */
  readonly look?: Partial<PlanetLook>;
  /** A ring round it, or none, whatever its content says. */
  readonly rings?: boolean;
  /** A registered model (design/assets.ts) instead of the generated globe, at the body's size. */
  readonly model?: AssetId;
}

/** Empty today: every world is generated. */
export const worlds: Readonly<Partial<Record<string, WorldRecipe>>> = {};
