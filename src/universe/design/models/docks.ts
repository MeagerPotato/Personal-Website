import { hexToLinear } from '../../sim/color';
import { MeshBuilder, type ModelData } from '../../sim/meshBuilder';
import { tokens } from '../tokens';

/**
 * THE THINGS THAT ARE NOT PLANETS: the Resume station and the Contact satellite of the home
 * system, the relays beside the satellite (Allen's profiles elsewhere), and the ring a ringed
 * planet wears. Each is modelled to fit a sphere of radius 1 and is scaled by the body's radius
 * from the manifest, +Y up.
 *
 * DESIGN SURFACE: shapes and paint are free to change.
 */

const paint = {
  hull: hexToLinear(tokens.color.ink.high),
  trim: hexToLinear(tokens.color.system.butter.base),
  dark: hexToLinear(tokens.color.ink.low),
  inner: hexToLinear(tokens.color.ink.mid),
  accent: hexToLinear(tokens.color.system.coral.base),
  panel: hexToLinear(tokens.color.system.sky.base),
  panelFrame: hexToLinear(tokens.color.system.sky.shade),
  /** The colour of a link on the page, for the relays, which are links. */
  link: hexToLinear(tokens.color.accent),
} as const;

/** A wheel station: a ring, a hub, four spokes and a mast. The wheel lies flat, axis up. */
export function buildStation(): ModelData {
  const builder = new MeshBuilder();
  // Round: the wheel and its hub are lit as the tubes they are, and their outlines are round.
  const SIDES = 40;

  // The ring is a square tube: out along the bottom, up the outer wall, back along the top, and
  // down the inner wall (walking backwards gives the wall that faces the hub).
  builder.lathe(
    [
      { z: -0.1, radius: 0.76 },
      { z: -0.1, radius: 1 },
      { z: 0.1, radius: 1 },
      { z: 0.1, radius: 0.76 },
      { z: -0.1, radius: 0.76 },
    ],
    SIDES,
    [paint.hull, paint.trim, paint.hull, paint.inner],
  );

  // The hub, capped at both ends.
  builder
    .lathe(
      [
        { z: -0.28, radius: 0 },
        { z: -0.28, radius: 0.2 },
        { z: 0.28, radius: 0.2 },
        { z: 0.28, radius: 0 },
      ],
      20,
      [paint.dark, paint.hull, paint.accent],
    )
    .box([0.48, 0, 0], [0.58, 0.07, 0.07], paint.dark)
    .box([-0.48, 0, 0], [0.58, 0.07, 0.07], paint.dark)
    .box([0, 0.48, 0], [0.07, 0.58, 0.07], paint.dark)
    .box([0, -0.48, 0], [0.07, 0.58, 0.07], paint.dark)
    .box([0, 0, 0.5], [0.04, 0.04, 0.44], paint.dark) // the mast
    .rotateX(-Math.PI / 2);

  return { mesh: builder.build(), sockets: {} };
}

/** A comms satellite: a boxy body, two solar wings and a dish that looks up. */
export function buildSatellite(): ModelData {
  const builder = new MeshBuilder();

  // The dish, as a bowl: up its back, round the rim, and down its inside. Then stood upright.
  builder
    .lathe(
      [
        { z: 0.3, radius: 0 },
        { z: 0.52, radius: 0.36 },
        { z: 0.52, radius: 0.33 },
        { z: 0.33, radius: 0 },
      ],
      24,
      [paint.inner, paint.hull, paint.hull],
    )
    .box([0, 0, 0.42], [0.03, 0.03, 0.3], paint.accent) // the feed horn
    .rotateX(-Math.PI / 2);

  builder
    .box([0, 0, 0], [0.42, 0.42, 0.6], paint.hull)
    .box([0, 0, -0.33], [0.3, 0.3, 0.06], paint.trim)
    .box([0.32, 0, 0], [0.22, 0.05, 0.05], paint.dark)
    .box([-0.32, 0, 0], [0.22, 0.05, 0.05], paint.dark)
    .box([0.7, 0, 0], [0.56, 0.03, 0.44], paint.panel)
    .box([-0.7, 0, 0], [0.56, 0.03, 0.44], paint.panel)
    .box([0.7, 0, 0], [0.04, 0.05, 0.46], paint.panelFrame)
    .box([-0.7, 0, 0], [0.04, 0.05, 0.46], paint.panelFrame);

  return { mesh: builder.build(), sockets: {} };
}

/**
 * A relay: a small comms buoy that stands for a profile on another site (GitHub, LinkedIn) and
 * shares the satellite's ring. A float in the colour of a link with a band round it, a keel below,
 * and a thin mast with a beacon on top: no dish and no wings, so that it never reads as the
 * satellite beside it, which can be docked at while a relay cannot. Neither butter nor the
 * cream face, which say "here" and "on" (docs/DESIGN.md). Stands upright.
 */
export function buildRelay(): ModelData {
  const builder = new MeshBuilder();
  builder
    .lathe(
      [
        { z: -0.95, radius: 0 }, // the keel's tip
        { z: -0.55, radius: 0.3 },
        { z: -0.5, radius: 0.42 }, // the float
        { z: -0.2, radius: 0.42 },
        { z: -0.1, radius: 0.42 },
        { z: 0.05, radius: 0.42 },
        { z: 0.05, radius: 0.3 },
        { z: 0.16, radius: 0.1 }, // its shoulder
        { z: 0.7, radius: 0.045 }, // the mast
        { z: 0.76, radius: 0.13 }, // the beacon
        { z: 0.88, radius: 0.13 },
        { z: 0.97, radius: 0 },
      ],
      24,
      [
        paint.dark,
        paint.dark,
        paint.link,
        paint.panelFrame,
        paint.link,
        paint.inner,
        paint.inner,
        paint.dark,
        paint.accent,
        paint.accent,
        paint.accent,
      ],
    )
    .rotateX(-Math.PI / 2);
  return { mesh: builder.build(), sockets: {} };
}

/**
 * A planet's ring: a flat WHITE annulus from radius 1 to `outer / inner`, both faces, lying in the
 * flight plane. It is white so that the material can tint it to its planet's system; Galaxy.ts
 * scales it to the planet.
 */
export function buildPlanetRing(innerToOuter: number): () => ModelData {
  return () => {
    const white = [1, 1, 1] as const;
    const mesh = new MeshBuilder()
      .lathe(
        [
          { z: 0, radius: 1 },
          { z: 0, radius: innerToOuter },
          { z: 0, radius: 1 },
        ],
        72,
        [white, white],
      )
      .rotateX(-Math.PI / 2)
      .build();
    return { mesh, sockets: {} };
  };
}
