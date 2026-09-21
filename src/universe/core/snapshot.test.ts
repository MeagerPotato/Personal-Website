import { describe, expect, it } from 'vitest';
import { RebuildBudget, parseSnapshot, startingFrom, type Snapshot } from './snapshot';

describe('RebuildBudget', () => {
  it('allows a few rebuilds, then says stop', () => {
    const budget = new RebuildBudget(3, 60_000);
    expect(budget.spend(0)).toBe(true);
    expect(budget.spend(1_000)).toBe(true);
    expect(budget.spend(2_000)).toBe(true);
    expect(budget.spend(3_000)).toBe(false);
  });

  it('forgets rebuilds that happened long ago', () => {
    const budget = new RebuildBudget(2, 60_000);
    expect(budget.spend(0)).toBe(true);
    expect(budget.spend(10_000)).toBe(true);
    expect(budget.spend(20_000)).toBe(false);
    // A refusal is not a rebuild: it does not push the window along.
    expect(budget.spend(60_001)).toBe(true);
    expect(budget.spend(65_000)).toBe(false);
    expect(budget.spend(70_001)).toBe(true);
  });
});

const FLYING: Snapshot = {
  steps: 5400,
  ship: { x: 64, z: -99, vx: 3, vz: -12.5, heading: 7.2, yawRate: -0.4 },
  dock: null,
};
const DOCKED: Snapshot = {
  ...FLYING,
  dock: { id: 'project/fishai', docked: true, angle: 2.5, spin: -1 },
};
/** What a snapshot looks like after a night in sessionStorage. */
const stored = (snapshot: unknown): unknown => JSON.parse(JSON.stringify(snapshot));

describe('a snapshot that has been away', () => {
  it('comes back as it left', () => {
    expect(parseSnapshot(stored(FLYING))).toEqual(FLYING);
    expect(parseSnapshot(stored(DOCKED))).toEqual(DOCKED);
    // A key that was dropped on the way is the same as no dock.
    expect(parseSnapshot({ steps: 1, ship: FLYING.ship })).toEqual({ ...FLYING, steps: 1 });
  });

  it('is refused whole when any of it is not what this engine writes', () => {
    const broken: unknown[] = [
      null,
      undefined,
      'snapshot',
      42,
      [],
      {},
      { ...FLYING, steps: -1 },
      { ...FLYING, steps: 1.5 },
      { ...FLYING, steps: 1e12 },
      { ...FLYING, steps: '5400' },
      { ...FLYING, ship: null },
      { ...FLYING, ship: { ...FLYING.ship, x: null } }, // what JSON makes of NaN and Infinity
      { ...FLYING, ship: { ...FLYING.ship, z: 1e9 } },
      { ...FLYING, ship: { x: 1, z: 2 } },
      { ...FLYING, dock: 'project/fishai' },
      { ...DOCKED, dock: { ...DOCKED.dock, id: 7 } },
      { ...DOCKED, dock: { ...DOCKED.dock, docked: 'yes' } },
      { ...DOCKED, dock: { ...DOCKED.dock, angle: null } },
      { ...DOCKED, dock: { ...DOCKED.dock, spin: 0 } },
    ];
    for (const data of broken) expect(parseSnapshot(data)).toBeNull();
  });

  it('never hands back the object it was given', () => {
    const data = stored(FLYING) as Snapshot;
    const parsed = parseSnapshot(data);
    expect(parsed?.ship).not.toBe(data.ship);
  });
});

describe('where a visit starts', () => {
  it('is the spawn point in open sky when nothing is known', () => {
    expect(startingFrom(undefined)).toEqual({ snapshot: null, at: null });
    expect(startingFrom({})).toEqual({ snapshot: null, at: null });
    expect(startingFrom({ snapshot: 'rubbish' })).toEqual({ snapshot: null, at: null });
  });

  it('is in orbit round the body whose page is open', () => {
    expect(startingFrom({ at: 'page/about' })).toEqual({ snapshot: null, at: 'page/about' });
    expect(startingFrom({ at: 'page/about', snapshot: 'rubbish' }).at).toBe('page/about');
  });

  it('carries on from a remembered snapshot: a reload in open sky, or on the same orbit', () => {
    expect(startingFrom({ snapshot: stored(FLYING) })).toEqual({ snapshot: FLYING, at: null });
    expect(startingFrom({ at: 'project/fishai', snapshot: stored(DOCKED) })).toEqual({
      snapshot: DOCKED,
      at: 'project/fishai',
    });
  });

  it('believes the URL, not the snapshot, about where the ship is docked', () => {
    // Another page was opened by a full page load: same world, same clock, another orbit.
    const moved = startingFrom({ at: 'page/resume', snapshot: stored(DOCKED) });
    expect(moved.at).toBe('page/resume');
    expect(moved.snapshot).toEqual({ ...DOCKED, dock: null });
    // The home page is open sky, whatever the ship was doing when it was last seen.
    const home = startingFrom({ snapshot: stored(DOCKED) });
    expect(home).toEqual({ snapshot: { ...DOCKED, dock: null }, at: null });
  });
});
