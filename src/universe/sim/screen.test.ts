import { describe, expect, it } from 'vitest';
import { createScreenMap, isTap, pickBody, projectBodies, type ScreenMap } from './screen';

type Vec3 = readonly [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** A camera the way three.js builds one: column-major, looking down its own -Z. */
function camera(eye: Vec3, target: Vec3, up: Vec3, fovDeg: number, aspect: number) {
  const back = unit(sub(eye, target));
  const right = unit(cross(up, back));
  const above = cross(back, right);
  const view = [
    ...[right[0], above[0], back[0], 0],
    ...[right[1], above[1], back[1], 0],
    ...[right[2], above[2], back[2], 0],
    ...[-dot(right, eye), -dot(above, eye), -dot(back, eye), 1],
  ];
  const focal = 1 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const [near, far] = [0.5, 12000];
  const projection = [
    ...[focal / aspect, 0, 0, 0],
    ...[0, focal, 0, 0],
    ...[0, 0, (far + near) / (near - far), -1],
    ...[0, 0, (2 * far * near) / (near - far), 0],
  ];
  const viewProjection: number[] = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (projection[k * 4 + row] ?? 0) * (view[column * 4 + k] ?? 0);
      }
      viewProjection.push(sum);
    }
  }
  return { viewProjection, focal };
}

const WIDTH = 1200;
const HEIGHT = 800;

function project(
  eye: Vec3,
  target: Vec3,
  up: Vec3,
  fovDeg: number,
  bodies: ReadonlyArray<readonly [x: number, z: number, radius: number]>,
): ScreenMap {
  const { viewProjection, focal } = camera(eye, target, up, fovDeg, WIDTH / HEIGHT);
  return projectBodies(
    viewProjection,
    focal,
    WIDTH,
    HEIGHT,
    bodies.flatMap(([x, z]) => [x, z]),
    bodies.map(([, , radius]) => radius),
    bodies.length,
    createScreenMap(bodies.length),
  );
}

describe('projectBodies', () => {
  it('from straight above, puts +X to the right and -Z up, to scale', () => {
    // 100 u up with a 90 degree lens: the view is 200 u tall, so 4 px to the unit.
    const map = project([0, 100, 0], [0, 0, 0], [0, 0, -1], 90, [
      [0, 0, 5],
      [10, 0, 5],
      [0, -25, 2],
    ]);
    expect([map.x[0], map.y[0]]).toEqual([600, 400]);
    expect(map.x[1]).toBeCloseTo(640, 9);
    expect(map.y[1]).toBeCloseTo(400, 9);
    expect(map.x[2]).toBeCloseTo(600, 9);
    expect(map.y[2]).toBeCloseTo(300, 9);
    expect(map.depth[0]).toBeCloseTo(100, 9);
    expect(map.radius[0]).toBeCloseTo(20, 9);
    expect(map.radius[2]).toBeCloseTo(8, 9);
  });

  it('from behind a ship, makes what is further away smaller and nearer the horizon', () => {
    // The chase view: a little above the plane, looking along +Z.
    const map = project([0, 5, -11], [0, 0, 14], [0, 1, 0], 55, [
      [0, 50, 8],
      [0, 500, 8],
      [40, 500, 8],
    ]);
    expect(map.radius[0]).toBeGreaterThan((map.radius[1] ?? 0) * 5);
    // Both are below the horizon (the camera is above the plane), the far one closer to it.
    const horizon = project([0, 5, -11], [0, 0, 14], [0, 1, 0], 55, [[0, 1e6, 1]]).y[0] ?? 0;
    expect(map.y[0]).toBeGreaterThan(map.y[1] ?? 0);
    expect(map.y[1]).toBeGreaterThan(horizon);
    // Looking along +Z with +Y up, +X is to the LEFT (three.js is right-handed).
    expect(map.x[2]).toBeLessThan(map.x[1] ?? 0);
  });

  it('knows what is behind the camera', () => {
    const map = project([0, 5, -11], [0, 0, 14], [0, 1, 0], 55, [
      [0, -200, 8],
      [0, 200, 8],
    ]);
    expect(map.depth[0]).toBeLessThan(0);
    expect(map.radius[0]).toBe(0);
    expect(map.depth[1]).toBeGreaterThan(0);
  });

  it('measures a body as it is drawn: bigger on the star map, or not there at all', () => {
    const { viewProjection, focal } = camera([0, 100, 0], [0, 0, 0], [0, 0, -1], 90, 1.5);
    const map = projectBodies(
      viewProjection,
      focal,
      WIDTH,
      HEIGHT,
      [0, 0, 10, 0, 20, 0],
      [5, 5, 5],
      3,
      createScreenMap(3),
      [1, 2.5, 0],
    );
    expect(map.radius[0]).toBeCloseTo(20, 9);
    expect(map.radius[1]).toBeCloseTo(50, 9);
    // Nothing to see is nothing to pick and nothing to name.
    expect(map.radius[2]).toBe(0);
    expect(
      pickBody(map, map.x[2] ?? 0, map.y[2] ?? 0, { minTargetPx: 12, minVisiblePx: 1.5 }),
    ).toBe(1);
  });

  it('fills no more rows than the map has', () => {
    const { viewProjection, focal } = camera([0, 100, 0], [0, 0, 0], [0, 0, -1], 90, 1.5);
    const map = projectBodies(
      viewProjection,
      focal,
      WIDTH,
      HEIGHT,
      [0, 0, 1, 1, 2, 2],
      [1, 1, 1],
      3,
      createScreenMap(2),
    );
    expect(map.count).toBe(2);
  });
});

describe('pickBody', () => {
  const PARAMS = { minTargetPx: 12, minVisiblePx: 1.5 };
  const mapOf = (
    rows: ReadonlyArray<readonly [x: number, y: number, radius: number, depth: number]>,
  ): ScreenMap => {
    const map = createScreenMap(rows.length);
    map.count = rows.length;
    rows.forEach(([x, y, radius, depth], i) => {
      map.x[i] = x;
      map.y[i] = y;
      map.radius[i] = radius;
      map.depth[i] = depth;
    });
    return map;
  };

  it('picks the body under the point, and nothing in empty sky', () => {
    const map = mapOf([
      [200, 300, 40, 100],
      [600, 300, 25, 100],
    ]);
    expect(pickBody(map, 210, 320, PARAMS)).toBe(0);
    expect(pickBody(map, 590, 310, PARAMS)).toBe(1);
    expect(pickBody(map, 400, 300, PARAMS)).toBe(-1);
    expect(pickBody(map, 200, 345, PARAMS)).toBe(-1);
  });

  it('gives a small body a target big enough to hit', () => {
    const map = mapOf([[200, 300, 3, 900]]);
    expect(pickBody(map, 210, 300, PARAMS)).toBe(0);
    expect(pickBody(map, 213, 300, PARAMS)).toBe(-1);
  });

  it('picks the one in front where two discs overlap', () => {
    const map = mapOf([
      [300, 300, 60, 400],
      [330, 300, 30, 120],
    ]);
    expect(pickBody(map, 320, 300, PARAMS)).toBe(1);
    expect(pickBody(map, 260, 300, PARAMS)).toBe(0);
  });

  it('prefers the body the point is ON to a body it is merely near', () => {
    // A moon in front of its planet, the point on the planet just beside the moon.
    const map = mapOf([
      [300, 300, 50, 200],
      [340, 300, 4, 150],
    ]);
    expect(pickBody(map, 330, 300, PARAMS)).toBe(0);
    expect(pickBody(map, 341, 301, PARAMS)).toBe(1);
  });

  it('between two small bodies, picks the one whose edge is closer', () => {
    const map = mapOf([
      [300, 300, 3, 900],
      [316, 300, 5, 950],
    ]);
    expect(pickBody(map, 307, 300, PARAMS)).toBe(0);
    expect(pickBody(map, 309, 300, PARAMS)).toBe(1);
  });

  it('never picks what cannot be seen, what is behind the camera, or what it is told to ignore', () => {
    const map = mapOf([
      [300, 300, 1, 3000],
      [300, 300, 40, -50],
      [300, 300, 30, 100],
    ]);
    expect(pickBody(map, 300, 300, PARAMS)).toBe(2);
    expect(pickBody(map, 300, 300, PARAMS, 2)).toBe(-1);
  });
});

describe('isTap', () => {
  const PARAMS = { tapMaxPx: 10, tapMaxSec: 0.4 };

  it('is short and stays put', () => {
    expect(isTap(100, 100, 104, 97, 0.12, PARAMS)).toBe(true);
    expect(isTap(100, 100, 100, 100, 0.4, PARAMS)).toBe(true);
  });

  it('is not a drag, and not a hold', () => {
    expect(isTap(100, 100, 111, 100, 0.12, PARAMS)).toBe(false);
    expect(isTap(100, 100, 100, 100, 0.41, PARAMS)).toBe(false);
  });
});
