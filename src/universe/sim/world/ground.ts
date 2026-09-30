import type { ThemeKey } from '../../design/tokens';
import { tuning } from '../../design/tuning';
import { generatePlanet, type PlanetLook, type PlanetShape } from '../planet';
import type { Tri, Unlit } from './kit';
import { painterOf, type PaintOp } from './paint';
import { bandsOf, sunBandsOf, type Ramp } from './palette';

/**
 * THE GROUND: the low-poly ball a world stands on, made by the engine's own planet generator
 * (sim/planet.ts) with the options it has for worlds of their own. A ground names a TERRAIN (how
 * the noise is shaped: overrides of `tuning.planet`), a ramp (a biome, a colour family or chalk:
 * palette.ts), and optionally a shape, a corner at the pole, band stops of its own and paint.
 * It is modelled at radius 1, like the props that stand on it.
 *
 * The colour nudge is the engine's (a facet's colour moves by up to `tuning.planet.colorJitter`),
 * not the concept prototype's three steps: the worlds should sit among the generated planets as
 * one family, and a sun's `colorJitter: 0` keeps it exact.
 */

export type TerrainName = 'continents' | 'calm' | 'isles' | 'lumpy' | 'flat' | 'sun';

export interface Terrain {
  readonly look: Partial<PlanetLook>;
  /** A smooth ball at this land level (sim/planet.ts, `flat`), painted by its band and ops alone. */
  readonly flat?: number;
}

/** The terrains of the vocabulary (vocabulary.md, 3.1). */
export const TERRAIN: Readonly<Record<TerrainName, Terrain>> = {
  /** The home planet: few, large continents in three terraces. */
  continents: {
    look: {
      reliefShare: 0.045,
      frequency: 1.0,
      octaves: 3,
      seaLevel: 0.02,
      peakAt: 0.55,
      terraces: 3,
      terraceStrength: 0.7,
      bandStops: [0.12, 0.5, 0.85],
    },
  },
  /** Rolling ground with few peaks and little sea. */
  calm: {
    look: {
      reliefShare: 0.03,
      frequency: 0.95,
      octaves: 3,
      seaLevel: -0.5,
      peakAt: 0.55,
      terraces: 2,
      terraceStrength: 0.85,
      bandStops: [0.08, 0.5, 0.86],
    },
  },
  /** Small islands in a sea. */
  isles: {
    look: {
      reliefShare: 0.04,
      frequency: 2.3,
      octaves: 3,
      seaLevel: 0.12,
      peakAt: 0.6,
      terraces: 3,
      terraceStrength: 0.8,
      bandStops: [0.12, 0.5, 0.85],
    },
  },
  /**
   * Planned work: unfired clay, rougher than any built world (the engine's own note in tuning.ts:
   * above 0.07 the outline turns lumpy, which is the point).
   */
  lumpy: {
    look: {
      reliefShare: 0.07,
      frequency: 1.5,
      octaves: 3,
      seaLevel: -0.6,
      peakAt: 0.55,
      terraces: 2,
      terraceStrength: 0.6,
      bandStops: [0.1, 0.5, 0.86],
    },
  },
  /**
   * A smooth ball, every facet at one level (0.3: the low band), so that ALL the character is
   * paint and props. Its stops are pinned here rather than read from tuning.planet: a level was
   * chosen for the band it falls in (-1 the sea, 0.3 low, 0.5 to 0.7 high), and a retune of the
   * generated planets must not repaint these worlds.
   */
  flat: { look: { bandStops: [0.1, 0.46, 0.8] }, flat: 0.3 },
  /** A sun's smooth ball: mostly its base, with lighter and darker patches, and no nudge at all. */
  sun: {
    look: {
      reliefShare: 0,
      frequency: 1.3,
      octaves: 3,
      seaLevel: -0.9,
      peakAt: 0.55,
      terraces: 3,
      terraceStrength: 0.7,
      bandStops: [0.36, 0.6, 0.78],
      colorJitter: 0,
    },
  },
};

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

/** The generator's look for a ground: tuning.planet, the terrain's overrides, its own stops. */
export function groundLook(spec: GroundSpec): { look: PlanetLook; flat: number | undefined } {
  const recipe = spec.recipe ?? 'flat';
  const terrain =
    typeof recipe === 'string' ? TERRAIN[recipe] : { look: TERRAIN.flat.look, flat: recipe.flat };
  return {
    look: {
      ...tuning.planet,
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
export function* groundOf(spec: GroundSpec, seed: string, detail: number): Generator<void, Tri[]> {
  const { look, flat } = groundLook(spec);
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
