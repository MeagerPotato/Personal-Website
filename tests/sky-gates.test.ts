import { describe, expect, it } from 'vitest';
import {
  skyBand,
  skyColours,
  skyConstants,
  skyLoops,
  skyStars,
} from '../src/universe/design/skyRecipe';
import { tokens } from '../src/universe/design/tokens';
import { tuning } from '../src/universe/design/tuning';
import { contrast } from '../src/site/contrast';
import { bandFrame } from '../src/universe/sim/milkyWay';
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
// recipe's own values, and the sky it describes to what was promised of it: no gas and no edge
// anywhere, calm where the planets are, never brighter than its ceiling, quieter than the stars
// that carry it, and readable under every mark laid over it.

const look = tuning.look.sky;
const colours = skyColours();
const texel = createSkyOracle(look, colours);
/** The Milky Way's haze alone: the same sky with no galaxy in it. */
const river = createSkyOracle({ ...look, galaxies: [] }, colours);
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
  // `texel(directionOf(azimuth, elevation))` of the recipe the look was designed with: the river
  // at its crest (in its lane, and above it), the lane at its darkest, the river under the
  // horizon; a spiral's nucleus (in the river) and one of its arms, a lens and its disc, an
  // ellipse, a small spiral low in the sky; the horizon, the strip, and empty sky.
  // prettier-ignore
  const GOLDEN: ReadonlyArray<readonly [az: number, el: number, r: number, g: number, b: number, occ: number]> = [
    [-55, 14, 0.013043235, 0.017492851, 0.048037927, 0.437319892],
    [-55, 16, 0.008549743, 0.012267767, 0.039310923, 0.948470393],
    [-180, -10, 0.006192567, 0.008519979, 0.025019672, 0.200000003],
    [125, -14, 0.012449941, 0.017334181, 0.049801102, 0.511989421],
    [-10, 12, 0.171989677, 0.160619176, 0.147254431, 0.248324615],
    [-11, 13, 0.027160462, 0.034653543, 0.060583473, 0.690658882],
    [96, 8, 0.150380128, 0.145694803, 0.137631009, 1],
    [97, 7.7, 0.018447325, 0.016266837, 0.012514074, 1],
    [186, 8, 0.167258031, 0.159621837, 0.146487049, 1],
    [4, -22, 0.171769935, 0.159394855, 0.138922518, 1],
    [0, 0, 0, 0, 0, 1],
    [-30, 4, 0.000528295, 0.000758489, 0.00293774, 1],
    [145, 60, 0, 0, 0, 1],
    [20, -40, 0, 0, 0, 1],
  ];

  it('is the recipe’s, texel for texel', () => {
    for (const [az, el, r, g, b, occ] of GOLDEN) {
      texel(directionOf(az, el), out);
      expect(out[0], `r at ${az}, ${el}`).toBeCloseTo(r, 8);
      expect(out[1], `g at ${az}, ${el}`).toBeCloseTo(g, 8);
      expect(out[2], `b at ${az}, ${el}`).toBeCloseTo(b, 8);
      expect(out[3], `occlusion at ${az}, ${el}`).toBeCloseTo(occ, 8);
    }
  });

  it('adds a galaxy to the haze, and takes nothing from it', () => {
    const a = [0, 0, 0, 0];
    // Far from every galaxy the sky is the river's alone...
    for (const [az, el] of [
      [-55, 14],
      [125, -14],
      [145, 60],
    ] as const) {
      expect(texel(directionOf(az, el), out)).toEqual(river(directionOf(az, el), a));
    }
    // ...and at a nucleus it is brighter by the galaxy, with the stars hidden no more than before.
    for (const galaxy of look.galaxies) {
      const at = directionOf(galaxy.azDeg, galaxy.elDeg);
      texel(at, out);
      river(at, a);
      expect(luminance(out) - luminance(a), `${galaxy.azDeg}, ${galaxy.elDeg}`).toBeGreaterThan(
        0.05,
      );
      expect(out[3]).toBe(a[3]);
    }
  });

  it('refuses a galaxy in a tint that is not a star’s', () => {
    const odd = { ...look, galaxies: [{ ...look.galaxies[0], disc: 'mauve' }] };
    expect(() => createSkyOracle(odd as unknown as typeof look, colours)).toThrow(/no star tint/);
  });
});

describe('the sky’s recipe, as the shader reads it', () => {
  it('writes finite numbers, and tables as long as the loops that read them', () => {
    const [galaxies, clumps] = skyLoops();
    const text = skyConstants();
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    const lengthOf = (name: string): number =>
      Number(new RegExp(`const \\w+ ${name}\\[(\\d+)\\]=`).exec(text)?.[1]);
    for (const name of ['GC', 'GE1', 'GE2', 'GP', 'GK', 'GT']) {
      expect(lengthOf(name), name).toBe(galaxies);
    }
    expect(lengthOf('CLUMP')).toBe(clumps);
    expect(galaxies).toBe(look.galaxies.length);
    expect(clumps).toBe(look.band.clumps.length);
    // Every float has its point (GLSL has no implicit conversion), every tint its number.
    expect(text).toContain('const float STRIP0=0.0;');
    expect(text).toContain('const vec4 BANKS=vec4(2.8,0.5,7.5,0.5);');
    expect(text).toContain('const vec2 LANE=vec2(0.3,0.8);');
    expect(text).toMatch(/const vec3 CLUMP\[12\]=vec3\[12\]\(vec3\(28\.0,10\.0,0\.5\),/);
    // The first galaxy: a spiral (2) with a hot disc (3) and a warm nucleus (0).
    expect(text).toMatch(/const ivec2 GT\[15\]=ivec2\[15\]\(ivec2\(3,0\),/);
    expect(text).toMatch(/const vec3 GK\[15\]=vec3\[15\]\(vec3\(2\.0,0\.99\d+,1\.0\),/);
  });

  it('hands over the colours it names: four tones of haze, six star tints', () => {
    expect(skyBand()).toHaveLength(4 * 3);
    expect(skyStars()).toHaveLength(Object.keys(tokens.color.star).length * 3);
    for (const channel of [...skyBand(), ...skyStars()]) {
      expect(channel > 0 && channel <= 1).toBe(true);
    }
    // The oracle is given the same, by name.
    expect(Object.keys(colours.stars)).toEqual(Object.keys(tokens.color.star));
    expect(skyStars().slice(0, 3)).toEqual([...(colours.stars.warm ?? [])]);
    expect(skyBand().slice(9)).toEqual([...colours.band.rim]);
  });

  it('is the same program on every tier: a tier is only a size', () => {
    for (const [tier, bake] of Object.entries(look.tiers)) {
      expect(Object.keys(bake).sort(), tier).toEqual(['bandRows', 'panoHeight', 'panoWidth']);
    }
    // Nothing of a tier goes into the program's text.
    expect(skyConstants).toHaveLength(0);
    expect(skyConstants()).not.toMatch(/#define/);
  });

  it('refuses a number that is not one, and an empty table', () => {
    expect(() => skyConstants({ ...look, intensity: Number.NaN })).toThrow(/not finite/);
    expect(() => skyConstants({ ...look, galaxies: [] })).toThrow(/needs a row/);
    expect(() => skyConstants({ ...look, band: { ...look.band, clumps: [] } })).toThrow(
      /needs a row/,
    );
  });
});

describe('the sky’s gates', () => {
  // The whole sphere on an equal-area grid: every cell the same share of the sky.
  const W = 360;
  const H = 180;
  let brightest = 0;
  let strip = 0;
  let empty = 0;
  let haze = 0;
  const a = [0, 0, 0, 0];
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
      haze = Math.max(haze, luminance(river(direction, a)));
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

  it('no view is loud: p95 at most 0.04, p99.9 at most 0.10', () => {
    for (const pose of poses) {
      expect(pose.p95, `p95 of ${pose.name}`).toBeLessThanOrEqual(0.04);
      expect(pose.p999, `p99.9 of ${pose.name}`).toBeLessThanOrEqual(0.1);
    }
    // And the sky is there: the loudest view is not far under its gate.
    expect(worst('p95')).toBeGreaterThan(0.02);
  });

  it('the Milky Way’s haze is faint under its stars, and it is there', () => {
    // The most the haze alone adds, anywhere: the stars are what a visitor sees, not the haze.
    expect(haze).toBeGreaterThan(0.05);
    expect(haze).toBeLessThan(0.1);
  });

  it('the haze has no edge: nowhere does it step from one texel to the next', () => {
    // Cuts across the river every two degrees of its length, and runs along it, a texel of the
    // largest panorama apart. A level cut into the haze (a contour line: what read as waves)
    // would be a step of 0.01 or more; a smooth river's steepest slope is a third of that.
    const { pole, b1, b2 } = bandFrame(look.band);
    const RAD = Math.PI / 180;
    const step = 360 / look.tiers.high.panoWidth;
    const at = (lonDeg: number, latDeg: number): number[] => {
      const flat = Math.cos(latDeg * RAD);
      const c = flat * Math.cos(lonDeg * RAD);
      const s = flat * Math.sin(lonDeg * RAD);
      const up = Math.sin(latDeg * RAD);
      return river(
        [
          c * b1[0] + s * b2[0] + up * pole[0],
          c * b1[1] + s * b2[1] + up * pole[1],
          c * b1[2] + s * b2[2] + up * pole[2],
        ],
        a,
      );
    };
    let steepest = 0;
    let steepestStars = 0;
    const walk = (place: (t: number) => readonly [number, number], from: number, to: number) => {
      let beforeY = Number.NaN;
      let beforeStars = Number.NaN;
      for (let t = from; t <= to; t += step) {
        const light = at(...place(t));
        const y = luminance(light);
        const stars = light[3] ?? 1;
        if (Number.isFinite(beforeY)) {
          steepest = Math.max(steepest, Math.abs(y - beforeY));
          steepestStars = Math.max(steepestStars, Math.abs(stars - beforeStars));
        }
        beforeY = y;
        beforeStars = stars;
      }
    };
    for (let lon = 0; lon < 360; lon += 2) walk((lat) => [lon, lat], -30, 30);
    for (let lat = -8; lat <= 8; lat += 2) walk((lon) => [lon, lat], 0, 360);
    expect(steepest).toBeGreaterThan(0);
    expect(steepest).toBeLessThan(0.006);
    // The dark lane hides its stars over a degree or so, never from one texel to the next.
    expect(steepestStars).toBeLessThan(0.2);
  });

  it('no pixel anywhere passes the ceiling', () => {
    expect(look.ceilingY).toBeLessThanOrEqual(0.19);
    expect(brightest).toBeLessThanOrEqual(look.ceilingY);
    expect(worst('max')).toBeLessThanOrEqual(look.ceilingY);
    // By construction: the knee holds the added light under the ceiling, then the intensity.
    expect(look.intensity).toBeLessThanOrEqual(1);
  });

  it('most of the sky carries no added light at all', () => {
    expect(empty / (W * H)).toBeGreaterThan(0.8);
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
