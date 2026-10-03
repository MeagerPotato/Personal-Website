import { hexToLinear } from '../sim/color';
import { bandFrame } from '../sim/milkyWay';
import { frameOf } from '../sim/skyDirections';
import type { SkyColours } from '../sim/skyOracle';
import type { SkyLook } from './lookTypes';
import { tokens, type StarKey } from './tokens';
import { tuning } from './tuning';

/**
 * THE SKY'S RECIPE, as the bake's shader reads it (shaders/skyBake.ts): `tuning.look.sky` written
 * out as GLSL constants, and the tokens it paints with as linear colours. The shader and its
 * constants are the same on every tier: a tier is only the size of the panorama.
 *
 * The haze's tones run deep, mid, lit, rim; the star tints are numbered in the order of
 * `tokens.color.star`. All angles are degrees.
 */

const BAND_TONES = ['deep', 'mid', 'lit', 'rim'] as const;
const STAR_TINTS = Object.keys(tokens.color.star) as StarKey[];
const GALAXY_KIND = { ellipse: 0, lens: 1, spiral: 2 } as const;
const RAD = Math.PI / 180;

/** The haze's ramp as the shader's `uBand` holds it: four linear colours end to end. */
export function skyBand(): number[] {
  return BAND_TONES.flatMap((tone) => hexToLinear(tokens.color.nebula.band[tone]));
}

/** The star tints as the shader's `uStar` holds them: six linear colours end to end. */
export function skyStars(): number[] {
  return STAR_TINTS.flatMap((tint) => hexToLinear(tokens.color.star[tint]));
}

/** A GLSL float: a whole number needs its point. */
const float = (value: number): string => {
  if (!Number.isFinite(value)) throw new RangeError('skyRecipe: a number of the sky is not finite');
  return Number.isInteger(value) ? `${value}.0` : String(value);
};

/** `const vec3 NAME=vec3(...);` (or a float, a vec2, a vec4: by how many numbers). */
function one(name: string, ...values: readonly number[]): string {
  if (values.length === 1) return `const float ${name}=${float(values[0] ?? 0)};`;
  return `const vec${values.length} ${name}=vec${values.length}(${values.map(float)});`;
}

/** `const vec4 NAME[2]=vec4[2](vec4(...),vec4(...));` (or vec3, or ivec2: by the row's length). */
function table(name: string, rows: readonly (readonly number[])[], whole = false): string {
  if (rows.length === 0) throw new RangeError(`skyRecipe: the table ${name} needs a row`);
  const type = `${whole ? 'i' : ''}vec${rows[0]?.length ?? 2}`;
  const list = rows.map((row) => `${type}(${row.map(whole ? String : float)})`);
  return `const ${type} ${name}[${rows.length}]=${type}[${rows.length}](${list});`;
}

/** The constants of the bake's shader: its numbers and its tables. */
export function skyConstants(look: SkyLook = tuning.look.sky): string {
  const { band, galaxies } = look;
  const { pole, b1, b2 } = bandFrame(band);
  const [narrow, wide] = band.banks;
  const at = galaxies.map((galaxy) => frameOf(galaxy.azDeg, galaxy.elDeg));
  return [
    one('INTENSITY', look.intensity),
    one('CAP_ABOVE', look.ceilingY),
    one('STRIP0', look.stripDeg[0]),
    one('STRIP1', look.stripDeg[1]),
    one('BAND_P', ...pole),
    one('BAND_B1', ...b1),
    one('BAND_B2', ...b2),
    one('BAND_GAIN', band.gain),
    one('BAND_BASE', band.base),
    one('BANKS', ...narrow, ...wide),
    one('MEANDER', ...band.meanderDeg),
    one('CORE', band.core.lonDeg, band.core.sigmaDeg, band.core.mix),
    one('LANE_OFF', ...band.lane.offsetDeg),
    one('LANE_W', ...band.lane.widthDeg),
    one('LANE', band.lane.dark, band.lane.hide),
    table('CLUMP', band.clumps),
    table(
      'GC',
      at.map((frame) => frame.c),
    ),
    table(
      'GE1',
      at.map((frame) => frame.e1),
    ),
    table(
      'GE2',
      at.map((frame) => frame.e2),
    ),
    table(
      'GP',
      galaxies.map((galaxy) => [
        galaxy.radiusDeg,
        galaxy.axisRatio,
        Math.cos(galaxy.angleDeg * RAD),
        Math.sin(galaxy.angleDeg * RAD),
      ]),
    ),
    // A galaxy's kind, the cosine of the angle past which it is not looked at, and its gain.
    table(
      'GK',
      galaxies.map((galaxy) => [
        GALAXY_KIND[galaxy.kind],
        Math.cos(Math.min(galaxy.radiusDeg * 2.2, 6) * RAD),
        galaxy.gain,
      ]),
    ),
    table(
      'GT',
      galaxies.map((galaxy) => [STAR_TINTS.indexOf(galaxy.disc), STAR_TINTS.indexOf(galaxy.core)]),
      true,
    ),
  ].join('\n');
}

/** How many times each loop of the shader runs: its `uLoop`, in this order. */
export function skyLoops(look: SkyLook = tuning.look.sky): number[] {
  return [look.galaxies.length, look.band.clumps.length];
}

/**
 * Every colour the sky is painted with, linear: what the oracle (sim/skyOracle.ts) is given, in
 * the tests and in the lab. The bake's material (materials.ts) hands the shader the same.
 */
export function skyColours(): SkyColours {
  const { space, star, nebula } = tokens.color;
  return {
    navyDeep: hexToLinear(space[950]),
    navyHorizon: hexToLinear(space[800]),
    falloff: tuning.backdrop.horizonFalloff,
    band: {
      deep: hexToLinear(nebula.band.deep),
      mid: hexToLinear(nebula.band.mid),
      lit: hexToLinear(nebula.band.lit),
      rim: hexToLinear(nebula.band.rim),
    },
    stars: Object.fromEntries(STAR_TINTS.map((tint) => [tint, hexToLinear(star[tint])])),
  };
}
