// Pose memory (src/shell/pose-memory.ts): when a page goes away, the shell keeps the engine's
// snapshot in sessionStorage, and the next page carries on from it, so a reload in open sky
// resumes where the ship was. But only in the galaxy the snapshot was taken in: the engine stamps
// each one with the manifest's galaxyKey (src/universe/main.ts), and one stamped with another
// galaxy (a deploy moved things while the tab was open) is dropped whole (core/snapshot.ts,
// startingFrom). These tests plant a snapshot before a page load, the way a tab that outlived a
// deploy would hold one, and ask the next page what it made of it.

import type { Page } from '@playwright/test';
import {
  engineReady,
  expect,
  keptNow,
  loadWith,
  openUniverse,
  test,
  universe,
  type Kept,
} from './support';

/** An hour of simulation (60 steps a second): a clock no page in these tests reaches by itself. */
const HOUR = 60 * 60 * 60;

const apart = (a: Kept['ship'], b: Kept['ship']): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The sky, and a snapshot of THIS galaxy with the ship somewhere else an hour later: at rest,
 * twice as far from home (the centre of the galaxy) as the spawn point and on the same side, in
 * open sky and 118 u from where a new visit starts.
 */
async function elsewhere(page: Page): Promise<{ spawn: Kept; moved: Kept }> {
  await openUniverse(page, '/');
  const spawn = await keptNow(page);
  const { x, z } = spawn.ship;
  const moved: Kept = {
    ...spawn,
    steps: spawn.steps + HOUR,
    ship: { ...spawn.ship, x: 2 * x, z: 2 * z, vx: 0, vz: 0, yawRate: 0 },
  };
  return { spawn, moved };
}

/** A key that is certainly not this galaxy's: its first digit changed. */
const another = (galaxy = ''): string => `${galaxy.startsWith('0') ? '1' : '0'}${galaxy.slice(1)}`;

test('the engine says which galaxy a snapshot was taken in', async ({ page }) => {
  await openUniverse(page, '/');
  const kept = await keptNow(page);
  expect(kept.galaxy).toMatch(/^[0-9a-f]{8}$/);
  // And every page of one build is the same galaxy.
  await page.goto(universe('/about/'));
  await engineReady(page);
  expect((await keptNow(page)).galaxy).toBe(kept.galaxy);
});

test('a reload in open sky carries on where the ship was', async ({ page }) => {
  const { spawn, moved } = await elsewhere(page);
  await loadWith(page, moved);
  const now = await keptNow(page);
  expect(now.steps).toBeGreaterThanOrEqual(moved.steps);
  expect(apart(now.ship, moved.ship)).toBeLessThan(5);
  expect(now.galaxy).toBe(spawn.galaxy);
});

test('a snapshot from another galaxy is forgotten: the visit starts at the spawn point', async ({
  page,
}) => {
  const { spawn, moved } = await elsewhere(page);
  await loadWith(page, { ...moved, galaxy: another(spawn.galaxy) });
  const now = await keptNow(page);
  // Nothing of it was believed: not the ship, and not the clock either.
  expect(now.steps).toBeLessThan(moved.steps);
  expect(apart(now.ship, spawn.ship)).toBeLessThan(5);
  expect(apart(now.ship, moved.ship)).toBeGreaterThan(100);
  // What this page leaves behind is stamped with its own galaxy.
  expect(now.galaxy).toBe(spawn.galaxy);
});

test('a snapshot from before galaxies were told apart is forgotten too: the galaxy has changed since', async ({
  page,
}) => {
  // No engine since stamps writes one without, so it is from a galaxy older than the first whose
  // key changed (the relays round home: core/snapshot.ts, startingFrom).
  const { spawn, moved } = await elsewhere(page);
  const unstamped: Partial<Kept> = { ...moved };
  delete unstamped.galaxy;
  await loadWith(page, unstamped);
  const now = await keptNow(page);
  expect(now.steps).toBeLessThan(moved.steps);
  expect(apart(now.ship, spawn.ship)).toBeLessThan(5);
  expect(apart(now.ship, moved.ship)).toBeGreaterThan(100);
  expect(now.galaxy).toBe(spawn.galaxy);
});

test('on a body page, the ship is in orbit there, on the clock of a snapshot of this galaxy only', async ({
  page,
}) => {
  const { spawn, moved } = await elsewhere(page);

  await loadWith(page, { ...moved, galaxy: another(spawn.galaxy) }, '/about/');
  const forgotten = await keptNow(page);
  expect(forgotten.dock).toMatchObject({ id: 'page/about', docked: true });
  expect(forgotten.steps).toBeLessThan(moved.steps);

  await loadWith(page, moved, '/about/');
  const believed = await keptNow(page);
  expect(believed.dock).toMatchObject({ id: 'page/about', docked: true });
  expect(believed.steps).toBeGreaterThanOrEqual(moved.steps);
});
