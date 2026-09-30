import { describe, expect, it } from 'vitest';
import { THEME_KEYS } from '../../design/tokens';
import { colorOf } from './palette';
import { chip, crane, dashes, pebbles, planned } from './planned';
import { FLAG, make, mk } from './rows';

// The planned kit's parts and their counts are the vocabulary's (section 6).

describe('the planned kit', () => {
  it.each(THEME_KEYS.map((family) => [family]))('builds its parts in %s', (family) => {
    expect(mk(crane(family))).toHaveLength(80);
    const card = mk(chip(family));
    expect(card).toHaveLength(64);
    for (const band of ['light', 'base', 'shade'] as const) {
      expect(
        card.some((t) => t.c === colorOf(`${family}.${band}`)),
        band,
      ).toBe(true);
    }
  });

  it('lights the crane’s beacon, and nothing else', () => {
    const tris = mk(crane('coral'));
    expect(tris.filter((t) => t.g === 2)).toHaveLength(8);
  });

  it('dashes a ring: 8 triangles a dash under ten dashes, 4 from ten on', () => {
    expect(mk(['g', ...dashes('sky', [1.4, 1.48], 6)])).toHaveLength(48);
    expect(mk(['g', ...dashes('lilac', [1.4, 1.48], 12)])).toHaveLength(48);
    expect(mk(['g', ...dashes('mint', [1.42, 1.5], 16)])).toHaveLength(64);
  });

  it('scatters the same pebbles every time, 8 triangles each, in primer', () => {
    const one = mk(pebbles(5, 1.4));
    expect(one).toHaveLength(40);
    expect(mk(pebbles(5, 1.4))).toEqual(one);
    // A bead is a lathe, whose colours come through MeshBuilder's float32 buffers.
    const primer = Array.from(new Float32Array(colorOf('biome.primer.high')));
    expect(one.every((t) => String(t.c) === String(primer))).toBe(true);
  });

  it('gives a planned body its four parts, the ring and the debris held', () => {
    const rows = planned('mint', { n: 16, debris: 6 });
    expect(rows.map(([name, flags]) => [name, flags])).toEqual([
      ['final-size-ring', FLAG.hold],
      ['crane', 0],
      ['paint-chip', 0],
      ['debris', FLAG.hold],
    ]);
    const build = make('t', { rows: [[['bead', 0.1, 'ink.high']], ...rows] }, { detail: 0 });
    expect(build.parts.map((p) => p.tris.length)).toEqual([64, 80, 64, 48]);
  });
});
