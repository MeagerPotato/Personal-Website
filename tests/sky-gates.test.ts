import { describe, expect, it } from 'vitest';
import { skyColours, skyConstants, skyLoops, skyRamps } from '../src/universe/design/skyRecipe';
import { tokens } from '../src/universe/design/tokens';
import { tuning } from '../src/universe/design/tuning';
import { contrast } from '../src/site/contrast';
import {
  SKY_POSE_NAMES,
  SKY_POSES,
  directionOf,
  elevationDeg,
  rayOf,
} from '../src/universe/sim/skyDirections';
import { createSkyOracle, luminance, navyAt } from '../src/universe/sim/skyOracle';

// THE BAKED SKY, HELD TO ITS GATES (docs/DESIGN.md, "Deep light"). The oracle (sim/skyOracle.ts)
// is the CPU twin of the shader that bakes the sky (design/shaders/skyBake.ts); the lab compares
// the two texel by texel on a GPU (`/lab/?subject=sky&parity=1`). Here the oracle is held to the
// recipe's own values, and the sky it describes to what was promised of it: calm where the
// planets are, never brighter than its ceiling, and readable under every mark laid over it.

const look = tuning.look.sky;
const colours = skyColours();
const texel = createSkyOracle(look, colours);
const out = [0, 0, 0, 0];

/** Total luminance at a direction: the navy plus the added light at an exposure. */
const navy = [0, 0, 0];
function totalY(direction: readonly [number, number, number], exposure: number): number {
  texel(direction, out);
  navyAt(colours, direction[1], navy);
  return luminance(navy) + luminance(out) * exposure;
}

const percentile = (sorted: Float64Array, share: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;

describe('the sky’s oracle', () => {
  // `Bake.texel(dirOf(azimuth, elevation))` of the recipe the look was designed with.
  // prettier-ignore
  const GOLDEN: ReadonlyArray<readonly [az: number, el: number, r: number, g: number, b: number, occ: number]> = [
    [-45, -22, 0.008884342, 0.024434237, 0.07331235, 0.05],
    [-31, -17, 0.00001193, 0.000008035, 0.000018869, 1],
    [195, -22, 0.014153114, 0.057654428, 0.045615348, 0.05],
    [75, -22, 0.01610154, 0.009313181, 0.031794369, 0.05],
    [-45, -40, 0.002531936, 0.005113797, 0.017745654, 0.05],
    [-45, 0, 0, 0, 0, 0.992901719],
    [0, 0, 0, 0, 0, 1],
    [-100, 10, 0.003131055, 0.004331207, 0.012958785, 0.75833956],
    [145, 60, 0, 0, 0, 1],
    [250, 12, 0.190310827, 0.161286613, 0.08888888, 0.935068911],
    [18, 14, 0.081696063, 0.089895089, 0.115602848, 0.626080589],
    [-122, 27, 0.000001708, 0.000002853, 0.000013597, 1],
  ];

  it('is the recipe’s, texel for texel', () => {
    // The recipe as it was drawn ends a massif along a line of one azimuth; the engine's pushes
    // the pools' reach about (`ragAzDeg`), which is the one thing it adds to the recipe.
    const recipe = createSkyOracle({ ...look, ragAzDeg: 0 }, colours);
    for (const [az, el, r, g, b, occ] of GOLDEN) {
      recipe(directionOf(az, el), out);
      expect(out[0], `r at ${az}, ${el}`).toBeCloseTo(r, 8);
      expect(out[1], `g at ${az}, ${el}`).toBeCloseTo(g, 8);
      expect(out[2], `b at ${az}, ${el}`).toBeCloseTo(b, 8);
      expect(out[3], `occlusion at ${az}, ${el}`).toBeCloseTo(occ, 8);
    }
  });

  it('the ragged push sideways moves the edge of a massif, and little else', () => {
    const recipe = createSkyOracle({ ...look, ragAzDeg: 0 }, colours);
    const a = [0, 0, 0, 0];
    // Deep inside a pool the gas is the recipe's, give or take a little of its strength...
    for (const [az, el] of [
      [-45, -40],
      [195, -22],
      [75, -22],
    ] as const) {
      const pushed = luminance(texel(directionOf(az, el), out));
      expect(Math.abs(pushed - luminance(recipe(directionOf(az, el), a)))).toBeLessThan(0.01);
    }
    // ...and above the horizon, where no massif reaches, nothing moved at all.
    for (const [az, el] of [
      [-100, 10],
      [250, 12],
      [18, 14],
    ] as const) {
      expect(texel(directionOf(az, el), out)).toEqual(recipe(directionOf(az, el), a));
    }
    // The edge of the Projects glow, where the recipe drew a straight line up the sky: the
    // azimuth at which the gas begins is no longer the same from one elevation to the next.
    const edge = (oracle: typeof texel, el: number): number => {
      for (let az = -30; az >= -50; az -= 0.1) {
        if (luminance(oracle(directionOf(az, el), a)) > 0.02) return az;
      }
      return Number.NaN;
    };
    // How far that edge wanders, from row to row down the sky, in degrees of azimuth.
    const wander = (oracle: typeof texel): number => {
      let total = 0;
      let before = Number.NaN;
      for (let el = -16; el >= -30; el -= 0.5) {
        const at = edge(oracle, el);
        if (Number.isFinite(at) && Number.isFinite(before)) total += Math.abs(at - before);
        before = at;
      }
      return total;
    };
    // (3.2 degrees over these rows as the recipe was drawn, 5.1 with the push.)
    expect(wander(texel)).toBeGreaterThan(wander(recipe) * 1.3);
  });

  it('a lower tier leaves layers out, and nothing else', () => {
    const { low, medium, high } = look.tiers;
    const lowTexel = createSkyOracle(look, colours, low);
    const mediumTexel = createSkyOracle(look, colours, medium);
    const highTexel = createSkyOracle(look, colours, high);
    const a = [0, 0, 0, 0];
    // The whole sky is the high tier's.
    expect(highTexel(directionOf(-45, -22), a)).toEqual(texel(directionOf(-45, -22), out));
    // A far galaxy (this one lies in the Milky Way) is not on low; the Milky Way and the massifs
    // are on every tier.
    const withoutGalaxy = luminance(lowTexel(directionOf(18, 14), a));
    expect(luminance(mediumTexel(directionOf(18, 14), a)) - withoutGalaxy).toBeGreaterThan(0.05);
    expect(luminance(lowTexel(directionOf(-100, 10), a))).toBeGreaterThan(0.002);
    expect(luminance(lowTexel(directionOf(-45, -30), a))).toBeGreaterThan(0.002);
  });
});

describe('the sky’s recipe, as the shader reads it', () => {
  it('writes finite numbers, and tables as long as the loops that read them', () => {
    const [galaxies, arcs, knots, ridges, pools] = skyLoops();
    const text = skyConstants(look.tiers.high);
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    const lengthOf = (name: string): number =>
      Number(new RegExp(`const \\w+ ${name}\\[(\\d+)\\]=`).exec(text)?.[1]);
    for (const name of ['GC', 'GE1', 'GE2', 'GP', 'GK']) expect(lengthOf(name)).toBe(galaxies);
    for (const name of ['AC', 'AE1', 'AE2', 'AP', 'AQ']) expect(lengthOf(name)).toBe(arcs);
    for (const name of ['KC', 'KP']) expect(lengthOf(name)).toBe(knots);
    for (const name of ['RA', 'RB', 'RK']) expect(lengthOf(name)).toBe(ridges);
    for (const name of ['PA', 'PB', 'PF']) expect(lengthOf(name)).toBe(pools);
    // The shader's `top[3]` and its loops over the ridges.
    expect(ridges).toBe(3);
    // Every float has its point (GLSL has no implicit conversion), every family its number.
    expect(text).toContain('const float WARP_AZ=14.0;');
    expect(text).toContain(
      'const ivec2 PF[4]=ivec2[4](ivec2(3,4),ivec2(0,4),ivec2(2,3),ivec2(4,3));',
    );
    expect(text).toContain('const float RK[3]=float[3](0.6,0.8,1.0);');
    expect(skyRamps()).toHaveLength(24 * 3);
    for (const channel of skyRamps()) expect(channel > 0 && channel < 1).toBe(true);
  });

  it('a tier is its defines', () => {
    const defines = (tier: keyof typeof look.tiers): string[] =>
      skyConstants(look.tiers[tier])
        .split('\n')
        .filter((line) => line.startsWith('#define'))
        .map((line) => line.slice(8));
    expect(defines('low')).toEqual(['SEC_MASSIF', 'SEC_BAND', 'NO_RELIEF', 'NO_WISP', 'NO_RAG2']);
    expect(defines('medium')).toEqual(['SEC_MASSIF', 'SEC_BAND', 'SEC_FAR', 'NO_RAG2']);
    expect(defines('high')).toEqual(['SEC_MASSIF', 'SEC_BAND', 'SEC_FAR']);
    expect(skyConstants(look.tiers.medium)).toContain('const int RELIEF_OCT=3;');
    expect(skyConstants(look.tiers.high)).toContain('const int RELIEF_OCT=4;');
  });

  it('refuses a number that is not one', () => {
    expect(() => skyConstants(look.tiers.high, { ...look, intensity: Number.NaN })).toThrow(
      /not finite/,
    );
    expect(() => skyConstants(look.tiers.high, { ...look, knots: [] })).toThrow(/needs a row/);
  });
});

describe('the sky’s gates', () => {
  // The whole sphere on an equal-area grid: every cell the same share of the sky.
  const W = 360;
  const H = 180;
  let brightest = 0;
  let strip = 0;
  let empty = 0;
  for (let j = 0; j < H; j += 1) {
    const y = ((j + 0.5) / H) * 2 - 1;
    const r = Math.sqrt(1 - y * y);
    for (let i = 0; i < W; i += 1) {
      const az = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
      const direction = [r * Math.sin(az), y, r * Math.cos(az)] as const;
      const total = totalY(direction, 1);
      if (total > brightest) brightest = total;
      if (Math.abs(elevationDeg(direction)) <= 6 && total > strip) strip = total;
      // Under half a thousandth: less than a code value of the darkest navy.
      if (luminance(out) < 0.0005) empty += 1;
    }
  }

  // The seven views (sim/skyDirections.ts), each at its own exposure.
  const PW = 240;
  const PH = 150;
  const poses = SKY_POSE_NAMES.map((name) => {
    const pose = SKY_POSES[name];
    const values = new Float64Array(PW * PH);
    for (let j = 0; j < PH; j += 1) {
      for (let i = 0; i < PW; i += 1) {
        const ray = rayOf(pose, ((i + 0.5) / PW) * 2 - 1, 1 - ((j + 0.5) / PH) * 2, PW / PH);
        values[j * PW + i] = totalY(ray, pose.exposure);
      }
    }
    values.sort();
    return {
      name,
      p95: percentile(values, 0.95),
      p999: percentile(values, 0.999),
      max: values[values.length - 1] ?? 0,
    };
  });
  const worst = (key: 'p95' | 'p999' | 'max'): number =>
    Math.max(...poses.map((pose) => pose[key]));

  it('the strip where planets and orbit lines sit stays near the navy', () => {
    expect(strip).toBeLessThanOrEqual(0.03);
  });

  it('no view is loud: p95 at most 0.08, p99.9 at most 0.16', () => {
    for (const pose of poses) {
      expect(pose.p95, `p95 of ${pose.name}`).toBeLessThanOrEqual(0.08);
      expect(pose.p999, `p99.9 of ${pose.name}`).toBeLessThanOrEqual(0.16);
    }
    // And the sky is there: the loud views are not far under their gates.
    expect(worst('p95')).toBeGreaterThan(0.05);
  });

  it('no pixel anywhere passes the ceiling', () => {
    expect(look.ceilingY).toBeLessThanOrEqual(0.19);
    expect(brightest).toBeLessThanOrEqual(look.ceilingY);
    expect(worst('max')).toBeLessThanOrEqual(look.ceilingY);
    // By construction: the knee holds the added light under the ceiling, then the intensity.
    expect(look.intensity).toBeLessThanOrEqual(1);
  });

  it('most of the sky carries no added light at all', () => {
    expect(empty / (W * H)).toBeGreaterThan(0.45);
  });

  it('ink and the focus ring read over the sky they can meet', () => {
    // A neutral grey of a luminance, as a colour the contrast helper takes.
    const grey = (y: number): string => {
      const s = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
      const hex = Math.round(Math.min(1, s) * 255)
        .toString(16)
        .padStart(2, '0');
      return `#${hex}${hex}${hex}`;
    };
    expect(contrast(tokens.color.ink.high, grey(worst('p999')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.color.ink.mid, grey(worst('p95')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.color.system.butter.base, grey(look.ceilingY))).toBeGreaterThanOrEqual(
      3,
    );
  });
});
