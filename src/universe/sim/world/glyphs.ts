import type { ThemeKey } from '../../design/tokens';
import { TAU } from '../math';
import { prism, PRISM, type Tri, type Vec2 } from './kit';
import { colorOf } from './palette';

/**
 * THE FAMILY GLYPHS. A colour family is a colour AND a shape, so that no meaning rests on colour
 * alone (a colour-blind visitor, a grey star map): Home's butter is a circle, Hardware's coral a
 * square, Software's sky a diamond, Research's mint a triangle, Hackathons' lilac a four-point
 * spark. They are the stops of the Circle Line round About Me, and (stage 2 on) the badges on the
 * name tags and the star map.
 *
 * This table is the one place the shapes live, and it is keyed by family: a new family in
 * tokens.ts breaks the compile here until it has a shape. (The Blog's rose would bring the
 * bookmark, a pennant with a notch, when the Blog exists.)
 *
 * Outlines lie in the XZ plane with the apex toward +Z, so that they stand upright on the
 * north-up star map.
 */

export type Outline = readonly Vec2[];

const starPoints = (n: number, r0: number, r1: number): Vec2[] =>
  Array.from({ length: 2 * n }, (_, i): Vec2 => {
    const a = (i / (2 * n)) * TAU;
    const r = i % 2 ? r1 : r0;
    return [r * Math.sin(a), r * Math.cos(a)];
  });

const scaled = (points: readonly Vec2[], k: number): Vec2[] =>
  points.map(([x, z]): Vec2 => [k * x, k * z]);

export const GLYPHS: Readonly<Record<ThemeKey, (r: number) => Outline>> = {
  butter: (r) =>
    Array.from({ length: 12 }, (_, i): Vec2 => [
      r * Math.sin((i / 12) * TAU),
      r * Math.cos((i / 12) * TAU),
    ]),
  coral: (r) =>
    scaled(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0.82 * r,
    ),
  sky: (r) =>
    scaled(
      [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ],
      1.1 * r,
    ),
  mint: (r) =>
    [
      [0, 1],
      [0.93, -0.75],
      [-0.93, -0.75],
    ].map(([x = 0, z = 0]): Vec2 => [r * x, r * z]),
  lilac: (r) => starPoints(4, 1.15 * r, 0.36 * r),
};

/** A family's glyph as a flat plate, h thick on the plane y: light on top, base walls, shade under. */
export const glyph = (family: ThemeKey, r: number, y = 0, h = 0.04): Tri[] =>
  prism(
    GLYPHS[family](r),
    y,
    y + h,
    colorOf(`${family}.light`),
    colorOf(`${family}.base`),
    colorOf(`${family}.shade`),
    PRISM.fanTop,
  );
