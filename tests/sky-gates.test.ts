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
// the two texel by texel on a GPU (`/lab/?subject=sky&parity=1`). Here the oracle is held still
// (a table of its own values: a change to it is seen, and has to be meant), and the sky it
// describes is held to what was promised of it: no gas and no edge anywhere, one family of
// tones, calm where the planets are, plain navy behind every cluster, never brighter than its
// ceiling, quieter than the stars that carry it, and readable under every mark laid over it.

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
  // `texel(directionOf(azimuth, elevation))`, AS THE ORACLE ITSELF GAVE IT when this table was
  // written: a regression pin, not a second opinion. It holds the oracle still, so that a
  // change to it (or to the recipe) shows here and is meant; what checks the oracle against
  // something other than itself is the lab's parity with the GPU's bake, and the gates below.
  // The rows: the river at its crest (in its lane) and above it; the bulge's heart, and its
  // edge above and along the river; the lane at its darkest; the river at its lowest, under the
  // horizon; a spiral's nucleus (on the river) and one of its arms, a lens and its disc, an
  // ellipse, a small spiral low in the sky; the horizon, the strip, empty sky above and below,
  // and the middle of a compass cluster.
  // prettier-ignore
  const GOLDEN: ReadonlyArray<readonly [az: number, el: number, r: number, g: number, b: number, occ: number]> = [
    [-62, 15, 0.012931419, 0.018195191, 0.053569785, 0.203049562],
    [-62, 18, 0.002373697, 0.003493196, 0.01220522, 0.951918733],
    [-31, 12.5, 0.043177112, 0.049434883, 0.114888293, 0.858298875],
    [-31, 18, 0.009546094, 0.013553021, 0.041193142, 0.999879174],
    [-22, 12, 0.015993026, 0.022343959, 0.064161443, 0.96607315],
    [68, -9, 0.00389774, 0.005517043, 0.017281391, 0.200000009],
    [118, -16.5, 0.010589815, 0.014978854, 0.044971825, 0.687022922],
    [-10, 12, 0.172206204, 0.16063035, 0.145591617, 0.792031556],
    [-11, 13, 0.024922149, 0.031342053, 0.048102527, 0.339364875],
    [96, 8, 0.150380129, 0.145694802, 0.137630989, 1],
    [97, 7.7, 0.01844732, 0.016266829, 0.012514035, 1],
    [186, 8, 0.167258636, 0.159621918, 0.146481925, 1],
    [4, -22, 0.171769935, 0.159394855, 0.138922518, 1],
    [0, 0, 0, 0, 0, 1],
    [-30, 4, 0.000058887, 0.000086458, 0.000385098, 1],
    [145, 60, 0, 0, 0, 1],
    [20, -40, 0, 0, 0, 1],
    [75, -20, 0.000038017, 0.000062996, 0.000303913, 1],
  ];

  it('is what it was, texel for texel', () => {
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
      [-62, 15],
      [118, -16.5],
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

  it('paints the haze in one family of tones: blue everywhere, and brightest at the bulge', () => {
    // The haze is the navy's own blue from its faintest to its brightest. A warm or a grey
    // tone in it (a cream bulge was tried) reads as a smear on the navy. Wherever the river
    // alone adds light, blue leads green by a wide margin, and green leads red.
    const a = [0, 0, 0, 0];
    let seen = 0;
    let brightest = 0;
    let heart = 0;
    for (let az = -180; az < 180; az += 1) {
      for (let el = -40; el <= 40; el += 1) {
        const [r = 0, g = 0, b = 0] = river(directionOf(az, el), a);
        const y = luminance(a);
        if (y < 0.0005) continue;
        seen += 1;
        expect(b, `blue at ${az}, ${el}`).toBeGreaterThan(g * 1.8);
        expect(g, `green at ${az}, ${el}`).toBeGreaterThan(r);
        if (y > brightest) {
          brightest = y;
          heart = az;
        }
      }
    }
    expect(seen).toBeGreaterThan(1000);
    // Its brightest place is the bulge (azimuth -31), in the first frame.
    expect(Math.abs(heart - -31)).toBeLessThanOrEqual(4);
  });

  it('never darkens the haze: the dark lane hides stars, and paints nothing', () => {
    // A lane darkened in the haze drew faint streaks along the river, which read as layers.
    // With a lane that hides nothing, the light is the same to the last bit; only the fourth
    // number (how much of a star shows) knows the lane.
    const open = createSkyOracle(
      { ...look, band: { ...look.band, lane: { ...look.band.lane, hide: 0 } } },
      colours,
    );
    const a = [0, 0, 0, 0];
    let hidden = 0;
    for (let az = -180; az < 180; az += 3) {
      for (let el = -30; el <= 30; el += 1.5) {
        const at = directionOf(az, el);
        texel(at, out);
        open(at, a);
        expect([out[0], out[1], out[2]]).toEqual([a[0], a[1], a[2]]);
        expect(a[3]).toBe(1);
        if ((out[3] ?? 1) < 0.5) hidden += 1;
      }
    }
    expect(hidden).toBeGreaterThan(20);
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
    // The lane has one number to give, how much it hides; the bulge, where it is, its two
    // widths and its swell.
    expect(text).toContain('const float LANE_HIDE=0.8;');
    expect(text).not.toMatch(/const \w+ LANE=/);
    expect(text).toContain('const vec4 CORE=vec4(120.0,9.0,5.5,0.9);');
    expect(text).toMatch(/const vec3 CLUMP\[12\]=vec3\[12\]\(vec3\(28\.0,10\.0,0\.5\),/);
    // The first galaxy: a spiral (2) with a hot disc (3) and a warm nucleus (0).
    expect(text).toMatch(/const ivec2 GT\[15\]=ivec2\[15\]\(ivec2\(3,0\),/);
    expect(text).toMatch(/const vec3 GK\[15\]=vec3\[15\]\(vec3\(2\.0,0\.99\d+,1\.0\),/);
  });

  it('hands over the colours it names: three tones of haze, six star tints', () => {
    expect(skyBand()).toHaveLength(3 * 3);
    expect(skyStars()).toHaveLength(Object.keys(tokens.color.star).length * 3);
    for (const channel of [...skyBand(), ...skyStars()]) {
      expect(channel > 0 && channel <= 1).toBe(true);
    }
    // The oracle is given the same, by name.
    expect(Object.keys(colours.stars)).toEqual(Object.keys(tokens.color.star));
    expect(skyStars().slice(0, 3)).toEqual([...(colours.stars.warm ?? [])]);
    expect(Object.keys(colours.band)).toEqual(['deep', 'mid', 'lit']);
    expect(skyBand().slice(6)).toEqual([...colours.band.lit]);
  });

  it('is the same program on every tier: a tier is only a size', () => {
    for (const [tier, bake] of Object.entries(look.tiers)) {
      expect(Object.keys(bake).sort(), tier).toEqual(['bandRows', 'panoHeight', 'panoWidth']);
    }
    // Nothing of a tier goes into the program's text.
    expect(skyConstants).toHaveLength(0);
    expect(skyConstants()).not.toMatch(/#define/);
  });

  it('refuses a number that is not one, an empty table, and a tint that is no star’s', () => {
    expect(() => skyConstants({ ...look, intensity: Number.NaN })).toThrow(/not finite/);
    expect(() => skyConstants({ ...look, galaxies: [] })).toThrow(/needs a row/);
    expect(() => skyConstants({ ...look, band: { ...look.band, clumps: [] } })).toThrow(
      /needs a row/,
    );
    // An unknown tint has no number in the shader's table: -1 would read outside it.
    for (const key of ['disc', 'core']) {
      const odd = { ...look, galaxies: [{ ...look.galaxies[0], [key]: 'mauve' }] };
      expect(() => skyConstants(odd as unknown as typeof look), key).toThrow(
        /no star tint "mauve"/,
      );
    }
    expect(skyConstants()).not.toMatch(/ivec2\([^)]*-/);
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

  // The seven views (sim/skyDirections.ts), each at its own exposure, on a grid of the view's
  // own shape.
  const viewsAt = (pw: number, ph: number, shape: string) =>
    SKY_POSE_NAMES.map((name) => {
      const pose = SKY_POSES[name];
      const values = new Float64Array(pw * ph);
      for (let j = 0; j < ph; j += 1) {
        for (let i = 0; i < pw; i += 1) {
          const ray = rayOf(pose, ((i + 0.5) / pw) * 2 - 1, 1 - ((j + 0.5) / ph) * 2, pw / ph);
          values[j * pw + i] = totalY(ray, pose.exposure);
        }
      }
      values.sort();
      return {
        name: `${name}, ${shape}`,
        p95: percentile(values, 0.95),
        p999: percentile(values, 0.999),
        max: values[values.length - 1] ?? 0,
      };
    });
  // As a wide screen shows them (1280 by 800), and as a phone held upright does (360 by 780):
  // that is the middle third of the wide view and no more, so whatever sits in the middle of a
  // view fills more of it. The river's bulge sits in the middle of the first frame.
  const wide = viewsAt(240, 150, 'wide');
  const upright = viewsAt(90, 195, 'upright');
  const poses = [...wide, ...upright];
  const worst = (key: 'p95' | 'p999' | 'max'): number =>
    Math.max(...poses.map((pose) => pose[key]));

  it('the strip where planets and orbit lines sit stays near the navy', () => {
    expect(strip).toBeLessThanOrEqual(0.03);
  });

  it('no view is loud, wide or upright: p95 at most 0.04, p99.9 at most 0.10', () => {
    expect(poses).toHaveLength(2 * SKY_POSE_NAMES.length);
    for (const pose of poses) {
      expect(pose.p95, `p95 of ${pose.name}`).toBeLessThanOrEqual(0.04);
      expect(pose.p999, `p99.9 of ${pose.name}`).toBeLessThanOrEqual(0.1);
    }
    // And the sky is there: on a wide screen the loudest view is not far under its gate.
    expect(Math.max(...wide.map((pose) => pose.p95))).toBeGreaterThan(0.02);
    expect(Math.max(...upright.map((pose) => pose.p95))).toBeGreaterThan(0.02);
  });

  it('the Milky Way’s haze is faint under its stars, and it is there', () => {
    // The most the haze alone adds, anywhere: the stars are what a visitor sees, not the haze.
    expect(haze).toBeGreaterThan(0.05);
    expect(haze).toBeLessThan(0.1);
  });

  it('no haze lies behind a cluster: its stars stand on plain navy', () => {
    // At a cluster's middle and one and two of its sigmas out, the river adds less than a
    // code value of the darkest navy (the measure of empty sky, above).
    const RAD = Math.PI / 180;
    for (const cluster of tuning.starfield.clusters) {
      const where = `the cluster at ${cluster.azDeg}, ${cluster.elDeg}`;
      expect(luminance(river(directionOf(cluster.azDeg, cluster.elDeg), a)), where).toBeLessThan(
        0.0005,
      );
      for (const sigmas of [1, 2]) {
        for (let turn = 0; turn < 12; turn += 1) {
          const angle = (turn / 12) * 2 * Math.PI;
          const reach = sigmas * cluster.sigmaDeg;
          const at = directionOf(
            cluster.azDeg + (reach * Math.cos(angle)) / Math.cos(cluster.elDeg * RAD),
            cluster.elDeg + reach * Math.sin(angle),
          );
          expect(luminance(river(at, a)), `${sigmas} sigma from ${where}`).toBeLessThan(0.0005);
        }
      }
    }
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
