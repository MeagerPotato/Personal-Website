import { TAU } from '../math';
import { MeshBuilder, type Point, type Rgb } from '../meshBuilder';

/**
 * THE GEOMETRY KIT of the worlds: the small toolbox every prop of every body is built from. It
 * leans on MeshBuilder for what that already does well (a lathe, a box) and adds three things:
 * a face that looks where it is told whatever order its corners came in, a convex outline
 * extruded into a plate or a slab, and a strip swept round the Y axis (a ring, an arc, a wave, a
 * gear rim, a dash).
 *
 * Everything works on TRIANGLE RECORDS, not on a builder: a prop is made, moved, turned and
 * scaled as a list of triangles, and only glue.ts packs them into buffers. That is what lets a
 * part be re-placed (an `s` or `n` placement, a modifier) after it is made, and a test count or
 * measure any of it. Local frame: +Y up, and a prop is modelled at the origin on a world of
 * radius 1 (vocabulary: "radius-1 worlds").
 *
 * A port of the concept set's prototype (kit.mjs). The shapes are the prototype's, triangle for
 * triangle, and so are the float32 corners of what goes through MeshBuilder: the triangle counts
 * of every body are pinned against it (tests/world-bodies.test.ts).
 */

export type Vec3 = Point;
/** A 3x3 matrix, row-major: `m[row][column]`. */
export type Mat3 = readonly [Vec3, Vec3, Vec3];
/** A point on a plane, or a [radius, height] pair of a profile: two numbers. */
export type Vec2 = readonly [number, number];

/**
 * How a triangle is lit: 0 by its sun (the toon bands), 1 flat and unlit, 2 unlit and glowing. A
 * facet of a sun's living surface glows too, and says so above that (6 and the sun's own number:
 * sim/sunSurface.ts, `sunFlag`), so every reader's "above a half" and "above one and a half"
 * still hold.
 */
export type Unlit = number;

/**
 * One triangle: its corners (nine numbers, a b c), its colour (linear RGB) and its lighting. A
 * facet of a generated ground (ground.ts) may also carry the normals of the curve it lies on (`n`,
 * nine numbers) and its other colours with their lines (`s`, 24 numbers: sim/meshBuilder.ts,
 * `MeshData.sides`); a ground is never moved, so `xf` drops them.
 */
export interface Tri {
  readonly p: readonly number[];
  readonly c: Rgb;
  readonly g: Unlit;
  readonly n?: ArrayLike<number>;
  readonly s?: ArrayLike<number>;
}

export const ORIGIN: Vec3 = [0, 0, 0];

// --- vectors --------------------------------------------------------------------------------------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Unit length; a zero vector stays zero instead of becoming NaN. */
export const norm = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

// --- matrices -------------------------------------------------------------------------------------

/** The rotation that turns about X, then Y, then Z (radians). */
export function rotm(rx = 0, ry = 0, rz = 0): Mat3 {
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(rx),
    Math.sin(rx),
    Math.cos(ry),
    Math.sin(ry),
    Math.cos(rz),
    Math.sin(rz),
  ];
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

export const mulM = (m: Mat3, p: Vec3): Vec3 => [dot(m[0], p), dot(m[1], p), dot(m[2], p)];

/** The matrix whose COLUMNS are three axes: it takes a part's local frame to theirs. */
export const basisM = (x: Vec3, y: Vec3, z: Vec3): Mat3 => [
  [x[0], y[0], z[0]],
  [x[1], y[1], z[1]],
  [x[2], y[2], z[2]],
];

/** m * l: first l, then m. */
export function mul3(m: Mat3, l: Mat3): Mat3 {
  const row = (r: Vec3): Vec3 => [
    r[0] * l[0][0] + r[1] * l[1][0] + r[2] * l[2][0],
    r[0] * l[0][1] + r[1] * l[1][1] + r[2] * l[2][1],
    r[0] * l[0][2] + r[1] * l[1][2] + r[2] * l[2][2],
  ];
  return [row(m[0]), row(m[1]), row(m[2])];
}

// --- triangles ------------------------------------------------------------------------------------

/** Corner `i` (0, 1 or 2) of a triangle. */
export const corner = (t: Tri, i: number): Vec3 => [
  t.p[i * 3] ?? 0,
  t.p[i * 3 + 1] ?? 0,
  t.p[i * 3 + 2] ?? 0,
];

/** The unit normal its winding gives (counter-clockwise seen from the front). */
export const normalOf = (t: Tri): Vec3 =>
  norm(cross(sub(corner(t, 1), corner(t, 0)), sub(corner(t, 2), corner(t, 0))));

export const centroidOf = (t: Tri): Vec3 => {
  const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
};

const T = (a: Vec3, b: Vec3, c: Vec3, color: Rgb): Tri => ({
  p: [...a, ...b, ...c],
  c: color,
  g: 0,
});

/** A triangle whose front faces `hint`, whatever order its corners came in. */
export function tri(a: Vec3, b: Vec3, c: Vec3, color: Rgb, hint?: Vec3): Tri[] {
  return [
    hint && dot(cross(sub(b, a), sub(c, a)), hint) < 0 ? T(a, c, b, color) : T(a, b, c, color),
  ];
}

/** A quad (corners in order round it) whose front faces `hint`. */
export const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Rgb, hint?: Vec3): Tri[] => [
  ...tri(a, b, c, color, hint),
  ...tri(a, c, d, color, hint),
];

/** A convex polygon, fanned from its first corner, whose front faces `hint`. */
export const poly = (points: readonly Vec3[], color: Rgb, hint?: Vec3): Tri[] => {
  const first = points[0];
  if (!first) return [];
  return points
    .slice(2)
    .flatMap((point, i) => tri(first, points[i + 1] ?? first, point, color, hint));
};

// --- transforms -----------------------------------------------------------------------------------

/** Where a list of triangles goes: scaled by `s`, then turned (`m`, or `rot` about X, Y, Z), then moved by `at`. */
export interface Place {
  readonly at?: Vec3;
  readonly rot?: Vec3;
  readonly s?: number | Vec3;
  readonly m?: Mat3;
}

export function xf(tris: readonly Tri[], { at = ORIGIN, rot, s = 1, m }: Place = {}): Tri[] {
  const turn = m ?? (rot ? rotm(rot[0], rot[1], rot[2]) : undefined);
  const k: Vec3 = typeof s === 'number' ? [s, s, s] : s;
  return tris.map((t) => {
    const p: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      let q: Vec3 = [
        (t.p[i * 3] ?? 0) * k[0],
        (t.p[i * 3 + 1] ?? 0) * k[1],
        (t.p[i * 3 + 2] ?? 0) * k[2],
      ];
      if (turn) q = mulM(turn, q);
      p.push(q[0] + at[0], q[1] + at[1], q[2] + at[2]);
    }
    return { p, c: t.c, g: t.g };
  });
}

// --- primitives (local frame: +Y up) --------------------------------------------------------------

/** One colour, or one per segment (a lathe's bands, a ring's steps): */
export type Colors = Rgb | readonly Rgb[];
const isList = (colors: Colors): colors is readonly Rgb[] => typeof colors[0] !== 'number';

/** The triangles a MeshBuilder made, as records: float32 corners, as the engine will draw them. */
function recordsOf(builder: MeshBuilder, color?: Rgb): Tri[] {
  const mesh = builder.build(false);
  return Array.from({ length: mesh.triangleCount }, (_, i) => ({
    p: [...mesh.positions.slice(i * 9, i * 9 + 9)],
    c: color ?? [mesh.colors[i * 9] ?? 0, mesh.colors[i * 9 + 1] ?? 0, mesh.colors[i * 9 + 2] ?? 0],
    g: 0,
  }));
}

/**
 * A body of revolution about +Y. `rings` is its profile, [height, radius] pairs walked bottom to
 * top for the OUTSIDE; `colors` one colour, or one per band between two rings.
 */
export function lathe(rings: readonly Vec2[], sides: number, colors: Colors, phase = 0): Tri[] {
  const builder = new MeshBuilder();
  builder.lathe(
    rings.map(([y, r]) => ({ z: y, radius: r })),
    sides,
    isList(colors) ? colors : [colors],
    phase,
  );
  builder.rotateX(-Math.PI / 2);
  return recordsOf(builder);
}

/** A capped cylinder from y0 to y1 (4 x sides triangles). */
export const cyl = (
  r: number,
  y0: number,
  y1: number,
  sides: number,
  color: Rgb,
  side = color,
  top = color,
): Tri[] =>
  lathe(
    [
      [y0, 0],
      [y0, r],
      [y1, r],
      [y1, 0],
    ],
    sides,
    [color, side, top],
  );

/** A cone (r1 = 0) or a frustum from y0 (radius r0) to y1 (radius r1). */
export const cone = (
  r0: number,
  r1: number,
  y0: number,
  y1: number,
  sides: number,
  color: Rgb,
  base = color,
  top = color,
): Tri[] =>
  lathe(
    [
      [y0, 0],
      [y0, r0],
      [y1, r1],
      [y1, 0],
    ],
    sides,
    [base, color, top],
  );

/** A half sphere of radius r with its rim on y = 0. */
export const dome = (r: number, sides: number, steps: number, color: Rgb): Tri[] =>
  lathe(
    [
      [0, 0],
      [0, r],
      ...Array.from({ length: steps }, (_, i): Vec2 => {
        const a = ((i + 1) / steps) * (Math.PI / 2);
        return [r * Math.sin(a), r * Math.cos(a)];
      }),
    ],
    sides,
    [color],
  );

/** An axis-aligned box centred on the origin (12 triangles). */
export function box(sx: number, sy: number, sz: number, color: Rgb): Tri[] {
  const builder = new MeshBuilder();
  builder.box([0, 0, 0], [sx, sy, sz], color);
  return recordsOf(builder, color);
}

/** A compass bearing (radians clockwise from north, -Z) and a radius, as [x, z]. */
export const brg = (b: number, r: number): Vec2 => [r * Math.sin(b), -r * Math.cos(b)];

/** Prism flags: 1 no bottom, 2 no walls, 4 fan the top from the middle (a star-shaped outline). */
export const PRISM = { noBottom: 1, noWalls: 2, fanTop: 4 } as const;

/**
 * A convex outline ([x, z] points in the XZ plane) extruded from y0 to y1: top, walls, bottom.
 * With y0 = y1 it is a flat plate, top only.
 */
export function prism(
  points: readonly Vec2[],
  y0: number,
  y1: number,
  top: Rgb,
  side = top,
  bottom = side,
  flags = 0,
): Tri[] {
  const n = points.length;
  const solid = y1 - y0 > 1e-6;
  const cx = points.reduce((sum, p) => sum + p[0], 0) / n;
  const cz = points.reduce((sum, p) => sum + p[1], 0) / n;
  const hi = points.map((p): Vec3 => [p[0], y1, p[1]]);
  const lo = points.map((p): Vec3 => [p[0], y0, p[1]]);
  const at = (list: readonly Vec3[], i: number): Vec3 => list[i % n] ?? ORIGIN;
  const up: Vec3 = [0, 1, 0];
  return [
    ...(flags & PRISM.fanTop
      ? hi.flatMap((p, i) => tri([cx, y1, cz], p, at(hi, i + 1), top, up))
      : poly(hi, top, up)),
    ...(solid && !(flags & PRISM.noBottom) ? poly(lo, bottom, [0, -1, 0]) : []),
    ...(solid && !(flags & PRISM.noWalls)
      ? points.flatMap((p, i) => {
          const q = points[(i + 1) % n] ?? p;
          const out: Vec3 = [(p[0] + q[0]) / 2 - cx, 0, (p[1] + q[1]) / 2 - cz];
          return quad(at(lo, i), at(lo, i + 1), at(hi, i + 1), at(hi, i), side, out);
        })
      : []),
  ];
}

/**
 * A trapezoid lying on the plane at bearing `b`, from radius r0 (half-width w0) out to r1
 * (half-width w1), between y0 and y1: a cog's tooth, a clock's tick, a sweeping hand.
 */
export function rq(
  b: number,
  r0: number,
  r1: number,
  w0: number,
  w1: number,
  y0: number,
  y1: number,
  top: Rgb,
  side = top,
): Tri[] {
  const [ax, az] = brg(b, r0);
  const [bx, bz] = brg(b, r1);
  const [px, pz] = brg(b + Math.PI / 2, 1);
  return prism(
    [
      [ax + px * w0, az + pz * w0],
      [ax - px * w0, az - pz * w0],
      [bx - px * w1, bz - pz * w1],
      [bx + px * w1, bz + pz * w1],
    ],
    y0,
    y1,
    top,
    side,
    side,
    y1 - y0 < 0.01 ? PRISM.noBottom | PRISM.noWalls : PRISM.noBottom,
  );
}

/** A strip's inner and outer radius: fixed, or as a function of the bearing (a wave, a curve). */
export type Radii = Vec2 | ((bearing: number) => Vec2);

/** Ring flags: 1 no underside, 2 an underside even when it is flat. */
export const RING = { noUnderside: 1, flatUnderside: 2 } as const;

/**
 * A strip swept round the Y axis from bearing b0 to b1 in `steps`, between y0 and y1, its radii
 * fixed or a function of the bearing: a solid ring, an arc, a wave, a gear rim, a road, a dash.
 * `top` and `side` may be a list of colours, one per step in turn.
 */
export function ring(
  radii: Radii,
  b0: number,
  b1: number,
  steps: number,
  y0: number,
  y1: number,
  top: Colors,
  side: Colors = top,
  flags = 0,
): Tri[] {
  const radiiAt = typeof radii === 'function' ? radii : (): Vec2 => radii;
  const flat = y1 - y0 < 1e-6;
  const out: Tri[] = [];
  const A = (p: Vec2, y: number): Vec3 => [p[0], y, p[1]];
  const pick = (colors: Colors, i: number): Rgb =>
    isList(colors) ? (colors[i % colors.length] ?? [0, 0, 0]) : colors;
  for (let i = 0; i < steps; i += 1) {
    const ba = b0 + ((b1 - b0) * i) / steps;
    const bb = b0 + ((b1 - b0) * (i + 1)) / steps;
    const [ra0, ra1] = radiiAt(ba);
    const [rb0, rb1] = radiiAt(bb);
    const ia = brg(ba, ra0);
    const oa = brg(ba, ra1);
    const ib = brg(bb, rb0);
    const ob = brg(bb, rb1);
    const t = pick(top, i);
    const s = pick(side, i);
    out.push(...quad(A(ia, y1), A(oa, y1), A(ob, y1), A(ib, y1), t, [0, 1, 0]));
    if (flat ? flags & RING.flatUnderside : !(flags & RING.noUnderside))
      out.push(...quad(A(ia, y0), A(oa, y0), A(ob, y0), A(ib, y0), s, [0, -1, 0]));
    if (!flat) {
      const outward: Vec3 = [(oa[0] + ob[0]) / 2, 0, (oa[1] + ob[1]) / 2];
      const inward: Vec3 = [-(ia[0] + ib[0]) / 2, 0, -(ia[1] + ib[1]) / 2];
      out.push(...quad(A(oa, y0), A(ob, y0), A(ob, y1), A(oa, y1), s, outward));
      out.push(...quad(A(ia, y0), A(ib, y0), A(ib, y1), A(ia, y1), s, inward));
    }
  }
  // An arc (not a whole ring) that has height is closed at both ends.
  if (!flat && Math.abs(b1 - b0) < TAU - 1e-6) {
    for (const [b, sign] of [
      [b0, -1],
      [b1, 1],
    ] as const) {
      const [r0, r1] = radiiAt(b);
      const a = brg(b, r0);
      const c = brg(b, r1);
      out.push(
        ...quad(
          [a[0], y0, a[1]],
          [c[0], y0, c[1]],
          [c[0], y1, c[1]],
          [a[0], y1, a[1]],
          pick(side, 0),
          [Math.cos(b) * sign, 0, Math.sin(b) * sign],
        ),
      );
    }
  }
  return out;
}
