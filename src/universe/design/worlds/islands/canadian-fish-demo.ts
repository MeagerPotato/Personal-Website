import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import { FLAG, type Item, type Rows } from '../../../sim/world/rows';
import {
  bush,
  chimneyOf,
  cloud,
  cottage,
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
  type Isle,
} from '../isles';

/**
 * CANADIAN FISH: a lake in a maple wood in autumn, where the game is played. A hand of giant
 * playing cards stands fanned on the hill over the lake like standing stones, a fish leaps from
 * the water ('leap'), a red canoe waits at the dock, the fishing hut smokes on the shore, reeds
 * and lily pads round the water, and the lake spills over the rim as a waterfall.
 */

/** Where the island is seen from first (the lab's turntable, and a ship coming in to dock). */
const VIEW = 135;
const at2 = (deg: number, r: number): readonly [number, number] => [
  r * Math.sin((deg * Math.PI) / 180),
  -r * Math.cos((deg * Math.PI) / 180),
];
/** The lake, flat on its own pad in the front of the island. */
const LAKE = { x: at2(VIEW, 0.24)[0], z: at2(VIEW, 0.24)[1], r: 0.33 };
/** The hill the cards stand on, at the back. */
const HILL = { x: at2(VIEW + 180, 0.44)[0], z: at2(VIEW + 180, 0.44)[1] };

const G = isle({
  seed: 11,
  hills: 0.12,
  bumps: 0.035,
  pads: [
    { x: LAKE.x, z: LAKE.z, r: LAKE.r + 0.04, dy: 0.02 },
    { x: HILL.x, z: HILL.z, r: 0.2, dy: 0.26 },
  ],
  grass: ['nature.moss', 'nature.grass', 'nature.meadow'],
  soil: ['nature.loam', 'nature.soil'],
});

/** A bearing in degrees to the turn that makes a thing's +Z face out along it. */
const face = (deg: number): number => Math.PI - (deg * Math.PI) / 180;

// --- The lake ------------------------------------------------------------------------------------

const WATER_Y = G.h(LAKE.x, LAKE.z) + 0.006;
/** Where the fish breaks the water. */
const LEAP_X = LAKE.x + at2(VIEW + 70, 0.13)[0];
const LEAP_Z = LAKE.z + at2(VIEW + 70, 0.13)[1];
/**
 * The water: a decal, so that it takes the cubes the lawn would (the first to reach a cube takes
 * it): the deep middle first, then the shallows, then a ring of sand round them.
 */
const lake: Item[] = [
  [
    'cyl',
    LAKE.r * 0.7,
    WATER_Y - 0.03,
    WATER_Y,
    12,
    'nature.pool',
    { at: [LAKE.x + 0.02, 0, LAKE.z - 0.02] },
  ],
  ['cyl', LAKE.r, WATER_Y - 0.04, WATER_Y, 14, 'nature.water', { at: [LAKE.x, 0, LAKE.z] }],
  [
    'ring',
    [LAKE.r, LAKE.r * 1.14],
    0,
    Math.PI * 2,
    14,
    WATER_Y - 0.04,
    WATER_Y,
    'nature.sand',
    'nature.sand',
    0,
    { at: [LAKE.x, 0, LAKE.z] },
  ],
];

/** Lily pads and their flowers, and the rings the fish left where it broke the water. */
const LILY: readonly (readonly [number, number])[] = [
  [LAKE.x - 0.22, LAKE.z - 0.05],
  [LAKE.x - 0.18, LAKE.z + 0.1],
  [LAKE.x + 0.16, LAKE.z - 0.14],
  [LAKE.x + 0.05, LAKE.z + 0.24],
  [LAKE.x + 0.2, LAKE.z + 0.08],
];
const pads: Item[] = [
  ...LILY.map(([x, z], i): Item => [
    'cyl',
    0.03 + 0.008 * (i % 2),
    WATER_Y,
    WATER_Y + 0.008,
    8,
    'nature.moss',
    { at: [x, 0, z] },
  ]),
  ...LILY.filter((_, i) => i % 2 === 0).map(([x, z], i): Item => [
    'box',
    0.02,
    0.02,
    0.02,
    i === 1 ? 'ink.high' : 'nature.rose',
    { at: [x + 0.01, WATER_Y + 0.016, z] },
  ]),
  [
    'ring',
    [0.06, 0.085],
    0,
    Math.PI * 2,
    10,
    WATER_Y,
    WATER_Y + 0.008,
    'nature.foam',
    'nature.foam',
    1,
    { at: [LEAP_X, 0, LEAP_Z] },
  ],
  [
    'ring',
    [0.12, 0.135],
    0,
    Math.PI * 2,
    12,
    WATER_Y,
    WATER_Y + 0.006,
    'nature.water',
    'nature.water',
    1,
    { at: [LEAP_X, 0, LEAP_Z] },
  ],
];

/** A clump of reeds: green blades and two brown cattails. */
const reeds = (at: Vec3, s = 1, seed = 0): Item => [
  'g',
  ...[0, 1, 2, 3, 4].map((i): Item => [
    'box',
    0.01,
    0.08 + 0.04 * Math.abs(jitter(seed, i)),
    0.01,
    i % 2 ? 'nature.moss' : 'nature.grass',
    {
      at: [0.02 * jitter(seed, i + 5), 0.05, 0.02 * jitter(seed, i + 9)],
      rot: [0.2 * jitter(seed, i + 13), 0, 0.2 * jitter(seed, i + 17)],
    },
  ]),
  ['box', 0.016, 0.035, 0.016, 'nature.bark', { at: [0.012, 0.115, 0] }],
  ['box', 0.016, 0.035, 0.016, 'nature.bark', { at: [-0.014, 0.1, 0.01] }],
  { at, s },
];

// --- The hand of cards on the hill ----------------------------------------------------------------

type Suit = 'heart' | 'diamond' | 'spade' | 'club';
const RED: ColorPath = 'coral.base';
const BLACK: ColorPath = 'space.800';

/** A suit's pip, about 0.06 across, on a card's face (+Z). */
const pip = (suit: Suit, z: number): Item => {
  const c = suit === 'heart' || suit === 'diamond' ? RED : BLACK;
  switch (suit) {
    case 'diamond':
      return [
        'box',
        0.045,
        0.045,
        0.01,
        c,
        { at: [0, 0, z], rot: [0, 0, Math.PI / 4], s: [0.85, 1.15, 1] },
      ];
    case 'heart':
      return [
        'g',
        ['bead', 0.022, c, { at: [-0.018, 0.01, z] }],
        ['bead', 0.022, c, { at: [0.018, 0.01, z] }],
        ['box', 0.04, 0.04, 0.01, c, { at: [0, -0.008, z], rot: [0, 0, Math.PI / 4] }],
      ];
    case 'spade':
      return [
        'g',
        ['bead', 0.022, c, { at: [-0.018, -0.006, z] }],
        ['bead', 0.022, c, { at: [0.018, -0.006, z] }],
        ['box', 0.04, 0.04, 0.01, c, { at: [0, 0.012, z], rot: [0, 0, Math.PI / 4] }],
        ['box', 0.012, 0.035, 0.01, c, { at: [0, -0.03, z] }],
      ];
    case 'club':
      return [
        'g',
        ['bead', 0.02, c, { at: [0, 0.02, z] }],
        ['bead', 0.02, c, { at: [-0.02, -0.006, z] }],
        ['bead', 0.02, c, { at: [0.02, -0.006, z] }],
        ['box', 0.012, 0.035, 0.01, c, { at: [0, -0.03, z] }],
      ];
  }
};

/** A playing card on its edge: a white face with its pip and corners, a sky back. */
const CARD_W = 0.19;
const CARD_H = 0.29;
const card = (suit: Suit, paper: ColorPath): Item => {
  const c = suit === 'heart' || suit === 'diamond' ? RED : BLACK;
  return [
    'g',
    ['box', CARD_W, CARD_H, 0.018, paper],
    ['box', CARD_W - 0.03, CARD_H - 0.03, 0.006, 'sky.base', { at: [0, 0, -0.011] }],
    ['box', 0.05, 0.05, 0.008, 'sky.light', { at: [0, 0, -0.014], rot: [0, 0, Math.PI / 4] }],
    ['g', pip(suit, 0.012), { s: [1.7, 1.7, 1] }],
    ['box', 0.02, 0.04, 0.008, c, { at: [-CARD_W / 2 + 0.025, CARD_H / 2 - 0.035, 0.011] }],
    ['box', 0.02, 0.04, 0.008, c, { at: [CARD_W / 2 - 0.025, -CARD_H / 2 + 0.035, 0.011] }],
  ];
};

/**
 * The hand: six cards fanned from one corner, their faces to +Z: square to the cubes, so that the
 * pips land on them cleanly (a face turned off the grid comes out in steps).
 */
const HAND: readonly Suit[] = ['spade', 'heart', 'club', 'diamond', 'spade', 'heart'];
const HAND_AT = G.at(HILL.x, HILL.z, 0.0);
const hand: Item = [
  'g',
  ...HAND.map((suit, i): Item => {
    const a = (i - (HAND.length - 1) / 2) * 0.3;
    const reach = CARD_H / 2 + 0.05;
    return [
      'g',
      card(suit, i % 2 ? 'star.warm' : 'ink.high'),
      { at: [-Math.sin(a) * reach, Math.cos(a) * reach - 0.02, i * 0.026], rot: [0, 0, a] },
    ];
  }),
  // A boulder at its foot, as a hand holds a fan.
  ['bead', 0.07, 'nature.rock', { at: [0, 0.03, 0.06] }],
  ['bead', 0.05, 'nature.flint', { at: [0.06, 0.02, 0.09] }],
  { at: HAND_AT },
];

// --- The fish -------------------------------------------------------------------------------------

/** A salmon, nose along +X, cut from plates: its body, a pale belly, a forked tail, fins, an eye. */
const salmon: Item = [
  'g',
  [
    'fin',
    [
      [0.17, -0.005],
      [0.14, 0.04],
      [0.06, 0.07],
      [-0.04, 0.065],
      [-0.12, 0.03],
      [-0.14, 0],
      [-0.12, -0.025],
      [-0.04, -0.055],
      [0.06, -0.06],
      [0.14, -0.035],
    ],
    0.1,
    'coral.base',
  ],
  [
    'fin',
    [
      [0.14, -0.03],
      [0.06, -0.015],
      [-0.06, -0.015],
      [-0.12, -0.022],
      [-0.04, -0.055],
      [0.06, -0.06],
    ],
    0.106,
    'coral.light',
  ],
  [
    'fin',
    [
      [0.1, 0.05],
      [0.02, 0.071],
      [-0.08, 0.05],
      [-0.08, 0.035],
      [0.1, 0.035],
    ],
    0.104,
    'nature.rust',
  ],
  [
    'fin',
    [
      [-0.11, 0.0],
      [-0.22, 0.1],
      [-0.19, 0.0],
    ],
    0.03,
    'coral.shade',
  ],
  [
    'fin',
    [
      [-0.11, 0.0],
      [-0.19, 0.0],
      [-0.22, -0.1],
    ],
    0.03,
    'coral.shade',
  ],
  [
    'fin',
    [
      [0.03, 0.06],
      [-0.05, 0.12],
      [-0.08, 0.055],
    ],
    0.02,
    'coral.shade',
  ],
  [
    'fin',
    [
      [0.06, -0.05],
      [-0.02, -0.1],
      [-0.03, -0.045],
    ],
    0.12,
    'coral.shade',
  ],
  ['box', 0.024, 0.024, 0.104, 'space.900', { at: [0.12, 0.015, 0] }],
  ['box', 0.01, 0.01, 0.108, 'ink.high', { at: [0.126, 0.021, 0] }],
];
const LEAP_AT: Vec3 = [LEAP_X, WATER_Y + 0.27, LEAP_Z];
/**
 * The fish, side on to +Z (square to the cubes), nose along +X. It is modelled nose up by
 * LEAP_TILT, as it rises (the still); 'leap' slides it up and down and pitches it about its own Z.
 */
const LEAP_TILT = 0.3;
const leap: Item = [
  'g',
  ['g', salmon, { rot: [0, 0, LEAP_TILT], s: 1.05 }],
  // Drops shaken off its tail.
  ['box', 0.02, 0.02, 0.02, 'nature.foam', { at: [-0.15, -0.1, 0.04] }],
  ['box', 0.016, 0.016, 0.016, 'nature.water', { at: [-0.19, -0.04, 0.06] }],
  ['box', 0.016, 0.016, 0.016, 'nature.foam', { at: [-0.12, -0.16, 0.02] }],
  { at: LEAP_AT },
];

// --- The shore: the dock, the canoe, the hut ------------------------------------------------------

/** The dock: planks on posts from the right shore out over the water, a lantern at its end. */
const DOCK_FROM: readonly [number, number] = [LAKE.x + 0.36, LAKE.z - 0.14];
const DOCK_TO: readonly [number, number] = [LAKE.x + 0.12, LAKE.z - 0.06];
const DOCK_LEN = Math.hypot(DOCK_TO[0] - DOCK_FROM[0], DOCK_TO[1] - DOCK_FROM[1]);
const DOCK_YAW = Math.atan2(DOCK_TO[0] - DOCK_FROM[0], DOCK_TO[1] - DOCK_FROM[1]);
const DECK_Y = WATER_Y + 0.03;
const dock: Item = [
  'g',
  ['box', 0.085, 0.016, DOCK_LEN, 'nature.wood', { at: [0, 0, 0] }],
  ...Array.from({ length: 6 }, (_, i): Item => [
    'box',
    0.088,
    0.018,
    0.008,
    'nature.bark',
    { at: [0, 0.001, -DOCK_LEN / 2 + 0.03 + (i * (DOCK_LEN - 0.06)) / 5] },
  ]),
  ...[-1, 1].flatMap((sx): Item[] =>
    [0.25, 0.75].map((t): Item => [
      'box',
      0.018,
      0.07,
      0.018,
      'nature.bark',
      { at: [sx * 0.045, -0.02, -DOCK_LEN / 2 + t * DOCK_LEN] },
    ]),
  ),
  ['box', 0.014, 0.12, 0.014, 'nature.bark', { at: [0.045, 0.06, DOCK_LEN / 2 - 0.01] }],
  ['box', 0.03, 0.03, 0.03, 'space.600', { at: [0.045, 0.12, DOCK_LEN / 2 - 0.01] }],
  ['bead', 0.019, 'nature.lamp', { at: [0.045, 0.12, DOCK_LEN / 2 + 0.002], g: 2 }],
  {
    at: [(DOCK_FROM[0] + DOCK_TO[0]) / 2, DECK_Y, (DOCK_FROM[1] + DOCK_TO[1]) / 2],
    rot: [0, DOCK_YAW, 0],
  },
];

/** A red canoe tied at the dock's end, a paddle across it. */
const canoe: Item = [
  'g',
  ['box', 0.2, 0.035, 0.06, 'nature.brick', { at: [0, 0.018, 0] }],
  ['box', 0.07, 0.03, 0.042, 'nature.brick', { at: [0.12, 0.022, 0], rot: [0, Math.PI / 4, 0] }],
  ['box', 0.07, 0.03, 0.042, 'nature.brick', { at: [-0.12, 0.022, 0], rot: [0, Math.PI / 4, 0] }],
  ['box', 0.18, 0.012, 0.04, 'nature.wood', { at: [0, 0.03, 0] }],
  ['box', 0.012, 0.02, 0.058, 'nature.bark', { at: [0.04, 0.04, 0] }],
  ['box', 0.16, 0.01, 0.014, 'nature.wood', { at: [-0.01, 0.046, 0.01], rot: [0, 0.4, 0] }],
  { at: [LAKE.x + 0.12, WATER_Y - 0.006, LAKE.z + 0.04], rot: [0, 0.4, 0] },
];

/** The fishing hut on the right shore, and where its smoke leaves. */
const HUT = G.brg(VIEW - 70, 0.68);
const HUT_SPIN = face(VIEW - 25);
const HUT_S = 1.15;
const CHIMNEY = chimneyOf(HUT, HUT_S, HUT_SPIN);

/** A birch: a white trunk with dark marks, a crown of gold. */
const birch = (at: Vec3, s = 1): Item => [
  'g',
  ['box', 0.026, 0.2, 0.026, 'ink.high', { at: [0, 0.1, 0] }],
  ['box', 0.028, 0.01, 0.028, 'space.600', { at: [0, 0.06, 0] }],
  ['box', 0.028, 0.01, 0.028, 'space.600', { at: [0, 0.13, 0] }],
  ['bead', 0.07, 'nature.gold', { at: [0, 0.23, 0] }],
  ['bead', 0.05, 'nature.amber', { at: [0.04, 0.2, 0.02] }],
  ['bead', 0.048, 'nature.gold', { at: [-0.03, 0.28, 0] }],
  { at, s },
];

/**
 * The lake pours over the rim on the front left, from a bay of its own edge, straight out from
 * the middle (a fall square to the rim reaches no further than the kit's own).
 */
const OUTLET = {
  x: LAKE.x + at2(VIEW + 38, LAKE.r)[0],
  z: LAKE.z + at2(VIEW + 38, LAKE.r)[1],
  r: 0.07,
};
const FALL = (Math.atan2(OUTLET.x, -OUTLET.z) * 180) / Math.PI;

/** The path from the hut round the lake up to the cards. */
const PATH_A: readonly [number, number] = [HUT[0] - 0.12, HUT[2] - 0.12];
const PATH_B: readonly [number, number] = [HILL.x + 0.2, HILL.z + 0.06];

/**
 * A picnic in the meadow in front of the lake: a blanket in coral and white squares, a hand of
 * three small cards dealt on it, a basket.
 */
const PICNIC = [
  LAKE.x + at2(VIEW - 30, LAKE.r + 0.2)[0],
  LAKE.z + at2(VIEW - 30, LAKE.r + 0.2)[1],
] as const;
const PICNIC_Y = G.h(PICNIC[0], PICNIC[1]);
const picnic: Item = [
  'g',
  ...[0, 1, 2, 3].map((i): Item => [
    'box',
    0.06,
    0.014,
    0.06,
    i === 0 || i === 3 ? 'coral.base' : 'ink.high',
    { at: [(i % 2) * 0.06 - 0.03, 0.007, Math.floor(i / 2) * 0.06 - 0.03] },
  ]),
  ...[-1, 0, 1].map((i): Item => [
    'box',
    0.026,
    0.006,
    0.036,
    'ink.high',
    { at: [i * 0.03, 0.017, 0.005], rot: [0, i * 0.3, 0] },
  ]),
  ['box', 0.008, 0.007, 0.012, 'coral.base', { at: [0.03, 0.021, 0.005] }],
  ['box', 0.008, 0.007, 0.012, 'space.800', { at: [-0.03, 0.021, 0.005] }],
  ['box', 0.04, 0.03, 0.03, 'nature.wood', { at: [0.07, 0.015, -0.05] }],
  ['box', 0.03, 0.006, 0.006, 'nature.bark', { at: [0.07, 0.04, -0.05] }],
  { at: [PICNIC[0], PICNIC_Y, PICNIC[1]] },
];

type Clear = readonly (readonly [number, number, number])[];
const RIM_FALL = at2(FALL, 0.9);
const CLEAR: Clear = [
  [PICNIC[0], PICNIC[1], 0.12],
  [LAKE.x, LAKE.z, LAKE.r + 0.1],
  [HILL.x, HILL.z, 0.3],
  [HUT[0], HUT[2], 0.18],
  [OUTLET.x, OUTLET.z, 0.12],
  [(OUTLET.x + RIM_FALL[0]) / 2, (OUTLET.z + RIM_FALL[1]) / 2, 0.12],
  [RIM_FALL[0], RIM_FALL[1], 0.12],
  [PATH_A[0], PATH_A[1], 0.1],
  [(PATH_A[0] + PATH_B[0]) / 2, (PATH_A[1] + PATH_B[1]) / 2, 0.1],
];

/** Trees round the lake, but none tall in front of it: the water shows. */
function wood(isle: Isle, n: number, seed: number): Item[] {
  const front = (x: number, z: number): boolean => {
    const deg = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
    return Math.abs(((deg - VIEW + 540) % 360) - 180) < 42;
  };
  const trees = forest(isle, n, seed, CLEAR, [
    'nature.rust',
    'nature.amber',
    'nature.gold',
    'nature.rust',
    'nature.brick',
  ]);
  return trees.map((t, i): Item => {
    const mod = (t as readonly unknown[])[(t as readonly unknown[]).length - 1] as { at: Vec3 };
    const [x, , z] = mod.at;
    if (front(x, z)) return bush(mod.at, 1.2, i % 2 ? 'nature.moss' : 'nature.grass');
    if (i % 7 === 3) return birch(mod.at, 1);
    return t;
  });
}

export const canadianFish: Rows = [
  G.hull,
  ['lilies', FLAG.decal, ...pads],
  ['lake', FLAG.decal, ...lake],
  ['cards', 0, hand],
  ['leap', 0, leap],
  ['dock', 0, dock, canoe],
  ['picnic', 0, picnic],
  [
    'shore',
    0,
    ...[200, 250, 290, 330, 20, 110, 150].map((deg, i): Item => {
      const [x, z] = at2(deg, LAKE.r + 0.02);
      return reeds(G.at(LAKE.x + x, LAKE.z + z), 1 + 0.2 * jitter(11, i), i);
    }),
    rock(G.at(LAKE.x + at2(270, 0.4)[0], LAKE.z + at2(270, 0.4)[1]), 1.1, 1),
    rock(G.at(LAKE.x + at2(10, 0.42)[0], LAKE.z + at2(10, 0.42)[1]), 0.9, 2),
  ],
  [
    'hut',
    0,
    cottage(HUT, HUT_S, 'nature.wood', 'nature.pine', HUT_SPIN),
    ...stones(G, PATH_A, PATH_B, 6, 'nature.flint'),
    lamppost(G.at(PATH_A[0] + 0.06, PATH_A[1] + 0.04), 1),
    lamppost(G.at(PATH_B[0] + 0.07, PATH_B[1] + 0.02), 1),
  ],
  [
    'wood',
    0,
    ...wood(G, 27, 11),
    tree(G.brg(VIEW + 70, 0.66), 1.3, 'nature.rust', 'nature.amber'),
    tree(G.brg(VIEW - 110, 0.6), 1.2, 'nature.amber', 'nature.gold'),
    birch(G.brg(VIEW + 150, 0.62), 1.2),
    rock(G.brg(VIEW - 50, 0.88), 1.2, 3),
    rock(G.brg(VIEW + 95, 0.86), 1, 4),
  ],
  ['meadow', 0, ...flowers(G, 30, 11, CLEAR.slice(0, 2))],
  ['falls', FLAG.decal, ...falls(G, FALL, OUTLET, 0.75)],
  ['flow', 0, flow(G, FALL, 0.75)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  [
    'leaves',
    0,
    leaves(G.brg(VIEW + 70, 0.66, 0.16), ['nature.rust', 'nature.amber', 'nature.gold']),
  ],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(4, 0.8, 0.72, 11)],
  ['islets', 0, islet([-1.1, -0.5, -0.45], 1, 3), islet([1.05, -0.62, 0.42], 0.85, 4)],
  ['clouds', 0, cloud([1.22, 0.64, -0.42], 0.9), cloud([-1.2, 0.52, 0.5], 0.8)],
];
