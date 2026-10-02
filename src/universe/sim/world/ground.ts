import type { ThemeKey } from '../../design/tokens';
import { generatePlanet, type PlanetLook, type PlanetShape } from '../planet';
import type { Tri, Unlit } from './kit';
import { painterOf, type PaintOp } from './paint';
import { bandsOf, sunBandsOf, type Ramp } from './palette';

/**
 * THE GROUND: the low-poly ball a world stands on, made by the engine's own planet generator
 * (sim/planet.ts) with the options it has for worlds of their own. A ground names a TERRAIN (how
 * the noise is shaped: overrides of the generated planets' look), a ramp (a biome, a colour
 * family or chalk: palette.ts), and optionally a shape, a corner at the pole, band stops of its
 * own and paint. It is modelled at radius 1, like the props that stand on it.
 *
 * The numbers are design (design/tuning.ts, `planet` and `terrain`) and come in as `GroundLooks`,
 * the way sim/planet.ts is handed its `PlanetLook`: logic owns the shape, tuning fills it in.
 *
 * The colour nudge is the engine's (a facet's colour moves by up to the look's `colorJitter`),
 * not the concept prototype's three steps: the worlds should sit among the generated planets as
 * one family, and a sun's `colorJitter: 0` keeps it exact.
 */

export type TerrainName = 'continents' | 'calm' | 'isles' | 'lumpy' | 'flat' | 'sun';

/** A terrain of the vocabulary (vocabulary.md, 3.1): design/tuning.ts, `terrain`. */
export interface Terrain {
  readonly look: Partial<PlanetLook>;
  /** A smooth ball at this land level (sim/planet.ts, `flat`), painted by its band and ops alone. */
  readonly flat?: number;
}

/** What a ground's look is made of (design/tuning.ts): the planets' look, and the terrains. */
export interface GroundLooks {
  readonly planet: PlanetLook;
  readonly terrain: Readonly<Record<TerrainName, Terrain>>;
}

/** A generated ground, as a body's rows state it. */
export interface GroundSpec {
  /**
   * Whose noise and paint: the name the concept art was drawn from, so that a continent is where
   * the picture has it. Without one, the body's own seed.
   */
  readonly seed?: string;
  /** Its colours: a biome of the tokens, a colour family (palette.ts) or chalk. Default terra. */
  readonly biome?: Ramp;
  /** A sun's ball in this family instead: `biome` is ignored, and the whole ground glows. */
  readonly sun?: ThemeKey;
  /** A terrain by name, or a smooth ball at a level of its own. Default flat (0.3). */
  readonly recipe?: TerrainName | { readonly flat: number };
  /** Band stops of its own (shore|low, low|high, high|peak), over the terrain's. */
  readonly stops?: readonly [number, number, number];
  readonly shape?: PlanetShape;
  readonly up?: 'vertex';
  readonly paint?: readonly PaintOp[];
}

/** The generator's look for a ground: the planets' look, the terrain's overrides, its own stops. */
export function groundLook(
  spec: GroundSpec,
  looks: GroundLooks,
): { look: PlanetLook; flat: number | undefined } {
  const recipe = spec.recipe ?? 'flat';
  const terrain =
    typeof recipe === 'string'
      ? looks.terrain[recipe]
      : { look: looks.terrain.flat.look, flat: recipe.flat };
  return {
    look: {
      ...looks.planet,
      ...terrain.look,
      ...(spec.stops ? { bandStops: spec.stops } : {}),
    },
    flat: terrain.flat,
  };
}

/**
 * The ground's triangles at radius 1: 20 * (detail + 1)^2 of them. A generator (one slice per
 * face of the icosahedron) so that a close-up ground can be spread over frames (core/jobs.ts).
 */
export function* groundOf(
  spec: GroundSpec,
  seed: string,
  detail: number,
  looks: GroundLooks,
): Generator<void, Tri[]> {
  const { look, flat } = groundLook(spec, looks);
  const mesh = yield* generatePlanet(
    {
      radius: 1,
      seed: spec.seed ?? seed,
      detail,
      bands: spec.sun ? sunBandsOf(spec.sun) : bandsOf(spec.biome ?? 'terra'),
      ...(flat === undefined ? {} : { flat }),
      ...(spec.shape ? { shape: spec.shape } : {}),
      ...(spec.up ? { up: spec.up } : {}),
      ...(spec.paint ? { paint: painterOf(spec.paint) } : {}),
    },
    look,
  );
  // A sun is light itself: its ball is unlit and blooms.
  const g: Unlit = spec.sun ? 2 : 0;
  return Array.from({ length: mesh.triangleCount }, (_, i): Tri => ({
    p: [...mesh.positions.subarray(i * 9, i * 9 + 9)],
    c: [mesh.colors[i * 9] ?? 0, mesh.colors[i * 9 + 1] ?? 0, mesh.colors[i * 9 + 2] ?? 0],
    g,
  }));
}
