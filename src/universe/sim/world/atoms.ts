import { TAU } from '../math';
import type { Rgb } from '../meshBuilder';
import { lathe, prism, quad, tri, type Tri, type Vec2, type Vec3 } from './kit';

/**
 * THE ATOMS: four props so common that every world is partly made of them (radius-1 worlds, +Y
 * up). A bead is a pebble, a rivet, a marker or a stop, and ROUND (kit.ts); a tile a pip, a badge,
 * a window or a chip of confetti, a disc from five sides and a polygon under; a fin a rocket's fin, a dorsal fin or a card; `pix` pixel art, or text through
 * the 3x5 pixel font (a roll number, a scoreboard). Their triangle counts are part of the
 * vocabulary's budget (vocabulary.md, 4.1) and pinned in atoms.test.ts.
 */

/** The sides of a bead nobody asked more of: with three bands pole to pole, 24 triangles. */
export const BEAD_SIDES = 6;

/**
 * A ball of radius r: `sides` round it and half as many bands pole to pole (sides x (bands - 1)
 * x 2 triangles). It was an octahedron; a bead is a ball, and is lit and built as one (rows.ts
 * gives each the sides its size wants).
 */
export const bead = (r: number, color: Rgb, sides = BEAD_SIDES): Tri[] => {
  const bands = Math.max(2, Math.round(sides / 2));
  return lathe(
    Array.from({ length: bands + 1 }, (_, i): Vec2 => {
      const a = (i / bands) * Math.PI;
      return [-r * Math.cos(a), i % bands ? r * Math.sin(a) : 0];
    }),
    sides,
    [color],
  );
};

/** A flat n-gon of radius r lying on the plane y, top only: n - 2 triangles. */
export const tile = (r: number, sides: number, color: Rgb, y = 0, phase = 0): Tri[] =>
  prism(
    Array.from({ length: sides }, (_, i): Vec2 => [
      r * Math.cos(phase + (i / sides) * TAU),
      r * Math.sin(phase + (i / sides) * TAU),
    ]),
    y,
    y,
    color,
  );

/**
 * A thick plate from a convex outline of [radial, y] points, standing in the plane through +Y and
 * +X, `thick` through: 4n - 4 triangles.
 */
export function fin(outline: readonly Vec2[], thick: number, color: Rgb): Tri[] {
  const h = thick / 2;
  const n = outline.length;
  const front = outline.map(([r, y]): Vec3 => [r, y, h]);
  const back = outline.map(([r, y]): Vec3 => [r, y, -h]);
  const cx = outline.reduce((sum, p) => sum + p[0], 0) / n;
  const cy = outline.reduce((sum, p) => sum + p[1], 0) / n;
  const at = (list: readonly Vec3[], i: number): Vec3 => list[i % n] ?? [0, 0, 0];
  return [
    ...outline
      .slice(2)
      .flatMap((_, i) => [
        ...tri(at(front, 0), at(front, i + 1), at(front, i + 2), color, [0, 0, 1]),
        ...tri(at(back, 0), at(back, i + 1), at(back, i + 2), color, [0, 0, -1]),
      ]),
    ...outline.flatMap((p, i) => {
      const q = outline[(i + 1) % n] ?? p;
      const out: Vec3 = [(p[0] + q[0]) / 2 - cx, (p[1] + q[1]) / 2 - cy, 0];
      return quad(at(front, i), at(front, i + 1), at(back, i + 1), at(back, i), color, out);
    }),
  ];
}

/**
 * The 3x5 pixel font: one 15-bit number per digit, rows top to bottom, three bits a row, the
 * most significant first. A full stop is one cell on the bottom row.
 */
// prettier-ignore
export const FONT = [31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695] as const;

/** Text as rows of '#' and '.', a column of '.' between characters. Digits and full stops only. */
export function text(chars: string): string[] {
  return [0, 1, 2, 3, 4].map((row) =>
    [...chars]
      .map((ch) => {
        if (ch === '.') return row === 4 ? '#' : '.';
        const glyph = /^\d$/.test(ch) ? FONT[Number(ch)] : undefined;
        if (glyph === undefined) throw new Error(`text: the pixel font has no '${ch}'`);
        return [4, 2, 1].map((bit) => ((glyph >> (12 - 3 * row)) & bit ? '#' : '.')).join('');
      })
      .join('.'),
  );
}

/**
 * Pixel art from rows of '#' (or a string, through the font): one quad per horizontal run of
 * cells, facing +Z, centred on the origin, `px` a cell: 2 triangles a run.
 */
export function pix(art: string | readonly string[], px: number, color: Rgb): Tri[] {
  const rows = typeof art === 'string' ? text(art) : art;
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const out: Tri[] = [];
  rows.forEach((row, j) => {
    for (let i = 0; i < w;) {
      if (row[i] !== '#') {
        i += 1;
        continue;
      }
      let k = i;
      while (k < w && row[k] === '#') k += 1;
      const x0 = (i - w / 2) * px;
      const x1 = (k - w / 2) * px;
      const y0 = (h / 2 - j - 1) * px;
      const y1 = (h / 2 - j) * px;
      out.push(...quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], color, [0, 0, 1]));
      i = k;
    }
  });
  return out;
}
