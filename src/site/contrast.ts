// WCAG 2 contrast, worked out from the design tokens, so the stylesheet's colour pairings can be
// checked by a test instead of by eye (src/site/contrast.test.ts).
//
// Pure: hex strings in, numbers and hex strings out.

type Rgb = readonly [number, number, number];

function parse(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/**
 * A translucent colour laid over another: what `color-mix(in srgb, top N%, transparent)` looks
 * like once it is painted over `under`. Browsers blend in gamma-encoded sRGB, and so does this.
 */
export function over(top: string, alpha: number, under: string): string {
  const a = parse(top);
  const b = parse(under);
  const channel = (i: 0 | 1 | 2): number => a[i] * alpha + b[i] * (1 - alpha);
  return toHex([channel(0), channel(1), channel(2)]);
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parse(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio, 1 to 21. Order does not matter. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
