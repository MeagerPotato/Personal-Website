import { describe, expect, it } from 'vitest';
import { BIOME_KEYS, THEME_KEYS, tokens } from './tokens';

describe('design tokens', () => {
  it('keeps the narrow type scale equal to the narrow end of the fluid one', () => {
    // The info panel pins the fluid scale to its narrow end (styles/global.css). If someone
    // retunes `text` and forgets `textNarrow`, the panel silently keeps the old sizes.
    for (const [key, fluid] of Object.entries(tokens.text)) {
      const narrowEnd = /^clamp\(\s*([^,]+),/.exec(fluid)?.[1];
      expect(narrowEnd, `text.${key} is not a clamp()`).toBeDefined();
      expect(tokens.textNarrow[key as keyof typeof tokens.textNarrow], `textNarrow.${key}`).toBe(
        narrowEnd,
      );
    }
    expect(Object.keys(tokens.textNarrow)).toEqual(Object.keys(tokens.text));
  });

  it('writes every colour as a six-digit hex, which is what the engine and the CSS both parse', () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') expect(value, path).toMatch(/^#[0-9a-f]{6}$/);
      else
        for (const [key, inner] of Object.entries(value as object)) walk(inner, `${path}.${key}`);
    };
    walk(tokens.color, 'color');
  });

  it('gives air to every biome with a sea, and to no other', () => {
    // Primer is the clay of work not built yet: no sea, so no air (design/worlds/air.ts, later).
    expect(Object.keys(tokens.color.air).sort()).toEqual(
      BIOME_KEYS.filter((biome) => biome !== 'primer').sort(),
    );
  });

  it('gives every family the two tones of its district, and the Milky Way its three', () => {
    expect(Object.keys(tokens.color.nebula).sort()).toEqual([...THEME_KEYS, 'band'].sort());
    for (const family of THEME_KEYS) {
      expect(Object.keys(tokens.color.nebula[family]), family).toEqual(['mid', 'lit']);
    }
    expect(Object.keys(tokens.color.nebula.band)).toEqual(['deep', 'mid', 'lit']);
  });
});
