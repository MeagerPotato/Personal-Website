import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import { tokens } from '../src/universe/design/tokens';
import { tuning } from '../src/universe/design/tuning';
import { azimuthBetween, wrapDeg } from '../src/universe/sim/skyDirections';

// `tuning.look` and the star classes are the numbers of the "flat worlds, deep light" pass
// (docs/DESIGN.md, "Deep light"). They are written before the systems that read them, so until
// each system arrives with its own tests, this file is what keeps the tables honest: that they
// name things that exist, that they are the size the shaders will loop over, and that the sky's
// compass still points at the galaxy as the build lays it out.

const real = buildUniverse(readRealInput(true));
const { sky, sun, air } = tuning.look;

describe('the sky’s compass', () => {
  const home = real.systems.find((system) => system.id === 'home');
  const azimuthOf = (id: string): number => {
    const system = real.systems.find((candidate) => candidate.id === id);
    if (!home || !system) throw new Error(`no system "${id}" in the galaxy`);
    return azimuthBetween(home.position, system.position);
  };

  it('puts a pool of gas at the bearing of each system from home', () => {
    // A pool is at infinity: it is right from home, and the same from everywhere. If the layout
    // ever moves a system (tuning.layout, a system's `order`), its pool must move with it.
    for (const id of ['projects', 'research', 'hackathons']) {
      const pool = sky.pools.find((candidate) => candidate.id === id);
      expect(pool, `a pool for ${id}`).toBeDefined();
      expect(wrapDeg((pool?.azDeg ?? 0) - azimuthOf(id)), id).toBeCloseTo(0, 0);
    }
  });

  it('paints each pool in its system’s family', () => {
    for (const id of ['projects', 'research', 'hackathons']) {
      const system = real.systems.find((candidate) => candidate.id === id);
      expect(sky.pools.find((pool) => pool.id === id)?.family, id).toBe(system?.theme);
    }
    // The second sun of the Projects binary has a smaller pool of its own, in its own family,
    // beside its binary's: a shape near that bearing, not a pointer.
    const hardware = real.bodies.find((body) => body.id === 'system/hardware');
    const pool = sky.pools.find((candidate) => candidate.id === 'hardware');
    expect(pool?.family).toBe(hardware?.theme);
    expect(Math.abs(wrapDeg((pool?.azDeg ?? 0) - azimuthOf('projects')))).toBeLessThan(20);
  });

  it('gives every system but home a pool, and home none: butter means "here"', () => {
    const systems = real.systems.filter((system) => system.id !== 'home').map(({ id }) => id);
    expect(
      sky.pools
        .map((pool) => pool.id)
        .filter((id) => id !== 'hardware')
        .sort(),
    ).toEqual(systems.sort());
    const families = [
      ...sky.pools.flatMap((pool) => [pool.family, pool.altFamily]),
      ...sky.arcs.map((arc) => arc.family),
    ];
    expect(families).not.toContain('butter');
    // One small knot of it, high in the sky, and nothing else.
    expect(sky.knots.filter((knot) => knot.family === 'butter')).toHaveLength(1);
  });

  it('keeps the pools below the horizon, where the chase camera looks', () => {
    for (const pool of sky.pools) {
      expect(pool.elDeg, pool.id).toBeLessThan(-10);
      expect(pool.elDeg, pool.id).toBeGreaterThan(-40);
    }
  });
});

describe('the sky’s tables', () => {
  it('are the sizes the bake loops over', () => {
    expect(sky.ridges).toHaveLength(3);
    expect(sky.pools).toHaveLength(4);
    expect(sky.galaxies).toHaveLength(12);
    expect(sky.arcs).toHaveLength(3);
    expect(sky.knots).toHaveLength(7);
  });

  it('runs the ridges far to near: lower, crisper, and lit harder', () => {
    const [far, mid, near] = sky.ridges;
    expect(far.offDeg).toBeGreaterThan(mid.offDeg);
    expect(mid.offDeg).toBeGreaterThan(near.offDeg);
    expect(far.edgeDeg).toBeGreaterThan(mid.edgeDeg);
    expect(mid.edgeDeg).toBeGreaterThan(near.edgeDeg);
    expect(near.key).toBeGreaterThan(far.key);
  });

  it('bakes a panorama twice as wide as high, in whole bands, on every tier', () => {
    for (const [tier, bake] of Object.entries(sky.tiers)) {
      expect(bake.panoWidth, tier).toBe(bake.panoHeight * 2);
      expect(bake.panoHeight % bake.bandRows, tier).toBe(0);
      // RGBA8: 4.5 MiB on low, 8 MiB at most. A phone starts at medium.
      expect(bake.panoWidth * bake.panoHeight * 4, tier).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
    expect(sky.tiers.low.panoWidth).toBeLessThan(sky.tiers.medium.panoWidth);
    // The cheapest tier leaves out what the others keep, never the other way round.
    expect(sky.tiers.low).toMatchObject({ far: false, rag2: false, wisp: false, reliefOctaves: 0 });
    expect(sky.tiers.high.reliefOctaves).toBeGreaterThanOrEqual(sky.tiers.medium.reliefOctaves);
  });

  it('leaves the horizon strip dark and holds a ceiling the focus ring can be seen over', () => {
    const [none, full] = sky.stripDeg;
    expect(none).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(none);
    // Butter over a sky of luminance Y: (0.7148 + 0.05) / (Y + 0.05) is 3:1 at Y 0.205.
    expect(sky.ceilingY).toBeLessThanOrEqual(0.205);
    expect(sky.intensity * sky.ceilingY).toBeLessThanOrEqual(0.19);
  });
});

describe('the stars’ tables', () => {
  const { classes, heroes, clusters, palette } = tuning.starfield;

  it('names only star tints that exist', () => {
    for (const { tint } of [...heroes, ...clusters]) {
      expect(Object.keys(tokens.color.star)).toContain(tint);
    }
    for (const [tint] of palette) expect(Object.keys(tokens.color.star)).toContain(tint);
  });

  it('has eight heroes, each a different place, above the horizon strip or just under it', () => {
    expect(heroes).toHaveLength(8);
    expect(new Set(heroes.map((hero) => `${hero.azDeg},${hero.elDeg}`)).size).toBe(8);
    for (const hero of heroes) {
      expect(hero.size).toBeGreaterThan(0);
      expect(hero.size).toBeLessThanOrEqual(1);
      expect(Math.abs(hero.elDeg)).toBeLessThan(30);
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
    }
    expect(classes.field.count).toBeGreaterThan(classes.bright.count);
    expect(classes.bright.count).toBeGreaterThan(classes.mid.count);
    expect(classes.mid.count).toBeGreaterThan(heroes.length);
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
