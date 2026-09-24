import { describe, expect, it } from 'vitest';
import { tokens } from '../universe/design/tokens';
import { FAVICON_SIZE, faviconSvg } from './favicon';

const svg = faviconSvg(tokens);

/** Every hex colour anywhere in the tokens, lower-cased. */
function tokenColours(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node === 'string') {
    if (/^#[0-9a-f]{3,8}$/i.test(node)) found.add(node.toLowerCase());
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) tokenColours(value, found);
  }
  return found;
}

describe('faviconSvg', () => {
  it('is a square SVG drawn on a 32 px grid', () => {
    expect(FAVICON_SIZE).toBe(32);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">')).toBe(
      true,
    );
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('uses only colours from the design tokens (invariant 8)', () => {
    const allowed = tokenColours(tokens);
    const used = [...svg.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(([hex]) => hex.toLowerCase());
    expect(used.length).toBeGreaterThanOrEqual(4);
    expect(used.filter((hex) => !allowed.has(hex))).toEqual([]);
  });

  it('follows the palette: repaint the planet token and the icon changes with it', () => {
    const repainted = structuredClone(tokens) as unknown as {
      color: { system: { sky: { base: string } } };
    };
    repainted.color.system.sky.base = tokens.color.system.mint.base;
    const after = faviconSvg(repainted as unknown as typeof tokens);
    expect(after).not.toBe(svg);
    expect(after).toContain(tokens.color.system.mint.base);
  });

  it('contains no text and nothing external, so it draws the same everywhere', () => {
    expect(svg).not.toMatch(/<text|<tspan|font-family|<image|href="http/);
  });

  it('is deterministic', () => {
    expect(faviconSvg(tokens)).toBe(svg);
  });
});
