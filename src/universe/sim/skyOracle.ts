import type { SkyLook, SkyTier } from '../design/lookTypes';
import type { Rgb } from './meshBuilder';
import { frameOf, type Direction } from './skyDirections';
import { fbm3 } from './skyNoise';

/**
 * THE SKY'S ORACLE: what one texel of the baked sky holds, computed on the CPU. It is the twin
 * of the bake's shader (design/shaders/skyBake.ts), expression for expression, in float64: the
 * tests hold the sky to its luminance gates with it (tests/sky-gates.test.ts), and the lab
 * compares the GPU's panorama with it texel by texel. NOTHING THE ENGINE SHIPS IMPORTS IT.
 *
 * Input: a unit direction (y up). Output: the light the sky ADDS to the navy (linear RGB) and,
 * fourth, how much of a star survives behind the gas there (1 = clear sky).
 *
 * The picture: below the horizon each system has a MASSIF of gas, three flat ridgelines receding
 * (far = hazy and light, near = dark and crisp), a thin lit line along each crest, and behind
 * the far one a stepped glow in the system's colour. Across the sky a Milky Way, far galaxies,
 * old blast arcs and knots of gas. Depth is layering. Keep the order of every expression: the
 * recipe's own values (skyOracle.test.ts) hold to nine places only while it is kept.
 */

/** The four tones of a ramp of gas, linear. */
export interface SkyRamp {
  readonly deep: Rgb;
  readonly mid: Rgb;
  readonly lit: Rgb;
  readonly rim: Rgb;
}

/** Every colour the bake is given, linear: the shader receives the same as uniforms. */
export interface SkyColours {
  readonly navyDeep: Rgb;
  readonly navyHorizon: Rgb;
  /** tuning.backdrop.horizonFalloff. */
  readonly falloff: number;
  /** By family (a key of tokens.color.nebula; `band` is the Milky Way's). */
  readonly ramps: Readonly<Record<string, SkyRamp>>;
  readonly starCool: Rgb;
  readonly starWarm: Rgb;
  readonly starHot: Rgb;
  readonly starAmber: Rgb;
}

/** Which layers a tier's shader keeps: the fields of a SkyTier that change the picture. */
export type SkyLayers = Pick<SkyTier, 'far' | 'reliefOctaves' | 'rag2' | 'wisp'>;

const RAD = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;
export const luminance = (c: ArrayLike<number>): number =>
  0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

/** `steps` flat levels, with edges `soft` wide (0 hard, 1 smooth). */
function posterise(d: number, steps: number, soft: number): number {
  const s = clamp(d, 0, 1) * steps;
  const k = Math.floor(s);
  const w = 0.04 + 0.46 * soft;
  return Math.min((k + sstep(0.5 - w, 0.5 + w, s - k)) / steps, 1);
}

/** The navy under everything: today's backdrop, to the bit. */
export function navyAt(colours: SkyColours, dy: number, out: number[]): number[] {
  const k = Math.exp(-Math.abs(dy) * colours.falloff);
  for (let c = 0; c < 3; c += 1) {
    out[c] = mix(colours.navyDeep[c] ?? 0, colours.navyHorizon[c] ?? 0, k);
  }
  return out;
}

/**
 * The oracle for one recipe: `texel(direction, out)` writes [r, g, b, occlusion] into `out` and
 * returns it. `layers` is what the tier's shader keeps (all of it when left out: the high tier).
 */
export function createSkyOracle(
  look: SkyLook,
  colours: SkyColours,
  layers: SkyLayers = { far: true, reliefOctaves: look.reliefOctaves, rag2: true, wisp: true },
): (direction: Direction, out: number[]) => number[] {
  const ramp = (family: string): SkyRamp => {
    const found = colours.ramps[family];
    if (!found) throw new RangeError(`skyOracle: no ramp of gas for "${family}"`);
    return found;
  };
  const { band, ridges } = look;
  const tilt = band.tiltDeg * RAD;
  const poleAz = band.poleAzDeg * RAD;
  const pole = [
    Math.sin(tilt) * Math.sin(poleAz),
    Math.cos(tilt),
    Math.sin(tilt) * Math.cos(poleAz),
  ];
  const [poleX = 0, poleY = 1, poleZ = 0] = pole;
  const bandRamp = ramp('band');
  const pools = look.pools.map((pool) => ({
    ...pool,
    ramp: ramp(pool.family),
    alt: ramp(pool.altFamily),
    heart: pool.family === 'coral' ? colours.starHot : colours.starAmber,
  }));
  const galaxies = look.galaxies.map((galaxy) => ({
    ...galaxy,
    ...frameOf(galaxy.azDeg, galaxy.elDeg),
    cosR: Math.cos(Math.min(galaxy.radiusDeg * 2.2, 5) * RAD),
    ca: Math.cos(galaxy.angleDeg * RAD),
    sa: Math.sin(galaxy.angleDeg * RAD),
  }));
  const arcs = look.arcs.map((arc) => ({
    ...arc,
    ...frameOf(arc.azDeg, arc.elDeg),
    ramp: ramp(arc.family),
  }));
  const knots = look.knots.map((knot) => ({
    ...knot,
    ...frameOf(knot.azDeg, knot.elDeg),
    ramp: ramp(knot.family),
  }));

  const navy = [0, 0, 0];
  const acc = [0, 0, 0];
  const top = [0, 0, 0];
  const deep = [0, 0, 0];
  const mid = [0, 0, 0];
  const lit = [0, 0, 0];
  const rim = [0, 0, 0];
  const tot = [0, 0, 0];

  function galaxyAt(dx: number, dy: number, dz: number, g: (typeof galaxies)[number]): number {
    const k = dx * g.c[0] + dy * g.c[1] + dz * g.c[2];
    const px = dx - g.c[0] * k;
    const py = dy - g.c[1] * k;
    const pz = dz - g.c[2] * k;
    const u = (px * g.e1[0] + py * g.e1[1] + pz * g.e1[2]) / RAD;
    const v = (px * g.e2[0] + py * g.e2[1] + pz * g.e2[2]) / RAD;
    const x = u * g.ca + v * g.sa;
    const y = -u * g.sa + v * g.ca;
    const a = g.radiusDeg;
    const b = g.radiusDeg * g.axisRatio;
    const r2 = (x / a) * (x / a) + (y / b) * (y / b);
    if (r2 > 6) return 0;
    let out = 0.55 * Math.exp(-r2 * 1.1) + 0.9 * Math.exp(-r2 * 9);
    if (g.kind === 'lens') {
      const yl = y / (b * 0.16);
      out *= 1 - 0.8 * Math.exp(-yl * yl) * sstep(0.05, 0.6, 1 - Math.min(1, r2 / 1.2));
    } else if (g.kind === 'spiral') {
      const th = Math.atan2(y / b, x / a);
      const rr = Math.sqrt(r2);
      out *=
        0.55 + 0.7 * (0.5 + 0.5 * Math.cos(2 * th - 5.5 * Math.log(rr + 0.15))) * sstep(0, 0.5, rr);
    }
    return Math.min(out, 1.3);
  }

  return function texel(direction, out) {
    const [dx, dy, dz] = direction;
    const az = Math.atan2(dx, dz) / RAD;
    const el = Math.asin(clamp(dy, -1, 1)) / RAD;
    navyAt(colours, dy, navy);
    tot[0] = navy[0] ?? 0;
    tot[1] = navy[1] ?? 0;
    tot[2] = navy[2] ?? 0;
    let occ = 1;
    const ce = Math.max(0.35, Math.cos(el * RAD));

    // ---- the massifs
    if (el < 4 && el > -62) {
      const wAz =
        (fbm3(dx * look.warpFreq + 1.7, dy * 0.4 + 8.3, dz * look.warpFreq + 2.9, 2, 0) - 0.5) *
        2 *
        look.warpAzDeg;
      // A ragged push sideways on top of the slow one, for WHOSE gas a texel is and how much of
      // it: without it a massif ends, and its glow with it, along a line of one azimuth,
      // straight up the sky. (The crests are not pushed: a crest is a height by azimuth, and a
      // ragged azimuth would fold it over.)
      const ragAz =
        look.ragAzDeg > 0
          ? (fbm3(
              dx * look.ragAzFreq + 6.3,
              dy * look.ragAzFreq + 9.4,
              dz * look.ragAzFreq + 2.6,
              3,
              4,
            ) -
              0.5) *
            2 *
            look.ragAzDeg
          : 0;
      let best = 0;
      let second = 0;
      let owner = -1;
      let oU = 0;
      for (let j = 0; j < pools.length; j += 1) {
        const p = pools[j];
        if (!p) continue;
        const u = (wrap180(az + wAz + ragAz - p.azDeg) * ce) / p.halfWidthDeg;
        const inf = Math.exp(-u * u * look.poolFall) * p.strength;
        if (inf > best) {
          second = best;
          best = inf;
          owner = j;
          oU = u;
        } else if (inf > second) second = inf;
      }
      const body = clamp(best - second * look.seam, 0, 1);
      const pool = pools[owner];
      if (body > 0.004 && pool) {
        const tint = fbm3(dx * 2.4 + 9.1, dy * 2.4 + 2.2, dz * 2.4 + 4.4, 2, 0);
        const alt = sstep(0.66 - pool.altShare * 0.6, 0.74, tint);
        for (let c = 0; c < 3; c += 1) {
          deep[c] = mix(pool.ramp.deep[c] ?? 0, pool.alt.deep[c] ?? 0, alt);
          mid[c] = mix(pool.ramp.mid[c] ?? 0, pool.alt.mid[c] ?? 0, alt);
          lit[c] = mix(pool.ramp.lit[c] ?? 0, pool.alt.lit[c] ?? 0, alt);
          rim[c] = mix(pool.ramp.rim[c] ?? 0, pool.alt.rim[c] ?? 0, alt);
        }

        // Ragged detail on every crest, in degrees of elevation.
        const rag =
          (fbm3(
            dx * look.ragFreq + 4.4,
            dy * look.ragFreq * 1.6 + 1.2,
            dz * look.ragFreq + 9.9,
            3,
            0,
          ) -
            0.5) *
          2 *
          look.ragDeg;
        const rag2 = layers.rag2
          ? (fbm3(
              dx * look.rag2Freq + 8.8,
              dy * look.rag2Freq * 1.5 + 3.2,
              dz * look.rag2Freq + 1.9,
              2,
              1,
            ) -
              0.5) *
            2 *
            look.rag2Deg
          : 0;
        const e = el + rag + rag2;
        const a = (az + wAz) * RAD;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // The massif sinks away at its ends.
        const sink = (1 - body) * look.dropDeg;
        for (let k = 0; k < 3; k += 1) {
          const ridge = ridges[k as 0 | 1 | 2];
          const f = ridge.freq;
          const n1 = fbm3(
            ca * f + pool.seed * (1 + k * 0.37),
            sa * f + pool.seed * 0.61,
            2.7 + k * 3.1,
            5,
            k,
          );
          const rid =
            1 -
            Math.abs(2 * fbm3(ca * f * 1.7 + pool.seed, sa * f * 1.7 + 4.1 * k, 7.3 + k, 3, 1) - 1);
          const sw = (0.7 * n1 + 0.3 * rid * rid - 0.4) * 2.0;
          top[k] = pool.elDeg + ridge.offDeg * pool.height + ridge.ampDeg * pool.height * sw - sink;
        }

        // ---- the glow above the far crest: brightest just above it, stepped, in the family's colour
        const dA = e - (top[0] ?? 0);
        const lat = Math.exp(-oU * oU * look.glowLateral * 1.6);
        const hgt = Math.exp(-Math.max(dA, 0) / look.glowHeightDeg);
        const streak = fbm3(dx * 6.5 + 3.3, dy * 1.3 + 1.1, dz * 6.5 + 6.1, 3, 0);
        const fil = 1 - look.glowFilament + look.glowFilament * (streak * 1.7 - 0.25);
        const heart =
          look.heart *
          Math.exp(-(oU * oU) / 0.06) *
          Math.exp(-Math.max(dA, 0) / (look.glowHeightDeg * 1.6));
        const g0 =
          clamp((body * lat * hgt * fil + heart * body) * look.glowGain * 1.15, 0, 1) *
          sstep(-1.5, 1.2, dA);
        const gq = posterise(g0, look.glowSteps, look.glowSoft);
        const hw = clamp(heart * body * 2.4, 0, 1) * sstep(0.45, 0.9, gq);
        // Steam rising off the far crest: ridged noise stretched upward, strongest right above it.
        let wsp = 0;
        if (layers.wisp) {
          const wr = 1 - Math.abs(2 * fbm3(dx * 15 + 2.2, dy * 2.1 + 7.7, dz * 15 + 5.1, 3, 3) - 1);
          wsp =
            sstep(0.8, 0.95, wr) *
            Math.exp(-Math.max(dA, 0) / 3.4) *
            sstep(-0.3, 0.6, dA) *
            body *
            look.wisp;
        }
        for (let c = 0; c < 3; c += 1) {
          let gc = mix(deep[c] ?? 0, mid[c] ?? 0, sstep(0.1, 0.5, gq));
          gc = mix(gc, lit[c] ?? 0, sstep(0.55, 0.95, gq));
          gc = mix(gc, (pool.heart[c] ?? 0) * 0.5, hw * look.heartMix);
          gc = mix(gc, lit[c] ?? 0, wsp);
          acc[c] = mix(navy[c] ?? 0, gc, Math.max(sstep(0.02, 0.2, g0), wsp * 0.9));
        }

        // ---- the three ridges, far to near: a flat body, a thin lit crest, a soft light under it
        let dmax = 0;
        const octaves = layers.reliefOctaves;
        const relief = (y: number): number =>
          fbm3(
            dx * look.reliefFreq + 3.9,
            y * look.reliefFreq * 1.35 + 6.2,
            dz * look.reliefFreq + 7.4,
            octaves,
            2,
          );
        const lumps =
          octaves > 0 ? clamp((relief(dy) - relief(dy + look.reliefTap)) * 22, 0, 1) : 0;
        for (let k = 0; k < 3; k += 1) {
          const ridge = ridges[k as 0 | 1 | 2];
          // Degrees below the crest.
          const dr = (top[k] ?? 0) - e;
          const m = sstep(-ridge.edgeDeg, ridge.edgeDeg, dr);
          if (m <= 0.001) continue;
          // The body: darker with each step nearer; the far one takes a little of the glow behind it.
          const haze = 0.34 - 0.12 * k;
          for (let c = 0; c < 3; c += 1) {
            const bc =
              (navy[c] ?? 0) * (0.8 - 0.1 * k) +
              (k === 0
                ? (mid[c] ?? 0) * ridge.body * 0.55 + (deep[c] ?? 0) * ridge.body * 0.6
                : (deep[c] ?? 0) * ridge.body);
            acc[c] = mix(acc[c] ?? 0, bc + (acc[c] ?? 0) * haze * (k === 0 ? 1 : 0), m);
          }
          const line = (1 - sstep(0, ridge.rimDeg, dr)) * m;
          const soft = (1 - sstep(0, ridge.softDeg, dr)) * m * look.softRim * ridge.key;
          const crest = clamp(
            line * look.rimGain * (0.45 + 0.55 * ridge.key) * (0.4 + 0.6 * body),
            0,
            1,
          );
          // Relief: lumps inside the body, lit on their upper side.
          const rf =
            lumps * sstep(0.2, 1.4, dr) * (1 - sstep(3, 11, dr)) * ridge.key * look.relief * m;
          for (let c = 0; c < 3; c += 1) {
            let v = mix(acc[c] ?? 0, mix(mid[c] ?? 0, lit[c] ?? 0, 0.6), soft * 0.8);
            v = mix(v, mix(lit[c] ?? 0, rim[c] ?? 0, ridge.edge), crest);
            acc[c] = mix(v, mix(mid[c] ?? 0, lit[c] ?? 0, 0.5), rf);
          }
          if (m > dmax) dmax = m;
        }
        const cover = Math.max(sstep(0.02, 0.2, g0), dmax);
        for (let c = 0; c < 3; c += 1) {
          // A family's loudness: mint is the brightest, so it is turned down.
          const loud = (navy[c] ?? 0) + ((acc[c] ?? 0) - (navy[c] ?? 0)) * pool.gain;
          tot[c] = mix(tot[c] ?? 0, loud, cover);
        }
        occ = 1 - 0.95 * dmax - 0.3 * sstep(0.1, 0.6, g0) * (1 - dmax);
      }
    }

    // ---- the Milky Way: a great circle of soft glow, a dark lane meandering through it, a warm bulge
    const sb = dx * poleX + dy * poleY + dz * poleZ;
    const lb = Math.asin(clamp(sb, -1, 1)) / RAD;
    if (Math.abs(lb) < band.sigmaDeg * 3) {
      const bw = Math.exp(-(lb / band.sigmaDeg) * (lb / band.sigmaDeg));
      const lon = wrap180(Math.atan2(dx - poleX * sb, dz - poleZ * sb) / RAD - band.coreAzDeg);
      const clump = fbm3(dx * 3.1 + 5.5, dy * 4.4 + 1.5, dz * 3.1 + 8.1, 4, 0);
      const meander = fbm3(dx * 1.7 + 2.5, dy * 2.4 + 4.5, dz * 1.7 + 0.5, 2, 0);
      const lc = 1.2 + (meander - 0.5) * 7;
      const lw = 1.6 + 1.3 * fbm3(dx * 2.8 + 8.5, dy * 3.8 + 7.5, dz * 2.8 + 2.5, 2, 1);
      const lane = Math.exp(-((lb - lc) / lw) * ((lb - lc) / lw));
      const bd = clamp(bw * (0.18 + 1.2 * clump) * look.bandGain, 0, 1);
      const bq = posterise(bd, 4, look.bandSoft);
      const bulge = Math.exp(-(lon / band.coreSigmaDeg) * (lon / band.coreSigmaDeg));
      const bcover = sstep(0.0, 0.25, bd) * 0.95;
      for (let c = 0; c < 3; c += 1) {
        let v = mix(bandRamp.deep[c] ?? 0, bandRamp.mid[c] ?? 0, sstep(0.05, 0.5, bq));
        v = mix(v, bandRamp.lit[c] ?? 0, sstep(0.45, 0.85, bq) * 0.5);
        v = mix(v, bandRamp.rim[c] ?? 0, bulge * 0.35 * sstep(0.6, 1.0, bq));
        v *= 1 - 0.82 * lane * sstep(0.1, 0.4, bq);
        tot[c] = mix(tot[c] ?? 0, Math.max(tot[c] ?? 0, v), bcover);
      }
      occ = Math.min(occ, 1 - 0.55 * bcover * lane);
    }

    if (layers.far) {
      // ---- far galaxies
      for (const galaxy of galaxies) {
        if (dx * galaxy.c[0] + dy * galaxy.c[1] + dz * galaxy.c[2] < galaxy.cosR) continue;
        const gl = galaxyAt(dx, dy, dz, galaxy);
        if (gl > 0.002) {
          const warm = Math.pow(gl, 1.4);
          for (let c = 0; c < 3; c += 1) {
            tot[c] =
              (tot[c] ?? 0) +
              mix(colours.starCool[c] ?? 0, colours.starWarm[c] ?? 0, warm) * gl * 0.5;
          }
        }
      }
      // ---- arcs: thin bright rings, wispy along their length
      for (const arc of arcs) {
        const cd = dx * arc.c[0] + dy * arc.c[1] + dz * arc.c[2];
        const off = Math.acos(clamp(cd, -1, 1)) / RAD - arc.radiusDeg;
        const w = arc.widthDeg;
        if (Math.abs(off) > w * 7) continue;
        let th =
          Math.atan2(
            dx * arc.e2[0] + dy * arc.e2[1] + dz * arc.e2[2],
            dx * arc.e1[0] + dy * arc.e1[1] + dz * arc.e1[2],
          ) / RAD;
        th = (th + 360) % 360;
        const span =
          sstep(arc.fromDeg, arc.fromDeg + 14, th) * (1 - sstep(arc.toDeg - 14, arc.toDeg, th));
        if (span <= 0.002) continue;
        const wob = (fbm3(dx * 5 + arc.seed, dy * 5 + 2.1, dz * 5 + 1.7, 3, 0) - 0.5) * w * 3;
        const o2 = off + wob;
        const line =
          Math.exp(-(o2 / w) * (o2 / w)) + 0.28 * Math.exp(-(o2 / (w * 4.2)) * (o2 / (w * 4.2)));
        // The arc breaks into pieces.
        const brk = sstep(0.28, 0.6, fbm3(dx * 9 + arc.seed, dy * 9 + 5.5, dz * 9, 3, 1));
        const aw = line * span * brk * arc.strength * look.arc;
        for (let c = 0; c < 3; c += 1) {
          tot[c] = (tot[c] ?? 0) + mix(arc.ramp.lit[c] ?? 0, arc.ramp.rim[c] ?? 0, 0.5) * aw * 3.2;
        }
      }
      // ---- knots: a ragged stepped clump and a point of heat
      for (const knot of knots) {
        const kd = dx * knot.c[0] + dy * knot.c[1] + dz * knot.c[2];
        if (kd < Math.cos(knot.radiusDeg * 2.4 * RAD)) continue;
        const kang = Math.acos(clamp(kd, -1, 1)) / RAD / knot.radiusDeg;
        const kr =
          kang + (fbm3(dx * 14 + knot.seed, dy * 14 + 1.9, dz * 14 + 4.3, 3, 0) - 0.5) * 0.9;
        const kv = clamp(1 - kr / 1.7, 0, 1);
        const kq = posterise(kv, 3, 0.35);
        const kcv = sstep(0.02, 0.2, kv);
        for (let c = 0; c < 3; c += 1) {
          let kc = mix(knot.ramp.deep[c] ?? 0, knot.ramp.mid[c] ?? 0, sstep(0.1, 0.5, kq));
          kc = mix(kc, knot.ramp.lit[c] ?? 0, sstep(0.55, 0.95, kq));
          kc = mix(kc, knot.ramp.rim[c] ?? 0, Math.exp(-kang * kang * 14) * 0.7);
          tot[c] = mix(tot[c] ?? 0, Math.max(tot[c] ?? 0, kc), kcv * 0.9);
        }
      }
    }

    // ---- added = total - navy, faded toward the horizon, then a soft knee at the ceiling
    const wobble = (fbm3(dx * 2.2 + 12.1, dy * 0.6, dz * 2.2 + 3.3, 2, 0) - 0.5) * 9;
    const strip = sstep(look.stripDeg[0], look.stripDeg[1], Math.abs(el) + wobble);
    let ar = Math.max(0, (tot[0] ?? 0) - (navy[0] ?? 0)) * strip;
    let ag = Math.max(0, (tot[1] ?? 0) - (navy[1] ?? 0)) * strip;
    let ab = Math.max(0, (tot[2] ?? 0) - (navy[2] ?? 0)) * strip;
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
