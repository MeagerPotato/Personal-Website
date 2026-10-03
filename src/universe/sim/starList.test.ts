import { describe, expect, it } from 'vitest';
import { STAR_KIND_COUNT } from '../design/shaders/sky';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { bandFrame, clumpAt, laneAt, meanderAt, narrowShare } from './milkyWay';
import { directionOf, wrapDeg } from './skyDirections';
import { buildStarList, STAR_KINDS, starCounts, type StarKind, type StarList } from './starList';

const recipe = tuning.starfield;
const { band } = tuning.look.sky;
const RAD = Math.PI / 180;
type Palette = ReadonlyArray<readonly [string, number]>;

const listOf = (coarse: boolean, low: boolean): StarList<string> =>
  buildStarList(recipe, band, { coarse, low });

const directionAt = (list: StarList<string>, i: number): [number, number, number] => [
  list.directions[i * 3] ?? 0,
  list.directions[i * 3 + 1] ?? 0,
  list.directions[i * 3 + 2] ?? 0,
];

/** Degrees between two unit vectors (by their chord: exact for the smallest angles too). */
const apart = (a: readonly number[], b: readonly number[]): number =>
  (2 *
    Math.asin(
      Math.min(
        1,
        Math.hypot(
          (a[0] ?? 0) - (b[0] ?? 0),
          (a[1] ?? 0) - (b[1] ?? 0),
          (a[2] ?? 0) - (b[2] ?? 0),
        ) / 2,
      ),
    )) /
  RAD;

const indicesOf = (list: StarList<string>, kind: StarKind): number[] => {
  const code = STAR_KINDS.indexOf(kind);
  return Array.from(list.kinds.keys()).filter((i) => list.kinds[i] === code);
};

/** Where a star is on the Milky Way: its longitude round it, and degrees off the river's middle. */
const frame = bandFrame(band);
function onRiver(list: StarList<string>, i: number): { phi: number; lonDeg: number; yy: number } {
  const d = directionAt(list, i);
  const dot = (axis: readonly number[]): number =>
    d[0] * (axis[0] ?? 0) + d[1] * (axis[1] ?? 0) + d[2] * (axis[2] ?? 0);
  const phi = Math.atan2(dot(frame.b2), dot(frame.b1));
  const off = Math.asin(Math.max(-1, Math.min(1, dot(frame.pole)))) / RAD;
  return { phi, lonDeg: (phi / RAD + 360) % 360, yy: off - meanderAt(band, phi) };
}

const full = listOf(false, false);
const { classes } = recipe;
/** The scattered stars come first, class by class: where each class starts, and ends. */
const SCATTERED = [
  ['dust', 0, recipe.count],
  ['field', recipe.count, recipe.count + classes.field.count],
  [
    'bright',
    recipe.count + classes.field.count,
    recipe.count + classes.field.count + classes.bright.count,
  ],
  [
    'mid',
    recipe.count + classes.field.count + classes.bright.count,
    recipe.count + classes.field.count + classes.bright.count + classes.mid.count,
  ],
] as const;
const scattered = SCATTERED[3][2];
/** Then the Milky Way's bulge: more of the three plain classes, class by class. */
const bulge = recipe.bulge.counts;
const BULGE = [
  ['dust', scattered, scattered + bulge.dust],
  ['field', scattered + bulge.dust, scattered + bulge.dust + bulge.field],
  [
    'bright',
    scattered + bulge.dust + bulge.field,
    scattered + bulge.dust + bulge.field + bulge.bright,
  ],
] as const;
const bulgeTotal = bulge.dust + bulge.field + bulge.bright;
/** Then the clusters, the double stars (a primary, then its companion), and the heroes. */
const clustersFrom = BULGE[2][2];
const clusterTotal = recipe.clusters.reduce((sum, cluster) => sum + cluster.count, 0);
const pairsFrom = clustersFrom + clusterTotal;

/** The same sky with a dark lane that hides no star. */
const open = buildStarList(
  recipe,
  { ...band, lane: { ...band.lane, hide: 0 } },
  { coarse: false, low: false },
);

/** erf, by Simpson's rule: good to eight places for the arguments used here. */
function erf(x: number): number {
  const n = 200;
  const h = x / n;
  let sum = 1 + Math.exp(-x * x);
  for (let k = 1; k < n; k += 1) sum += (k % 2 === 1 ? 4 : 2) * Math.exp(-((k * h) ** 2));
  return ((2 / Math.sqrt(Math.PI)) * h * sum) / 3;
}

describe('how many stars', () => {
  it('has a row in the shader for every kind', () => {
    expect(STAR_KINDS).toHaveLength(STAR_KIND_COUNT);
  });

  it('is 9,311 with a mouse on the medium and high tiers', () => {
    expect(starCounts(recipe, { coarse: false, low: false })).toEqual({
      dust: 6400,
      field: 1500,
      bright: 260,
      mid: 64,
      hero: 8,
      bulge: { dust: 520, field: 130, bright: 16 },
      clusters: [70, 55, 80, 60, 60, 60],
      pairs: 14,
    });
    expect(full.count).toBe(9311);
  });

  it('halves every class on a phone, and again on the low tier, which has no mid', () => {
    expect(starCounts(recipe, { coarse: true, low: false })).toEqual({
      dust: 3200,
      field: 750,
      bright: 130,
      mid: 32,
      hero: 8,
      bulge: { dust: 260, field: 65, bright: 8 },
      clusters: [35, 28, 40, 30, 30, 30],
      pairs: 14,
    });
    expect(starCounts(recipe, { coarse: false, low: true })).toEqual({
      dust: 3200,
      field: 750,
      bright: 130,
      mid: 0,
      hero: 8,
      bulge: { dust: 260, field: 65, bright: 8 },
      clusters: [35, 28, 40, 30, 30, 30],
      pairs: 14,
    });
    expect(starCounts(recipe, { coarse: true, low: true })).toEqual({
      dust: 1600,
      field: 375,
      bright: 65,
      mid: 0,
      hero: 8,
      bulge: { dust: 130, field: 33, bright: 4 },
      clusters: [18, 14, 20, 15, 15, 15],
      pairs: 14,
    });
    // The heroes and the doubles are the look, and cost a quad each: all of them, everywhere.
    expect(listOf(true, false).count).toBe(4674);
    expect(listOf(false, true).count).toBe(4642);
    expect(listOf(true, true).count).toBe(2340);
  });

  it('builds exactly the stars it counts, of the kinds it counts', () => {
    for (const coarse of [false, true]) {
      for (const low of [false, true]) {
        const list = listOf(coarse, low);
        const counts = starCounts(recipe, { coarse, low });
        const clusters = counts.clusters.reduce((sum, n) => sum + n, 0);
        // A cluster's first stars are its heart: bright ones, then field ones, then dust.
        const { brightCount, fieldCount } = recipe.cluster;
        const brightInClusters = counts.clusters.reduce(
          (sum, n) => sum + Math.min(n, brightCount),
          0,
        );
        const fieldInClusters = counts.clusters.reduce(
          (sum, n) => sum + Math.min(Math.max(n - brightCount, 0), fieldCount),
          0,
        );
        expect(indicesOf(list, 'dust')).toHaveLength(
          counts.dust + counts.bulge.dust + clusters - brightInClusters - fieldInClusters,
        );
        // A double star is a bright one and a field one.
        expect(indicesOf(list, 'field')).toHaveLength(
          counts.field + counts.bulge.field + fieldInClusters + counts.pairs,
        );
        expect(indicesOf(list, 'bright')).toHaveLength(
          counts.bright + counts.bulge.bright + brightInClusters + counts.pairs,
        );
        expect(indicesOf(list, 'mid')).toHaveLength(counts.mid);
        expect(indicesOf(list, 'hero')).toHaveLength(8);
        expect(list.tints).toHaveLength(list.count);
      }
    }
  });

  it('has no double star when there is no pair of tints to draw one in', () => {
    const none = { ...recipe, pairs: { ...recipe.pairs, tints: [] } };
    expect(starCounts(none, { coarse: false, low: false }).pairs).toBe(0);
    expect(buildStarList(none, band, { coarse: false, low: false }).count).toBe(9311 - 28);
  });
});

describe('the list of stars', () => {
  it('is the same list every time', () => {
    const again = listOf(false, false);
    expect(again.directions).toEqual(full.directions);
    expect(again.brightness).toEqual(full.brightness);
    expect(again.tints).toEqual(full.tints);
    expect(again.sizes).toEqual(full.sizes);
    expect(again.phases).toEqual(full.phases);
    expect(again.twinkles).toEqual(full.twinkles);
  });

  it('is another list for another seed', () => {
    const other = buildStarList({ ...recipe, seed: 'another-sky' }, band, {
      coarse: false,
      low: false,
    });
    expect(other.directions).not.toEqual(full.directions);
  });

  it('gives unit directions, finite numbers, and only tints that are star tokens', () => {
    const tints = Object.keys(tokens.color.star);
    for (let i = 0; i < full.count; i += 1) {
      expect(Math.hypot(...directionAt(full, i))).toBeCloseTo(1, 5);
      expect(Number.isFinite(full.brightness[i])).toBe(true);
      expect(tints).toContain(full.tints[i]);
      expect(full.phases[i]).toBeGreaterThanOrEqual(0);
      expect(full.phases[i]).toBeLessThan(1);
    }
  });

  it('keeps each class inside its range of brightness, most of it at the faint end', () => {
    for (const [name, from, to] of SCATTERED) {
      const cls = classes[name];
      const ys = Array.from(full.brightness.subarray(from, to));
      const kind = STAR_KINDS.indexOf(name);
      expect(Array.from(full.kinds.subarray(from, to)).every((k) => k === kind)).toBe(true);
      const [lo, hi] = cls.yRange;
      // Float32: the range's ends, to seven digits.
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(Math.max(...ys)).toBeLessThanOrEqual(hi + 1e-6);
      // Brightness is random^yExp across the range: under its middle are 0.5^(1 / yExp) of them
      // (71 percent of the dust), give or take three and a half deviations of such a draw.
      const want = 0.5 ** (1 / cls.yExp);
      const faint = ys.filter((y) => y < (lo + hi) / 2).length / ys.length;
      expect(Math.abs(faint - want), name).toBeLessThan(
        3.5 * Math.sqrt((want * (1 - want)) / ys.length),
      );
    }
    expect(classes.dust.yExp).toBeGreaterThan(1);
    expect(scattered).toBe(full.count - bulgeTotal - clusterTotal - recipe.pairs.count * 2 - 8);
  });

  it('makes the dust of every brightness from barely there to a field star’s', () => {
    // Dust of one brightness read as grain, and a river of it as a stripe: the faintest dust
    // is under a fifth of the brightest, the brightest is as bright as a field star, and the
    // sky really holds both ends.
    const [lo, hi] = classes.dust.yRange;
    expect(hi / lo).toBeGreaterThan(5);
    expect(hi).toBeGreaterThan(classes.field.yRange[0]);
    const ys = Array.from(full.brightness.subarray(0, recipe.count));
    const share = (from: number, to: number): number =>
      ys.filter((y) => y >= from && y < to).length / ys.length;
    expect(share(lo, lo * 2)).toBeGreaterThan(0.3);
    expect(share(classes.field.yRange[0], hi + 1e-6)).toBeGreaterThan(0.05);
  });

  it('draws each class in its own temperatures, by their weights', () => {
    for (const [name, from, to] of SCATTERED) {
      const cls = classes[name];
      const palette: Palette = 'palette' in cls ? cls.palette : recipe.palette;
      const total = palette.reduce((sum, [, weight]) => sum + weight, 0);
      expect(palette).toHaveLength(6);
      const n = to - from;
      for (const [tint, weight] of palette) {
        const want = weight / total;
        const share = full.tints.slice(from, to).filter((t) => t === tint).length / n;
        // Within three and a half standard deviations of a draw of n.
        const slack = 3.5 * Math.sqrt((want * (1 - want)) / n);
        expect(Math.abs(share - want), `${name}: ${tint}`).toBeLessThan(slack);
      }
    }
    // Dust is whiter than the stars that carry the colour, and those are redder than dust.
    const shareOf = (name: 'dust' | 'bright', tint: string): number => {
      const palette: Palette = classes[name].palette;
      return palette.find(([key]) => key === tint)?.[1] ?? 0;
    };
    expect(shareOf('dust', 'white')).toBeGreaterThan(shareOf('bright', 'white'));
    expect(shareOf('bright', 'ember')).toBeGreaterThan(shareOf('dust', 'ember'));
  });

  it('lays the dust and the field stars along the Milky Way, by their shares', () => {
    // Within two deviations of the wide bank are all of the narrow bank's stars and 95 percent
    // of the wide one's; of the stars scattered anywhere, the share of the sphere that strip is.
    const strip = 2 * band.banks[1][0] * Math.SQRT1_2;
    const ofSphere = Math.sin(strip * RAD);
    for (const [name, from, to] of SCATTERED.slice(0, 2)) {
      let near = 0;
      for (let i = from; i < to; i += 1) if (Math.abs(onRiver(full, i).yy) < strip) near += 1;
      const share = classes[name].bandShare;
      const slack = 2.5 / Math.sqrt(to - from);
      expect(near / (to - from), name).toBeGreaterThan(
        share * 0.95 + (1 - share) * ofSphere - slack,
      );
      expect(near / (to - from), name).toBeLessThan(share + (1 - share) * ofSphere + slack);
    }
  });

  it('lays the river’s stars across it as its haze is bright across it', () => {
    // The haze's cross-section is two banks, exp(-(y / sigma)^2) times a weight: a bank's
    // stars are in proportion to its MASS (weight times sigma). So, of the river's dust, the
    // share within `a` degrees of its middle is erf(a / sigma) of each bank's; of the dust
    // scattered anywhere, the share of the sphere such a strip is. (Without the lane, which
    // takes stars out of one side.)
    const [[s1, w1], [s2, w2]] = band.banks;
    const inRiver = classes.dust.bandShare;
    const within = (a: number): number => {
      let near = 0;
      for (let i = 0; i < recipe.count; i += 1) if (Math.abs(onRiver(open, i).yy) < a) near += 1;
      return near / recipe.count;
    };
    const want = (a: number, narrow: number): number =>
      inRiver * (narrow * erf(a / s1) + (1 - narrow) * erf(a / s2)) +
      (1 - inRiver) * Math.sin(a * RAD);
    for (const a of [s1, s2]) {
      const share = want(a, narrowShare(band));
      const slack = 3.5 * Math.sqrt((share * (1 - share)) / recipe.count);
      expect(Math.abs(within(a) - share), `within ${a} degrees`).toBeLessThan(slack);
    }
    // A bank chosen by its weight alone would crowd the narrow one: a hard core, and banks
    // that stop short. That reading is ruled out by ten deviations and more.
    const byWeight = want(s1, w1 / (w1 + w2));
    expect(byWeight - within(s1)).toBeGreaterThan(
      10 * Math.sqrt((byWeight * (1 - byWeight)) / recipe.count),
    );
  });

  it('crowds the river into its clumps', () => {
    // Dust in the river, by 20 degrees of its length: the densest stretch has more than twice
    // the stars of the thinnest, and they are where the recipe's clumps are.
    const strip = 2 * band.banks[1][0] * Math.SQRT1_2;
    const stretches = new Array<number>(18).fill(0);
    for (let i = 0; i < recipe.count; i += 1) {
      const at = onRiver(full, i);
      const stretch = Math.floor(at.lonDeg / 20) % 18;
      if (Math.abs(at.yy) < strip) stretches[stretch] = (stretches[stretch] ?? 0) + 1;
    }
    const weights = stretches.map((_, k) => clumpAt(band, k * 20 + 10));
    const densest = stretches.indexOf(Math.max(...stretches));
    const thinnest = stretches.indexOf(Math.min(...stretches));
    expect((stretches[densest] ?? 0) / (stretches[thinnest] ?? 1)).toBeGreaterThan(2);
    expect(weights[densest]).toBeGreaterThan(1);
    expect(weights[thinnest]).toBeLessThan(0.5);
  });

  it('thins the stars where the dark lane runs: the rift is made of missing stars', () => {
    const inLane = (list: StarList<string>): number => {
      let n = 0;
      for (let i = 0; i < recipe.count; i += 1) {
        const at = onRiver(list, i);
        if (laneAt(band, at.phi, at.yy) > 0.5) n += 1;
      }
      return n;
    };
    // The same river with a lane that hides nothing has more than twice the dust in it.
    expect(inLane(full)).toBeGreaterThan(0);
    expect(inLane(full)).toBeLessThan(inLane(open) * 0.5);
  });

  it('adds the bulge’s stars after the scattered ones, class by class, each in its range', () => {
    for (const [name, from, to] of BULGE) {
      const kind = STAR_KINDS.indexOf(name);
      const [lo, hi] = classes[name].yRange;
      for (let i = from; i < to; i += 1) {
        expect(full.kinds[i]).toBe(kind);
        expect(full.brightness[i]).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(full.brightness[i]).toBeLessThanOrEqual(hi + 1e-6);
      }
    }
    expect(bulgeTotal).toBe(666);
  });

  it('makes the bulge an oval of stars on the river, as wide as the haze swells', () => {
    // Where the haze swells by exp(-(lon / along)^2 - (y / across)^2), the stars are drawn
    // from that very Gaussian: deviations of along / sqrt 2 and across / sqrt 2. (Without the
    // lane, which takes stars out of one side.)
    const { lonDeg, sigmaDeg } = band.core;
    const [along, across] = sigmaDeg;
    const us: number[] = [];
    const vs: number[] = [];
    for (let i = scattered; i < clustersFrom; i += 1) {
      const at = onRiver(open, i);
      us.push(wrapDeg(at.lonDeg - lonDeg) / (along * Math.SQRT1_2));
      vs.push(at.yy / (across * Math.SQRT1_2));
    }
    for (const xs of [us, vs]) {
      const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
      const deviation = Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length);
      // In deviations: the oval is centred on the bulge's place, and as wide as it says.
      expect(Math.abs(mean)).toBeLessThan(0.2);
      expect(Math.abs(deviation - 1)).toBeLessThan(0.1);
      // Five deviations is one star in 1.7 million.
      expect(Math.max(...xs.map(Math.abs))).toBeLessThan(5);
    }
  });

  it('makes the bulge warm with its STARS: the bulge’s palette by weight, and no blue star', () => {
    const { palette } = recipe.bulge;
    const total = palette.reduce((sum, [, weight]) => sum + weight, 0);
    const tints = full.tints.slice(scattered, clustersFrom);
    for (const [tint, weight] of palette) {
      const want = weight / total;
      const share = tints.filter((t) => t === tint).length / tints.length;
      expect(Math.abs(share - want), tint).toBeLessThan(
        3.5 * Math.sqrt((want * (1 - want)) / tints.length),
      );
    }
    const keys = palette.map(([tint]) => tint as string);
    expect(tints.every((tint) => keys.includes(tint))).toBe(true);
    expect(keys).not.toContain('cool');
    expect(keys).not.toContain('hot');
    // Four in five of them are a warm temperature; of the river's own dust, under a third.
    const warmth = (of: Palette): number =>
      of
        .filter(([tint]) => ['warm', 'amber', 'ember'].includes(tint))
        .reduce((sum, [, weight]) => sum + weight, 0) / of.reduce((sum, [, w]) => sum + w, 0);
    expect(warmth(palette)).toBeGreaterThan(0.8);
    expect(warmth(classes.dust.palette)).toBeLessThan(0.34);
  });

  it('crowds the bulge: more of its own stars in its oval than the river has anywhere', () => {
    // The stars inside one sigma of an oval the bulge's size, laid on the river at a longitude.
    const { lonDeg, sigmaDeg } = band.core;
    const [along, across] = sigmaDeg;
    const inOval = (from: number, to: number, lon: number): number => {
      let n = 0;
      for (let i = from; i < to; i += 1) {
        const at = onRiver(full, i);
        if ((wrapDeg(at.lonDeg - lon) / along) ** 2 + (at.yy / across) ** 2 < 1) n += 1;
      }
      return n;
    };
    const own = inOval(scattered, clustersFrom, lonDeg);
    const river = inOval(0, scattered, lonDeg);
    // The bulge is its stars: they outnumber the river's own there...
    expect(own).toBeGreaterThan(river * 1.5);
    // ...and no stretch of the river, at any of its clumps, is as crowded as the bulge.
    for (const [lon] of band.clumps) {
      if (Math.abs(wrapDeg(lon - lonDeg)) < 2 * along) continue;
      expect(inOval(0, scattered, lon) * 1.5, `the clump at ${lon}`).toBeLessThan(own + river);
    }
  });

  it('runs the dark lane through the bulge as through the rest of the river', () => {
    const inLane = (list: StarList<string>): number => {
      let n = 0;
      for (let i = scattered; i < clustersFrom; i += 1) {
        const at = onRiver(list, i);
        if (laneAt(band, at.phi, at.yy) > 0.5) n += 1;
      }
      return n;
    };
    expect(inLane(full)).toBeGreaterThan(0);
    expect(inLane(full)).toBeLessThan(inLane(open) * 0.6);
  });

  it('gathers each cluster round its centre, mostly in its own tint', () => {
    let from = clustersFrom;
    for (const cluster of recipe.clusters) {
      const centre = directionOf(cluster.azDeg, cluster.elDeg);
      let own = 0;
      for (let i = from; i < from + cluster.count; i += 1) {
        // A two-dimensional Gaussian: five sigma is one star in 270,000.
        expect(apart(directionAt(full, i), centre)).toBeLessThan(5 * cluster.sigmaDeg);
        if (full.tints[i] === cluster.tint) own += 1;
      }
      expect(own / cluster.count).toBeGreaterThan(recipe.cluster.tintShare - 0.1);
      from += cluster.count;
    }
    expect(from).toBe(pairsFrom);
  });

  it('gives each cluster a heart: bright stars close in, and fainter ones falling away', () => {
    // Sixty faint dots of one size read as a patch of grain. A cluster's first stars are
    // bright ones in its middle, then field stars round them, then dust across its width.
    const look = recipe.cluster;
    const [brightLo, brightHi] = classes.bright.yRange;
    expect(look.brightCount).toBeGreaterThanOrEqual(2);
    expect(look.heart).toBeLessThan(0.5);
    const near: number[] = [];
    const far: number[] = [];
    let from = clustersFrom;
    for (const cluster of recipe.clusters) {
      const centre = directionOf(cluster.azDeg, cluster.elDeg);
      for (let k = 0; k < cluster.count; k += 1) {
        const i = from + k;
        const sigmas = apart(directionAt(full, i), centre) / cluster.sigmaDeg;
        const y = full.brightness[i] ?? 0;
        const kind = STAR_KINDS[full.kinds[i] ?? 0];
        if (k < look.brightCount) {
          expect(kind).toBe('bright');
          expect(y).toBeGreaterThanOrEqual(brightLo - 1e-6);
          expect(y).toBeLessThanOrEqual(brightHi + 1e-6);
          // Within `heart` of the cluster's width (five of ITS sigmas, as above).
          expect(sigmas).toBeLessThan(5 * look.heart);
          continue;
        }
        expect(y).toBeGreaterThanOrEqual(look.yBase - 1e-6);
        expect(y).toBeLessThanOrEqual(look.yBase + look.yGain);
        if (k < look.brightCount + look.fieldCount) {
          expect(kind).toBe('field');
          expect(sigmas).toBeLessThan(5 * look.heart * 2);
          continue;
        }
        expect(kind).toBe('dust');
        if (sigmas < 1) near.push(y);
        else if (sigmas > 1.5) far.push(y);
      }
      from += cluster.count;
    }
    // The dust is brighter toward the middle: no equal dots.
    const mean = (ys: readonly number[]): number => ys.reduce((sum, y) => sum + y, 0) / ys.length;
    expect(near.length).toBeGreaterThan(50);
    expect(far.length).toBeGreaterThan(50);
    expect(mean(near)).toBeGreaterThan(mean(far) * 1.3);
    // Every heart is brighter than any of its cluster's dust can be... and than most dust is.
    expect(brightLo).toBeGreaterThan(look.yBase + look.yGain);
  });

  it('sets fourteen double stars: a bright one, and a fainter one a hair away in another tint', () => {
    const { pairs } = recipe;
    const tints = pairs.tints.map(([primary, companion]) => `${primary}+${companion}`);
    const seen = new Set<string>();
    for (let k = 0; k < pairs.count; k += 1) {
      const primary = pairsFrom + k * 2;
      const companion = primary + 1;
      expect(STAR_KINDS[full.kinds[primary] ?? 0]).toBe('bright');
      expect(STAR_KINDS[full.kinds[companion] ?? 0]).toBe('field');
      const between = apart(directionAt(full, primary), directionAt(full, companion));
      // (Directions are float32: a few millionths of a degree.)
      expect(between).toBeGreaterThanOrEqual(pairs.sepDeg[0] - 1e-3);
      expect(between).toBeLessThanOrEqual(pairs.sepDeg[1] + 1e-3);
      expect(full.brightness[primary]).toBeGreaterThanOrEqual(pairs.primaryY[0] - 1e-6);
      expect(full.brightness[primary]).toBeLessThanOrEqual(pairs.primaryY[1] + 1e-6);
      expect(full.brightness[companion]).toBeGreaterThanOrEqual(pairs.companionY[0] - 1e-6);
      expect(full.brightness[companion]).toBeLessThanOrEqual(pairs.companionY[1] + 1e-6);
      const pair = `${full.tints[primary]}+${full.tints[companion]}`;
      expect(tints).toContain(pair);
      seen.add(pair);
      // A double holds still.
      expect(full.twinkles[primary]).toBe(0);
      expect(full.twinkles[companion]).toBe(0);
    }
    expect(pairs.count).toBe(14);
    // Both pairs of tints are in the sky.
    expect(seen.size).toBe(tints.length);
  });

  it('puts the eight heroes exactly where the table says, on every tier', () => {
    for (const list of [full, listOf(true, false), listOf(false, true), listOf(true, true)]) {
      const heroes = indicesOf(list, 'hero');
      expect(heroes).toHaveLength(recipe.heroes.length);
      // They close the list.
      expect(heroes[0]).toBe(list.count - recipe.heroes.length);
      recipe.heroes.forEach((hero, n) => {
        const i = heroes[n] ?? -1;
        expect(apart(directionAt(list, i), directionOf(hero.azDeg, hero.elDeg))).toBeLessThan(0.05);
        expect(list.tints[i]).toBe(hero.tint);
        expect(list.sizes[i]).toBeCloseTo(hero.size, 6);
        expect(list.brightness[i]).toBe(1);
        expect(list.twinkles[i]).toBe(0);
      });
    }
  });

  it('gives each mid star spikes of its own length, and every plain star none to scale', () => {
    const [short, long] = classes.mid.sizeRange;
    const sizes = indicesOf(full, 'mid').map((i) => full.sizes[i] ?? 0);
    expect(sizes).toHaveLength(classes.mid.count);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(short - 1e-6);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(long + 1e-6);
    // Across the whole range, not all alike.
    expect(Math.min(...sizes)).toBeLessThan(short + (long - short) * 0.15);
    expect(Math.max(...sizes)).toBeGreaterThan(long - (long - short) * 0.15);
    for (const kind of ['dust', 'field', 'bright'] as const) {
      expect(indicesOf(full, kind).every((i) => full.sizes[i] === 1)).toBe(true);
    }
  });

  it('lets about an eighth of the dust, field and bright stars twinkle, and no star with spikes', () => {
    const plain = SCATTERED[2][2];
    const twinkling = Array.from(full.twinkles.subarray(0, plain)).filter((t) => t === 1).length;
    expect(Math.abs(twinkling / plain - recipe.twinkleShare)).toBeLessThan(0.02);
    // About a thousand: as many as shimmered before the sky had this many stars.
    expect(twinkling).toBeGreaterThan(800);
    expect(twinkling).toBeLessThan(1200);
    // ...and with the bulge's stars and the clusters', which twinkle as often, still about that.
    const all = Array.from(full.twinkles).filter((t) => t === 1).length;
    expect(all).toBeGreaterThan(twinkling);
    expect(all).toBeLessThan(1200);
    for (const i of [...indicesOf(full, 'mid'), ...indicesOf(full, 'hero')]) {
      expect(full.twinkles[i]).toBe(0);
    }
  });
});
