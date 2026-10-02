import { hexToLinear } from '../sim/color';
import { frameOf } from '../sim/skyDirections';
import type { SkyColours, SkyRamp } from '../sim/skyOracle';
import type { SkyLook, SkyTier } from './lookTypes';
import { tokens, type NebulaKey } from './tokens';
import { tuning } from './tuning';

/**
 * THE SKY'S RECIPE, as the bake's shader reads it (shaders/skyBake.ts): `tuning.look.sky` written
 * out as GLSL constants, and the tokens it paints with as linear colours. The shader is the same
 * text on every tier; a tier is the `#define`s at the top of this block, each of which leaves a
 * whole layer out of the program (so a tier's program is smaller, not branchier).
 *
 * Families are numbered in the order of `tokens.color.nebula` (coral 0, butter 1, mint 2, sky 3,
 * lilac 4, band 5); a ramp's tones run deep, mid, lit, rim. All angles are degrees.
 */

const FAMILIES = Object.keys(tokens.color.nebula) as NebulaKey[];
const TONES = ['deep', 'mid', 'lit', 'rim'] as const;
const GALAXY_KIND = { ellipse: 0, lens: 1, spiral: 2 } as const;
const RAD = Math.PI / 180;

/** The six ramps as the shader's `uRamp` holds them: 24 linear colours end to end, by family. */
export function skyRamps(): number[] {
  return FAMILIES.flatMap((family) =>
    TONES.flatMap((tone) => hexToLinear(tokens.color.nebula[family][tone])),
  );
}

/** A GLSL float: a whole number needs its point. */
const float = (value: number): string => {
  if (!Number.isFinite(value)) throw new RangeError('skyRecipe: a number of the sky is not finite');
  return Number.isInteger(value) ? `${value}.0` : String(value);
};

/** `const vec4 NAME[2] = vec4[2](vec4(...), vec4(...));` (or float, or ivec2: by the row's length). */
function table(name: string, rows: readonly (readonly number[])[], whole = false): string {
  if (rows.length === 0) throw new RangeError(`skyRecipe: the table ${name} needs a row`);
  const width = rows[0]?.length ?? 1;
  const type = width === 1 ? 'float' : `${whole ? 'i' : ''}vec${width}`;
  const cell = whole ? String : float;
  const list = rows.map((row) => (width === 1 ? cell(row[0] ?? 0) : `${type}(${row.map(cell)})`));
  return `const ${type} ${name}[${rows.length}]=${type}[${rows.length}](${list});`;
}

/** The constants of the bake's shader for one tier: its `#define`s, its numbers, its tables. */
export function skyConstants(tier: SkyTier, look: SkyLook = tuning.look.sky): string {
  const family = (key: NebulaKey): number => FAMILIES.indexOf(key);
  const one = (name: string, value: number): string => `const float ${name}=${float(value)};`;
  const { band, ridges, pools, galaxies, arcs, knots } = look;
  const places = <T extends { azDeg: number; elDeg: number }>(rows: readonly T[]) =>
    rows.map((row) => frameOf(row.azDeg, row.elDeg));
  const galaxyAt = places(galaxies);
  const arcAt = places(arcs);
  return [
    '#define SEC_MASSIF',
    '#define SEC_BAND',
    tier.far ? '#define SEC_FAR' : '',
    tier.reliefOctaves > 0 ? '' : '#define NO_RELIEF',
    tier.wisp ? '' : '#define NO_WISP',
    tier.rag2 ? '' : '#define NO_RAG2',
    `const int RELIEF_OCT=${Math.max(1, Math.round(tier.reliefOctaves))};`,
    one('WARP_AZ', look.warpAzDeg),
    one('WARP_FREQ', look.warpFreq),
    one('POOL_FALL', look.poolFall),
    one('SEAM', look.seam),
    one('DROP', look.dropDeg),
    one('RAG', look.ragDeg),
    one('RAG_FREQ', look.ragFreq),
    one('RAG_AZ', look.ragAzDeg),
    one('RAG_AZ_FREQ', look.ragAzFreq),
    one('RAG2', look.rag2Deg),
    one('RAG2_FREQ', look.rag2Freq),
    one('RELIEF', look.relief),
    one('RELIEF_FREQ', look.reliefFreq),
    one('RELIEF_TAP', look.reliefTap),
    one('WISP', look.wisp),
    one('GLOW_H', look.glowHeightDeg),
    one('GLOW_LAT', look.glowLateral),
    one('GLOW_FIL', look.glowFilament),
    one('GLOW_GAIN', look.glowGain),
    one('GLOW_STEPS', look.glowSteps),
    one('GLOW_SOFT', look.glowSoft),
    one('HEART', look.heart),
    one('HEART_MIX', look.heartMix),
    one('SOFT_RIM', look.softRim),
    one('RIM_GAIN', look.rimGain),
    one('BAND_GAIN', look.bandGain),
    one('BAND_SOFT', look.bandSoft),
    one('ARC_AMT', look.arc),
    one('INTENSITY', look.intensity),
    one('CAP_ABOVE', look.ceilingY),
    one('STRIP0', look.stripDeg[0]),
    one('STRIP1', look.stripDeg[1]),
    one('BAND_CORE', band.coreSigmaDeg),
    `const vec4 BAND_A=vec4(${[band.tiltDeg, band.poleAzDeg, band.sigmaDeg, band.coreAzDeg].map(float)});`,
    table(
      'RA',
      ridges.map((ridge) => [ridge.offDeg, ridge.ampDeg, ridge.freq, ridge.edgeDeg]),
    ),
    table(
      'RB',
      ridges.map((ridge) => [ridge.rimDeg, ridge.softDeg, ridge.body, ridge.edge]),
    ),
    table(
      'RK',
      ridges.map((ridge) => [ridge.key]),
    ),
    table(
      'PA',
      pools.map((pool) => [pool.azDeg, pool.elDeg, pool.halfWidthDeg, pool.strength]),
    ),
    table(
      'PB',
      pools.map((pool) => [pool.seed, pool.height, pool.altShare, pool.gain]),
    ),
    table(
      'PF',
      pools.map((pool) => [family(pool.family), family(pool.altFamily)]),
      true,
    ),
    table(
      'GC',
      galaxyAt.map((at) => at.c),
    ),
    table(
      'GE1',
      galaxyAt.map((at) => at.e1),
    ),
    table(
      'GE2',
      galaxyAt.map((at) => at.e2),
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
    // A galaxy's kind, and the cosine of the angle past which it is not looked at.
    table(
      'GK',
      galaxies.map((galaxy) => [
        GALAXY_KIND[galaxy.kind],
        Math.cos(Math.min(galaxy.radiusDeg * 2.2, 5) * RAD),
      ]),
    ),
    table(
      'AC',
      arcAt.map((at) => at.c),
    ),
    table(
      'AE1',
      arcAt.map((at) => at.e1),
    ),
    table(
      'AE2',
      arcAt.map((at) => at.e2),
    ),
    table(
      'AP',
      arcs.map((arc) => [arc.radiusDeg, arc.fromDeg, arc.toDeg, arc.widthDeg]),
    ),
    table(
      'AQ',
      arcs.map((arc) => [arc.strength, arc.seed, family(arc.family)]),
    ),
    table(
      'KC',
      places(knots).map((at) => at.c),
    ),
    table(
      'KP',
      knots.map((knot) => [knot.radiusDeg, knot.seed, family(knot.family)]),
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

/** How many times each loop of the shader runs: its `uLoop`, in this order. */
export function skyLoops(look: SkyLook = tuning.look.sky): number[] {
  return [look.galaxies, look.arcs, look.knots, look.ridges, look.pools].map((rows) => rows.length);
}

/**
 * Every colour the sky is painted with, linear: what the oracle (sim/skyOracle.ts) is given, in
 * the tests and in the lab. The bake's material (materials.ts) hands the shader the same.
 */
export function skyColours(): SkyColours {
  const { space, star, nebula } = tokens.color;
  const ramp = (family: NebulaKey): SkyRamp => ({
    deep: hexToLinear(nebula[family].deep),
    mid: hexToLinear(nebula[family].mid),
    lit: hexToLinear(nebula[family].lit),
    rim: hexToLinear(nebula[family].rim),
  });
  return {
    navyDeep: hexToLinear(space[950]),
    navyHorizon: hexToLinear(space[800]),
    falloff: tuning.backdrop.horizonFalloff,
    ramps: Object.fromEntries(FAMILIES.map((family) => [family, ramp(family)])),
    starCool: hexToLinear(star.cool),
    starWarm: hexToLinear(star.warm),
    starHot: hexToLinear(star.hot),
    starAmber: hexToLinear(star.amber),
  };
}
