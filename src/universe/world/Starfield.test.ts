import { InstancedBufferGeometry, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { buildStarList } from '../sim/starList';
import { starCount, starGeometry, Starfield } from './Starfield';

const list = (low: boolean) =>
  buildStarList(tuning.starfield, tuning.look.sky.band, { coarse: false, low });
const numbers = (attribute: BufferAttribute, vertex: number): number[] =>
  Array.from(
    { length: attribute.itemSize },
    (_, k) => attribute.array[vertex * attribute.itemSize + k] ?? NaN,
  );

describe('the stars’ geometry', () => {
  it('is a quad a star: four vertices of its own, one corner each, and two triangles', () => {
    const stars = list(true);
    const geometry = starGeometry(stars);
    const position = geometry.getAttribute('position') as BufferAttribute;
    const index = geometry.getIndex();
    expect(position.count).toBe(stars.count * 4);
    expect(index?.count).toBe(stars.count * 6);
    expect(starCount(geometry)).toBe(stars.count);
    for (const star of [0, 1, Math.floor(stars.count / 2), stars.count - 1]) {
      const corners = [0, 1, 2, 3].map((corner) => numbers(position, star * 4 + corner));
      expect(corners).toEqual([
        [-1, -1, 0],
        [1, -1, 0],
        [-1, 1, 0],
        [1, 1, 0],
      ]);
      const triangles = Array.from({ length: 6 }, (_, k) => index?.array[star * 6 + k]);
      expect(triangles.map((vertex) => (vertex ?? NaN) - star * 4)).toEqual([0, 1, 2, 2, 1, 3]);
    }
    geometry.dispose();
  });

  it('gives all four corners the star’s own direction, colour and numbers', () => {
    const stars = list(true);
    const geometry = starGeometry(stars);
    const direction = geometry.getAttribute('aDir') as BufferAttribute;
    const color = geometry.getAttribute('aColor') as BufferAttribute;
    const star = geometry.getAttribute('aStar') as BufferAttribute;
    for (let i = 0; i < stars.count; i += 97) {
      const first = [direction, color, star].map((attribute) => numbers(attribute, i * 4));
      for (let corner = 1; corner < 4; corner += 1) {
        expect(
          [direction, color, star].map((attribute) => numbers(attribute, i * 4 + corner)),
        ).toEqual(first);
      }
      expect(first[0]).toEqual(Array.from(stars.directions.subarray(i * 3, i * 3 + 3)));
      expect(first[2]).toEqual([
        stars.kinds[i],
        stars.sizes[i],
        stars.phases[i],
        stars.twinkles[i],
      ]);
    }
    geometry.dispose();
  });

  it('is not instanced: a software renderer draws every instance on its own', () => {
    // CI draws on the CPU, where the low tier's stars cost 20.6 ms a frame as instances and
    // 3.8 ms as triangles (world/Starfield.ts, starGeometry).
    const field = new Starfield({ coarsePointer: false, reducedMotion: false, low: true });
    expect(field.object.geometry).not.toBeInstanceOf(InstancedBufferGeometry);
    expect(
      Object.values(field.object.geometry.attributes).map((attribute) => attribute.count),
    ).toEqual(Array.from({ length: 4 }, () => starCount(field.object.geometry) * 4));
    field.dispose();
  });

  it('counts its vertices in two bytes while they fit, and in four past that', () => {
    const full = list(false);
    // The fullest sky there is: every vertex within reach of a 16-bit index.
    expect(full.count * 4).toBeLessThanOrEqual(0xffff);
    const geometry = starGeometry(full);
    expect(geometry.getIndex()?.array).toBeInstanceOf(Uint16Array);
    geometry.dispose();

    const count = 0x4000;
    const many = starGeometry({
      count,
      directions: new Float32Array(count * 3),
      brightness: new Float32Array(count),
      kinds: new Uint8Array(count),
      tints: Array.from({ length: count }, () => 'white' as const),
      sizes: new Float32Array(count),
      phases: new Float32Array(count),
      twinkles: new Uint8Array(count),
    });
    expect(many.getIndex()?.array).toBeInstanceOf(Uint32Array);
    expect(many.getIndex()?.array[count * 6 - 1]).toBe(count * 4 - 1);
    many.dispose();
  });
});
