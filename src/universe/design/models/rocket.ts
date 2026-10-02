import { hexToLinear } from '../../sim/color';
import { MeshBuilder, type ModelData, type Point, type Rgb } from '../../sim/meshBuilder';
import { tokens } from '../tokens';

/**
 * THE ROCKET, first pass: a chunky toy rocket, 2 u long, nose along +Z, +Y up. Generic on purpose;
 * Allen's own rocket (name, look, maybe one of the real ones from CAD) replaces it later, either by
 * editing the numbers here or by pointing `assets.rocket` at a .glb (design/assets.ts).
 *
 * DESIGN SURFACE: every number and colour here is free to change. What logic relies on is only the
 * conventions (length about 2 u, +Z forward, +Y up) and the socket names.
 */

/**
 * Round ("Deep light": round and smooth): the hull is lit as the body of revolution it is
 * (sim/meshBuilder.ts, `lathe`), and with this many sides its outline is round too. The fins
 * keep their edges.
 */
const SIDES = 24;
const PHASE = Math.PI / SIDES;
const NOSE_BANDS = 8;
/** The radius of the body, where the window sits. */
const BODY = 0.42;

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
  { z: -0.58, radius: BODY, paint: paint.hull }, // the body
  // The nose: a rounded ogive in NOSE_BANDS bands, so that light bends round it as its outline does.
  ...Array.from({ length: NOSE_BANDS + 1 }, (_, i) => {
    const t = i / NOSE_BANDS;
    return {
      z: 0.2 + 0.8 * t,
      radius: i === NOSE_BANDS ? 0 : BODY * Math.cos((t * Math.PI) / 2) ** 0.8,
      paint: paint.accent,
    };
  }),
];

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

/**
 * A round patch laid ON the body's curve, on top: a disc of `radius` about (0, z), every point
 * of it lifted `lift` off the tube, in rings fine enough to follow it. It is lit as the tube is.
 */
function patch(builder: MeshBuilder, radius: number, lift: number, color: Rgb): void {
  const RINGS = 3;
  const at = (ring: number, side: number): Point => {
    const angle = (side / SIDES) * Math.PI * 2;
    const x = ((radius * ring) / RINGS) * Math.cos(angle);
    return [
      x,
      Math.sqrt(BODY * BODY - x * x) + lift,
      porthole.z + ((radius * ring) / RINGS) * Math.sin(angle),
    ];
  };
  const normal = (p: Point): Point => [p[0] / BODY, (p[1] - lift) / BODY, 0];
  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let side = 0; side < SIDES; side += 1) {
      const [a, b, c, d] = [
        at(ring, side),
        at(ring + 1, side),
        at(ring + 1, side + 1),
        at(ring, side + 1),
      ];
      // Seen from above (+Y): a, d, c, b runs counter-clockwise.
      builder.triangle(a, d, c, color, { n: [...normal(a), ...normal(d), ...normal(c)] });
      builder.triangle(a, c, b, color, { n: [...normal(a), ...normal(c), ...normal(b)] });
    }
  }
}

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

  patch(builder, porthole.rimRadius, porthole.lift, hexToLinear(paint.glassRim));
  patch(builder, porthole.glassRadius, porthole.lift * 2, hexToLinear(paint.glass));

  return {
    mesh: builder.build(),
    sockets: {
      /** Where the flame starts: just inside the bell. */
      engine: [0, 0, -0.94],
    },
  };
}
