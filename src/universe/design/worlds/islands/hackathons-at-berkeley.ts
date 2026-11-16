import { TAU } from '../../../sim/math';
import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import type { Item, Rows } from '../../../sim/world/rows';
import {
  bush,
  cloud,
  falls,
  flow,
  flowers,
  forest,
  gulls,
  isle,
  islet,
  jitter,
  lamppost,
  leaves,
  puff,
  rock,
  stones,
  tree,
} from '../isles';

/**
 * HACKATHONS @ BERKELEY: the logistics of a hackathon, as a festival on a flat green. A ring road
 * runs round it and the two hacker buses drive it, bringing the hackers in; inside, a stage
 * with its truss and lights and a crowd in front of it, food stalls under striped awnings,
 * catering tents, a big tree, and string lights on poles all round. Outside the road: the food
 * truck smoking at its grill, the depot with the merchandise stacked by its door, a wood in
 * jacaranda purples and blossom, and a stream that pours off the rim.
 */

export const BERKELEY = isle({
  seed: 29,
  hills: 0.12,
  bumps: 0.03,
  crystal: 'nature.rose',
  pads: [{ x: 0, z: 0, r: 0.68, dy: 0.05 }],
});
const G = BERKELEY;

/** The green's height (the pad), and the ring road on it. */
const GREEN = G.h(0, 0);
const ROAD: [number, number] = [0.52, 0.64];
const LANE = (ROAD[0] + ROAD[1]) / 2;
const ROAD_Y = GREEN + 0.012;

/** A straight beam of square section `w` from a to b (a cable, a truss). */
const beam = (a: Vec3, b: Vec3, w: number, color: ColorPath): Item => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const at: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return ['box', w, len, w, color, { at, rot: [Math.acos(d[1] / len), Math.atan2(d[0], d[2]), 0] }];
};
/** The yaw that turns a thing's +Z to face compass bearing `deg`. */
const facing = (deg: number): number => Math.PI - (deg * Math.PI) / 180;
const onGreen = (deg: number, r: number, dy = 0): Vec3 => G.brg(deg, r, dy);

const road: Item[] = [
  ['ring', ROAD, 0, TAU, 28, GREEN - 0.03, ROAD_Y, 'ink.low', 'nature.slate', 1],
  [
    'ring',
    [ROAD[0] - 0.012, ROAD[0]],
    0,
    TAU,
    28,
    GREEN - 0.03,
    ROAD_Y + 0.008,
    'ink.high',
    'ink.high',
    1,
  ],
  [
    'ring',
    [ROAD[1], ROAD[1] + 0.012],
    0,
    TAU,
    28,
    GREEN - 0.03,
    ROAD_Y + 0.008,
    'ink.high',
    'ink.high',
    1,
  ],
  // The line down its middle, dashed.
  ...Array.from({ length: 18 }, (_, i): Item => [
    'ring',
    [LANE - 0.007, LANE + 0.007],
    (i / 18) * TAU,
    ((i + 0.45) / 18) * TAU,
    2,
    ROAD_Y,
    ROAD_Y + 0.004,
    'butter.base',
    'butter.base',
    1,
  ]),
];

/** A hacker bus, nose along +X: its body, a band of lit windows, the windscreen, four wheels. */
const bus = (family: 'butter' | 'sky'): Item => [
  'g',
  ['box', 0.36, 0.12, 0.15, `${family}.base`, { at: [0, 0.1, 0] }],
  ['box', 0.34, 0.022, 0.13, `${family}.light`, { at: [0, 0.17, 0] }],
  ['box', 0.12, 0.02, 0.08, `${family}.shade`, { at: [-0.06, 0.188, 0] }],
  ['box', 0.3, 0.04, 0.152, 'sky.light', { at: [-0.02, 0.125, 0], g: 1 }],
  ['box', 0.362, 0.014, 0.154, `${family}.shade`, { at: [0, 0.075, 0] }],
  ['box', 0.01, 0.055, 0.12, 'sky.light', { at: [0.181, 0.12, 0], g: 1 }],
  ...[-0.11, 0.11].flatMap((x): Item[] =>
    [-1, 1].map((sz): Item => [
      'cyl',
      0.034,
      -0.012,
      0.012,
      8,
      'space.600',
      { at: [x, 0.034, sz * 0.072], rot: [Math.PI / 2, 0, 0] },
    ]),
  ),
  ['box', 0.01, 0.022, 0.026, 'nature.lamp', { at: [0.182, 0.06, 0.05], g: 2 }],
  ['box', 0.01, 0.022, 0.026, 'nature.lamp', { at: [0.182, 0.06, -0.05], g: 2 }],
];

/** The stage at the back of the green, turned to the crowd. */
const STAGE = G.at(0.08, -0.3);
const stage: Item = [
  'g',
  ['box', 0.36, 0.05, 0.17, 'nature.wood', { at: [0, 0.025, 0] }],
  ['box', 0.362, 0.03, 0.01, 'space.600', { at: [0, 0.022, 0.086] }],
  ['box', 0.36, 0.2, 0.02, 'space.600', { at: [0, 0.15, -0.08] }],
  ['box', 0.26, 0.11, 0.01, 'lilac.base', { at: [0, 0.16, -0.068], g: 1 }],
  ['box', 0.16, 0.03, 0.012, 'butter.base', { at: [0, 0.18, -0.066], g: 1 }],
  ['box', 0.1, 0.02, 0.012, 'mint.base', { at: [-0.03, 0.135, -0.066], g: 1 }],
  // The truss and the lights hung from it.
  ['box', 0.022, 0.3, 0.022, 'ink.mid', { at: [-0.19, 0.15, -0.06] }],
  ['box', 0.022, 0.3, 0.022, 'ink.mid', { at: [0.19, 0.15, -0.06] }],
  ['box', 0.4, 0.022, 0.022, 'ink.mid', { at: [0, 0.3, -0.06] }],
  ['box', 0.4, 0.016, 0.016, 'ink.mid', { at: [0, 0.3, 0.02] }],
  ...[-0.12, -0.04, 0.04, 0.12].map((x, i): Item => [
    'box',
    0.03,
    0.03,
    0.03,
    i % 2 ? 'coral.light' : 'butter.light',
    { at: [x, 0.275, 0.02], g: 2 },
  ]),
  // Speakers, and the one at the microphone.
  ['box', 0.05, 0.1, 0.05, 'space.900', { at: [-0.2, 0.05, 0.06] }],
  ['box', 0.05, 0.1, 0.05, 'space.900', { at: [0.2, 0.05, 0.06] }],
  ['box', 0.026, 0.045, 0.02, 'coral.base', { at: [0, 0.075, 0.02] }],
  ['box', 0.02, 0.02, 0.02, 'biome.dune.low', { at: [0, 0.108, 0.02] }],
  { at: STAGE, rot: [0, facing(172), 0] },
];

/** The crowd before the stage: a hacker is a body and a head. */
const SHIRTS: readonly ColorPath[] = [
  'coral.base',
  'sky.base',
  'butter.base',
  'mint.base',
  'lilac.base',
  'ink.high',
];
const crowd: Item[] = Array.from({ length: 16 }, (_, i): Item => {
  const x = STAGE[0] - 0.15 + (i % 6) * 0.06 + 0.012 * jitter(29, i);
  const z = STAGE[2] + 0.15 + Math.floor(i / 6) * 0.06 + 0.012 * jitter(31, i);
  return [
    'g',
    ['box', 0.028, 0.045, 0.022, SHIRTS[i % SHIRTS.length] ?? 'coral.base', { at: [0, 0.0225, 0] }],
    ['box', 0.02, 0.02, 0.02, i % 3 ? 'biome.dune.low' : 'nature.bark', { at: [0, 0.055, 0] }],
    { at: G.at(x, z) },
  ];
});

/** A food stall: a counter, a striped awning on posts, a lamp under it. */
const stall = (at: Vec3, yaw: number, family: 'coral' | 'butter' | 'mint'): Item => [
  'g',
  ['box', 0.13, 0.06, 0.07, 'ink.high', { at: [0, 0.03, 0] }],
  ['box', 0.132, 0.012, 0.072, `${family}.base`, { at: [0, 0.066, 0] }],
  ['box', 0.012, 0.13, 0.012, 'ink.mid', { at: [-0.06, 0.065, 0.04] }],
  ['box', 0.012, 0.13, 0.012, 'ink.mid', { at: [0.06, 0.065, 0.04] }],
  ['box', 0.012, 0.15, 0.012, 'ink.mid', { at: [-0.06, 0.075, -0.035] }],
  ['box', 0.012, 0.15, 0.012, 'ink.mid', { at: [0.06, 0.075, -0.035] }],
  ['box', 0.15, 0.014, 0.1, `${family}.base`, { at: [0, 0.145, 0.005], rot: [0.25, 0, 0] }],
  ['box', 0.05, 0.016, 0.102, 'ink.high', { at: [-0.04, 0.147, 0.005], rot: [0.25, 0, 0] }],
  ['box', 0.03, 0.016, 0.102, 'ink.high', { at: [0.05, 0.147, 0.005], rot: [0.25, 0, 0] }],
  ['box', 0.024, 0.024, 0.024, 'nature.lamp', { at: [0, 0.115, 0.01], g: 2 }],
  // What is for sale on the counter.
  ['box', 0.022, 0.02, 0.022, 'nature.amber', { at: [-0.03, 0.08, 0.015] }],
  ['box', 0.022, 0.02, 0.022, 'nature.rust', { at: [0.03, 0.08, 0.015] }],
  { at, rot: [0, yaw, 0] },
];

/** A catering tent: white, peaked, its flap open on a lit inside. */
const tent = (at: Vec3, yaw: number, s: number): Item => [
  'g',
  ['box', 0.14, 0.06, 0.14, 'ink.high', { at: [0, 0.03, 0] }],
  ['cone', 0.115, 0, 0.06, 0.15, 4, 'ink.high', { rot: [0, Math.PI / 4, 0] }],
  ['box', 0.05, 0.05, 0.01, 'lamp.window', { at: [0, 0.03, 0.071], g: 1 }],
  ['box', 0.012, 0.04, 0.012, 'ink.mid', { at: [0, 0.17, 0] }],
  ['box', 0.03, 0.018, 0.006, 'coral.base', { at: [0.016, 0.18, 0] }],
  { at, rot: [0, yaw, 0], s },
];

/** The big tree on the green, hung with lights. */
const BIG = G.at(-0.3, -0.08);
const bigTree: Item = [
  'g',
  tree([0, 0, 0], 1.55, 'nature.grass', 'nature.meadow'),
  ...Array.from({ length: 7 }, (_, i): Item => {
    const a = i * 2.3;
    return [
      'box',
      0.022,
      0.022,
      0.022,
      i % 2 ? 'butter.light' : 'nature.lamp',
      { at: [0.15 * Math.cos(a), 0.22 + 0.05 * Math.sin(i * 1.7), 0.15 * Math.sin(a)], g: 2 },
    ];
  }),
  { at: BIG },
];

/** String lights on poles round the green, sagging between them, their bulbs in the families. */
/** Round the back of the green only, so the front is open to see the festival over. */
const POLES = [250, 300, 350, 40, 90];
const POLE_R = 0.47;
const POLE_H = 0.2;
const BULBS: readonly ColorPath[] = [
  'butter.light',
  'coral.light',
  'mint.light',
  'sky.light',
  'nature.lamp',
];
const poles: Item[] = POLES.map((deg): Item => [
  'g',
  ['box', 0.016, POLE_H, 0.016, 'ink.mid', { at: [0, POLE_H / 2, 0] }],
  ['box', 0.024, 0.016, 0.024, 'ink.mid', { at: [0, POLE_H, 0] }],
  { at: onGreen(deg, POLE_R) },
]);
const SPANS = POLES.slice(0, -1).map((deg, i) => [deg, POLES[i + 1] ?? deg] as const);
const sag = (i: number, t: number): Vec3 => {
  const [from, to] = SPANS[i] ?? [0, 0];
  const a = onGreen(from, POLE_R, POLE_H);
  const b = onGreen(to, POLE_R, POLE_H);
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.1, (a[2] + b[2]) / 2];
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * mid[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * mid[1] + t * t * b[1],
    u * u * a[2] + 2 * u * t * mid[2] + t * t * b[2],
  ];
};
const cables: Item[] = SPANS.flatMap((_, i): Item[] => [
  beam(sag(i, 0), sag(i, 0.5), 0.007, 'ink.low'),
  beam(sag(i, 0.5), sag(i, 1), 0.007, 'ink.low'),
]);
const lights: Item[] = SPANS.flatMap((_, i): Item[] =>
  [0.17, 0.34, 0.5, 0.66, 0.83].map((t, k): Item => {
    const p = sag(i, t);
    return [
      'box',
      0.024,
      0.028,
      0.024,
      BULBS[(i + k) % BULBS.length] ?? 'nature.lamp',
      { at: [p[0], p[1] - 0.017, p[2]], g: 2 },
    ];
  }),
);

/** The food truck by the road, its grill's chimney smoking. */
const TRUCK = onGreen(62, 0.79);
const TRUCK_YAW = facing(62) + Math.PI / 2;
const truck: Item = [
  'g',
  ['box', 0.26, 0.13, 0.13, 'ink.high', { at: [0, 0.1, 0] }],
  ['box', 0.08, 0.09, 0.13, 'coral.base', { at: [0.155, 0.08, 0] }],
  ['box', 0.01, 0.04, 0.1, 'sky.light', { at: [0.196, 0.1, 0], g: 1 }],
  ['box', 0.14, 0.05, 0.01, 'lamp.window', { at: [-0.02, 0.12, 0.066], g: 2 }],
  ['box', 0.17, 0.012, 0.06, 'coral.base', { at: [-0.02, 0.16, 0.09], rot: [-0.35, 0, 0] }],
  ['box', 0.262, 0.03, 0.132, 'coral.base', { at: [0, 0.05, 0] }],
  ['box', 0.03, 0.06, 0.03, 'ink.mid', { at: [-0.08, 0.19, -0.03] }],
  ...[-0.08, 0.14].flatMap((x): Item[] =>
    [-1, 1].map((sz): Item => [
      'cyl',
      0.03,
      -0.01,
      0.01,
      8,
      'space.600',
      { at: [x, 0.03, sz * 0.062], rot: [Math.PI / 2, 0, 0] },
    ]),
  ),
  { at: TRUCK, rot: [0, TRUCK_YAW, 0] },
];
const CHIMNEY: Vec3 = [
  TRUCK[0] + -0.08 * Math.cos(TRUCK_YAW) + -0.03 * Math.sin(TRUCK_YAW),
  TRUCK[1] + 0.23,
  TRUCK[2] - -0.08 * Math.sin(TRUCK_YAW) + -0.03 * Math.cos(TRUCK_YAW),
];

/** The depot, and the merchandise in boxes by its door. */
const DEPOT = onGreen(300, 0.8);
const depot: Item = [
  'g',
  ['box', 0.24, 0.15, 0.18, 'nature.flint', { at: [0, 0.075, 0] }],
  ['box', 0.26, 0.03, 0.2, 'sky.shade', { at: [0, 0.16, 0] }],
  ['box', 0.11, 0.1, 0.01, 'ink.mid', { at: [0, 0.05, 0.091] }],
  ['box', 0.05, 0.03, 0.01, 'lamp.window', { at: [0, 0.125, 0.091], g: 1 }],
  ...[
    [0.16, 0.03, 0.03, 'biome.dune.shore'],
    [0.16, 0.09, 0.03, 'butter.base'],
    [0.16, 0.03, -0.04, 'biome.dune.shore'],
    [0.22, 0.03, 0.0, 'sky.base'],
    [0.16, 0.15, 0.0, 'biome.dune.shore'],
  ].map(([x = 0, y = 0, z = 0, c]): Item => [
    'box',
    0.06,
    0.06,
    0.06,
    c as ColorPath,
    { at: [x as number, y as number, z as number] },
  ]),
  { at: DEPOT, rot: [0, facing(300) + Math.PI, 0] },
];

/** The stream's pond, and the bearing it pours over the rim at. */
const POND = { x: -0.5, z: 0.62, r: 0.075 };
const FALL = 222;

const CLEAR: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.7],
  [TRUCK[0], TRUCK[2], 0.2],
  [DEPOT[0], DEPOT[2], 0.2],
  [POND.x, POND.z, 0.13],
  [-0.62, 0.72, 0.1],
  // The front stays low, so the festival is seen over it.
  [0, 0.86, 0.22],
  [0.42, 0.76, 0.16],
];

export const berkeley: Rows = [
  G.hull,
  ['road', 0, ...road],
  [
    'bus',
    0,
    ['g', bus('butter'), { at: [0, ROAD_Y, -LANE], rot: [0, Math.PI, 0] }],
    ['g', bus('sky'), { at: [0, ROAD_Y, LANE] }],
  ],
  ['stage', 0, stage, ...crowd],
  [
    'catering',
    0,
    stall(onGreen(118, 0.36), facing(130), 'coral'),
    stall(onGreen(148, 0.38), facing(150), 'butter'),
    stall(onGreen(178, 0.38), facing(170), 'mint'),
    tent(onGreen(222, 0.36), facing(200), 1),
    tent(onGreen(250, 0.37), facing(215), 0.9),
  ],
  ['big-tree', 0, bigTree],
  ['string-lights', 0, ...lights],
  ['poles', 0, ...poles, ...cables],
  ['depot', 0, truck, depot],
  [
    'wood',
    0,
    ...forest(
      G,
      22,
      29,
      CLEAR,
      ['nature.plum', 'nature.rose', 'lilac.base', 'nature.grass'],
      [0.72, 0.93],
    ),
    rock(G.brg(170, 0.88), 1, 1),
    rock(G.brg(10, 0.9), 1.1, 2),
    bush(G.brg(150, 0.86), 1.1, 'nature.moss'),
    bush(G.brg(190, 0.84), 1, 'nature.grass'),
    bush(G.brg(130, 0.78), 0.9, 'nature.pine'),
  ],
  ['meadow', 0, ...flowers(G, 30, 29, [[0, 0, 0.66]])],
  [
    'path',
    0,
    ...stones(G, [DEPOT[0] * 0.86, DEPOT[2] * 0.86], [DEPOT[0] * 0.7, DEPOT[2] * 0.7], 2),
    lamppost(onGreen(100, 0.7), 1),
    lamppost(onGreen(240, 0.7), 1),
    // The bus stop.
    [
      'g',
      ['box', 0.012, 0.16, 0.012, 'ink.mid', { at: [0, 0.08, 0] }],
      ['box', 0.06, 0.05, 0.01, 'sky.base', { at: [0, 0.15, 0] }],
      ['box', 0.03, 0.012, 0.012, 'ink.high', { at: [0, 0.15, 0.006] }],
      { at: onGreen(195, 0.69), rot: [0, facing(195), 0] },
    ],
  ],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  ['leaves', 0, leaves(onGreen(330, 0.82, 0.14), ['nature.plum', 'nature.rose', 'lilac.light'])],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.8, 0.74, 29)],
  ['islets', 0, islet([1.1, -0.5, 0.38], 0.9, 7), islet([-1.06, -0.62, -0.46], 0.75, 8)],
  ['clouds', 0, cloud([1.22, 0.58, -0.4], 0.9), cloud([-1.24, 0.52, 0.3], 0.75)],
];
