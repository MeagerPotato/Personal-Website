import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { BodiesOnScreen } from './BodiesOnScreen';

/**
 * Two bodies in a window of 1000 by 800 px, seen from 200 u up the +Z axis: the first at the
 * middle of the world, in the map out to 15 u (a world with rings), the second 40 u to the right
 * and drawn at twice its size. `positions` is live, as the galaxy's is.
 */
function setup() {
  const camera = new PerspectiveCamera(40, 1000 / 800, 1, 5000);
  camera.position.set(0, 0, 200);
  camera.lookAt(0, 0, 0);
  const positions = new Float64Array([0, 0, 40, 0]);
  const screen = new BodiesOnScreen({
    camera,
    positions,
    radii: [15, 6],
    scales: [1, 2],
    count: 2,
  });
  screen.resize({ width: 1000, height: 800, pixelRatio: 1 });
  screen.frameUpdate();
  return { camera, positions, screen };
}

describe('a body’s disc on screen', () => {
  it('is measured out to the reach asked for, not to the radius the map has the body at', () => {
    const { screen } = setup();
    const disc = { x: 0, y: 0, radius: 0 };
    expect(screen.disc(0, 10, disc)).toBe(true);
    expect(disc.x).toBeCloseTo(500, 9);
    expect(disc.y).toBeCloseTo(400, 9);
    // Two thirds of what the map has (15 u), and exactly where a point 10 u from the middle is.
    expect(disc.radius).toBeCloseTo(((screen.map.radius[0] ?? 0) * 10) / 15, 9);
    const edge = { x: 0, y: 0 };
    expect(screen.pointAt(10, 0, edge)).toBe(true);
    expect(edge.x - disc.x).toBeCloseTo(disc.radius, 9);
    expect(disc.radius).toBeGreaterThan(20);
  });

  it('is as big as the body is drawn this frame, where it is this frame', () => {
    const { positions, screen } = setup();
    const disc = { x: 0, y: 0, radius: 0 };
    // Drawn at twice its size (the star map does that): 6 u of ground are 12 u on screen.
    expect(screen.disc(1, 6, disc)).toBe(true);
    const middle = { x: 0, y: 0 };
    const edge = { x: 0, y: 0 };
    screen.pointAt(40, 0, middle);
    screen.pointAt(52, 0, edge);
    expect(disc.x).toBeCloseTo(middle.x, 9);
    expect(disc.radius).toBeCloseTo(edge.x - middle.x, 9);

    // The body goes on round its sun: the disc is where the last frame saw it, until the next.
    positions[2] = 0;
    positions[3] = 40;
    screen.disc(1, 6, disc);
    expect(disc.x).toBeCloseTo(middle.x, 9);
    screen.frameUpdate();
    screen.disc(1, 6, disc);
    expect(disc.x).toBeCloseTo(500, 9);
    // Nearer the camera now, so bigger.
    expect(disc.radius).toBeGreaterThan(edge.x - middle.x);
  });

  it('says no for a body behind the camera, and for a row that is none of the map’s', () => {
    const { camera, screen } = setup();
    const disc = { x: -1, y: -1, radius: -1 };
    expect(screen.disc(2, 10, disc)).toBe(false);
    expect(screen.disc(-1, 10, disc)).toBe(false);
    camera.position.set(0, 0, -200);
    camera.lookAt(0, 0, -400);
    screen.frameUpdate();
    expect(screen.disc(0, 10, disc)).toBe(false);
    // And leaves what it was given alone.
    expect(disc).toEqual({ x: -1, y: -1, radius: -1 });
  });
});
