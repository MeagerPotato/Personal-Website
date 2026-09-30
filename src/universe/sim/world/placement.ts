import { shapePoint, type PlanetShape } from '../planet';
import {
  basisM,
  cross,
  mul3,
  norm,
  rotm,
  scale,
  xf,
  type Mat3,
  type Tri,
  type Vec2,
  type Vec3,
} from './kit';

/**
 * SURFACE PLACEMENT. A part is modelled upright (+Y) at the origin and stood on its world
 * afterwards, so that a part never needs to know where it will live: `onSurf` stands it at a
 * latitude and longitude of a round world, `atNormal` on any point of any shape along the normal
 * there (`shapePoint` and `shapeNormal` give both for a superellipsoid).
 *
 * Each placement is also a FRAME (a matrix, a point and a scale): the interpreter stands the
 * triangles in it, and a moving part keeps it as its pivot (rows.ts, `pivotOf`), so that a crane
 * swings about its own tower.
 */

export { shapePoint };

/** Where a placement puts a part: the part's triangles are scaled by `s`, turned by `m`, moved to `at`. */
export interface Frame {
  readonly m: Mat3;
  readonly at: Vec3;
  readonly s: number;
}

/** The unit direction at a latitude and longitude, in degrees (longitude 0 is +Z, 90 is +X). */
export const dirOf = (latDeg: number, lonDeg: number): Vec3 => {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
};

/** [latitude, longitude] in degrees for a colatitude and a compass bearing (north -Z, clockwise). */
export const polar = (colatDeg: number, bearingDeg: number): Vec2 => [
  90 - colatDeg,
  180 - bearingDeg,
];

export interface SurfaceOptions {
  /** Height above the surface, in radii. */
  readonly alt?: number;
  /** A turn about the part's own up, radians. */
  readonly spin?: number;
  readonly s?: number;
  /** A lean about the part's own X and Z, radians. */
  readonly tilt?: Vec2;
}

/** The frame of a part stood on a round world at a latitude and longitude: local -Z toward the pole. */
export function surfaceFrame(
  latDeg: number,
  lonDeg: number,
  { alt = 0, spin = 0, s = 1, tilt = [0, 0] }: SurfaceOptions = {},
): Frame {
  const u = dirOf(latDeg, lonDeg);
  let east = cross([0, 1, 0], u);
  // At a pole there is no east: any horizontal axis will do, and +X is the one the art used.
  east = Math.hypot(east[0], east[1], east[2]) < 1e-6 ? [1, 0, 0] : norm(east);
  return {
    m: mul3(basisM(east, u, cross(east, u)), rotm(tilt[0], spin, tilt[1])),
    at: scale(u, 1 + alt),
    s,
  };
}

export const onSurf = (
  tris: readonly Tri[],
  latDeg: number,
  lonDeg: number,
  options: SurfaceOptions = {},
): Tri[] => xf(tris, surfaceFrame(latDeg, lonDeg, options));

/** The frame of a part stood at `pos` with its up along `normal`, turned about it by `spin`. */
export function normalFrame(pos: Vec3, normal: Vec3, spin = 0, s = 1): Frame {
  const up = norm(normal);
  const ref: Vec3 = Math.abs(up[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(ref, up));
  return { m: mul3(basisM(x, up, cross(x, up)), rotm(0, spin, 0)), at: pos, s };
}

export const atNormal = (tris: readonly Tri[], pos: Vec3, normal: Vec3, spin = 0, s = 1): Tri[] =>
  xf(tris, normalFrame(pos, normal, spin, s));

/** The outward normal of a superellipsoid (or of the unit sphere) at a point of its surface. */
export function shapeNormal(pos: Vec3, shape?: PlanetShape): Vec3 {
  const p = shape?.p ?? 2;
  const s = shape?.s ?? [1, 1, 1];
  const along = (i: 0 | 1 | 2): number =>
    (Math.sign(pos[i]) * Math.abs(pos[i] / s[i]) ** (p - 1)) / s[i];
  return norm([along(0), along(1), along(2)]);
}
