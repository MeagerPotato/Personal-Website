import type { ThemeKey } from '../../design/tokens';
import { TAU } from '../math';
import { finish } from '../planet';
import { bead, fin, pix, tile } from './atoms';
import { glyph } from './glyphs';
import { groundOf, type GroundSpec } from './ground';
import {
  add,
  basisM,
  box,
  brg,
  cone,
  cross,
  cyl,
  dome,
  dot,
  lathe,
  mul3,
  mulM,
  norm,
  ORIGIN,
  poly,
  prism,
  quad,
  ring,
  rotm,
  rq,
  scale,
  sub,
  tri,
  xf,
  type Mat3,
  type Place,
  type Radii,
  type Tri,
  type Unlit,
  type Vec2,
  type Vec3,
} from './kit';
import { colorOf, looksLikeColor, type ColorPath } from './palette';
import { atNormal, normalFrame, onSurf, surfaceFrame, type SurfaceOptions } from './placement';

/**
 * THE INTERPRETER: a body is DATA, and this turns it into triangles. A body's rows are
 * `[ground, ...parts]`:
 *
 *   ground   a generator spec (ground.ts), or a HULL: items that are the body themselves (the
 *            Resume station, the Contact satellite, a relay's plinth, the Kalshi coin)
 *   part     `[name, flags, ...items]`. The name is how the motion table, the tests and the
 *            documents refer to it. Flags add up (FLAG): 1 hold (it does not turn with the ground),
 *            2 flat and unlit, 4 glow (it blooms), 8 decal (it hugs the ground), 16 ghost (still
 *            to come: drawn as a blueprint, with its edges as lines).
 *   item     `[op, ...args, modifiers?]`: an op of the kit or the atoms with its positional
 *            arguments, or a structural op. A string that looks like a colour path ('coral.base')
 *            is turned into a colour HERE, through palette.ts, and nowhere else. The last argument
 *            may be a plain object `{ at, rot, s, g }`: where the result goes (kit.ts, `xf`) and
 *            its lighting (1 flat, 2 glow).
 *
 * Structural ops:
 *   ['g', item, ...]                               a group
 *   ['x', [at, ...], item]                         the item at every position
 *   ['around', n, phase, r, y, face, item]         the item at n bearings round a circle (face 1:
 *                                                  turned to look outward)
 *   ['s', lat, lon, { alt, spin, s, tilt }, item]  stood on a round world (placement.ts, onSurf)
 *   ['n', pos, normal, spin, scale, item]          stood on a point along a normal (atNormal)
 * Wherever an item is expected a function of the index may stand, which is how a row of 35
 * cells or twelve teeth is one line.
 *
 * The close-up parts are the same rows in another module (design/worlds/near.ts), loaded later.
 * A port of the concept set's prototype (rows.mjs), with types: an op's arguments are checked by
 * the compiler, and so is every colour path.
 */

/** Where an item's triangles go, and how they are lit (1 flat, 2 glow). */
export interface Mod {
  readonly at?: Vec3;
  readonly rot?: Vec3;
  readonly s?: number | Vec3;
  readonly g?: 1 | 2;
}

type C = ColorPath;
/** One colour, or one per segment. */
type Cs = C | readonly C[];

/** [], [A], [A, B], ...: the optional arguments an op may be given, in order. */
type Prefixes<T extends readonly unknown[]> = T extends readonly [...infer Head, unknown]
  ? Prefixes<Head> | T
  : T;
type Op<
  Name extends string,
  Required extends readonly unknown[],
  Optional extends readonly unknown[] = [],
> =
  | readonly [Name, ...Required, ...Prefixes<Optional>]
  | readonly [Name, ...Required, ...Prefixes<Optional>, Mod];

/** The kit's ops and the atoms, with their positional arguments (kit.ts, atoms.ts, glyphs.ts). */
export type OpItem =
  | Op<'lathe', [profile: readonly Vec2[], sides: number, colors: Cs], [phase: number]>
  | Op<'cyl', [r: number, y0: number, y1: number, sides: number, color: C], [side: C, top: C]>
  | Op<
      'cone',
      [r0: number, r1: number, y0: number, y1: number, sides: number, color: C],
      [base: C, top: C]
    >
  | Op<'dome', [r: number, sides: number, steps: number, color: C]>
  | Op<'box', [sx: number, sy: number, sz: number, color: C]>
  | Op<
      'prism',
      [outline: readonly Vec2[], y0: number, y1: number, top: C],
      [side: C, bottom: C, flags: number]
    >
  | Op<
      'ring',
      [radii: Radii, b0: number, b1: number, steps: number, y0: number, y1: number, top: Cs],
      [side: Cs, flags: number]
    >
  | Op<
      'rq',
      [b: number, r0: number, r1: number, w0: number, w1: number, y0: number, y1: number, top: C],
      [side: C]
    >
  | Op<'quad', [a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: C], [hint: Vec3]>
  | Op<'tri', [a: Vec3, b: Vec3, c: Vec3, color: C], [hint: Vec3]>
  | Op<'poly', [points: readonly Vec3[], color: C], [hint: Vec3]>
  | Op<'glyph', [family: ThemeKey, r: number], [y: number, h: number]>
  | Op<'bead', [r: number, color: C]>
  | Op<'tile', [r: number, sides: number, color: C], [y: number, phase: number]>
  | Op<'fin', [outline: readonly Vec2[], thick: number, color: C]>
  | Op<'pix', [art: string | readonly string[], px: number, color: C]>;

export type ItemFn = (index: number) => Item;

export type Item =
  | OpItem
  | readonly ['g', ...Item[]]
  | readonly ['g', ...Item[], Mod]
  | readonly ['x', ats: readonly Vec3[], item: Item]
  | readonly ['x', ats: readonly Vec3[], item: Item, Mod]
  | readonly ['around', n: number, phase: number, r: number, y: number, face: 0 | 1, item: Item]
  | readonly [
      'around',
      n: number,
      phase: number,
      r: number,
      y: number,
      face: 0 | 1,
      item: Item,
      Mod,
    ]
  | readonly ['s', lat: number, lon: number, options: SurfaceOptions, item: Item]
  | readonly ['s', lat: number, lon: number, options: SurfaceOptions, item: Item, Mod]
  | readonly ['n', pos: Vec3, normal: Vec3, spin: number, scale: number, item: Item]
  | readonly ['n', pos: Vec3, normal: Vec3, spin: number, scale: number, item: Item, Mod]
  | ItemFn
  | readonly Item[];

/** A part's flags, added together. */
export const FLAG = { hold: 1, flat: 2, glow: 4, decal: 8, ghost: 16 } as const;

/** `[name, flags, ...items]`. */
export type PartRow = readonly [name: string, flags: number, ...items: Item[]];
/** Items that ARE the body: its ground when it is a built thing and not a world. */
export type Hull = readonly Item[];
/** A body: its ground, then its everyday (far) parts. */
export type Rows = readonly [ground: GroundSpec | Hull, ...parts: PartRow[]];

/** What the rows of a body may depend on. */
export interface RowOptions {
  /** The star map's variant (About Me draws its Circle Line bolder and simpler there). */
  readonly map: boolean;
}

/** A body as design/worlds states it. */
export interface BodyRecipe {
  readonly rows: Rows | ((options: RowOptions) => Rows);
  /** It never turns, not even with the planet's slow spin (the Kalshi coin rocks instead). */
  readonly still?: boolean;
}

// --- the interpreter ------------------------------------------------------------------------------

const OPS: Readonly<Record<OpItem[0], (...args: never[]) => Tri[]>> = {
  lathe,
  cyl,
  cone,
  dome,
  box,
  prism,
  ring,
  rq,
  quad,
  tri,
  poly,
  glyph,
  bead,
  tile,
  fin,
  pix,
};

const isOp = (op: string): op is OpItem[0] => Object.hasOwn(OPS, op);

const isMod = (x: unknown): x is Mod => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A list of items, rather than one item (whose first element is its op's name). */
const isList = (item: readonly unknown[]): item is readonly Item[] =>
  Array.isArray(item[0]) || typeof item[0] === 'function';

/** Every colour path in an op's arguments, as a colour. */
const decode = (x: unknown): unknown =>
  typeof x === 'string'
    ? looksLikeColor(x)
      ? colorOf(x)
      : x
    : Array.isArray(x)
      ? x.map(decode)
      : x;

/** An item's op, its arguments, and its modifiers (the trailing plain object, if there is one). */
function parse(item: readonly unknown[]): { op: string; args: unknown[]; mod: Mod | undefined } {
  const [op, ...args] = item;
  const last = args[args.length - 1];
  const mod = args.length > 0 && isMod(last) ? last : undefined;
  if (mod) args.pop();
  return { op: String(op), args, mod };
}

/** An item's triangles. `index` is its place in its list, for an item that is a function of it. */
export function mk(item: Item, index = 0): Tri[] {
  if (typeof item === 'function') return mk(item(index), index);
  if (isList(item)) return item.flatMap((x, j) => mk(x, j));
  const { op, args, mod } = parse(item);
  let tris: Tri[];
  switch (op) {
    case 'g':
      tris = (args as Item[]).flatMap((x, j) => mk(x, j));
      break;
    case 'x': {
      const [ats, child] = args as [readonly Vec3[], Item];
      tris = ats.flatMap((at, j) => xf(mk(child, j), { at }));
      break;
    }
    case 'around': {
      const [n, phase, r, y, face, child] = args as [number, number, number, number, 0 | 1, Item];
      tris = Array.from({ length: n }, (_, j) => {
        const b = phase + (j / n) * TAU;
        const [x, z] = brg(b, r);
        return xf(mk(child, j), face ? { at: [x, y, z], rot: [0, -b, 0] } : { at: [x, y, z] });
      }).flat();
      break;
    }
    case 's': {
      const [lat, lon, options, child] = args as [number, number, SurfaceOptions, Item];
      tris = onSurf(mk(child), lat, lon, options);
      break;
    }
    case 'n': {
      const [pos, normal, spin, s, child] = args as [Vec3, Vec3, number, number, Item];
      tris = atNormal(mk(child), pos, normal, spin, s);
      break;
    }
    default: {
      if (!isOp(op)) throw new Error(`mk: '${op}' is not an op of the kit, the atoms or the rows`);
      tris = (OPS[op] as (...decoded: unknown[]) => Tri[])(...(decode(args) as unknown[]));
    }
  }
  const { g } = mod ?? {};
  if (g) tris = tris.map((t) => ({ ...t, g }));
  return mod && (mod.at || mod.rot || mod.s) ? xf(tris, mod) : tris;
}

// --- pivots ---------------------------------------------------------------------------------------

/**
 * Where a part stands, as a frame of its own: an origin and three unit axes at right angles, in
 * the body's frame. A part that MOVES is drawn about it (vocabulary.md, section 7: "authored at
 * its own pivot and placed by the matrix of the ground it stands on"), so that an axis of the
 * motion table is the part's own: a crane swings about its own tower, a letter flies along its
 * own path, a cloud of guesses shrinks onto the bot it is about.
 */
export interface Pivot {
  readonly origin: Vec3;
  /** Columns: the part's own x, y and z. */
  readonly basis: Mat3;
}

const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const BODY_PIVOT: Pivot = { origin: ORIGIN, basis: IDENTITY };

interface Affine {
  readonly m: Mat3;
  readonly t: Vec3;
}
const STAY: Affine = { m: IDENTITY, t: ORIGIN };
const then = (outer: Affine, inner: Affine): Affine => ({
  m: mul3(outer.m, inner.m),
  t: add(mulM(outer.m, inner.t), outer.t),
});
/** What `xf` does, as a matrix and a move. */
function affineOf({ at = ORIGIN, rot, s = 1, m }: Place): Affine {
  const turn = m ?? (rot ? rotm(rot[0], rot[1], rot[2]) : IDENTITY);
  const k: Vec3 = typeof s === 'number' ? [s, s, s] : s;
  return {
    m: mul3(turn, [
      [k[0], 0, 0],
      [0, k[1], 0],
      [0, 0, k[2]],
    ]),
    t: at,
  };
}
const column = (m: Mat3, j: 0 | 1 | 2): Vec3 => [m[0][j], m[1][j], m[2][j]];

/**
 * The pivot of a part: the placements its items share, followed down while there is exactly
 * one item to follow (an `s` or `n` placement, a group's modifiers, a group of one). It stops at
 * a group of several, at a repeat (`x`, `around`), and at an op, whose own `{ at }` is not its
 * pivot: About Me's train is a bead placed on the Circle Line, and it runs round the LINE (the
 * body's own axis), not round itself. Scale is not part of a pivot: it stays in the geometry, so
 * that a slide of the motion table is in body radii whatever the part's size.
 */
export function pivotOf(items: readonly Item[]): Pivot {
  let frame = STAY;
  let list = items;
  for (;;) {
    if (list.length !== 1 || list[0] === undefined) break;
    let item: Item = list[0];
    while (typeof item === 'function') item = item(0);
    if (isList(item)) {
      list = item;
      continue;
    }
    const { op, args, mod } = parse(item);
    const own = mod && (mod.at || mod.rot || mod.s) ? affineOf(mod) : STAY;
    if (op === 'g') {
      frame = then(frame, own);
      list = args as Item[];
      continue;
    }
    if (op === 's' || op === 'n') {
      const placed =
        op === 's'
          ? surfaceFrame(...(args.slice(0, 3) as [number, number, SurfaceOptions]))
          : normalFrame(...(args.slice(0, 4) as [Vec3, Vec3, number, number]));
      frame = then(then(frame, own), affineOf(placed));
      list = [args[op === 's' ? 3 : 4] as Item];
      continue;
    }
    if (op === 'x' || op === 'around') frame = then(frame, own);
    break;
  }
  // Keep the turn, drop the scale: Gram-Schmidt on the columns.
  const x = norm(column(frame.m, 0));
  const y1 = column(frame.m, 1);
  const y = norm(sub(y1, scale(x, dot(y1, x))));
  return { origin: frame.t, basis: basisM(x, y, cross(x, y)) };
}

/** A point of the body's frame in a pivot's own frame. */
export function toPivot(p: Vec3, { origin, basis }: Pivot): Vec3 {
  const d = sub(p, origin);
  return [dot(column(basis, 0), d), dot(column(basis, 1), d), dot(column(basis, 2), d)];
}

/** A point of a pivot's own frame in the body's frame. */
export function fromPivot(p: Vec3, { origin, basis }: Pivot): Vec3 {
  return add(mulM(basis, p), origin);
}

// --- a body ---------------------------------------------------------------------------------------

export type Tier = 'far' | 'near';

export interface BuiltPart {
  readonly name: string;
  /** far: in the everyday mesh (flight, the map); near: only in close-up. */
  readonly tier: Tier;
  readonly flags: number;
  readonly tris: readonly Tri[];
  readonly pivot: Pivot;
}

/** A body built from its rows: its ground and its named parts, in the body's frame at radius 1. */
export interface Build {
  readonly id: string;
  readonly ground: readonly Tri[];
  readonly parts: readonly BuiltPart[];
}

export interface BuildOptions {
  /** The ground's detail (glue.ts, `groundDetail`); a hull has none. */
  readonly detail: number;
  /** Build the star map's variant of the rows. */
  readonly map?: boolean;
  /** The body's own seed, for a ground that names none (the manifest's `seed`). Default: its id. */
  readonly seed?: string;
  /** The close-up parts (design/worlds/near.ts), once that chunk is loaded. */
  readonly near?: readonly PartRow[];
}

/** The rows of a body, for these options. */
export const rowsOf = (recipe: BodyRecipe, options: RowOptions): Rows =>
  typeof recipe.rows === 'function' ? recipe.rows(options) : recipe.rows;

const isHull = (ground: GroundSpec | Hull): ground is Hull => Array.isArray(ground);

/**
 * Build a body. A generator (the ground slices by the icosahedron's faces, then a slice a part),
 * so that core/jobs.ts can spread a close-up body over frames; `make` runs it in one go.
 */
export function* makeBody(
  id: string,
  recipe: BodyRecipe,
  options: BuildOptions,
): Generator<void, Build> {
  const [ground, ...far] = rowsOf(recipe, { map: options.map ?? false });
  const groundTris = isHull(ground)
    ? mk(ground)
    : yield* groundOf(ground, options.seed ?? id, options.detail);
  const parts: BuiltPart[] = [];
  const names = new Set<string>();
  const tiers: ReadonlyArray<readonly [Tier, readonly PartRow[]]> = [
    ['far', far],
    ['near', options.near ?? []],
  ];
  for (const [tier, list] of tiers) {
    for (const [name, flags, ...items] of list) {
      // A name is how the motion table finds a part: two with one name would move together.
      if (names.has(name)) throw new Error(`${id}: two parts are called '${name}'`);
      names.add(name);
      const g: Unlit = flags & FLAG.glow ? 2 : flags & FLAG.flat ? 1 : 0;
      const tris = items.flatMap((x, j) => mk(x, j)).map((t) => (t.g ? t : { ...t, g }));
      parts.push({ name, tier, flags, tris, pivot: pivotOf(items) });
      yield;
    }
  }
  return { id, ground: groundTris, parts };
}

export const make = (id: string, recipe: BodyRecipe, options: BuildOptions): Build =>
  finish(makeBody(id, recipe, options));

/** How many triangles a build has: its ground and its parts, or only the parts of one tier. */
export function trianglesOf(build: Build, tier?: Tier): number {
  const parts = build.parts.filter((part) => !tier || part.tier === tier);
  return (tier ? 0 : build.ground.length) + parts.reduce((sum, part) => sum + part.tris.length, 0);
}
