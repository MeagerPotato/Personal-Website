import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { BODIES } from '../design/worlds/bodies';
import { finish, groundHeight } from './planet';
import { centroidOf, norm, normalOf, type Tri } from './world/kit';
import { groundLook, groundOf, type GroundSpec } from './world/ground';
import { colorOf } from './world/palette';
import { FLAG, rowsOf } from './world/rows';
import { LAMP, LAMPS_PART, windowFacets, windowLamps } from './windows';

// The lamps of home's night side, on home's real ground at its close-up detail: the same towns
// every time, on the land near the coasts, and never more than the look allows.

const looks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
const { windows } = tuning.look.air;
const recipe = BODIES['page/about'];
if (!recipe) throw new Error('home has rows');
const [spec] = rowsOf(recipe, { map: false }) as unknown as [GroundSpec];
const seed = spec.seed ?? 'page/about';
const ground: Tri[] = finish(groundOf(spec, seed, tuning.world.detailNear, looks));
const heightAt = groundHeight(seed, groundLook(spec, looks).look);

describe('lit windows', () => {
  const lamps = windowFacets(ground, heightAt, seed, windows);

  it('are the same towns every time', () => {
    expect(windowFacets(ground, heightAt, seed, windows)).toEqual(lamps);
    // Another world's ground would have other towns.
    expect(windowFacets(ground, heightAt, 'elsewhere', windows)).not.toEqual(lamps);
  });

  it('are as many as the look allows on home, and no more', () => {
    // Home has far more land near its coasts than lamps: the look's `most` is what counts.
    expect(lamps).toHaveLength(windows.most);
    expect(windows.most).toBeGreaterThanOrEqual(60);
    expect(windows.most).toBeLessThanOrEqual(200);
    expect(new Set(lamps.map((lamp) => lamp.facet)).size).toBe(lamps.length);
    // The most favoured first.
    expect(lamps[0]?.rank).toBe(1);
    for (let i = 1; i < lamps.length; i += 1) {
      expect(lamps[i]?.rank).toBeLessThan(lamps[i - 1]?.rank ?? 0);
      expect(lamps[i]?.rank).toBeGreaterThan(0);
    }
  });

  it('stand on the land near the coasts, never in the sea or on the peaks', () => {
    const [low, high] = windows.h;
    expect(low).toBeGreaterThan(0);
    for (const { facet } of lamps) {
      const tri = ground[facet];
      if (!tri) throw new Error(`no facet ${facet}`);
      const [x, y, z] = norm(centroidOf(tri));
      const h = heightAt(x, y, z);
      expect(h).toBeGreaterThanOrEqual(low);
      expect(h).toBeLessThanOrEqual(high);
    }
  });

  it('gather into towns: a lamp has another close by', () => {
    const at = lamps.map(({ facet }) => norm(centroidOf(ground[facet] as Tri)));
    const near = at.filter((p, i) =>
      at.some((q, j) => i !== j && p[0] * q[0] + p[1] * q[1] + p[2] * q[2] > Math.cos(0.12)),
    );
    expect(near.length).toBeGreaterThan(0.6 * at.length);
  });

  it('become a close-up part of round dots lying on the ground, flagged as lamps', () => {
    const color = colorOf('lamp.window');
    const part = windowLamps(ground, heightAt, seed, windows, color);
    expect(part.name).toBe(LAMPS_PART);
    expect(part.tier).toBe('near');
    // A decal that turns with the ground (it is not held).
    expect(part.flags).toBe(FLAG.decal);
    // A hexagon a lamp: four triangles.
    expect(part.tris).toHaveLength(windows.most * 4);
    const [small, big] = windows.sizeR;
    for (const tri of part.tris) {
      expect(tri.g).toBe(LAMP);
      expect(tri.c).toBe(color);
      // It faces out of the ground, and carries the ball's normal: night falls on it as on the
      // ball under it.
      const out = norm(centroidOf(tri));
      const up = normalOf(tri);
      expect(up[0] * out[0] + up[1] * out[1] + up[2] * out[2]).toBeGreaterThan(0.8);
      const n = Array.from(tri.n ?? []);
      expect(Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0)).toBeCloseTo(1, 9);
      expect((n[0] ?? 0) * out[0] + (n[1] ?? 0) * out[1] + (n[2] ?? 0) * out[2]).toBeGreaterThan(
        0.99,
      );
      // No bigger than the biggest lamp.
      const [a, b] = [tri.p.slice(0, 3), tri.p.slice(3, 6)];
      expect(
        Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)),
      ).toBeLessThanOrEqual(2 * big + 1e-9);
    }
    expect(small).toBeLessThan(big);
    // The whole part keeps home under the close-up ceiling (tests/world-bodies.test.ts: 6600).
    expect(part.tris.length).toBeLessThanOrEqual(800);
  });

  it('lights nothing on a ground with no land in reach', () => {
    const sea = (): number => -1;
    expect(windowFacets(ground, sea, seed, windows)).toEqual([]);
    expect(windowLamps(ground, sea, seed, windows, [1, 1, 1]).tris).toEqual([]);
  });
});
