import { describe, expect, expectTypeOf, it } from 'vitest';
import { tuning } from '../../design/tuning';
import { HOME } from '../../design/worlds/home';
import { bead, fin, pix, tile } from './atoms';
import { glyph } from './glyphs';
import type { GroundLooks } from './ground';
import {
  box,
  centroidOf,
  cone,
  cyl,
  dome,
  dot,
  lathe,
  poly,
  prism,
  quad,
  ring,
  rq,
  tri,
  type Vec3,
} from './kit';
import { colorOf } from './palette';
import { surfaceFrame } from './placement';
import { planned } from './planned';
import {
  BODY_PIVOT,
  FLAG,
  fromPivot,
  make,
  makeBody,
  mk,
  OPS,
  pivotOf,
  rowsOf,
  toPivot,
  trianglesOf,
  type BodyRecipe,
  type Item,
  type KitArgs,
  type OpName,
  type PartRow,
} from './rows';

// The interpreter turns rows into triangles, names the parts, and finds where each one stands.

const close = (a: readonly number[], b: readonly number[], digits = 9): void =>
  a.forEach((v, i) => expect(v, `component ${i}`).toBeCloseTo(b[i] ?? NaN, digits));

const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
const BOX: Item = ['box', 0.1, 0.1, 0.1, 'ink.high'];
const partOf = (build: ReturnType<typeof make>, name: string) => {
  const part = build.parts.find((p) => p.name === name);
  if (!part) throw new Error(`no part '${name}'`);
  return part;
};
const pivotOfPart = (recipe: BodyRecipe | undefined, name: string) => {
  if (!recipe) throw new Error('no recipe');
  const [, ...parts] = rowsOf(recipe, { map: false });
  const row = parts.find(([n]) => n === name);
  if (!row) throw new Error(`no part '${name}'`);
  const [, , ...items] = row;
  return pivotOf(items);
};

describe('the interpreter', () => {
  it('builds a ground and named parts', () => {
    const build = make(
      't',
      { rows: [{}, ['a', 0, BOX], ['b', FLAG.hold, BOX, BOX]] },
      { detail: 1, looks: LOOKS },
    );
    expect(build.ground).toHaveLength(80);
    expect(build.parts.map((p) => [p.name, p.tier, p.flags, p.tris.length])).toEqual([
      ['a', 'far', 0, 12],
      ['b', 'far', FLAG.hold, 24],
    ]);
    expect(trianglesOf(build)).toBe(116);
    expect(trianglesOf(build, 'far')).toBe(36);
  });

  it('takes a hull as the body itself, with no ground to generate', () => {
    const build = make(
      't',
      { rows: [[BOX, ['bead', 0.1, 'ink.mid']]] },
      { detail: 8, looks: LOOKS },
    );
    expect(build.ground).toHaveLength(20);
    expect(build.parts).toEqual([]);
  });

  it('adds the close-up parts only when it is given them', () => {
    const recipe: BodyRecipe = { rows: [[BOX], ['far-one', 0, BOX]] };
    const near: PartRow[] = [['near-one', 0, BOX, BOX]];
    expect(trianglesOf(make('t', recipe, { detail: 0, looks: LOOKS }))).toBe(24);
    const close = make('t', recipe, { detail: 0, looks: LOOKS, near });
    expect(close.parts.map((p) => [p.name, p.tier])).toEqual([
      ['far-one', 'far'],
      ['near-one', 'near'],
    ]);
    expect(trianglesOf(close, 'near')).toBe(24);
  });

  it('builds a body a slice at a time', () => {
    const job = makeBody(
      't',
      { rows: [{}, ['a', 0, BOX], ['b', 0, BOX]] },
      { detail: 2, looks: LOOKS },
    );
    let slices = 0;
    let step = job.next();
    while (!step.done) {
      slices += 1;
      step = job.next();
    }
    // The ground's twenty faces, then one a part.
    expect(slices).toBe(22);
    expect(trianglesOf(step.value)).toBe(180 + 24);
  });

  it('reads the star map’s variant of rows given as a function', () => {
    const recipe: BodyRecipe = {
      rows: ({ map }) => [[BOX], ...(map ? [] : [['sign', 0, BOX] as const])],
    };
    expect(make('t', recipe, { detail: 0, looks: LOOKS }).parts).toHaveLength(1);
    expect(make('t', recipe, { detail: 0, looks: LOOKS, map: true }).parts).toHaveLength(0);
  });

  it('lights a part by its flags, and an item by its own g', () => {
    const build = make(
      't',
      {
        rows: [
          [BOX],
          ['lamp', FLAG.glow, BOX],
          ['sign', FLAG.flat, BOX, ['bead', 0.1, 'star.warm', { g: 2 }]],
        ],
      },
      { detail: 0, looks: LOOKS },
    );
    expect(partOf(build, 'lamp').tris.every((t) => t.g === 2)).toBe(true);
    expect(partOf(build, 'sign').tris.map((t) => t.g)).toEqual([
      ...Array(12).fill(1),
      ...Array(8).fill(2),
    ]);
    expect(build.ground.every((t) => t.g === 0)).toBe(true);
  });

  it('resolves colour paths, and throws on one that names nothing', () => {
    expect(mk(BOX).every((t) => t.c === colorOf('ink.high'))).toBe(true);
    expect(() => mk(['box', 1, 1, 1, 'ink.hgh' as 'ink.high'])).toThrow("'ink.hgh'");
    expect(() => mk(['glyph', 'rose' as 'coral', 0.1])).toThrow();
  });

  it('throws on an op it does not know', () => {
    expect(() => mk(['blob', 1] as unknown as Item)).toThrow("'blob'");
  });

  it('makes nothing of an empty list', () => {
    expect(mk([])).toEqual([]);
    expect(mk(['g'])).toEqual([]);
    expect(mk(['g', [], BOX])).toHaveLength(12);
  });

  it('calls the function behind each op, whose parameters are exactly what the rows may say', () => {
    const KIT = {
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
    // Both ways: a kit signature the rows do not follow, or rows the kit cannot take, is a compile
    // error here (and the op table's own type catches the one direction in rows.ts).
    expectTypeOf<{ [K in OpName]: Parameters<(typeof KIT)[K]> }>().toEqualTypeOf<{
      [K in OpName]: KitArgs<K>;
    }>();
    expect(Object.keys(OPS).sort()).toEqual(Object.keys(KIT).sort());
    for (const op of Object.keys(KIT) as OpName[]) expect(OPS[op], op).toBe(KIT[op]);
  });

  it('asks a body with a ghost for the family its edges are drawn in', () => {
    const rows: BodyRecipe['rows'] = [[BOX], ['plan', FLAG.ghost, BOX]];
    expect(() => make('t', { rows }, { detail: 0, looks: LOOKS })).toThrow("'plan' is a ghost");
    expect(() =>
      make('t', { rows: [[BOX]] }, { detail: 0, looks: LOOKS, near: [['plan', FLAG.ghost, BOX]] }),
    ).toThrow("'plan' is a ghost");
    expect(make('t', { rows, ghost: 'mint' }, { detail: 0, looks: LOOKS }).ghost).toBe('mint');
    expect(make('t', { rows: [[BOX]] }, { detail: 0, looks: LOOKS }).ghost).toBeUndefined();
  });

  it('refuses two parts of one name: the motion table would move both', () => {
    expect(() =>
      make(
        't',
        { rows: [[BOX], ['a', 0, BOX]] },
        { detail: 0, looks: LOOKS, near: [['a', 0, BOX]] },
      ),
    ).toThrow("two parts are called 'a'");
  });

  it('repeats an item, with its index, at positions and round a circle', () => {
    const cells = mk([
      'x',
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      (i) => ['tile', 0.1, 3 + i, 'ink.high'],
    ]);
    expect(cells).toHaveLength(1 + 2 + 3);
    const teeth = mk(['around', 12, 0, 1, 0, 1, BOX]);
    expect(teeth).toHaveLength(144);
    // Twelve boxes on a circle of radius 1, north first.
    const first = teeth.slice(0, 12).map(centroidOf);
    const mid = first.reduce<Vec3>(
      (s, c) => [s[0] + c[0] / 12, s[1] + c[1] / 12, s[2] + c[2] / 12],
      [0, 0, 0],
    );
    close(mid, [0, 0, -1]);
  });

  it('places an item by its trailing modifiers', () => {
    const [moved] = mk([
      'tri',
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      'ink.high',
      [0, 1, 0],
      { at: [0, 2, 0], s: 2 },
    ]);
    // Scaled, then moved; and wound to face its hint (+Y), so b and c trade places.
    expect(moved?.p).toEqual([0, 2, 0, 0, 2, 2, 2, 2, 0]);
  });
});

describe('pivots', () => {
  it('leaves a part with several items, or an op, at the body’s centre', () => {
    expect(pivotOf([BOX, BOX])).toEqual(BODY_PIVOT);
    // About Me's train: a bead placed on the Circle Line runs round the LINE, the body's axis.
    expect(pivotOfPart(HOME['page/about'], 'train')).toEqual(BODY_PIVOT);
  });

  it('follows a group’s modifiers, without their scale', () => {
    // The Contact satellite's letter: at the end of its path, drawn small.
    const letter = pivotOfPart(HOME['page/contact'], 'letter');
    close(letter.origin, [0, 0.16, 1.025]);
    close(letter.basis.flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('stands a planned crane on its own tower', () => {
    const [, crane] = planned('mint', { crane: [50, 232] });
    if (!crane) throw new Error('no crane');
    const [, , ...items] = crane;
    const pivot = pivotOf(items);
    const frame = surfaceFrame(50, 232, { s: 0.8, spin: 0.5 });
    close(pivot.origin, frame.at);
    close(pivot.basis.flat(), frame.m.flat());
  });

  it('keeps the turn of a frame and drops its scale', () => {
    const pivot = pivotOf([['g', BOX, { at: [1, 2, 3], rot: [0.3, 0.2, 0.1], s: [2, 0.5, 3] }]]);
    const { basis } = pivot;
    const cols = ([0, 1, 2] as const).map((j): Vec3 => [basis[0][j], basis[1][j], basis[2][j]]);
    for (const [i, a] of cols.entries()) {
      expect(Math.hypot(...a)).toBeCloseTo(1, 12);
      for (const b of cols.slice(i + 1)) expect(dot(a, b)).toBeCloseTo(0, 12);
    }
    close(pivot.origin, [1, 2, 3]);
  });

  it('goes to a pivot’s frame and back', () => {
    const pivot = pivotOf([['s', 30, 70, { spin: 1.1, alt: 0.2 }, BOX]]);
    const p: Vec3 = [0.3, -0.7, 1.9];
    close(fromPivot(toPivot(p, pivot), pivot), p, 12);
    close(toPivot(pivot.origin, pivot), [0, 0, 0], 12);
  });
});
