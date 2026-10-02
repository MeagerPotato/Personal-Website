import { describe, expect, it } from 'vitest';
import { STAR_KIND_COUNT } from '../design/shaders/sky';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import { directionOf } from './skyDirections';
import { buildStarList, STAR_KINDS, starCounts, type StarKind, type StarList } from './starList';

const recipe = tuning.starfield;
const { band } = tuning.look.sky;
const RAD = Math.PI / 180;

const listOf = (coarse: boolean, low: boolean): StarList<string> =>
  buildStarList(recipe, band, { coarse, low });

const directionAt = (list: StarList<string>, i: number): [number, number, number] => [
  list.directions[i * 3] ?? 0,
  list.directions[i * 3 + 1] ?? 0,
  list.directions[i * 3 + 2] ?? 0,
];

/** Degrees between two unit vectors. */
const apart = (a: readonly number[], b: readonly number[]): number =>
  Math.acos(
    Math.min(1, (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)),
  ) / RAD;

const indicesOf = (list: StarList<string>, kind: StarKind): number[] => {
  const code = STAR_KINDS.indexOf(kind);
  return Array.from(list.kinds.keys()).filter((i) => list.kinds[i] === code);
};

const full = listOf(false, false);
const clusterTotal = recipe.clusters.reduce((sum, cluster) => sum + cluster.count, 0);

describe('how many stars', () => {
  it('has a row in the shader for every kind', () => {
    expect(STAR_KINDS).toHaveLength(STAR_KIND_COUNT);
  });

  it('is 5,249 with a mouse on the medium and high tiers', () => {
    expect(starCounts(recipe, { coarse: false, low: false })).toEqual({
      dust: 4200,
      field: 700,
      bright: 110,
      mid: 26,
      hero: 8,
      clusters: [70, 55, 80],
    });
    expect(full.count).toBe(5249);
  });

  it('halves every class but the heroes on a phone, and again on the low tier, which has no mid', () => {
    expect(starCounts(recipe, { coarse: true, low: false })).toEqual({
      dust: 2100,
      field: 350,
      bright: 55,
      mid: 13,
      hero: 8,
      clusters: [35, 28, 40],
    });
    expect(starCounts(recipe, { coarse: false, low: true })).toEqual({
      dust: 2100,
      field: 350,
      bright: 55,
      mid: 0,
      hero: 8,
      clusters: [35, 28, 40],
    });
    expect(starCounts(recipe, { coarse: true, low: true })).toEqual({
      dust: 1050,
      field: 175,
      bright: 28,
      mid: 0,
      hero: 8,
      clusters: [18, 14, 20],
    });
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
        expect(indicesOf(list, 'field')).toHaveLength(counts.field + fieldInClusters);
        expect(indicesOf(list, 'bright')).toHaveLength(counts.bright);
        expect(indicesOf(list, 'mid')).toHaveLength(counts.mid);
        expect(indicesOf(list, 'hero')).toHaveLength(8);
        expect(list.tints).toHaveLength(list.count);
      }
    }
  });
});

describe('the list of stars', () => {
  it('is the same list every time', () => {
    const again = listOf(false, false);
    expect(again.directions).toEqual(full.directions);
    expect(again.brightness).toEqual(full.brightness);
    expect(again.tints).toEqual(full.tints);
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
    // The scattered stars come first, class by class; the clusters and the heroes after.
    const classes = [
      recipe.classes.dust,
      recipe.classes.field,
      recipe.classes.bright,
      recipe.classes.mid,
    ];
    const counts = [
      recipe.count,
      recipe.classes.field.count,
      recipe.classes.bright.count,
      recipe.classes.mid.count,
    ];
    let from = 0;
    classes.forEach((cls, kind) => {
      const n = counts[kind] ?? 0;
      const ys = Array.from(full.brightness.subarray(from, from + n));
      expect(Array.from(full.kinds.subarray(from, from + n)).every((k) => k === kind)).toBe(true);
      const [lo, hi] = cls.yRange;
      // Float32: the range's ends, to seven digits.
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(Math.max(...ys)).toBeLessThanOrEqual(hi + 1e-6);
      if (cls.yExp > 1) {
        const faint = ys.filter((y) => y < (lo + hi) / 2).length / n;
        expect(faint).toBeGreaterThan(0.6);
      }
      from += n;
    });
    expect(from).toBe(full.count - clusterTotal - recipe.heroes.length);
  });

  it('draws the six temperatures by their weights', () => {
    // Over the scattered stars (a cluster wears its own tint).
    const scattered = full.count - clusterTotal - recipe.heroes.length;
    const total = recipe.palette.reduce((sum, [, weight]) => sum + weight, 0);
    expect(recipe.palette).toHaveLength(6);
    for (const [tint, weight] of recipe.palette) {
      const share = full.tints.slice(0, scattered).filter((t) => t === tint).length / scattered;
      expect(Math.abs(share - weight / total), tint).toBeLessThan(0.02);
    }
  });

  it('lays half the dust along the Milky Way', () => {
    // Within two sigma of the great circle are 95.4 percent of the band's stars, and of the
    // stars scattered anywhere the share of the sphere that strip covers.
    const pole = directionOf(band.poleAzDeg, 90 - band.tiltDeg);
    const strip = 2 * recipe.bandSigmaDeg;
    const dust = recipe.count;
    let near = 0;
    for (let i = 0; i < dust; i += 1) {
      if (Math.abs(90 - apart(directionAt(full, i), pole)) < strip) near += 1;
    }
    const ofBand = 0.9545;
    const ofSphere = Math.sin(strip * RAD);
    const share = (near / dust - ofSphere) / (ofBand - ofSphere);
    expect(Math.abs(share - recipe.classes.dust.bandShare)).toBeLessThan(0.03);
  });

  it('gathers each cluster round its centre, mostly in its own tint', () => {
    let from = full.count - clusterTotal - recipe.heroes.length;
    for (const cluster of recipe.clusters) {
      const centre = directionOf(cluster.azDeg, cluster.elDeg);
      let own = 0;
      for (let i = from; i < from + cluster.count; i += 1) {
        // A two-dimensional Gaussian: five sigma is one star in 270,000.
        expect(apart(directionAt(full, i), centre)).toBeLessThan(5 * cluster.sigmaDeg);
        expect(full.brightness[i]).toBeGreaterThanOrEqual(recipe.cluster.yBase - 1e-6);
        expect(full.brightness[i]).toBeLessThanOrEqual(recipe.cluster.yBase + recipe.cluster.yGain);
        if (full.tints[i] === cluster.tint) own += 1;
      }
      expect(own / cluster.count).toBeGreaterThan(recipe.cluster.tintShare - 0.1);
      from += cluster.count;
    }
  });

  it('puts the eight heroes exactly where the table says, on every tier', () => {
    for (const list of [full, listOf(true, false), listOf(false, true), listOf(true, true)]) {
      const heroes = indicesOf(list, 'hero');
      expect(heroes).toHaveLength(recipe.heroes.length);
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

  it('lets about a fifth of the dust, field and bright stars twinkle, and no star with spikes', () => {
    const scattered = recipe.count + recipe.classes.field.count + recipe.classes.bright.count;
    const twinkling = Array.from(full.twinkles.subarray(0, scattered)).filter(
      (t) => t === 1,
    ).length;
    expect(Math.abs(twinkling / scattered - recipe.twinkleShare)).toBeLessThan(0.02);
    for (const i of [...indicesOf(full, 'mid'), ...indicesOf(full, 'hero')]) {
      expect(full.twinkles[i]).toBe(0);
    }
  });
});
