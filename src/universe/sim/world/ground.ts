import type { ThemeKey } from '../../design/tokens';
import { generatePlanet, type PlanetLook, type PlanetShape } from '../planet';
import { sunFlag, sunSeed, type SunSurfaceLook } from '../sunSurface';
import type { Tri } from './kit';
import { painterOf, type PaintOp } from './paint';
import { bandsOf, colorOf, sunBandsOf, type Ramp } from './palette';

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
 *
 * A SUN'S ball is a living surface (sim/sunSurface.ts): a smooth ball in its family's base, every
 * facet flagged as the surface with the sun's own number, on which the sun's shader draws the
 * tones. A sun that is PAINTED (the Hardware sun's frame ball, one shade under its gears) keeps
 * its paint and a plain glow: its gears are its surface.
 *
 * Every facet carries the normals of the ball it lies on, and where two colours meet in it, both
 * (sim/planet.ts): the ground is round, whatever its facets.
 */

export type TerrainName = 'continents' | 'calm' | 'isles' | 'lumpy' | 'flat' | 'sun';

/** A terrain of the vocabulary (vocabulary.md, 3.1): design/tuning.ts, `terrain`. */
export interface Terrain {
  readonly look: Partial<PlanetLook>;
  /** A smooth ball at this land level (sim/planet.ts, `flat`), painted by its band and ops alone. */
  readonly flat?: number;
}

/**
 * What a ground's look is made of (design/tuning.ts): the planets' look, the terrains, and a
 * sun's living surface (`look.sun`).
 */
export interface GroundLooks {
  readonly planet: PlanetLook;
  readonly terrain: Readonly<Record<TerrainName, Terrain>>;
  readonly sun: SunSurfaceLook;
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
  /**
   * A sun's ball in this family instead: `biome` is ignored, and the whole ground glows. Without
   * `paint` it is a living surface (sim/sunSurface.ts), whatever its `recipe`.
   */
  readonly sun?: ThemeKey;
  /** A terrain by name, or a smooth ball at a level of its own. Default flat (0.3). */
  readonly recipe?: TerrainName | { readonly flat: number };
  /**
   * A detail of its own, whatever its kind's is (sim/world/glue.ts, `groundDetail`): for a ground
   * that is mostly hidden, or whose parts were fitted to its facets (the Hardware sun's frame).
   */
  readonly detail?: number;
  /** Band stops of its own (shore|low, low|high, high|peak), over the terrain's. */
  readonly stops?: readonly [number, number, number];
  readonly shape?: PlanetShape;
  readonly up?: 'vertex';
  readonly paint?: readonly PaintOp[];
}

/** Is this ground a sun's living surface: a sun's, and not painted over? */
export const isLivingSun = (spec: GroundSpec): boolean => spec.sun !== undefined && !spec.paint;

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
 * The ground's triangles at radius 1: 20 * (detail + 1)^2 of them (its own detail, if it has one). A generator (one slice per
 * face of the icosahedron) so that a close-up ground can be spread over frames (core/jobs.ts).
 */
export function* groundOf(
  spec: GroundSpec,
  seed: string,
  detail: number,
  looks: GroundLooks,
): Generator<void, Tri[]> {
  const { look, flat: level } = groundLook(spec, looks);
  // A living sun: a smooth ball (its tones are the shader's).
  const living = isLivingSun(spec);
  const flat = living ? 0 : level;
  const mesh = yield* generatePlanet(
    {
      radius: 1,
      seed: spec.seed ?? seed,
      detail: spec.detail ?? detail,
      bands: spec.sun ? sunBandsOf(spec.sun) : bandsOf(spec.biome ?? 'terra'),
      ...(flat === undefined ? {} : { flat }),
      ...(spec.shape ? { shape: spec.shape } : {}),
      ...(spec.up ? { up: spec.up } : {}),
      ...(spec.paint ? { paint: painterOf(spec.paint) } : {}),
    },
    look,
  );
  // A sun is light itself: its ball is unlit and blooms. A living one says which sun it is, and
  // is its family's base to a material that knows nothing of tones.
  const g = living ? sunFlag(sunSeed(spec.seed ?? seed)) : spec.sun ? 2 : 0;
  const { sides, bends } = mesh;
  return Array.from({ length: mesh.triangleCount }, (_, i): Tri => {
    const tri = {
      p: [...mesh.positions.subarray(i * 9, i * 9 + 9)],
      c: living
        ? colorOf(`${spec.sun ?? 'sky'}.base`)
        : ([
            mesh.colors[i * 9] ?? 0,
            mesh.colors[i * 9 + 1] ?? 0,
            mesh.colors[i * 9 + 2] ?? 0,
          ] as const),
      g,
      n: mesh.normals.subarray(i * 9, i * 9 + 9),
    };
    // More colours than one: the others, and their lines.
    const side = sides?.subarray(i * 24, i * 24 + 24);
    if (!side?.some((value) => value !== 0)) return tri;
    const bend = bends?.subarray(i * 12, i * 12 + 12);
    return bend?.some((value) => value !== 0) ? { ...tri, s: side, b: bend } : { ...tri, s: side };
  });
}
