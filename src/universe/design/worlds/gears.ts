import { TAU } from '../../sim/math';
import { FLAG, type Item, type PartRow, type Rows } from '../../sim/world/rows';
import { sunGround } from './shared';

type Vec3 = [number, number, number];
type Kind = 'big' | 'pin';

// --- the numbers ------------------------------------------------------------------------------------
export const Z = { big: 8, pin: 6 } as const; // teeth: all 24 contacts mesh when z_big is even and z_pin a multiple of 3
const THETA = Math.acos(1 / Math.sqrt(3)); // a cube-face axis to a cube-corner axis: 54.7356 deg
const D_PIN = Math.atan2(Math.sin(THETA), Z.big / Z.pin + Math.cos(THETA)); // 23.1386 deg
const D_BIG = THETA - D_PIN; // 31.5970 deg: the two pitch circles touch
const TOOTH_PITCH = (TAU * Math.sin(D_BIG)) / Z.big; // 0.4115 radii of arc, the same on both gears
const ADD = 0.08; // a tooth rises this far above the pitch circle...
const DED = 0.09; // ...and the root sinks this far below it (0.01 of clearance)
const W_PITCH = 0.41 * TOOTH_PITCH; // tooth width at the pitch circle (leaves 0.59 for the gap)
const W_TIP = 0.3 * TOOTH_PITCH;
export const CORE = 0.94; // the frame ball under the gears

// --- one gear, in its own frame: apex at the origin, +Y outward, a shallow cone going down -------------
function gear(kind: Kind): Item {
  const z = Z[kind];
  const delta = kind === 'big' ? D_BIG : D_PIN;
  const rp = Math.sin(delta); // pitch radius in the plate's own plane
  const slope = (1 - Math.cos(delta)) / rp; // the plate is the cone y = -slope * r
  const root = rp - DED;
  const tip = rp + ADD;
  const w = W_PITCH + ((W_PITCH - W_TIP) * DED) / ADD; // width at the root
  const half = { root: w / (2 * root), tip: W_TIP / (2 * tip) }; // half-widths as angles
  const at = (r: number, b: number, lift = 0): Vec3 => [
    r * Math.sin(b),
    -slope * r + lift,
    -r * Math.cos(b),
  ];
  const out: Item[] = [];
  // the plate: a fan from the apex over the toothed outline, four points a tooth
  const outline: Vec3[] = [];
  for (let j = 0; j < z; j += 1) {
    const c = (j * TAU) / z;
    outline.push(
      at(root, c - half.root),
      at(tip, c - half.tip),
      at(tip, c + half.tip),
      at(root, c + half.root),
    );
  }
  const face = kind === 'big' ? 'coral.light' : 'coral.base';
  outline.forEach((p, i) =>
    out.push(['tri', [0, 0, 0], p, outline[(i + 1) % outline.length] ?? p, face, [0, 1, 0]]),
  );
  // a ring of paint on the web of the big cogs, then a hub and an axle: each ring is invariant under
  // one click of its own gear, so the picture after any number of clicks is exactly the still
  if (kind === 'big') {
    for (let i = 0; i < 16; i += 1) {
      const [b0, b1] = [(i / 16) * TAU, ((i + 1) / 16) * TAU];
      const [a, b, c, d] = [
        at(root * 0.66, b0, 0.01),
        at(root * 0.74, b0, 0.01),
        at(root * 0.74, b1, 0.01),
        at(root * 0.66, b1, 0.01),
      ];
      out.push(
        ['tri', a, b, c, 'coral.base', [0, 1, 0]],
        ['tri', a, c, d, 'coral.base', [0, 1, 0]],
      );
    }
  }
  const disc = (
    share: number,
    n: number,
    color: 'coral.shade' | 'coral.light',
    lift: number,
  ): void => {
    const ring = Array.from({ length: n }, (_, i) => at(root * share, (i / n) * TAU, lift));
    ring.forEach((p, i) =>
      out.push(['tri', [0, lift, 0], p, ring[(i + 1) % n] ?? p, color, [0, 1, 0]]),
    );
  };
  disc(0.42, kind === 'big' ? 8 : 12, 'coral.shade', 0.016); // the hub
  disc(0.18, kind === 'big' ? 8 : 6, 'coral.light', 0.022); // the axle
  return ['g', ...out];
}

// --- the fourteen gears: six cogs on the cube-face axes, eight pinions on the cube-corner axes -------
const CORNER = Math.atan(1 / Math.SQRT2) * (180 / Math.PI); // latitude of a cube corner: 35.2644 deg
export const GEARS: readonly (readonly [name: string, kind: Kind, lat: number, lon: number])[] = [
  ['big-yp', 'big', 90, 0],
  ['big-yn', 'big', -90, 0],
  ['big-xp', 'big', 0, 90],
  ['big-xn', 'big', 0, -90],
  ['big-zp', 'big', 0, 0],
  ['big-zn', 'big', 0, 180],
  ['pin-ppp', 'pin', CORNER, 45],
  ['pin-ppn', 'pin', CORNER, 135],
  ['pin-pnp', 'pin', -CORNER, 45],
  ['pin-pnn', 'pin', -CORNER, 135],
  ['pin-npp', 'pin', CORNER, -45],
  ['pin-npn', 'pin', CORNER, -135],
  ['pin-nnp', 'pin', -CORNER, -45],
  ['pin-nnn', 'pin', -CORNER, -135],
];

export const hardware: Rows = [
  {
    ...sunGround('coral'),
    shape: { p: 2, s: [CORE, CORE, CORE] },
    paint: [['band', 0, 1.01, 'coral.shade']],
  },
  // every pinion half a tooth on from every cog: that is what makes all 24 contacts mesh
  ...GEARS.map(([name, kind, lat, lon]): PartRow => [
    name,
    FLAG.hold | FLAG.glow,
    ['s', lat, lon, { spin: kind === 'pin' ? TAU / 12 : 0 }, gear(kind)],
  ]),
];
