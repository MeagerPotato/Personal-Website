import type { SkyLook } from '../design/lookTypes';
import type { Rgb } from './meshBuilder';
import { bandFrame, bulgeAt, clumpAt, laneAt, meanderAt, profileAt } from './milkyWay';
import { frameOf, type Direction } from './skyDirections';

/**
 * THE SKY'S ORACLE: what one texel of the baked sky holds, computed on the CPU. It is the twin
 * of the bake's shader (design/shaders/skyBake.ts), expression for expression, in float64: the
 * tests hold the sky to its luminance gates with it (tests/sky-gates.test.ts), and the lab
 * compares the GPU's panorama with it texel by texel. NOTHING THE ENGINE SHIPS IMPORTS IT.
 *
 * Input: a unit direction (y up). Output: the light the sky ADDS to the navy (linear RGB) and,
 * fourth, how much of a star shows there (1 = clear sky; less in the Milky Way's dark lane).
 *
 * The picture: the Milky Way's haze (sim/milkyWay.ts: a river along a great circle, with a dark
 * lane and a cream bulge) and far galaxies, on navy. No gas: nothing here is noise and nothing
 * is cut into levels. Keep the order of every expression: the recipe's own values
 * (tests/sky-gates.test.ts) hold to nine places only while it is kept.
 */

/** Every colour the bake is given, linear: the shader receives the same as uniforms. */
export interface SkyColours {
  readonly navyDeep: Rgb;
  readonly navyHorizon: Rgb;
  /** tuning.backdrop.horizonFalloff. */
  readonly falloff: number;
  /** The Milky Way's haze (tokens.color.nebula.band). */
  readonly band: { readonly deep: Rgb; readonly mid: Rgb; readonly lit: Rgb; readonly rim: Rgb };
  /** The star tints, by key (tokens.color.star): what a far galaxy is painted with. */
  readonly stars: Readonly<Record<string, Rgb>>;
}

const RAD = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const luminance = (c: ArrayLike<number>): number =>
  0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

/** The navy under everything: the backdrop's, to the bit. */
export function navyAt(colours: SkyColours, dy: number, out: number[]): number[] {
  const k = Math.exp(-Math.abs(dy) * colours.falloff);
  for (let c = 0; c < 3; c += 1) {
    out[c] = mix(colours.navyDeep[c] ?? 0, colours.navyHorizon[c] ?? 0, k);
  }
  return out;
}

/**
 * The oracle for one recipe: `texel(direction, out)` writes [r, g, b, occlusion] into `out` and
 * returns it. The same on every tier: a tier is only the size of the panorama.
 */
export function createSkyOracle(
  look: SkyLook,
  colours: SkyColours,
): (direction: Direction, out: number[]) => number[] {
  const tint = (key: string): Rgb => {
    const found = colours.stars[key];
    if (!found) throw new RangeError(`skyOracle: no star tint "${key}"`);
    return found;
  };
  const { band } = look;
  const { pole, b1, b2 } = bandFrame(band);
  const haze = colours.band;
  const galaxies = look.galaxies.map((galaxy) => ({
    ...frameOf(galaxy.azDeg, galaxy.elDeg),
    kind: galaxy.kind,
    a: galaxy.radiusDeg,
    b: galaxy.radiusDeg * galaxy.axisRatio,
    cosR: Math.cos(Math.min(galaxy.radiusDeg * 2.2, 6) * RAD),
    ca: Math.cos(galaxy.angleDeg * RAD),
    sa: Math.sin(galaxy.angleDeg * RAD),
    disc: tint(galaxy.disc),
    core: tint(galaxy.core),
    gain: galaxy.gain,
  }));

  const navy = [0, 0, 0];
  const add = [0, 0, 0];

  return function texel(direction, out) {
    const [dx, dy, dz] = direction;
    const el = Math.asin(clamp(dy, -1, 1)) / RAD;
    navyAt(colours, dy, navy);
    add[0] = 0;
    add[1] = 0;
    add[2] = 0;
    let occ = 1;

    // ---- the Milky Way. lb: degrees off its great circle; phi: the longitude round it.
    const lb = Math.asin(clamp(dx * pole[0] + dy * pole[1] + dz * pole[2], -1, 1)) / RAD;
    if (Math.abs(lb) < 40) {
      const phi = Math.atan2(
        dx * b2[0] + dy * b2[1] + dz * b2[2],
        dx * b1[0] + dy * b1[1] + dz * b1[2],
      );
      const lon = phi / RAD;
      const yy = lb - meanderAt(band, phi);
      const prof = profileAt(band, yy);
      const clump = clumpAt(band, lon);
      const lane = laneAt(band, phi, yy);
      const bq = clamp(prof * clump * band.gain, 0, 1);
      const cream = bulgeAt(band, lon) * band.core.mix * sstep(0.4, 1, bq);
      const dark = 1 - band.lane.dark * lane * sstep(0.05, 0.35, bq);
      const cover = 0.95 * sstep(0, 0.22, bq);
      for (let c = 0; c < 3; c += 1) {
        let v = mix(haze.deep[c] ?? 0, haze.mid[c] ?? 0, sstep(0.04, 0.55, bq));
        v = mix(v, haze.lit[c] ?? 0, 0.45 * sstep(0.5, 1, bq));
        v = mix(v, haze.rim[c] ?? 0, cream);
        v *= dark;
        add[c] = cover * Math.max(v - (navy[c] ?? 0), 0);
      }
      occ = 1 - band.lane.hide * lane * sstep(0, 0.25, bq);
    }

    // ---- far galaxies: a disc with a soft rim and a tight nucleus, in two star tints
    for (const g of galaxies) {
      const cd = dx * g.c[0] + dy * g.c[1] + dz * g.c[2];
      if (cd < g.cosR) continue;
      const px = dx - g.c[0] * cd;
      const py = dy - g.c[1] * cd;
      const pz = dz - g.c[2] * cd;
      const u = (px * g.e1[0] + py * g.e1[1] + pz * g.e1[2]) / RAD;
      const v = (px * g.e2[0] + py * g.e2[1] + pz * g.e2[2]) / RAD;
      const x = u * g.ca + v * g.sa;
      const y = -u * g.sa + v * g.ca;
      const r2 = (x / g.a) * (x / g.a) + (y / g.b) * (y / g.b);
      if (r2 > 4) continue;
      const r = Math.sqrt(r2);
      let disc = Math.exp(-2.6 * r) * (1 - sstep(0.82, 1.18, r));
      let core = Math.exp(-28 * r2);
      if (g.kind === 'spiral') {
        // Two arms.
        disc *=
          0.45 +
          0.9 *
            (0.5 + 0.5 * Math.cos(2 * Math.atan2(y / g.b, x / g.a) - 6.2 * Math.log(r + 0.12))) *
            sstep(0.08, 0.5, r);
      } else if (g.kind === 'lens') {
        // Edge on: a dark lane along it.
        const lane =
          Math.exp(-(y / (0.2 * g.b)) * (y / (0.2 * g.b))) *
          sstep(0.05, 0.5, 1 - Math.min(1, r2 / 1.1));
        disc *= 1 - 0.6 * lane;
        core *= 1 - 0.3 * lane;
      }
      const o = 0.55 * disc + 0.9 * core;
      const k = clamp((0.9 * core) / Math.max(o, 1e-6), 0, 1);
      const amount = o * 0.42 * g.gain;
      for (let c = 0; c < 3; c += 1) {
        add[c] = (add[c] ?? 0) + mix(g.disc[c] ?? 0, g.core[c] ?? 0, k) * amount;
      }
    }

    // ---- faded toward the horizon, then a soft knee at the ceiling
    const strip = sstep(look.stripDeg[0], look.stripDeg[1], Math.abs(el));
    let ar = (add[0] ?? 0) * strip;
    let ag = (add[1] ?? 0) * strip;
    let ab = (add[2] ?? 0) * strip;
    const ya = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab;
    if (ya > 1e-9) {
      const room = Math.max(look.ceilingY - luminance(navy), 1e-5);
      const knee = (room * Math.tanh(ya / room)) / ya;
      ar *= knee;
      ag *= knee;
      ab *= knee;
    }
    out[0] = ar * look.intensity;
    out[1] = ag * look.intensity;
    out[2] = ab * look.intensity;
    out[3] = occ;
    return out;
  };
}
