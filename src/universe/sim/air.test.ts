import { describe, expect, it } from 'vitest';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import {
  airShade,
  alongStops,
  inAir,
  limbTint,
  shellAlpha,
  type AirColors,
  type AirPlace,
} from './air';
import { hexToLinear } from './color';
import type { Rgb } from './meshBuilder';

// The air's shaders only run on a GPU; this is their twin, with the numbers of the real look
// (design/tuning.ts, `look.air`) and the real tokens. What must hold: a lit place seen straight
// on is exactly its token, the star map is flat, and a night is never black.

const { air: look } = tuning.look;
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const white: Rgb = [1, 1, 1];
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** The colours as design/materials.ts hands them to the shader (`airBands`). */
const colorsOf = (air: keyof typeof tokens.color.air): AirColors => ({
  air: hexToLinear(tokens.color.air[air]),
  dusk: lerp(
    white,
    scale(hexToLinear(tokens.color.shading.dusk), look.bands.dusk),
    look.bands.duskShare,
  ),
  night: scale(hexToLinear(tokens.color.shading.night), look.bands.night),
  shadow: hexToLinear(tokens.color.shading.shadow),
});
const colors = colorsOf('terra');
const shading = tuning.shading;
const sea = hexToLinear(tokens.color.biome.terra.sea);
const place = (over: Partial<AirPlace>): AirPlace => ({
  facing: 1,
  nz: 1,
  ballFacing: 1,
  ...over,
});

describe('a world with air: its three bands', () => {
  it('leaves a lit place that faces the camera exactly its token', () => {
    for (const facing of [1, 0.7, shading.bandEdges[1] + 0.01]) {
      expect(airShade(sea, place({ facing }), colors, look, shading)).toEqual(sea);
    }
    // And so over most of the disc: the tint starts well out toward the limb.
    expect(airShade(sea, place({ nz: 0.7 }), colors, look, shading)).toEqual(sea);
  });

  it('warms the middle band and cools the shade, and never makes a night black', () => {
    const [low, high] = shading.bandEdges;
    const dusk = airShade(sea, place({ facing: (low + high) / 2 }), colors, look, shading);
    const night = airShade(sea, place({ facing: -1, ballFacing: -1 }), colors, look, shading);
    dusk.forEach((value, k) => expect(value).toBeCloseTo((sea[k] ?? 0) * (colors.dusk[k] ?? 0)));
    night.forEach((value, k) => expect(value).toBeCloseTo((sea[k] ?? 0) * (colors.night[k] ?? 0)));
    // Warm: the dusk keeps more of the red than of the blue; cool: the night the other way.
    expect(colors.dusk[0]).toBeGreaterThan(colors.dusk[2]);
    expect(colors.night[2]).toBeGreaterThan(colors.night[0]);
    // Darker band by band, and the night keeps at least 0.04 of every channel of the lit colour.
    for (let k = 0; k < 3; k += 1) {
      expect(colors.dusk[k]).toBeLessThanOrEqual(1);
      expect(colors.night[k]).toBeLessThan(colors.dusk[k] ?? 0);
      expect(colors.night[k]).toBeGreaterThanOrEqual(0.04);
    }
  });

  it('is its token everywhere on the star map', () => {
    for (const facing of [1, 0.1, -1]) {
      for (const nz of [1, 0.4, 0]) {
        const shaded = airShade(
          sea,
          place({ facing, nz, ballFacing: facing }),
          colors,
          look,
          shading,
          1,
        );
        shaded.forEach((value, k) => expect(value).toBeCloseTo(sea[k] ?? NaN, 12));
      }
    }
  });

  it('lights what stands above the air as everything without air is lit', () => {
    const [low, high] = shading.bandEdges;
    const top = look.limb.topRadii[1];
    const mid = airShade(
      sea,
      place({ facing: (low + high) / 2, height: top }),
      colors,
      look,
      shading,
    );
    const shade = airShade(sea, place({ facing: -1, height: top + 1 }), colors, look, shading);
    for (let k = 0; k < 3; k += 1) {
      const dark = (sea[k] ?? 0) * (colors.shadow[k] ?? 0);
      expect(mid[k]).toBeCloseTo(dark + ((sea[k] ?? 0) - dark) * shading.midLevel);
      expect(shade[k]).toBeCloseTo(dark);
    }
    expect(inAir(place({ height: 1 }), look)).toBe(1);
    expect(inAir(place({ height: top }), look)).toBe(0);
  });
});

describe('a world with air: the tint on its limb', () => {
  it('is nothing mid-disc and the most on the outline, in flat steps', () => {
    const { lit, always, steps } = look.limb;
    expect(limbTint(place({ nz: 1 }), look)).toBe(0);
    expect(limbTint(place({ nz: 0 }), look)).toBeCloseTo(lit + always);
    const seen = new Set<number>();
    let last = 0;
    for (let nz = 1; nz >= 0; nz -= 0.001) {
      const tint = limbTint(place({ nz }), look);
      expect(tint).toBeGreaterThanOrEqual(last);
      last = tint;
      seen.add(Math.round(tint * 1e6));
    }
    // Flat levels: none, and then one for each step.
    expect(seen.size).toBe(steps + 1);
  });

  it('is strong toward the light, faint at night, and gone above the air', () => {
    const day = limbTint(place({ nz: 0, ballFacing: 1 }), look);
    const night = limbTint(place({ nz: 0, ballFacing: -1 }), look);
    expect(night).toBeCloseTo(look.limb.always);
    expect(day).toBeGreaterThan(5 * night);
    expect(limbTint(place({ nz: 0, height: look.limb.topRadii[1] }), look)).toBe(0);
  });

  it('takes the limb toward the air’s colour, never past it', () => {
    for (const key of Object.keys(tokens.color.air) as Array<keyof typeof tokens.color.air>) {
      const of = colorsOf(key);
      const rim = airShade(sea, place({ nz: 0 }), of, look, shading);
      rim.forEach((value, k) => {
        const [from, to] = [sea[k] ?? 0, of.air[k] ?? 0];
        expect(value).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-12);
        expect(value).toBeLessThanOrEqual(Math.max(from, to) + 1e-12);
      });
    }
  });
});

describe('a world with air: its shell', () => {
  it('reads stops linearly between two, and holds outside them', () => {
    const stops = [
      [0, 1],
      [72, 0.85],
      [180, 0.16],
    ] as const;
    expect(alongStops(stops, -5)).toBe(1);
    expect(alongStops(stops, 0)).toBe(1);
    expect(alongStops(stops, 36)).toBeCloseTo(0.925);
    expect(alongStops(stops, 72)).toBeCloseTo(0.85);
    expect(alongStops(stops, 126)).toBeCloseTo(0.505);
    expect(alongStops(stops, 200)).toBe(0.16);
    expect(alongStops([], 3)).toBe(0);
  });

  it('is rings outside the outline, fainter outward and toward the night', () => {
    const { shell } = look;
    expect(shellAlpha(0.99, 0, shell)).toBe(0);
    expect(shellAlpha(1.4, 0, shell)).toBe(0);
    let last = Infinity;
    for (const [inner, outer, alpha] of shell.rings) {
      const middle = (inner + outer) / 2;
      expect(shellAlpha(middle, 0, shell)).toBeCloseTo(alpha);
      expect(shellAlpha(middle, 0, shell)).toBeLessThan(last);
      expect(shellAlpha(middle, 180, shell)).toBeLessThan(0.25 * alpha);
      // The same either side of the light.
      expect(shellAlpha(middle, -70, shell)).toBe(shellAlpha(middle, 70, shell));
      last = alpha;
    }
    // The low tier keeps the inner rings.
    const [inner, outer] = shell.rings.at(-1) ?? [0, 0];
    expect(shell.lowRings).toBeLessThan(shell.rings.length);
    expect(shellAlpha((inner + outer) / 2, 0, shell, true)).toBe(0);
    expect(shellAlpha(1.02, 0, shell, true)).toBe(shellAlpha(1.02, 0, shell));
  });

  it('puts the dusk of the hairline on the terminator, and fades it into the night', () => {
    const { stops } = look.rim;
    const alphas = stops.map(([deg, , alpha]) => [deg, alpha] as const);
    expect(stops.find(([, tone]) => tone === 'dusk')?.[0]).toBe(90);
    expect(alongStops(alphas, 0)).toBeGreaterThan(0.9);
    expect(alongStops(alphas, 180)).toBeLessThan(0.15);
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]?.[0]).toBeGreaterThan(stops[i - 1]?.[0] ?? Infinity);
    }
  });
});
