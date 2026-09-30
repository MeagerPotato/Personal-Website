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

/** This galaxy's key (manifest.ts, galaxyKey), and another deploy's. */
const HERE = '5f3a09c1';
const ELSEWHERE = '0b77e2d4';

const FLYING: Snapshot = {
  steps: 5400,
  ship: { x: 64, z: -99, vx: 3, vz: -12.5, heading: 7.2, yawRate: -0.4 },
  dock: null,
  halting: false,
  guarding: false,
  galaxy: HERE,
};
/** STOP was pressed a moment ago: still braking to rest. */
const STOPPING: Snapshot = { ...FLYING, halting: true };
/** The pilot took a journey back at speed a moment ago: the reflex is still on. */
const GUARDED: Snapshot = { ...FLYING, guarding: true };
const DOCKED: Snapshot = {
  ...FLYING,
  dock: { id: 'project/fishai', docked: true, angle: 2.5, spin: -1, holdSec: 0 },
};
/** Half a second into a hop: the journey must still last a second before it may arrive. */
const HEADED: Snapshot = {
  ...FLYING,
  dock: { id: 'project/fishai', docked: false, angle: 0, spin: 1, holdSec: 1 },
};
/** What a snapshot looks like after a night in sessionStorage. */
const stored = (snapshot: unknown): unknown => JSON.parse(JSON.stringify(snapshot));
/** The same, written before snapshots said which galaxy they were taken in. */
const unstamped = (snapshot: Snapshot): unknown => {
  const older: Record<string, unknown> = { ...snapshot };
  delete older.galaxy;
  return stored(older);
};

describe('a snapshot that has been away', () => {
  it('comes back as it left', () => {
    expect(parseSnapshot(stored(FLYING))).toEqual(FLYING);
    expect(parseSnapshot(stored(DOCKED))).toEqual(DOCKED);
    expect(parseSnapshot(stored(HEADED))).toEqual(HEADED);
    expect(parseSnapshot(stored(STOPPING))).toEqual(STOPPING);
    expect(parseSnapshot(stored(GUARDED))).toEqual(GUARDED);
    // Written before STOP braked, or before a ship taken back was guarded: neither.
    const older: Record<string, unknown> = { ...STOPPING };
    delete older.halting;
    expect(parseSnapshot(older)?.halting).toBe(false);
    const oldGuard: Record<string, unknown> = { ...GUARDED };
    delete oldGuard.guarding;
    expect(parseSnapshot(oldGuard)?.guarding).toBe(false);
    // Headed somewhere, or docked, is never braking to a stop, nor handed back.
    expect(parseSnapshot({ ...HEADED, halting: true })?.halting).toBe(false);
    expect(parseSnapshot({ ...HEADED, guarding: true })?.guarding).toBe(false);
    // Written before a journey's hold was kept: nothing to wait for.
    const before = { id: 'project/fishai', docked: false, angle: 0, spin: 1 };
    expect(parseSnapshot({ ...HEADED, dock: before })?.dock?.holdSec).toBe(0);
    // A key that was dropped on the way is the same as no dock.
    expect(parseSnapshot({ steps: 1, ship: FLYING.ship, galaxy: HERE })).toEqual({
      ...FLYING,
      steps: 1,
    });
    // Written before snapshots said which galaxy they were taken in: they still say nothing.
    expect(parseSnapshot(unstamped(DOCKED))).not.toHaveProperty('galaxy');
    expect(parseSnapshot(unstamped(DOCKED))).toEqual({ ...DOCKED, galaxy: undefined });
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
      { ...HEADED, dock: { ...HEADED.dock, holdSec: -1 } },
      { ...HEADED, dock: { ...HEADED.dock, holdSec: 3600 } },
      { ...HEADED, dock: { ...HEADED.dock, holdSec: '1' } },
      { ...HEADED, dock: { ...HEADED.dock, holdSec: null } },
      { ...FLYING, halting: 'yes' },
      { ...FLYING, halting: null },
      { ...FLYING, guarding: 1 },
      { ...FLYING, guarding: null },
      // Stopped AND taken back by the controls: no engine writes that.
      { ...FLYING, halting: true, guarding: true },
      { ...FLYING, galaxy: 7 },
      { ...FLYING, galaxy: null },
      { ...DOCKED, galaxy: { key: HERE } },
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
    expect(startingFrom(undefined, HERE)).toEqual({ snapshot: null, at: null });
    expect(startingFrom({}, HERE)).toEqual({ snapshot: null, at: null });
    expect(startingFrom({ snapshot: 'rubbish' }, HERE)).toEqual({ snapshot: null, at: null });
  });

  it('is in orbit round the body whose page is open', () => {
    expect(startingFrom({ at: 'page/about' }, HERE)).toEqual({ snapshot: null, at: 'page/about' });
    expect(startingFrom({ at: 'page/about', snapshot: 'rubbish' }, HERE).at).toBe('page/about');
  });

  it('carries on from a remembered snapshot: a reload in open sky, or on the same orbit', () => {
    expect(startingFrom({ snapshot: stored(FLYING) }, HERE)).toEqual({
      snapshot: FLYING,
      at: null,
    });
    expect(startingFrom({ snapshot: stored(STOPPING) }, HERE)).toEqual({
      snapshot: STOPPING,
      at: null,
    });
    expect(startingFrom({ at: 'project/fishai', snapshot: stored(DOCKED) }, HERE)).toEqual({
      snapshot: DOCKED,
      at: 'project/fishai',
    });
  });

  it('believes the URL, not the snapshot, about where the ship is docked', () => {
    // Another page was opened by a full page load: same world, same clock, another orbit.
    const moved = startingFrom({ at: 'page/resume', snapshot: stored(DOCKED) }, HERE);
    expect(moved.at).toBe('page/resume');
    expect(moved.snapshot).toEqual({ ...DOCKED, dock: null });
    // The home page is open sky, whatever the ship was doing when it was last seen.
    const home = startingFrom({ snapshot: stored(DOCKED) }, HERE);
    expect(home).toEqual({ snapshot: { ...DOCKED, dock: null }, at: null });
  });

  it('brakes a journey it does not take up: a page load on the way somewhere is a STOP', () => {
    // A planet pointed at flies with the URL on the sky: a reload there, or the router's full
    // page load after a deploy, must not hand the ship back at the autopilot's speed.
    expect(startingFrom({ snapshot: stored(HEADED) }, HERE)).toEqual({
      snapshot: { ...HEADED, dock: null, halting: true, guarding: false },
      at: null,
    });
    // Another body's page: put in orbit there (main.ts), which ends the braking at once.
    expect(startingFrom({ at: 'page/resume', snapshot: stored(HEADED) }, HERE).snapshot).toEqual({
      ...HEADED,
      dock: null,
      halting: true,
    });
    // Its own page keeps the dock: main.ts puts the ship in orbit there, so nothing is left to
    // brake. A settled orbit let go of is not braked either.
    expect(startingFrom({ at: 'project/fishai', snapshot: stored(HEADED) }, HERE).snapshot).toEqual(
      HEADED,
    );
    expect(startingFrom({ snapshot: stored(DOCKED) }, HERE).snapshot?.halting).toBe(false);
  });

  it('brakes an orbit still settling, as a key or a link would', () => {
    // Half a second into an orbit the springs still carry the ship round at speed (sim/docking.ts,
    // onJourney): let go of there by a page load, it must not coast into the body's cushion.
    const settling: Snapshot = { ...DOCKED, ship: { ...DOCKED.ship, vx: 40, vz: -22 } };
    expect(startingFrom({ snapshot: stored(settling) }, HERE).snapshot?.halting).toBe(true);
    expect(
      startingFrom({ at: 'page/resume', snapshot: stored(settling) }, HERE).snapshot?.halting,
    ).toBe(true);
    // On its own page the orbit is kept, settling and all.
    expect(
      startingFrom({ at: 'project/fishai', snapshot: stored(settling) }, HERE).snapshot,
    ).toEqual(settling);
  });

  it('forgets a snapshot taken in another galaxy: a deploy moved things while the tab was open', () => {
    // Wherever the ship was, and whatever it was doing, that was in THE OTHER galaxy: here it
    // could be inside a planet, or docked on a ring that has gone elsewhere.
    for (const saved of [FLYING, STOPPING, GUARDED, DOCKED, HEADED]) {
      const before = stored({ ...saved, galaxy: ELSEWHERE });
      expect(startingFrom({ snapshot: before }, HERE)).toEqual({ snapshot: null, at: null });
      // A page opened on a body starts in orbit there, as if nothing were remembered: even the
      // body the snapshot was docked at.
      for (const at of ['page/resume', 'project/fishai']) {
        expect(startingFrom({ at, snapshot: before }, HERE)).toEqual({ snapshot: null, at });
      }
    }
  });

  it('forgets a snapshot from before galaxies were told apart: that was an older galaxy', () => {
    // Written by an engine from before stamps existed, and so from before the galaxy first moved
    // (the slots made room for a binary star, 2026-09-30): every engine since stamps what it
    // writes. Its ship is where it was in THAT galaxy, as surely as one stamped ELSEWHERE.
    for (const saved of [FLYING, STOPPING, GUARDED, DOCKED, HEADED]) {
      const before = unstamped(saved);
      // It still reads as a snapshot (parseSnapshot): it is only not believed here.
      expect(parseSnapshot(before)).not.toBeNull();
      expect(startingFrom({ snapshot: before }, HERE)).toEqual({ snapshot: null, at: null });
      for (const at of ['page/resume', 'project/fishai']) {
        expect(startingFrom({ at, snapshot: before }, HERE)).toEqual({ snapshot: null, at });
      }
    }
    // While one stamped with this galaxy is believed, as ever.
    expect(startingFrom({ snapshot: stored(FLYING) }, HERE).snapshot).toEqual(FLYING);
  });
});
