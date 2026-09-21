import type { Rgb } from './meshBuilder';

/**
 * Colours for generated geometry. Tokens are sRGB hex strings, which is what CSS wants; a vertex
 * colour has to be LINEAR, because the shaders light in linear space and convert back on output
 * (three's colour management does the same for `new Color(hex)`). Pure, so generators can run
 * headless.
 */

function channelToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** '#rrggbb' -> linear RGB floats. Throws on anything else: a typo must not become black. */
export function hexToLinear(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new RangeError(`hexToLinear: expected '#rrggbb', got '${hex}'`);
  const [, r = '', g = '', b = ''] = match;
  return [
    channelToLinear(Number.parseInt(r, 16)),
    channelToLinear(Number.parseInt(g, 16)),
    channelToLinear(Number.parseInt(b, 16)),
  ];
}
