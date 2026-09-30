import { describe, expect, it } from 'vitest';
import { THEME_KEYS } from '../../design/tokens';
import { GLYPHS, glyph } from './glyphs';
import { normalOf } from './kit';
import { colorOf } from './palette';

// A colour family is a colour and a shape (vocabulary.md, section 5): every family of tokens.ts
// has one, and each plate costs 4n - 2 triangles (a fanned top, a bottom, the walls).

const PLATE: Readonly<Record<string, number>> = {
  butter: 46,
  coral: 14,
  sky: 14,
  mint: 10,
  lilac: 30,
};

describe('the family glyphs', () => {
  it('gives every family of the tokens a shape', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([...THEME_KEYS].sort());
  });

  it.each(THEME_KEYS.map((family) => [family]))('draws %s as its plate', (family) => {
    const tris = glyph(family, 0.1, 0.02);
    expect(tris).toHaveLength(PLATE[family] ?? -1);
    expect(tris).toHaveLength(4 * GLYPHS[family](0.1).length - 2);
    const top = tris.filter((t) => normalOf(t)[1] > 0.999);
    expect(top.every((t) => t.c === colorOf(`${family}.light`) && t.p[1] === 0.06)).toBe(true);
    const bottom = tris.filter((t) => normalOf(t)[1] < -0.999);
    expect(bottom.every((t) => t.c === colorOf(`${family}.shade`))).toBe(true);
  });

  it('stands each outline with its apex toward +Z, the star map’s north-up', () => {
    for (const family of THEME_KEYS) {
      const zs = GLYPHS[family](1).map(([, z]) => z);
      expect(Math.max(...zs), family).toBeGreaterThan(0.8);
    }
  });
});
