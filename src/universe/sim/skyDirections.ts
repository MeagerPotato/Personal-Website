/**
 * WHERE THINGS ARE IN THE SKY, and the seven views the sky is judged from.
 *
 * The sky is at infinity, so a place in it is a direction: a unit vector, y up. Tables
 * (design/tuning.ts: the hero stars, the clusters, the galaxies) give directions as two angles:
 *
 *   azimuth    atan2(x, z), degrees: 0 is +Z, 90 is +X. The layout's bearings (degrees from +X
 *              toward +Z) convert as azimuth = 90 - bearing.
 *   elevation  asin(y), degrees: 0 is the horizon, negative is below it, where the chase camera
 *              looks.
 *
 * Pure: no three.js, no DOM (the lab turns a pose into a camera; a test turns one into numbers).
 */

export type Direction = readonly [x: number, y: number, z: number];

const RAD = Math.PI / 180;

/** The unit vector at an azimuth and an elevation, both in degrees. */
export function directionOf(azDeg: number, elDeg: number): [number, number, number] {
  const az = azDeg * RAD;
  const el = elDeg * RAD;
  const flat = Math.cos(el);
  return [Math.sin(az) * flat, Math.sin(el), Math.cos(az) * flat];
}

/**
 * A place in the sky with a frame across it: the direction `c`, a level unit vector `e1` (a
 * quarter turn of azimuth on) and `e2 = c x e1`, which points up the sky. What is drawn ROUND a
 * place (a far galaxy's ellipse, an arc's angle) is measured along these two.
 */
export function frameOf(
  azDeg: number,
  elDeg: number,
): { c: [number, number, number]; e1: [number, number, number]; e2: [number, number, number] } {
  const c = directionOf(azDeg, elDeg);
  const flat = Math.hypot(c[2], c[0]);
  const e1: [number, number, number] = [c[2] / flat, 0, -c[0] / flat];
  return {
    c,
    e1,
    e2: [c[1] * e1[2] - c[2] * e1[1], c[2] * e1[0] - c[0] * e1[2], c[0] * e1[1] - c[1] * e1[0]],
  };
}

/** The azimuth of a direction, degrees in (-180, 180]. Not defined straight up or down (0 there). */
export function azimuthDeg([x, , z]: Direction): number {
  return Math.atan2(x, z) / RAD;
}

/** The elevation of a direction, degrees from -90 to 90. The vector need not be a unit one. */
export function elevationDeg([x, y, z]: Direction): number {
  return Math.atan2(y, Math.hypot(x, z)) / RAD;
}

/** The difference between two angles in degrees, wrapped to [-180, 180). */
export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** The azimuth, from a point on the flight plane, of another point on it: [x, z] both. */
export function azimuthBetween(
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1]) / RAD;
}

/** One of the views the sky is judged from. */
export interface SkyPose {
  /** The azimuth the camera faces, degrees. */
  readonly yawDeg: number;
  /** Degrees up from the horizon (negative looks down). */
  readonly pitchDeg: number;
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  /** How much of the sky's added light shows: 0.5 while docked, else 1. */
  readonly exposure: number;
  readonly what: string;
}

/**
 * The seven views: every acceptance picture of the sky, every luminance gate, and the lab's
 * `sky` subject use these, so that "before" and "after" are the same view. All were written for
 * a view 1.6 times as wide as it is high.
 */
export const SKY_POSES = {
  first: {
    yawDeg: -27.9,
    // The chase camera at rest: 4.4 u above the ship and looking 25 u ahead (tuning.chaseCam).
    pitchDeg: -10,
    fovDeg: 55,
    exposure: 1,
    what: 'the first frame at home: the chase camera, the horizon a third of the way down',
  },
  cruise: {
    yawDeg: -60,
    pitchDeg: -10,
    fovDeg: 62,
    exposure: 1,
    what: 'flying toward the Projects binary, a little wider and higher',
  },
  docked: {
    yawDeg: 20,
    pitchDeg: -25,
    fovDeg: 40,
    exposure: 0.5,
    what: 'docked at a planet: closer, looking down, the panel open, the sky at half strength',
  },
  proj: {
    yawDeg: -45,
    pitchDeg: -12,
    fovDeg: 50,
    exposure: 1,
    what: 'looking straight toward Projects',
  },
  hack: {
    yawDeg: 75,
    pitchDeg: -12,
    fovDeg: 50,
    exposure: 1,
    what: 'looking straight toward Hackathons',
  },
  res: {
    yawDeg: 15,
    pitchDeg: -12,
    fovDeg: 50,
    exposure: 1,
    what: 'looking straight toward Research',
  },
  band: {
    // Toward where the river is highest: its bulge is left of the middle of this view.
    yawDeg: -60,
    pitchDeg: 10,
    fovDeg: 70,
    exposure: 1,
    what: 'looking up along the Milky Way, its bulge in view: the widest view',
  },
} as const satisfies Record<string, SkyPose>;

export type SkyPoseName = keyof typeof SKY_POSES;
export const SKY_POSE_NAMES = Object.keys(SKY_POSES) as SkyPoseName[];

/** A pose's camera: where it faces, its right and its up (unit vectors), and tan(fov / 2). */
function cameraOf(pose: SkyPose): {
  forward: Direction;
  right: Direction;
  up: Direction;
  half: number;
} {
  const forward = directionOf(pose.yawDeg, pose.pitchDeg);
  const yaw = pose.yawDeg * RAD;
  // Right is level (no roll), a quarter turn of azimuth to the right of where the camera faces.
  const right: Direction = [-Math.cos(yaw), 0, Math.sin(yaw)];
  // Up completes the frame: right x forward.
  const up: Direction = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up, half: Math.tan((pose.fovDeg * RAD) / 2) };
}

/**
 * The direction through a point of a pose's picture: `u` and `v` from -1 to 1 across the view
 * (u to the right, v up), `aspect` its width over its height. (0, 0) is where the camera faces.
 * With the camera facing +Z, screen right is -X: azimuth grows to the LEFT.
 */
export function rayOf(
  pose: SkyPose,
  u: number,
  v: number,
  aspect: number,
): [number, number, number] {
  const { forward, right, up, half } = cameraOf(pose);
  const a = u * half * aspect;
  const b = v * half;
  const x = forward[0] + right[0] * a + up[0] * b;
  const y = forward[1] + right[1] * a + up[1] * b;
  const z = forward[2] + right[2] * a + up[2] * b;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/**
 * Where a direction falls in a pose's picture, the other way round from `rayOf`: [u, v] as
 * there (each from -1 to 1 inside the view), or null for a direction the camera does not face.
 */
export function pointOf(
  pose: SkyPose,
  direction: Direction,
  aspect: number,
): [number, number] | null {
  const { forward, right, up, half } = cameraOf(pose);
  const dot = (axis: Direction): number =>
    direction[0] * axis[0] + direction[1] * axis[1] + direction[2] * axis[2];
  const ahead = dot(forward);
  if (ahead <= 1e-6) return null;
  return [dot(right) / ahead / (half * aspect), dot(up) / ahead / half];
}
