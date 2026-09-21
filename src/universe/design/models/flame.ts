import { hexToLinear } from '../../sim/color';
import { MeshBuilder, type ModelData } from '../../sim/meshBuilder';
import { tokens } from '../tokens';

/**
 * THE ENGINE FLAME: a candy-corn cone in three flat bands, hottest at the nozzle. It is modelled
 * ONE unit long and ONE unit wide (radius 1 at its widest), starting at the origin and pointing
 * along -Z; ship/EngineFlame.ts scales it with the throttle. Drawn unlit (it IS the light).
 */

const SIDES = 6;

const profile = [
  { z: -1.0, radius: 0, paint: tokens.color.system.coral.base }, // the tail
  { z: -0.5, radius: 0.66, paint: tokens.color.system.butter.base },
  { z: -0.16, radius: 1.0, paint: tokens.color.star.warm }, // the hot root
  { z: 0, radius: 0.72, paint: tokens.color.star.warm },
] as const;

export function buildFlame(): ModelData {
  const mesh = new MeshBuilder()
    .lathe(
      profile.map(({ z, radius }) => ({ z, radius })),
      SIDES,
      profile.map((ring) => hexToLinear(ring.paint)),
    )
    .build();
  return { mesh, sockets: {} };
}
