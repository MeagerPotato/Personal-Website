import { describe, expect, it } from 'vitest';
import { STAR_KIND_COUNT } from '../design/shaders/sky';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { bandFrame, clumpAt, laneAt, meanderAt } from './milkyWay';
import { directionOf } from './skyDirections';
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
const clusterTotal = recipe.clusters.reduce((sum, cluster) => sum + cluster.count, 0);
/** Then the clusters, the double stars (a primary, then its companion), and the heroes. */
const pairsFrom = scattered + clusterTotal;

describe('how many stars', () => {
  it('has a row in the shader for every kind', () => {
    expect(STAR_KINDS).toHaveLength(STAR_KIND_COUNT);
  });

  it('is 8,645 with a mouse on the medium and high tiers', () => {
    expect(starCounts(recipe, { coarse: false, low: false })).toEqual({
      dust: 6400,
      field: 1500,
      bright: 260,
      mid: 64,
      hero: 8,
      clusters: [70, 55, 80, 60, 60, 60],
      pairs: 14,
    });
    expect(full.count).toBe(8645);
  });

  it('halves every class on a phone, and again on the low tier, which has no mid', () => {
    expect(starCounts(recipe, { coarse: true, low: false })).toEqual({
      dust: 3200,
      field: 750,
      bright: 130,
      mid: 32,
      hero: 8,
      clusters: [35, 28, 40, 30, 30, 30],
      pairs: 14,
    });
    expect(starCounts(recipe, { coarse: false, low: true })).toEqual({
      dust: 3200,
      field: 750,
      bright: 130,
      mid: 0,
      hero: 8,
      clusters: [35, 28, 40, 30, 30, 30],
      pairs: 14,
    });
    expect(starCounts(recipe, { coarse: true, low: true })).toEqual({
      dust: 1600,
      field: 375,
      bright: 65,
      mid: 0,
      hero: 8,
      clusters: [18, 14, 20, 15, 15, 15],
      pairs: 14,
    });
    // The heroes and the doubles are the look, and cost a quad each: all of them, everywhere.
    expect(listOf(true, false).count).toBe(4341);
    expect(listOf(false, true).count).toBe(4309);
    expect(listOf(true, true).count).toBe(2173);
  });

  it('builds exactly the stars it counts, of the kinds it counts', () => {
    for (const coarse of [false, true]) {
      for (const low of [false, true]) {
        const list = listOf(coarse, low);
        const counts = starCounts(recipe, { coarse, low });
        const clusters = counts.clusters.reduce((sum, n) => sum + n, 0);
        const fieldInClusters = counts.clusters.reduce(
          (sum, n) => sum + Math.min(n, recipe.cluster.fieldCount),
          0,
        );
        expect(indicesOf(list, 'dust')).toHaveLength(counts.dust + clusters - fieldInClusters);
        // A double star is a bright one and a field one.
        expect(indicesOf(list, 'field')).toHaveLength(
          counts.field + fieldInClusters + counts.pairs,
        );
        expect(indicesOf(list, 'bright')).toHaveLength(counts.bright + counts.pairs);
        expect(indicesOf(list, 'mid')).toHaveLength(counts.mid);
        expect(indicesOf(list, 'hero')).toHaveLength(8);
        expect(list.tints).toHaveLength(list.count);
      }
    }
  });

  it('has no double star when there is no pair of tints to draw one in', () => {
    const none = { ...recipe, pairs: { ...recipe.pairs, tints: [] } };
    expect(starCounts(none, { coarse: false, low: false }).pairs).toBe(0);
    expect(buildStarList(none, band, { coarse: false, low: false }).count).toBe(8645 - 28);
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
    expect(scattered).toBe(full.count - clusterTotal - recipe.pairs.count * 2 - 8);
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
    const open = buildStarList(
      recipe,
      { ...band, lane: { ...band.lane, hide: 0 } },
      {
        coarse: false,
        low: false,
      },
    );
    expect(inLane(full)).toBeGreaterThan(0);
    expect(inLane(full)).toBeLessThan(inLane(open) * 0.5);
  });

  it('gathers each cluster round its centre, mostly in its own tint', () => {
    let from = scattered;
    for (const cluster of recipe.clusters) {
      const centre = directionOf(cluster.azDeg, cluster.elDeg);
      let own = 0;
      for (let i = from; i < from + cluster.count; i += 1) {
        // A two-dimensional Gaussian: five sigma is one star in 270,000.
        expect(apart(directionAt(full, i), centre)).toBeLessThan(5 * cluster.sigmaDeg);
        expect(full.brightness[i]).toBeGreaterThanOrEqual(recipe.cluster.yBase - 1e-6);
        expect(full.brightness[i]).toBeLessThanOrEqual(recipe.cluster.yBase + recipe.cluster.yGain);
        expect(full.kinds[i]).toBeLessThanOrEqual(STAR_KINDS.indexOf('field'));
        if (full.tints[i] === cluster.tint) own += 1;
      }
      expect(own / cluster.count).toBeGreaterThan(recipe.cluster.tintShare - 0.1);
      from += cluster.count;
    }
    expect(from).toBe(pairsFrom);
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
    for (const i of [...indicesOf(full, 'mid'), ...indicesOf(full, 'hero')]) {
      expect(full.twinkles[i]).toBe(0);
    }
  });
});
