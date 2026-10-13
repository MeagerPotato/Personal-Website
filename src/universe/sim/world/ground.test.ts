import { describe, expect, it } from 'vitest';
import { tuning } from '../../design/tuning';
import { finish } from '../planet';
import { groundLook, groundOf, type GroundLooks, type GroundSpec } from './ground';
import { colorOf } from './palette';

// The ground is the engine's own generator with a world's options: it must count, colour and
// seed exactly as a body's rows say.

const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };
const ground = (spec: GroundSpec, seed = 'body', detail = 3) =>
  finish(groundOf(spec, seed, detail, LOOKS));
/** A colour as the generator's buffers hold it: float32. */
const f32 = (path: string): string => String(Array.from(new Float32Array(colorOf(path))));
const radiusOf = (p: readonly number[], i: number): number =>
  Math.hypot(p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0);

describe('the ground', () => {
  it('has 20 x (detail + 1)^2 triangles at radius 1', () => {
    for (const detail of [3, 4, 6, 8]) {
      expect(ground({ recipe: 'continents' }, 'x', detail)).toHaveLength(20 * (detail + 1) ** 2);
    }
  });

  it('is a smooth ball at radius 1 when it is flat (the default)', () => {
    const tris = ground({ biome: 'dune' });
    expect(tris.every((t) => [0, 1, 2].every((i) => Math.abs(radiusOf(t.p, i) - 1) < 1e-6))).toBe(
      true,
    );
    expect(tris.every((t) => t.g === 0)).toBe(true);
  });

  it('seeds by its own name when it has one, else by the body', () => {
    const named = ground({ seed: 'about-me', recipe: 'continents' }, 'page/about');
    expect(ground({ seed: 'about-me', recipe: 'continents' }, 'another')).toEqual(named);
    expect(ground({ recipe: 'continents' }, 'page/about')).not.toEqual(named);
  });

  it('makes a sun a smooth, glowing ball of its family’s base (sim/sunSurface.test.ts)', () => {
    const tris = ground({ sun: 'mint', recipe: 'sun' }, 'sun', 4);
    expect(tris).toHaveLength(500);
    expect(tris.every((t) => [0, 1, 2].every((i) => Math.abs(radiusOf(t.p, i) - 1) < 1e-6))).toBe(
      true,
    );
    // Glowing, and flagged as the surface (above 4); its tones are the shader's to draw.
    expect(tris.every((t) => t.g > 4)).toBe(true);
    const colours = new Set(tris.map((t) => String(Array.from(new Float32Array(t.c)))));
    expect([...colours]).toEqual([f32('mint.base')]);
  });

  it('is round: every facet carries the normals of the ball or the shape it lies on', () => {
    for (const t of ground({ recipe: 'continents' }, 'page/about')) {
      if (!t.n) throw new Error('a ground’s facet has its normals');
      for (let i = 0; i < 9; i += 3) {
        // The relief lifts a corner along its direction and never turns its normal.
        const r = radiusOf(t.p, i / 3);
        for (let k = 0; k < 3; k += 1) expect(t.n[i + k]).toBeCloseTo((t.p[i + k] ?? NaN) / r, 6);
      }
    }
    // A rounded box: flat on its faces, turning only round its edges.
    const box = ground({ shape: { p: 4, s: [1, 1, 1] } });
    const top = box.filter((t) => [1, 4, 7].every((i) => (t.p[i] ?? 0) > 0.95));
    expect(top.length).toBeGreaterThan(0);
    for (const t of top) expect(t.n?.[1]).toBeGreaterThan(0.9);
  });

  it('takes a detail of its own over its kind’s', () => {
    expect(ground({ biome: 'dune', detail: 1 }, 'x', 6)).toHaveLength(80);
  });

  it('paints its ops over the bands, exactly', () => {
    const tris = ground({ biome: 'primer', paint: [['band', 0, 0.5, 'coral.base']] });
    const north = tris.filter((t) => Math.min(t.p[1] ?? 0, t.p[4] ?? 0, t.p[7] ?? 0) > 1e-6);
    expect(north.length).toBeGreaterThan(0);
    expect(north.every((t) => String(t.c) === f32('coral.base') && !t.s)).toBe(true);
    // Along the equator the paint ends INSIDE the facets: they carry both colours and the line.
    const split = tris.filter((t) => t.s);
    expect(split.length).toBeGreaterThan(0);
    for (const t of split) {
      const ys = [t.p[1] ?? 0, t.p[4] ?? 0, t.p[7] ?? 0];
      expect(Math.min(...ys)).toBeLessThan(1e-6);
      expect(Math.max(...ys)).toBeGreaterThan(-1e-6);
    }
  });

  it('makes the generator’s look of the looks it is given, the terrain and its own stops', () => {
    expect(groundLook({ recipe: 'isles' }, LOOKS).look).toEqual({
      ...LOOKS.planet,
      ...LOOKS.terrain.isles.look,
    });
    expect(groundLook({ recipe: 'isles' }, LOOKS).flat).toBeUndefined();
    expect(groundLook({}, LOOKS).flat).toBe(LOOKS.terrain.flat.flat);
    expect(groundLook({ recipe: { flat: -1 } }, LOOKS).flat).toBe(-1);
    expect(groundLook({ recipe: { flat: -1 } }, LOOKS).look.bandStops).toEqual(
      LOOKS.terrain.flat.look.bandStops,
    );
    expect(groundLook({ recipe: 'calm', stops: [0.1, 0.2, 0.3] }, LOOKS).look.bandStops).toEqual([
      0.1, 0.2, 0.3,
    ]);
    // Nothing is read from anywhere else: other looks, another ground.
    const lumpier: GroundLooks = {
      ...LOOKS,
      terrain: { ...LOOKS.terrain, isles: { look: { reliefShare: 0.2 } } },
    };
    expect(groundLook({ recipe: 'isles' }, lumpier).look).toEqual({
      ...LOOKS.planet,
      reliefShare: 0.2,
    });
    expect(finish(groundOf({ recipe: 'isles' }, 'x', 3, lumpier))).not.toEqual(
      ground({ recipe: 'isles' }, 'x'),
    );
  });
});
