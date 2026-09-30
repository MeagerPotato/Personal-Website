import { describe, expect, it } from 'vitest';
import { tuning } from '../../design/tuning';
import { finish } from '../planet';
import { groundLook, groundOf, TERRAIN, type GroundSpec } from './ground';
import { colorOf } from './palette';

// The ground is the engine's own generator with a world's options: it must count, colour and
// seed exactly as a body's rows say.

const ground = (spec: GroundSpec, seed = 'body', detail = 3) =>
  finish(groundOf(spec, seed, detail));
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

  it('paints a sun in its family, unlit and glowing, with no nudge', () => {
    const tris = ground({ sun: 'mint', recipe: 'sun' }, 'sun', 4);
    expect(tris).toHaveLength(500);
    expect(tris.every((t) => t.g === 2)).toBe(true);
    const allowed = [f32('mint.base'), f32('mint.light'), f32('mint.shade')];
    expect(tris.every((t) => allowed.includes(String(t.c)))).toBe(true);
  });

  it('paints its ops over the bands, exactly', () => {
    const tris = ground({ biome: 'primer', paint: [['band', 0, 0.5, 'coral.base']] });
    const north = tris.filter((t) => (t.p[1] ?? 0) + (t.p[4] ?? 0) + (t.p[7] ?? 0) > 0.3);
    expect(north.length).toBeGreaterThan(0);
    expect(north.every((t) => String(t.c) === f32('coral.base'))).toBe(true);
  });

  it('reads the generator’s look from tuning, the terrain and its own stops', () => {
    expect(groundLook({ recipe: 'isles' }).look).toEqual({
      ...tuning.planet,
      ...TERRAIN.isles.look,
    });
    expect(groundLook({ recipe: 'isles' }).flat).toBeUndefined();
    expect(groundLook({}).flat).toBe(0.3);
    expect(groundLook({ recipe: { flat: -1 } }).flat).toBe(-1);
    expect(groundLook({ recipe: 'calm', stops: [0.1, 0.2, 0.3] }).look.bandStops).toEqual([
      0.1, 0.2, 0.3,
    ]);
  });
});
