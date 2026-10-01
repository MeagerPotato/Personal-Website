import { describe, expect, it } from 'vitest';
import { box, centroidOf, dot, normalOf, norm, type Vec3 } from './kit';
import {
  atNormal,
  dirOf,
  normalFrame,
  onSurf,
  polar,
  shapeNormal,
  shapePoint,
  spinToward,
  surfaceFrame,
} from './placement';

// A part is modelled upright at the origin and stood on its world afterwards.

const close = (a: readonly number[], b: readonly number[], digits = 9): void =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, digits));

describe('surface placement', () => {
  it('points latitude and longitude the vocabulary’s way', () => {
    close(dirOf(90, 0), [0, 1, 0]);
    close(dirOf(0, 0), [0, 0, 1]);
    close(dirOf(0, 90), [1, 0, 0]);
    // Colatitude and a compass bearing (north -Z, clockwise).
    close(dirOf(...polar(90, 90)), [1, 0, 0]);
    close(dirOf(...polar(90, 0)), [0, 0, -1]);
  });

  it('stands a part on a latitude and longitude, its up along the surface', () => {
    const up = dirOf(30, 40);
    const tris = onSurf(box(0.1, 0.1, 0.1, [1, 1, 1]), 30, 40, { alt: 0.05 });
    const middle = tris
      .map(centroidOf)
      .reduce<Vec3>((s, c) => [s[0] + c[0] / 12, s[1] + c[1] / 12, s[2] + c[2] / 12], [0, 0, 0]);
    close(
      middle,
      up.map((v) => v * 1.05),
    );
    const { m } = surfaceFrame(30, 40, { spin: 0.7, tilt: [0, 0] });
    close([m[0][1], m[1][1], m[2][1]], up);
  });

  it('keeps a part’s -Z toward the pole, and survives the pole itself', () => {
    const { m } = surfaceFrame(0, 0);
    // Local -Z is north: +Y on the equator.
    close([-m[0][2], -m[1][2], -m[2][2]], [0, 1, 0]);
    const pole = surfaceFrame(90, 0);
    expect(pole.m.flat().every(Number.isFinite)).toBe(true);
    close([pole.m[0][1], pole.m[1][1], pole.m[2][1]], [0, 1, 0]);
  });

  it('stands a part on any point along a normal', () => {
    const normal = norm([1, 2, 0.5]);
    const tris = atNormal(box(0.1, 0.01, 0.1, [1, 1, 1]), [0.2, 0.9, 0.1], normal, 0.3);
    const top = tris.filter((t) => dot(normalOf(t), normal) > 0.999);
    expect(top).toHaveLength(2);
    const { m, at } = normalFrame([0, 1, 0], [0, 1, 0]);
    close(at, [0, 1, 0]);
    close([m[0][1], m[1][1], m[2][1]], [0, 1, 0]);
  });

  it('stands a part on a shaped ground, on its surface and along its normal', () => {
    const shape = { p: 2, s: [1.05, 0.72, 0.8] as Vec3 };
    const ground = shapePoint(dirOf(20, 40), shape);
    const up = shapeNormal(ground, shape);
    const { m, at } = surfaceFrame(20, 40, { alt: 0.03, shape });
    close(
      at,
      ground.map((v, i) => v + (up[i] ?? 0) * 0.03),
    );
    close([m[0][1], m[1][1], m[2][1]], up);
    // On the unit sphere a shape changes nothing.
    const sphere = surfaceFrame(20, 40, { alt: 0.03, spin: 0.4, shape: { p: 2, s: [1, 1, 1] } });
    const plain = surfaceFrame(20, 40, { alt: 0.03, spin: 0.4 });
    close(sphere.at, plain.at);
    close(sphere.m.flat(), plain.m.flat());
  });

  it('spins a part stood along a normal until its +X runs toward a direction', () => {
    // Near the pole (the frame's other reference axis) and away from it: the same answer.
    for (const normal of [norm([0.1, 1, 0.05]), norm([0.6, 0.7, 0.3])]) {
      const toward: Vec3 = [1, 0, 0];
      const { m } = normalFrame([0, 0, 0], normal, spinToward(normal, toward));
      const x: Vec3 = [m[0][0], m[1][0], m[2][0]];
      // +X is the direction projected across the normal.
      const k = dot(toward, normal);
      close(x, norm([1 - k * normal[0], -k * normal[1], -k * normal[2]]));
    }
  });

  it('finds the point and the normal of a superellipsoid', () => {
    const shape = { p: 4, s: [1.2, 0.8, 1] as Vec3 };
    const d = norm([0.3, 0.8, 0.2]);
    const p = shapePoint(d, shape);
    // On the surface: sum |p_i / s_i|^p = 1.
    expect(
      p.reduce((sum, v, i) => sum + Math.abs(v / (shape.s[i] ?? 1)) ** shape.p, 0),
    ).toBeCloseTo(1, 9);
    // The normal of the unit sphere is the direction itself.
    close(shapeNormal(d), d);
    // A superellipsoid's is the gradient: steeper than the direction toward its flat faces.
    const n = shapeNormal(p, shape);
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
    expect(n[1]).toBeGreaterThan(d[1]);
  });
});
