import { hexToLinear } from '../../sim/color';
import { MeshBuilder, type ModelData } from '../../sim/meshBuilder';
import { tokens } from '../tokens';

/**
 * THE ROCKET, first pass: a chunky toy rocket, 2 u long, nose along +Z, +Y up. Generic on purpose;
 * Allen's own rocket (name, look, maybe one of the real ones from CAD) replaces it later, either by
 * editing the numbers here or by pointing `assets.rocket` at a .glb (design/assets.ts).
 *
 * DESIGN SURFACE: every number and colour here is free to change. What logic relies on is only the
 * conventions (length about 2 u, +Z forward, +Y up) and the socket names.
 */

const SIDES = 8;
/** With 8 sides this turn puts a flat facet exactly on top, where the window sits. */
const PHASE = Math.PI / 8;

const paint = {
  hull: tokens.color.ink.high,
  accent: tokens.color.system.coral.base,
  tail: tokens.color.ink.high,
  metal: tokens.color.ink.low,
  bore: tokens.color.space[700],
  glass: tokens.color.system.sky.base,
  glassRim: tokens.color.ink.mid,
} as const;

/**
 * The hull's profile, walked from inside the nozzle, round its lip, and forward along the outside
 * to the tip of the nose (see MeshBuilder.lathe for why that order). `paint` colours the band
 * from its ring to the NEXT one.
 */
const profile = [
  { z: -0.78, radius: 0, paint: paint.bore }, // the dark inside of the nozzle
  { z: -1.0, radius: 0.25, paint: paint.metal }, // the lip
  { z: -1.0, radius: 0.3, paint: paint.metal }, // the bell, from outside
  { z: -0.74, radius: 0.17, paint: paint.tail }, // the plate the bell is bolted to
  { z: -0.74, radius: 0.36, paint: paint.accent }, // a flared skirt
  { z: -0.58, radius: 0.42, paint: paint.hull }, // the body
  { z: 0.2, radius: 0.42, paint: paint.accent }, // the nose cone, in three bands
  { z: 0.52, radius: 0.33, paint: paint.accent },
  { z: 0.8, radius: 0.18, paint: paint.accent },
  { z: 1.0, radius: 0, paint: paint.accent }, // the tip (its paint is never used)
] as const;

/** One swept fin as [distance from the axis, z]. Four of them, in an X seen from behind. */
const fin = {
  outline: [
    [0.34, -0.12],
    [0.88, -0.74],
    [0.88, -1.04],
    [0.34, -0.72],
  ],
  thickness: 0.08,
  angles: [0.25, 0.75, 1.25, 1.75].map((turns) => turns * Math.PI),
} as const;

/** The round window on top, where the chase camera sees it. */
const porthole = { z: -0.12, rimRadius: 0.17, glassRadius: 0.115, lift: 0.012 } as const;

export function buildRocket(): ModelData {
  const builder = new MeshBuilder();

  builder.lathe(
    profile.map(({ z, radius }) => ({ z, radius })),
    SIDES,
    profile.map((ring) => hexToLinear(ring.paint)),
    PHASE,
  );

  for (const angle of fin.angles) {
    builder.plate(fin.outline, angle, fin.thickness, hexToLinear(paint.accent));
  }

  // The top facet of the body is flat, at the apothem of the polygon.
  const top = 0.42 * Math.cos(Math.PI / SIDES);
  builder
    .disc(
      [0, top + porthole.lift, porthole.z],
      [0, 1, 0],
      porthole.rimRadius,
      8,
      hexToLinear(paint.glassRim),
    )
    .disc(
      [0, top + porthole.lift * 2, porthole.z],
      [0, 1, 0],
      porthole.glassRadius,
      8,
      hexToLinear(paint.glass),
    );

  return {
    mesh: builder.build(),
    sockets: {
      /** Where the flame starts: just inside the bell. */
      engine: [0, 0, -0.94],
    },
  };
}
