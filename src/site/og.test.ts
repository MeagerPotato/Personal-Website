import { describe, expect, it } from 'vitest';
import { tokens } from '../universe/design/tokens';
import { OG_SIZE, defaultOgSvg } from './og';

const svg = defaultOgSvg(tokens);

/** Every hex colour anywhere in the tokens, lower-cased. */
function tokenColours(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node === 'string') {
    if (/^#[0-9a-f]{3,8}$/i.test(node)) found.add(node.toLowerCase());
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) tokenColours(value, found);
  }
  return found;
}

describe('defaultOgSvg', () => {
  it('is the size link previews expect', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"'),
    ).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('is deterministic: the same tokens draw the same card, star for star', () => {
    expect(defaultOgSvg(tokens)).toBe(svg);
  });

  it('uses only colours from the design tokens (invariant 8)', () => {
    const allowed = tokenColours(tokens);
    const used = [...svg.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(([hex]) => hex.toLowerCase());
    expect(used.length).toBeGreaterThan(50);
    // url(#id) references are not colours: their ids never look like hex (they start with "og-").
    expect(used.filter((hex) => !allowed.has(hex))).toEqual([]);
  });

  it('follows the palette: change a token and the card changes with it', () => {
    const count = (text: string, part: string): number => text.split(part).length - 1;
    const repainted = structuredClone(tokens) as unknown as {
      color: { system: { butter: { base: string } } };
    };
    // Repaint the sun with another token: that colour must now appear more often than before.
    const paint = tokens.color.system.mint.shade;
    repainted.color.system.butter.base = paint;
    const after = defaultOgSvg(repainted as unknown as typeof tokens);
    expect(count(after, paint)).toBeGreaterThan(count(svg, paint));
    expect(count(after, tokens.color.system.butter.base)).toBeLessThan(
      count(svg, tokens.color.system.butter.base),
    );
  });

  it('contains no text, so it rasterises identically whatever fonts a machine has', () => {
    expect(svg).not.toMatch(/<text|<tspan|font-family/);
  });

  it('gives every clip path its own id and uses each one', () => {
    const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map(([, id]) => id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(svg).toContain(`url(#${id})`);
  });

  it('keeps every star on the canvas and never emits NaN', () => {
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    for (const [, cx, cy] of svg.matchAll(
      /<circle cx="([\d.-]+)" cy="([\d.-]+)" r="[\d.]+" fill="#/g,
    )) {
      expect(Number(cx)).toBeGreaterThanOrEqual(0);
      expect(Number(cx)).toBeLessThanOrEqual(OG_SIZE.width);
      expect(Number(cy)).toBeGreaterThanOrEqual(0);
      expect(Number(cy)).toBeLessThanOrEqual(OG_SIZE.height);
    }
  });
});
