import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import { tokens } from '../src/universe/design/tokens';
import { tuning } from '../src/universe/design/tuning';
import { clumpAt, clumpPeak } from '../src/universe/sim/milkyWay';
import { createOrbitTable } from '../src/universe/sim/orbits';
import {
  SKY_POSES,
  azimuthBetween,
  directionOf,
  pointOf,
  wrapDeg,
  type SkyPoseName,
} from '../src/universe/sim/skyDirections';
import { trafficDots } from '../src/universe/sim/traffic';

// `tuning.look` and the star classes are the numbers of the "flat worlds, deep light" pass
// (docs/DESIGN.md, "Deep light"). This file keeps the tables honest: that they name things that
// exist, that they are the size the shaders will loop over, that the sky's compass still points
// at the galaxy as the build lays it out, and that every view has something in it to find.

const real = buildUniverse(readRealInput(true));
const { sky, sun, air } = tuning.look;
const { classes, heroes, clusters, palette, pairs } = tuning.starfield;
const STAR_TINTS = Object.keys(tokens.color.star);

/** Where a place in the sky falls in one of the seven views, 1280 x 800 CSS px: [x, y] or null. */
const WIDTH = 1280;
const HEIGHT = 800;
function seenAt(
  name: SkyPoseName,
  place: { azDeg: number; elDeg: number },
): [number, number] | null {
  const point = pointOf(SKY_POSES[name], directionOf(place.azDeg, place.elDeg), WIDTH / HEIGHT);
  if (!point || Math.abs(point[0]) > 1 || Math.abs(point[1]) > 1) return null;
  return [((point[0] + 1) / 2) * WIDTH, ((1 - point[1]) / 2) * HEIGHT];
}

describe('the sky’s compass', () => {
  const home = real.systems.find((system) => system.id === 'home');
  const azimuthOf = (id: string): number => {
    const system = real.systems.find((candidate) => candidate.id === id);
    if (!home || !system) throw new Error(`no system "${id}" in the galaxy`);
    return azimuthBetween(home.position, system.position);
  };
  // The clusters that mark a system: the rest are only clusters.
  const compass = clusters.flatMap((cluster) => ('system' in cluster ? [cluster] : []));

  it('puts a cluster of stars at the bearing of each system from home', () => {
    // A cluster is at infinity: it is right from home, and the same from everywhere. If the
    // layout ever moves a system (tuning.layout, a system's `order`), its cluster moves with it.
    for (const id of ['projects', 'research', 'hackathons']) {
      const cluster = compass.find((candidate) => candidate.system === id);
      expect(cluster, `a cluster for ${id}`).toBeDefined();
      expect(wrapDeg((cluster?.azDeg ?? 0) - azimuthOf(id)), id).toBeCloseTo(0, 0);
    }
  });

  it('gives every system but home a cluster, and home none: home is where the viewer stands', () => {
    const systems = real.systems.filter((system) => system.id !== 'home').map(({ id }) => id);
    expect(compass.map((cluster) => cluster.system).sort()).toEqual(systems.sort());
  });

  it('keeps the compass low, where the sky is emptiest, and in star tints only', () => {
    for (const cluster of compass) {
      // Under the horizon strip, and inside every flying view that faces it.
      expect(cluster.elDeg, cluster.system).toBe(-20);
      // A star wears a temperature, never a family's colour: the nearest the palette has.
      expect(STAR_TINTS).toContain(cluster.tint);
    }
    // No two systems' clusters wear the same temperature.
    expect(new Set(compass.map((cluster) => cluster.tint)).size).toBe(compass.length);
    // Each is in the middle of the view that looks straight at its system.
    for (const [pose, id] of [
      ['proj', 'projects'],
      ['res', 'research'],
      ['hack', 'hackathons'],
    ] as const) {
      const cluster = compass.find((candidate) => candidate.system === id);
      const at = cluster ? seenAt(pose, cluster) : null;
      expect(at?.[0], id).toBeCloseTo(WIDTH / 2, 0);
      expect(at?.[1], id).toBeGreaterThan(HEIGHT / 2);
    }
  });
});

describe('the sky’s tables', () => {
  it('holds fifteen far galaxies, in star tints that do not read brown', () => {
    expect(sky.galaxies).toHaveLength(15);
    expect(new Set(sky.galaxies.map((galaxy) => `${galaxy.azDeg},${galaxy.elDeg}`)).size).toBe(15);
    for (const galaxy of sky.galaxies) {
      const where = `${galaxy.azDeg}, ${galaxy.elDeg}`;
      // On navy an amber or an ember galaxy is a brown smudge.
      expect(['hot', 'warm', 'white', 'cool'], where).toContain(galaxy.disc);
      expect(['hot', 'warm', 'white', 'cool'], where).toContain(galaxy.core);
      expect(galaxy.disc, where).not.toBe(galaxy.core);
      expect(galaxy.gain, where).toBeGreaterThan(0);
      expect(galaxy.gain, where).toBeLessThanOrEqual(1);
      expect(galaxy.axisRatio, where).toBeGreaterThan(0);
      expect(galaxy.axisRatio, where).toBeLessThanOrEqual(1);
      // No nucleus in the horizon strip, where planets and their names are.
      expect(Math.abs(galaxy.elDeg), where).toBeGreaterThanOrEqual(7);
      // Small: the largest is a few degrees across. And its disc (which ends 1.18 radii out)
      // lies inside the cone the bake looks at it in (2.2 radii, 6 degrees at most).
      expect(galaxy.radiusDeg, where).toBeLessThanOrEqual(2.6);
      expect(galaxy.radiusDeg * 1.18, where).toBeLessThan(Math.min(galaxy.radiusDeg * 2.2, 6));
    }
    // All three kinds are there.
    expect(new Set(sky.galaxies.map((galaxy) => galaxy.kind))).toEqual(
      new Set(['spiral', 'lens', 'ellipse']),
    );
  });

  it('lays the Milky Way as a river: two banks, clumps along it, a lane that hides stars', () => {
    const { band } = sky;
    const [narrow, wide] = band.banks;
    expect(narrow[0]).toBeLessThan(wide[0]);
    expect(narrow[1] + wide[1]).toBeCloseTo(1, 9);
    // Tilted, or its frame has no level vector to start from (sim/milkyWay.ts).
    expect(band.tiltDeg).toBeGreaterThan(0);
    expect(band.clumps).toHaveLength(12);
    for (const [lon, sigma, weight] of band.clumps) {
      expect(lon).toBeGreaterThanOrEqual(0);
      expect(lon).toBeLessThan(360);
      expect(sigma).toBeGreaterThan(0);
      expect(weight).toBeGreaterThan(0);
    }
    // Along its length it is uneven, and never empty: the thinnest stretch has a fifth or more
    // of the densest.
    let thinnest = Infinity;
    for (let lon = 0; lon < 360; lon += 1) thinnest = Math.min(thinnest, clumpAt(band, lon));
    expect(thinnest / clumpPeak(band)).toBeGreaterThan(0.2);
    expect(thinnest / clumpPeak(band)).toBeLessThan(0.5);
    // The lane is made of missing stars more than of paint; the bulge is a little cream.
    expect(band.lane.hide).toBeGreaterThan(band.lane.dark);
    expect(band.lane.hide).toBeLessThan(1);
    expect(band.lane.widthDeg[0]).toBeGreaterThan(Math.abs(band.lane.widthDeg[1]));
    expect(band.core.mix).toBeLessThanOrEqual(0.15);
    // It rises to the right across the first frame: its crest lies right of where that view
    // faces (azimuth grows to the left), higher than the horizon strip reaches.
    expect(wrapDeg(band.poleAzDeg + 180 - SKY_POSES.first.yawDeg)).toBeLessThan(0);
    expect(band.tiltDeg).toBeGreaterThan(sky.stripDeg[1]);
  });

  it('bakes a panorama twice as wide as high, in whole bands, on every tier', () => {
    for (const [tier, bake] of Object.entries(sky.tiers)) {
      expect(bake.panoWidth, tier).toBe(bake.panoHeight * 2);
      expect(bake.panoHeight % bake.bandRows, tier).toBe(0);
      // RGBA8: 4.5 MiB on low, 8 MiB at most. A phone starts at medium.
      expect(bake.panoWidth * bake.panoHeight * 4, tier).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
    expect(sky.tiers.low.panoWidth).toBeLessThan(sky.tiers.medium.panoWidth);
    // A far galaxy is more than a texel or two even on the smallest panorama.
    const smallest = Math.min(...sky.galaxies.map((galaxy) => galaxy.radiusDeg));
    expect(smallest / (360 / sky.tiers.low.panoWidth)).toBeGreaterThan(2);
  });

  it('fades the sky’s light out toward the horizon, under a ceiling the focus ring is seen over', () => {
    const [none, full] = sky.stripDeg;
    expect(none).toBeGreaterThanOrEqual(0);
    // A long taper: a short one draws a ruler-straight edge along the sky.
    expect(full - none).toBeGreaterThanOrEqual(8);
    // Butter over a sky of luminance Y: (0.7148 + 0.05) / (Y + 0.05) is 3:1 at Y 0.205.
    expect(sky.ceilingY).toBeLessThanOrEqual(0.205);
    expect(sky.intensity * sky.ceilingY).toBeLessThanOrEqual(0.19);
  });
});

describe('the stars’ tables', () => {
  it('names only star tints that exist', () => {
    for (const { tint } of [...heroes, ...clusters]) expect(STAR_TINTS).toContain(tint);
    const palettes = [palette, classes.dust.palette, classes.bright.palette, classes.mid.palette];
    for (const shares of palettes) {
      // Every temperature has a share of every palette, and the shares are a whole.
      expect(shares.map(([tint]) => tint).sort()).toEqual([...STAR_TINTS].sort());
      expect(shares.reduce((sum, [, share]) => sum + share, 0)).toBeCloseTo(1, 9);
    }
    for (const tints of pairs.tints) for (const tint of tints) expect(STAR_TINTS).toContain(tint);
  });

  it('has eight heroes, each a different place, in all six temperatures', () => {
    expect(heroes).toHaveLength(8);
    expect(new Set(heroes.map((hero) => `${hero.azDeg},${hero.elDeg}`)).size).toBe(8);
    expect(new Set<string>(heroes.map((hero) => hero.tint))).toEqual(new Set(STAR_TINTS));
    for (const hero of heroes) {
      expect(hero.size).toBeGreaterThan(0);
      expect(hero.size).toBeLessThanOrEqual(1);
      expect(Math.abs(hero.elDeg)).toBeLessThan(30);
    }
  });

  it('shows a hero in every view the sky is judged from, clear of the bars and the panel', () => {
    // The nav chips are the top 58 px of a 1280 x 800 view, the Map button sits under them at
    // the right (x from 1162, y 70 to 113), and a docked body's panel covers the right of it.
    // A hero's middle keeps 10 px from each.
    const clear = ([x, y]: readonly [number, number]): boolean =>
      y > 58 + 10 && !(x > 1162 - 10 && y > 70 - 10 && y < 113 + 10);
    const inView = (name: SkyPoseName): Array<[number, number]> =>
      heroes.flatMap((hero) => {
        const at = seenAt(name, hero);
        return at ? [at] : [];
      });
    for (const name of ['first', 'cruise', 'proj', 'hack', 'res', 'band'] as const) {
      const seen = inView(name);
      expect(seen.length, name).toBeGreaterThanOrEqual(1);
      // And none of the ones in view hides behind a chip.
      expect(seen.every(clear), name).toBe(true);
    }
    // Three in the first frame: upper right, above the home planet, low on the left.
    expect(inView('first')).toHaveLength(3);
    // Docked, the panel takes the right of the view: the one hero there is at its top left.
    const docked = inView('docked');
    expect(docked).toHaveLength(1);
    expect(docked[0]?.[0]).toBeLessThan(WIDTH * 0.25);
    expect(docked[0]?.[1]).toBeLessThan(HEIGHT * 0.25);
    expect(docked.every(clear)).toBe(true);
  });

  it('leaves no sixth of the round empty: three or more things to find in each', () => {
    // Galaxies, heroes and clusters, by azimuth: a slow look round always finds something.
    const azimuths = [...sky.galaxies, ...heroes, ...clusters].map(
      (thing) => ((thing.azDeg % 360) + 360) % 360,
    );
    for (let sector = 0; sector < 6; sector += 1) {
      const found = azimuths.filter((az) => Math.floor(az / 60) === sector);
      expect(found.length, `azimuth ${sector * 60} to ${sector * 60 + 60}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it('makes each class brighter and rarer than the one before', () => {
    const order = [classes.dust, classes.field, classes.bright, classes.mid];
    for (const [i, cls] of order.entries()) {
      expect(cls.yRange[0]).toBeLessThan(cls.yRange[1]);
      expect(cls.yRange[1]).toBeLessThanOrEqual(1);
      const before = order[i - 1];
      if (!before) continue;
      expect(cls.yRange[0]).toBeGreaterThan(before.yRange[0]);
      expect(cls.sigmaPx).toBeGreaterThan(before.sigmaPx);
      // The faint stars are the river; the bright ones are spread over the whole sky.
      expect(cls.bandShare).toBeLessThan(before.bandShare);
    }
    expect(tuning.starfield.count).toBeGreaterThan(classes.field.count);
    expect(classes.field.count).toBeGreaterThan(classes.bright.count);
    expect(classes.bright.count).toBeGreaterThan(classes.mid.count);
    expect(classes.mid.count).toBeGreaterThan(heroes.length);
  });

  it('makes a mid star a small hero: six short spikes, of its own length', () => {
    const { mid } = classes;
    expect(mid.spikeLenPx).toBeLessThan(tuning.starfield.hero.spikeLenPx / 2);
    expect(mid.sizeRange[0]).toBeGreaterThan(0);
    expect(mid.sizeRange[0]).toBeLessThan(mid.sizeRange[1]);
    expect(mid.sizeRange[1]).toBeLessThanOrEqual(1);
  });

  it('keeps a double star a pair to the eye: apart, and not far', () => {
    // In the first view a degree is 14.5 px: a companion is 6 to 10 px from its primary.
    const perDeg = HEIGHT / SKY_POSES.first.fovDeg;
    expect(pairs.sepDeg[0] * perDeg).toBeGreaterThan(5);
    expect(pairs.sepDeg[1] * perDeg).toBeLessThan(12);
    expect(pairs.count).toBeGreaterThan(0);
    for (const [primary, companion] of pairs.tints) expect(primary).not.toBe(companion);
    expect(pairs.companionY[1]).toBeLessThan(pairs.primaryY[0]);
  });

  it('holds the sky still: nothing drifts across the baked panorama', () => {
    // The stars lie where the Milky Way's haze is, and its lane dims them at fixed directions.
    expect(tuning.starfield.driftRadPerSec).toBe(0);
  });
});

describe('traffic and the chart', () => {
  it('runs traffic on every orbit of today’s galaxy but the relays’', () => {
    const table = createOrbitTable(real.systems, real.bodies);
    const byId = new Map(real.bodies.map((body) => [body.id, body]));
    const docks = (row: number): boolean => byId.get(table.ids[row] ?? '')?.docks !== false;
    const dots = trafficDots(table, docks, tuning.look.traffic);
    const lines = new Set(Array.from(dots.row, (row) => table.ids[row]));
    const orbiting = real.bodies.filter((body) => body.orbit !== null);
    const relays = orbiting.filter((body) => body.docks === false);
    expect(relays.length).toBeGreaterThan(0);
    expect(lines.size).toBe(orbiting.length - relays.length);
    expect(dots.count).toBe(2 * lines.size);
    for (const relay of relays) expect(lines.has(relay.id)).toBe(false);
    // No orbit of today's is under the limit: every line a ship can dock on has its two dots.
    expect(Math.min(...orbiting.map((body) => body.orbit?.radius ?? 0))).toBeGreaterThanOrEqual(
      tuning.look.traffic.minOrbitRadiusU,
    );
  });

  it('keeps the districts apart, and a dash shorter than its gap', () => {
    // Two districts that overlap would paint one family's plate over another's.
    const { districtOuter, ringDashPx, ringWidthPx, dotRadiusPx, dotSpacingPx } = tuning.look.chart;
    expect(districtOuter).toBeGreaterThan(1);
    for (const a of real.systems) {
      for (const b of real.systems) {
        if (a.id >= b.id) continue;
        const apart = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
        expect(apart, `${a.id} and ${b.id}`).toBeGreaterThan(districtOuter * (a.radius + b.radius));
      }
    }
    // A ring of long dashes reads as an orbit line, which is what the dashes are there to avoid.
    expect(ringDashPx[0]).toBeLessThan(ringDashPx[1]);
    expect(ringWidthPx).toBeLessThan(ringDashPx[0]);
    expect(dotRadiusPx * 8).toBeLessThan(dotSpacingPx);
  });
});

describe('the suns’ and the worlds’ tables', () => {
  it('cuts the sun’s surface into four tones, and points its spots outward', () => {
    const { thresholds } = sun.granulation;
    expect([...thresholds]).toEqual([...thresholds].sort((a, b) => a - b));
    expect(sun.limbNz[0]).toBeLessThan(sun.limbNz[1]);
    for (const spot of sun.spots) {
      // Written to two decimals, so nearly unit: the shader normalises them.
      expect(Math.hypot(...spot.normal)).toBeCloseTo(1, 1);
    }
    // The low tier keeps a subset of the rays that exist.
    const { count, lowIndices } = sun.corona.rays;
    expect(lowIndices.every((index) => index < count)).toBe(true);
    expect(new Set(lowIndices).size).toBe(lowIndices.length);
    expect(sun.detailLow).toBeLessThan(tuning.world.detailSun);
    // The corona's light lies behind everything a sun wears, its lens in front of its ball.
    const [light, lens] = sun.corona.pull;
    expect(light).toBeLessThan(-1.7);
    expect(lens).toBeGreaterThan(1);
    expect(sun.corona.lensHalf).toBeGreaterThan(1);
    expect(sun.corona.rayBase).toBeLessThan(1);
  });

  it('gives air only to bodies that exist, in airs and peaks that exist', () => {
    const ids = new Set(real.bodies.map((body) => body.id));
    for (const [id, world] of Object.entries(air.worlds)) {
      expect(ids.has(id), `${id} is a body of the galaxy`).toBe(true);
      expect(Object.keys(tokens.color.air)).toContain(world.air);
      expect(Object.keys(tokens.color.biome)).toContain(world.cloud.peak);
      expect(world.cloud.share).toBeGreaterThan(0);
      expect(world.cloud.share).toBeLessThanOrEqual(1);
    }
    // Home is the one world with lamps on its night side.
    expect(
      Object.entries(air.worlds)
        .filter(([, world]) => 'windows' in world)
        .map(([id]) => id),
    ).toEqual(['page/about']);
  });

  it('never makes a night black, and steps the air’s shell outward', () => {
    expect(air.bands.night).toBeGreaterThan(0.5);
    expect(air.bands.dusk).toBeLessThanOrEqual(1);
    const { rings, lowRings } = air.shell;
    for (const [i, [inner, outer, alpha]] of rings.entries()) {
      expect(outer).toBeGreaterThan(inner);
      const next = rings[i + 1];
      if (next) {
        expect(next[0]).toBe(outer);
        expect(next[2]).toBeLessThan(alpha);
      }
    }
    expect(lowRings).toBeLessThanOrEqual(rings.length);
  });
});
