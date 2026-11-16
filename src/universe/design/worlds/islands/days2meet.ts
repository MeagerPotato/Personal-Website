import type { Vec3 } from '../../../sim/world/kit';
import type { ColorPath } from '../../../sim/world/palette';
import type { Item, Rows } from '../../../sim/world/rows';
import { nth } from '../shared';
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
} from '../isles';

/**
 * DAYS2MEET: a month laid out as a walled garden. Five weeks of seven raised beds, each as full
 * of bloom as its day is free (the poll's heat map, grown), a flag on the day everyone can make,
 * the brush that paints a respondent's days sweeping a week. Above it on its knoll the clock
 * tower that says when; round it orchards in blossom, a gardener's shed that smokes, a
 * greenhouse, beehives, and a stream that pours off the rim.
 */

/** How free each day is (0 nobody, 4 everyone), five weeks of seven days. */
// prettier-ignore
const HEAT = [[1, 1, 2, 1, 0, 1, 1], [2, 2, 3, 2, 1, 2, 2], [1, 2, 3, 3, 2, 2, 1], [2, 3, 3, 2, 1, 3, 3], [1, 2, 2, 1, 1, 4, 4]];
/** What a bed grows at each heat (bare soil, then the ramp of the heat map), and its blooms. */
const RAMP = ['nature.soil', 'sky.shade', 'sky.base', 'mint.base', 'mint.light'] as const;
const BLOOM = ['nature.soil', 'sky.base', 'sky.light', 'mint.light', 'ink.high'] as const;
/** The bed's pitch, and where the month's middle is. */
const BED = 0.105;
const MONTH = { x: 0, z: 0.26 };

export const DAYS2MEET = isle({
  seed: 19,
  hills: 0.15,
  bumps: 0.03,
  crystal: 'sky.base',
  pads: [
    { x: MONTH.x, z: MONTH.z, r: 0.45, dy: 0.075 },
    { x: 0, z: -0.54, r: 0.24, dy: 0.1 },
    { x: 0, z: -0.54, r: 0.12, dy: 0.15 },
  ],
});
const G = DAYS2MEET;

/** The middle of the bed of day `col` in week `row` (Sunday on the left, the first week at the back). */
const bedAt = (col: number, row: number): [number, number] => [
  MONTH.x + (col - 3) * BED,
  MONTH.z + (row - 2) * BED,
];
/** The garden's floor: the gravel the beds stand on. */
const FLOOR = G.h(MONTH.x, MONTH.z) + 0.02;

/** One raised bed: a wooden frame, its soil, a cushion of plants as tall as the day is free. */
const bed = (col: number, row: number): Item => {
  const heat = nth(nth(HEAT, row), col);
  const [x, z] = bedAt(col, row);
  const out: Item[] = [
    ['box', BED - 0.014, 0.036, BED - 0.014, 'nature.wood', { at: [0, 0.018, 0] }],
    ['box', BED - 0.04, 0.012, BED - 0.04, 'nature.loam', { at: [0, 0.04, 0] }],
  ];
  if (heat > 0) {
    // Leaves as wide as the day is busy with answers, the heat's colour in bloom on them.
    const w = 0.036 + 0.008 * heat;
    const h = 0.01 + 0.01 * heat;
    out.push(['box', w, h, w, 'nature.moss', { at: [0, 0.046 + h / 2, 0] }]);
    out.push([
      'box',
      w - 0.012,
      0.016,
      w - 0.012,
      nth(RAMP, heat),
      { at: [0, 0.046 + h + 0.006, 0] },
    ]);
    const n = [0, 0, 2, 3, 4][heat] ?? 0;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + col;
      out.push([
        'box',
        0.018,
        0.018,
        0.018,
        nth(BLOOM, heat),
        { at: [0.022 * Math.cos(a), 0.046 + h + 0.018, 0.022 * Math.sin(a)] },
      ]);
    }
  }
  return ['g', ...out, { at: [x, FLOOR, z] }];
};

/** The garden: gravel inside a clipped hedge (gaps for the paths), and the 35 beds. */
const W = BED * 7 + 0.06;
const D = BED * 5 + 0.06;
const hedge = (dx: number, dz: number, w: number, d: number): Item => [
  'box',
  w,
  0.05,
  d,
  'nature.moss',
  { at: [MONTH.x + dx, FLOOR + 0.01, MONTH.z + dz] },
];
const garden: Item[] = [
  // A raised garden: a plinth of stone where the ground falls away, gravel on it.
  ['box', W + 0.05, 0.14, D + 0.05, 'nature.rock', { at: [MONTH.x, FLOOR - 0.1, MONTH.z] }],
  ['box', W + 0.05, 0.02, D + 0.05, 'nature.flint', { at: [MONTH.x, FLOOR - 0.02, MONTH.z] }],
  ['box', W, 0.04, D, 'nature.sand', { at: [MONTH.x, FLOOR - 0.02, MONTH.z] }],
  // The hedge round it, open at the front and the back where the paths come in.
  hedge(-W / 4 - 0.04, D / 2 + 0.02, W / 2 - 0.08, 0.035),
  hedge(W / 4 + 0.04, D / 2 + 0.02, W / 2 - 0.08, 0.035),
  hedge(-W / 4 - 0.04, -D / 2 - 0.02, W / 2 - 0.08, 0.035),
  hedge(W / 4 + 0.04, -D / 2 - 0.02, W / 2 - 0.08, 0.035),
  hedge(-W / 2 - 0.02, 0, 0.035, D + 0.075),
  hedge(W / 2 + 0.02, 0, 0.035, D + 0.075),
  ...HEAT.flatMap((week, row) => week.map((_, col) => bed(col, row))),
];

/** The day everyone can make: a butter flag on its bed. */
const BEST = bedAt(6, 4);
const bestDay: Item = [
  'g',
  ['box', 0.014, 0.3, 0.014, 'ink.high', { at: [0, 0.15, 0] }],
  ['box', 0.12, 0.07, 0.012, 'butter.base', { at: [0.066, 0.25, 0] }],
  ['box', 0.05, 0.02, 0.014, 'butter.light', { at: [0.07, 0.25, 0] }],
  ['bead', 0.018, 'nature.gold', { at: [0, 0.31, 0] }],
  { at: [BEST[0] - 0.03, FLOOR + 0.04, BEST[1] - 0.02] },
];

/** The brush that paints a respondent's free days, over the second week (it sweeps the row). */
const brush: Item = [
  'g',
  // Leaning as it paints; the part's own axes stay the garden's, so it sweeps level.
  [
    'g',
    ['box', 0.024, 0.17, 0.024, 'nature.wood', { at: [0, 0.16, 0] }],
    ['box', 0.044, 0.04, 0.036, 'ink.mid', { at: [0, 0.07, 0] }],
    ['box', 0.054, 0.05, 0.04, 'coral.base', { at: [0, 0.03, 0] }],
    ['box', 0.04, 0.02, 0.03, 'coral.shade', { at: [0, 0.0, 0] }],
    { rot: [0, 0, 0.25] },
  ],
  ['bead', 0.012, 'coral.base', { at: [0.01, -0.03, 0] }],
  { at: [MONTH.x, FLOOR + 0.12, bedAt(0, 1)[1]] },
];

/** The clock tower on its knoll behind the garden. */
const TOWER: Vec3 = G.at(0, -0.56);
const FACE_Y = 0.42;
const clockTower: Item = [
  'g',
  ['box', 0.2, 0.06, 0.2, 'nature.rock', { at: [0, 0.03, 0] }],
  ['box', 0.14, 0.32, 0.14, 'ink.high', { at: [0, 0.2, 0] }],
  ['box', 0.15, 0.025, 0.15, 'sky.base', { at: [0, 0.16, 0] }],
  ['box', 0.15, 0.025, 0.15, 'sky.base', { at: [0, 0.32, 0] }],
  // Arrow-slit windows, lit.
  ['box', 0.03, 0.06, 0.01, 'lamp.window', { at: [0, 0.24, 0.071], g: 1 }],
  ['box', 0.03, 0.05, 0.01, 'lamp.window', { at: [0, 0.1, 0.071], g: 1 }],
  ['box', 0.04, 0.07, 0.01, 'nature.wood', { at: [0, 0.095, -0.071] }],
  // The clock stage, its faces lit from inside.
  ['box', 0.17, 0.15, 0.17, 'ink.high', { at: [0, FACE_Y, 0] }],
  ['box', 0.19, 0.025, 0.19, 'sky.shade', { at: [0, FACE_Y + 0.085, 0] }],
  [
    'cyl',
    0.058,
    0,
    0.012,
    12,
    'butter.light',
    { at: [0, FACE_Y, 0.085], rot: [Math.PI / 2, 0, 0], g: 2 },
  ],
  [
    'cyl',
    0.058,
    0,
    0.012,
    12,
    'butter.light',
    { at: [0.085, FACE_Y, 0], rot: [0, 0, -Math.PI / 2], g: 2 },
  ],
  [
    'cyl',
    0.058,
    0,
    0.012,
    12,
    'butter.light',
    { at: [-0.085, FACE_Y, 0], rot: [0, 0, Math.PI / 2], g: 2 },
  ],
  // The belfry: four posts, a bell, the pyramid roof and its finial.
  ...[-1, 1].flatMap((sx): Item[] =>
    [-1, 1].map((sz): Item => [
      'box',
      0.026,
      0.1,
      0.026,
      'ink.high',
      { at: [sx * 0.07, FACE_Y + 0.15, sz * 0.07] },
    ]),
  ),
  ['cone', 0.04, 0.012, FACE_Y + 0.12, FACE_Y + 0.18, 8, 'nature.gold'],
  ['cone', 0.16, 0, FACE_Y + 0.2, FACE_Y + 0.36, 4, 'sky.base', { rot: [0, Math.PI / 4, 0] }],
  ['box', 0.2, 0.02, 0.2, 'sky.shade', { at: [0, FACE_Y + 0.2, 0] }],
  ['box', 0.012, 0.06, 0.012, 'ink.mid', { at: [0, FACE_Y + 0.39, 0] }],
  ['bead', 0.02, 'nature.gold', { at: [0, FACE_Y + 0.42, 0] }],
  { at: TOWER },
];
/** The hands on the front face (they go round: a part of their own about the face's middle). */
const hands: Item = [
  'g',
  ['box', 0.01, 0.05, 0.008, 'space.900', { at: [0, 0.022, 0], g: 1 }],
  ['box', 0.036, 0.01, 0.008, 'space.900', { at: [0.016, 0, 0], g: 1 }],
  ['box', 0.016, 0.016, 0.01, 'space.600', { g: 1 }],
  { at: [TOWER[0], TOWER[1] + FACE_Y, TOWER[2] + 0.1] },
];

/** A tree of the orchard: a trunk and one round crown (and a lighter top), neater than the wood's. */
const fruitTree = (
  at: Vec3,
  s: number,
  crown: ColorPath,
  top: ColorPath,
  fruit?: ColorPath,
): Item => [
  'g',
  ['box', 0.034, 0.14, 0.034, 'nature.bark', { at: [0, 0.07, 0] }],
  ['bead', 0.1, crown, { at: [0, 0.2, 0] }],
  ['bead', 0.06, top, { at: [-0.025, 0.27, -0.02] }],
  ...(fruit
    ? [0, 1].map((i): Item => [
        'box',
        0.024,
        0.024,
        0.024,
        fruit,
        {
          at: [
            0.095 * Math.cos(i * 2.6 + s * 9),
            0.18 + 0.03 * i,
            0.095 * Math.sin(i * 2.6 + s * 9),
          ],
        },
      ])
    : []),
  { at, s },
];
/** A blossoming tree (pink, or white). */
const blossom = (at: Vec3, s: number, i: number): Item =>
  fruitTree(
    at,
    s,
    i % 3 === 1 ? 'ink.high' : 'nature.rose',
    i % 3 === 2 ? 'ink.high' : 'coral.light',
  );
/** An apple tree: a green crown hung with red fruit. */
const apple = (at: Vec3, s: number): Item =>
  fruitTree(at, s, 'nature.grass', 'nature.meadow', 'nature.brick');

/** Orchards in rows: blossom on the right behind the garden, apples on the left. */
const ROWS_AT = (
  cx: number,
  cz: number,
  cols: number,
  rows: number,
  pitch: number,
): [number, number][] =>
  Array.from({ length: cols * rows }, (_, i): [number, number] => [
    cx + ((i % cols) - (cols - 1) / 2) * pitch + 0.02 * jitter(cx * 10, i),
    cz + (Math.floor(i / cols) - (rows - 1) / 2) * pitch + 0.02 * jitter(cz * 10, i),
  ]).filter(([x, z]) => Math.hypot(x, z) < 0.88);
const BLOSSOM = ROWS_AT(0.52, -0.4, 3, 3, 0.18).slice(0, 7);
const APPLES = ROWS_AT(-0.52, -0.34, 3, 2, 0.18);

/** The gardener's shed, the greenhouse, the hives. */
const SHED = G.brg(272, 0.74);
const SPIN = -Math.PI / 2 + 0.2;
const CHIMNEY = chimneyOf(SHED, 1.05, SPIN);
const HOUSE = G.brg(112, 0.7);
const greenhouse: Item = [
  'g',
  ['box', 0.26, 0.03, 0.16, 'nature.brick', { at: [0, 0.015, 0] }],
  ['box', 0.24, 0.1, 0.14, 'sky.light', { at: [0, 0.08, 0] }],
  ['box', 0.26, 0.022, 0.09, 'sky.light', { at: [0, 0.15, -0.035], rot: [0.55, 0, 0] }],
  ['box', 0.26, 0.022, 0.09, 'sky.light', { at: [0, 0.15, 0.035], rot: [-0.55, 0, 0] }],
  ...[-0.12, -0.04, 0.04, 0.12].map((x): Item => [
    'box',
    0.016,
    0.115,
    0.158,
    'nature.wood',
    { at: [x, 0.085, 0] },
  ]),
  ['box', 0.27, 0.016, 0.016, 'nature.wood', { at: [0, 0.188, 0] }],
  ['box', 0.248, 0.016, 0.158, 'nature.wood', { at: [0, 0.135, 0] }],
  ['box', 0.03, 0.03, 0.01, 'nature.rose', { at: [0.0, 0.07, 0.071] }],
  ['box', 0.03, 0.03, 0.01, 'nature.moss', { at: [-0.08, 0.06, 0.071] }],
  ['box', 0.03, 0.03, 0.01, 'nature.gold', { at: [0.08, 0.065, 0.071] }],
  { at: HOUSE, rot: [0, 0.35, 0] },
];
const hive = (at: Vec3): Item => [
  'g',
  ['box', 0.06, 0.02, 0.06, 'nature.wood', { at: [0, 0.01, 0] }],
  ['box', 0.05, 0.04, 0.05, 'butter.base', { at: [0, 0.04, 0] }],
  ['box', 0.05, 0.04, 0.05, 'butter.shade', { at: [0, 0.08, 0] }],
  ['box', 0.066, 0.016, 0.066, 'ink.high', { at: [0, 0.108, 0] }],
  { at },
];

/** The stream's pond, and the bearing it pours over the rim at. */
const POND = { x: -0.56, z: 0.32, r: 0.085 };
const FALL = 238;

/** Places the wood leaves alone: the garden, the knoll, the orchards, the buildings, the water. */
const CLEAR: readonly (readonly [number, number, number])[] = [
  [-0.22, MONTH.z, 0.36],
  [0.22, MONTH.z, 0.36],
  [0, -0.54, 0.26],
  [0.5, -0.42, 0.3],
  [-0.5, -0.36, 0.28],
  [SHED[0], SHED[2], 0.18],
  [HOUSE[0], HOUSE[2], 0.2],
  [POND.x, POND.z, 0.14],
  [-0.72, 0.42, 0.12],
  [0, -0.2, 0.12],
  // The front stays low (flowers, bushes, rocks), so the garden is seen over it.
  [0, 0.85, 0.36],
  [0.5, 0.68, 0.24],
  [-0.4, 0.74, 0.2],
];

/** The low front of the island, seen over: wildflowers in drifts, and bushes. */
const frontMeadow: Item[] = Array.from({ length: 22 }, (_, i): Item => {
  const b = ((120 + 120 * ((jitter(29, i) + 1) / 2)) * Math.PI) / 180;
  const r = 0.62 + 0.3 * ((jitter(31, i) + 1) / 2);
  const at = G.at(r * Math.sin(b), -r * Math.cos(b), 0.02);
  const color =
    (['nature.rose', 'nature.gold', 'ink.high', 'nature.plum', 'sky.light'] as const)[i % 5] ??
    'ink.high';
  return ['box', 0.022, 0.022, 0.022, color, { at }];
});

export const days2meet: Rows = [
  G.hull,
  ['month-grid', 0, ...garden],
  ['best-day', 0, bestDay],
  ['paint-cursor', 0, brush],
  ['clock-tower', 0, clockTower],
  ['clock-hands', 0, hands],
  [
    'orchard',
    0,
    ...BLOSSOM.map(([x, z], i) => blossom(G.at(x, z), 0.9 + 0.12 * jitter(19, i), i)),
    ...APPLES.map(([x, z], i) => apple(G.at(x, z), 0.85 + 0.1 * jitter(23, i))),
  ],
  [
    'wood',
    0,
    ...forest(
      G,
      10,
      19,
      CLEAR,
      ['nature.grass', 'nature.rose', 'nature.moss', 'coral.light'],
      [0.62, 0.92],
    ),
    tree(G.brg(82, 0.8), 1.1, 'nature.rose', 'coral.light'),
    rock(G.brg(195, 0.86), 1.1, 1),
    rock(G.brg(330, 0.3), 0.8, 2),
    rock(G.brg(60, 0.86), 0.9, 4),
    bush(G.brg(205, 0.66), 1.1, 'nature.moss'),
    bush(G.brg(150, 0.66), 1, 'nature.grass'),
    bush(G.brg(172, 0.86), 1.2, 'nature.moss'),
    bush(G.brg(128, 0.88), 1.1, 'nature.grass'),
    bush(G.brg(190, 0.72), 0.9, 'nature.pine'),
    rock(G.brg(140, 0.9), 0.9, 5),
  ],
  ['meadow', 0, ...flowers(G, 26, 19, CLEAR.slice(0, 3)), ...frontMeadow],
  [
    'shed',
    0,
    cottage(SHED, 1.05, 'ink.high', 'mint.shade', SPIN),
    greenhouse,
    hive(G.brg(140, 0.62)),
    hive(G.brg(148, 0.7)),
    hive(G.brg(132, 0.72)),
    ...stones(G, [0, -0.02], [0, -0.38], 4),
    ...stones(G, [MONTH.x, MONTH.z + D / 2 + 0.06], [0, 0.82], 3),
    ...stones(G, [SHED[0] * 0.8, SHED[2] * 0.8], [-0.44, MONTH.z - 0.12], 3),
    lamppost(G.at(-0.08, -0.22), 1),
    lamppost(G.at(0.42, 0.6), 1),
  ],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  [
    'leaves',
    0,
    leaves(G.at(BLOSSOM[0]?.[0] ?? 0.4, BLOSSOM[0]?.[1] ?? -0.4, 0.12), [
      'nature.rose',
      'coral.light',
      'ink.high',
    ] satisfies ColorPath[]),
  ],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.82, 0.78, 19)],
  ['islets', 0, islet([1.1, -0.52, 0.42], 0.9, 3), islet([-1.08, -0.6, -0.48], 0.75, 4)],
  ['clouds', 0, cloud([-1.22, 0.6, -0.38], 0.9), cloud([1.2, 0.52, -0.4], 0.75)],
];
