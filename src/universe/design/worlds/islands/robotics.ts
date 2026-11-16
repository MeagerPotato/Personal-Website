import { TAU } from '../../../sim/math';
import type { Item, Rows } from '../../../sim/world/rows';
import { beacon } from '../shared';
import {
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
  lamppost,
  leaves,
  puff,
  rock,
  stones,
  tree,
} from '../isles';

/**
 * ROBOTICS: a VEX field on a raised green in the middle of a wooded island. The robot works the
 * field (it shuffles along its side), its cloud of guesses about where it is closes in on it up
 * close (near.ts), the team's workshop smokes at the edge of the wood, a stream pours off the
 * rim, gulls wheel over it all.
 */

/** Half the field's side, and the green it stands on. */
const FIELD = 0.36;
export const ROBOTICS = isle({
  seed: 3,
  hills: 0.12,
  pads: [{ x: 0, z: 0, r: 0.53, dy: 0.05 }],
});
const G = ROBOTICS;

/** Where the robot stands on its field, [x, z] (its pose cloud, near.ts, gathers round it). */
export const ROBOT_AT = [0.17, 0.19] as const;
/** The height of the field's floor. */
export const FIELD_Y = G.h(0, 0) + 0.03;

/** The field: grey tiles inside a low white wall, the tiles' seams a cross of darker lines. */
const field: Item[] = [
  ['box', FIELD * 2, 0.03, FIELD * 2, 'ink.low', { at: G.at(0, 0, 0.015) }],
  ['box', FIELD * 2, 0.034, 0.012, 'space.600', { at: G.at(0, 0, 0.015) }],
  ['box', 0.012, 0.034, FIELD * 2, 'space.600', { at: G.at(0, 0, 0.015) }],
  ...[-1, 1].flatMap((side): Item[] => [
    ['box', FIELD * 2 + 0.04, 0.06, 0.03, 'ink.high', { at: G.at(0, side * FIELD, 0.03) }],
    ['box', 0.03, 0.06, FIELD * 2, 'ink.high', { at: G.at(side * FIELD, 0, 0.03) }],
  ]),
  // Coloured tape at the corners: the alliance stations.
  ['box', 0.12, 0.034, 0.02, 'coral.base', { at: G.at(-FIELD + 0.08, -FIELD + 0.03, 0.015) }],
  ['box', 0.12, 0.034, 0.02, 'sky.base', { at: G.at(FIELD - 0.08, FIELD - 0.03, 0.015) }],
];

/** A mobile goal: a hexagon base with its stake, rings stacked on it. */
const goal = (x: number, z: number, family: 'coral' | 'sky'): Item => [
  'g',
  ['cyl', 0.07, 0, 0.04, 6, 'butter.base'],
  ['cyl', 0.014, 0.04, 0.2, 6, 'ink.mid'],
  ['ring', [0.03, 0.06], 0, TAU, 6, 0.05, 0.075, `${family}.light`, `${family}.base`, 1],
  ['ring', [0.03, 0.06], 0, TAU, 6, 0.085, 0.11, `${family}.light`, `${family}.base`, 1],
  { at: [x, FIELD_Y, z] },
];

/** The robot: a coral chassis on four wheels, a tower and the arm that lifts the rings. */
const bot: Item = [
  'g',
  ['box', 0.16, 0.05, 0.18, 'coral.base', { at: [0, 0.055, 0] }],
  ...[-1, 1].flatMap((sx): Item[] =>
    [-1, 1].map((sz): Item => [
      'cyl',
      0.032,
      -0.016,
      0.016,
      8,
      'space.600',
      { at: [sx * 0.095, 0.032, sz * 0.055], rot: [0, 0, Math.PI / 2] },
    ]),
  ),
  ['box', 0.05, 0.13, 0.05, 'ink.high', { at: [0, 0.14, -0.04] }],
  ['box', 0.035, 0.025, 0.15, 'coral.light', { at: [0, 0.2, 0.03] }],
  ['ring', [0.025, 0.05], 0, TAU, 6, 0.18, 0.2, 'sky.light', 'sky.base', 1, { at: [0, 0, 0.1] }],
  ['box', 0.04, 0.025, 0.01, 'lamp.window', { at: [0, 0.08, 0.091], g: 1 }],
];

/** The team's workshop at the wood's edge, and its chimney. */
const SHOP = G.brg(140, 0.72);
const SPIN = 0.7;
const CHIMNEY = chimneyOf(SHOP, 1.15, SPIN);
/** The stream's pond, in the wood, and the bearing it pours over the rim at. */
const POND = { x: -0.5, z: 0.5, r: 0.09 };
const FALL = 228;

/** Places the wood leaves alone: the green, the workshop, the pond and its stream. */
const CLEAR: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.6],
  [SHOP[0], SHOP[2], 0.18],
  [POND.x, POND.z, 0.16],
  [-0.62, 0.62, 0.12],
  [-0.72, 0.72, 0.1],
];

export const robotics: Rows = [
  G.hull,
  ['field', 0, ...field],
  [
    'stake-rings',
    0,
    ['cyl', 0.024, FIELD_Y, FIELD_Y + 0.42, 6, 'ink.mid'],
    ...([0.03, 0.07, 0.11] as const).map((y, i): Item => [
      'ring',
      [0.04, 0.08],
      0,
      TAU,
      6,
      FIELD_Y + y,
      FIELD_Y + y + 0.03,
      i === 1 ? 'sky.light' : 'coral.light',
      i === 1 ? 'sky.base' : 'coral.base',
      1,
    ]),
    beacon([0, FIELD_Y + 0.44, 0]),
  ],
  ['goals', 0, goal(-0.24, 0.22, 'coral'), goal(0.24, -0.22, 'sky')],
  ['bot', 0, ['g', bot, { at: [ROBOT_AT[0], FIELD_Y, ROBOT_AT[1]], rot: [0, -0.7, 0] }]],
  [
    'wood',
    0,
    ...forest(G, 26, 3, CLEAR),
    tree(G.brg(40, 0.66), 1.25, 'nature.amber', 'nature.gold'),
    tree(G.brg(300, 0.7), 1.15, 'nature.rust', 'nature.amber'),
    rock(G.brg(190, 0.86), 1.2, 1),
    rock(G.brg(20, 0.88), 0.9, 2),
    rock(G.brg(265, 0.62), 0.8, 3),
  ],
  ['meadow', 0, ...flowers(G, 30, 3, CLEAR.slice(0, 1))],
  [
    'workshop',
    0,
    cottage(SHOP, 1.15, 'ink.high', 'nature.tile', SPIN),
    ...stones(G, [SHOP[0] * 0.85, SHOP[2] * 0.85], [0.4, 0.4], 4),
    lamppost(G.brg(118, 0.6), 1),
    lamppost(G.brg(162, 0.6), 1),
  ],
  ['falls', 0, ...falls(G, FALL, POND)],
  ['flow', 0, flow(G, FALL)],
  ['smoke-1', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 0.9)],
  ['smoke-2', 0, puff([CHIMNEY[0], CHIMNEY[1] + 0.02, CHIMNEY[2]], 1.1)],
  ['leaves', 0, leaves(G.brg(40, 0.66, 0.12))],
  ['crystals', 0, ...G.crystals],
  ['gulls', 0, ...gulls(3, 0.75, 0.75, 3)],
  ['islets', 0, islet([1.12, -0.5, -0.45], 1, 1), islet([-1.05, -0.62, 0.5], 0.8, 2)],
  ['clouds', 0, cloud([-1.2, 0.62, -0.5], 0.9), cloud([1.22, 0.5, 0.42], 0.75)],
];
