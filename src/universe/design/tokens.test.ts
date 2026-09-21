import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

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
});
