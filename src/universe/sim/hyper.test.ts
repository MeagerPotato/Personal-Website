import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { createCruiseState, type CruiseState } from './autopilot';
import {
  HYPER_NONE,
  HYPER_OFFERED,
  HYPER_SPENT,
  HYPER_TUNNEL,
  HYPER_WINDUP,
  createDockState,
  type DockState,
  type Hyper,
} from './docking';
import { cancelHyper, engageHyper, fastAhead, resumeHyper, stepHyper, type Ahead } from './hyper';

const STEP = 1 / 60;
const P = tuning.hyper;
/** u between the samples of a made-up plan. */
const SPACING = 10;

/** A plan with these speeds (u/s) at samples SPACING apart, the ship on the piece from `index`. */
function plan(speeds: readonly number[], index = 0): CruiseState {
  const cruise = createCruiseState(0);
  cruise.fresh = false;
  cruise.index = index;
  cruise.path.count = speeds.length;
  speeds.forEach((v, k) => {
    cruise.speeds[k] = v;
    cruise.path.s[k] = k * SPACING;
  });
  return cruise;
}

/** A plan that is `speed` fast for `seconds` from where the ship is, and then slow to its end. */
function fastFor(seconds: number, speed = 500): CruiseState {
  const pieces = Math.round((seconds * speed) / SPACING);
  return plan([...Array<number>(pieces + 1).fill(speed), 100, 50, 20]);
}

const SLOW = plan([150, 180, 150, 100, 40]);
const read = (cruise: CruiseState, floor = P.dropSpeed): Ahead =>
  fastAhead(cruise, floor, { peak: -1, fastSec: -1 });

/** A dock on a journey flown by the autopilot, in the state `hyper`. */
function journey(hyper: Hyper = HYPER_NONE, hyperSec = 0): DockState {
  const dock = createDockState();
  dock.phase = 'cruise';
  dock.body = 3;
  dock.hyper = hyper;
  dock.hyperSec = hyperSec;
  return dock;
}

describe('fastAhead: what the plan still holds', () => {
  it('finds nothing where there is no plan, or one sample of one', () => {
    expect(read(plan([]))).toEqual({ peak: 0, fastSec: 0 });
    expect(read(plan([700]))).toEqual({ peak: 0, fastSec: 0 });
  });

  it('does not read the last journey’s plan: a fresh cruise has nothing ahead', () => {
    const cruise = fastFor(2);
    cruise.fresh = true;
    expect(read(cruise)).toEqual({ peak: 0, fastSec: 0 });
  });

  it('times a plan that is fast all the way to its last sample', () => {
    // 50 pieces of 10 u at 500 u/s: one second.
    const ahead = read(plan(Array<number>(51).fill(500)));
    expect(ahead.peak).toBe(500);
    expect(ahead.fastSec).toBeCloseTo(1, 9);
  });

  it('times each piece at the mean of the speeds at its ends', () => {
    // 10 u from 300 to 500 u/s (400 on average), then 10 u from 500 down to 100 (not fast).
    const ahead = read(plan([300, 500, 100]));
    expect(ahead.peak).toBe(500);
    expect(ahead.fastSec).toBeCloseTo(10 / 400, 12);
  });

  it('counts through a slow bend to the last fast sample beyond it', () => {
    const ahead = read(plan([500, 500, 100, 100, 500, 500, 100]));
    // 10 u at 500, 10 at 300, 10 at 100, 10 at 300, 10 at 500: the dip is part of the stretch.
    expect(ahead.fastSec).toBeCloseTo(10 / 500 + 10 / 300 + 10 / 100 + 10 / 300 + 10 / 500, 12);
  });

  it('reads from the piece the ship is on, and only what is ahead', () => {
    const speeds = [700, 650, 350, 320, 100, 60];
    expect(read(plan(speeds, 0)).peak).toBe(700);
    const later = read(plan(speeds, 2));
    expect(later.peak).toBe(350);
    expect(later.fastSec).toBeCloseTo(10 / 335, 12);
    // Past the fast stretch: nothing is left of it.
    expect(read(plan(speeds, 4))).toEqual({ peak: 100, fastSec: 0 });
    // A sample that is fast where the ship already is counts for no time.
    expect(read(plan(speeds, 3)).fastSec).toBe(0);
    // An index from before the path is its start.
    expect(read(plan(speeds, -1))).toEqual(read(plan(speeds, 0)));
  });

  it('holds the floor it is asked for, and never divides by nothing', () => {
    expect(read(plan([300, 300, 300]), 300).fastSec).toBeCloseTo(20 / 300, 12);
    expect(read(plan([299, 299, 299]), 300).fastSec).toBe(0);
    const still = read(plan([0, 0, 0]), 0);
    expect(Number.isFinite(still.fastSec)).toBe(true);
  });
});

describe('stepHyper: one offer and one jump a journey', () => {
  it('offers once the plan pays, and not before', () => {
    const dock = journey();
    stepHyper(dock, SLOW, 0, P, STEP);
    expect(dock.hyper).toBe(HYPER_NONE);
    // Fast enough, but not for a wind-up and a tunnel.
    stepHyper(dock, fastFor(P.windupSec + P.minTunnelSec - 0.1), 0, P, STEP);
    expect(dock.hyper).toBe(HYPER_NONE);
    // Long enough, but never as fast as an offer asks.
    stepHyper(dock, fastFor(2, P.minPlannedSpeed - 1), 0, P, STEP);
    expect(dock.hyper).toBe(HYPER_NONE);
    expect(dock.hyperSec).toBeCloseTo(3 * STEP, 12);
    // A plan that only pays later (a replan) may still offer.
    stepHyper(dock, fastFor(P.windupSec + P.minTunnelSec + 0.05), 0, P, STEP);
    expect(dock.hyper).toBe(HYPER_OFFERED);
    expect(dock.hyperSec).toBe(0);
  });

  it('withdraws an offer that no longer pays, for good', () => {
    const dock = journey(HYPER_OFFERED);
    stepHyper(dock, fastFor(2), 100, P, STEP);
    expect(dock.hyper).toBe(HYPER_OFFERED);
    expect(dock.hyperSec).toBeCloseTo(STEP, 12);
    stepHyper(dock, fastFor(0.5), 500, P, STEP);
    expect(dock.hyper).toBe(HYPER_SPENT);
    expect(dock.hyperSec).toBe(0);
    // THE LATCH: the plan pays again (a replan found a longer way), and nothing is offered.
    for (let k = 0; k < 30; k += 1) stepHyper(dock, fastFor(3), 500, P, STEP);
    expect(dock.hyper).toBe(HYPER_SPENT);
    // Nor is its clock run: spent is spent.
    expect(dock.hyperSec).toBe(0);
    // And a press finds nothing to take.
    expect(engageHyper(dock)).toBe(false);
  });

  it('opens the tunnel after the wind-up, once the ship is fast', () => {
    const dock = journey(HYPER_OFFERED);
    expect(engageHyper(dock)).toBe(true);
    expect(dock.hyper).toBe(HYPER_WINDUP);
    const cruise = fastFor(3);
    // 0.35 s is 21 steps: fast already, it still waits for them.
    for (let k = 0; k < 20; k += 1) stepHyper(dock, cruise, 600, P, STEP);
    expect(dock.hyper).toBe(HYPER_WINDUP);
    stepHyper(dock, cruise, 600, P, STEP);
    expect(dock.hyper).toBe(HYPER_TUNNEL);
    expect(dock.hyperSec).toBe(0);
  });

  it('waits in the wind-up for a ship that is still slow', () => {
    const dock = journey(HYPER_WINDUP);
    const cruise = fastFor(3);
    for (let k = 0; k < 60; k += 1) stepHyper(dock, cruise, P.punchSpeed - 1, P, STEP);
    expect(dock.hyper).toBe(HYPER_WINDUP);
    expect(dock.hyperSec).toBeCloseTo(1, 9);
    stepHyper(dock, cruise, P.punchSpeed, P, STEP);
    expect(dock.hyper).toBe(HYPER_TUNNEL);
  });

  it('gives the jump up when the fast stretch ends before the tunnel opened', () => {
    const dock = journey(HYPER_WINDUP, 0.1);
    stepHyper(dock, SLOW, 150, P, STEP);
    expect(dock.hyper).toBe(HYPER_SPENT);
    expect(dock.hyperSec).toBe(0);
  });

  it('opens no stub of a tunnel for a press that came too late', () => {
    // Ready to punch, with less than 0.8 of the least tunnel left of the fast stretch.
    const late = journey(HYPER_WINDUP, P.windupSec);
    stepHyper(late, fastFor(0.8 * P.minTunnelSec - 0.05), 500, P, STEP);
    expect(late.hyper).toBe(HYPER_SPENT);
    // With that much left, it opens.
    const inTime = journey(HYPER_WINDUP, P.windupSec);
    stepHyper(inTime, fastFor(0.8 * P.minTunnelSec + 0.05), 500, P, STEP);
    expect(inTime.hyper).toBe(HYPER_TUNNEL);
  });

  it('stays in the tunnel through a slow bend, and drops out when no fast stretch is ahead', () => {
    const dock = journey(HYPER_TUNNEL, 0.4);
    const bend = plan([500, 400, 120, 90, 120, 450, 600, 600, 100]);
    // The ship is in the bend, slow, and the plan beyond it is fast again.
    bend.index = 3;
    stepHyper(dock, bend, 90, P, STEP);
    expect(dock.hyper).toBe(HYPER_TUNNEL);
    expect(dock.hyperSec).toBeCloseTo(0.4 + STEP, 12);
    // Past the last fast sample: the drop-out.
    bend.index = 7;
    stepHyper(dock, bend, 600, P, STEP);
    expect(dock.hyper).toBe(HYPER_SPENT);
    expect(dock.hyperSec).toBe(0);
  });

  it('takes a press only on an offer, and takes a wind-up back only before the tunnel', () => {
    for (const state of [HYPER_NONE, HYPER_WINDUP, HYPER_TUNNEL, HYPER_SPENT] as const) {
      const dock = journey(state, 0.2);
      expect(engageHyper(dock), `engage in ${state}`).toBe(false);
      expect(dock.hyper).toBe(state);
      expect(dock.hyperSec).toBe(0.2);
    }
    for (const state of [HYPER_NONE, HYPER_OFFERED, HYPER_TUNNEL, HYPER_SPENT] as const) {
      const dock = journey(state, 0.2);
      expect(cancelHyper(dock), `cancel in ${state}`).toBe(false);
      expect(dock.hyper).toBe(state);
      expect(dock.hyperSec).toBe(0.2);
    }
    // A chord in the wind-up (Shift+Tab): the offer stands again, and can be taken again.
    const dock = journey(HYPER_OFFERED, 0.6);
    expect(engageHyper(dock)).toBe(true);
    expect(dock.hyperSec).toBe(0);
    dock.hyperSec = 0.2;
    expect(cancelHyper(dock)).toBe(true);
    expect(dock.hyper).toBe(HYPER_OFFERED);
    expect(dock.hyperSec).toBe(0);
    expect(engageHyper(dock)).toBe(true);
  });

  it('takes a tunnel up again only on a journey the autopilot flies, past its punch', () => {
    for (const phase of ['free', 'approach', 'docked'] as const) {
      const dock = createDockState();
      dock.phase = phase;
      resumeHyper(dock);
      expect(dock.hyper, phase).toBe(HYPER_NONE);
      expect(dock.hyperSec).toBe(0);
    }
    const dock = journey();
    resumeHyper(dock);
    expect(dock.hyper).toBe(HYPER_TUNNEL);
    expect(dock.hyperSec).toBeGreaterThanOrEqual(0.5);
    // The first step holds it to the plan that step made: a fast stretch ahead keeps it...
    stepHyper(dock, fastFor(1), 500, P, STEP);
    expect(dock.hyper).toBe(HYPER_TUNNEL);
    // ...and a plan with none ends it there and then.
    const over = journey();
    resumeHyper(over);
    stepHyper(over, SLOW, 150, P, STEP);
    expect(over.hyper).toBe(HYPER_SPENT);
  });

  it('reads the plan and the speed, and writes the dock’s two fields: nothing else', () => {
    const dock = journey(HYPER_WINDUP, P.windupSec);
    const before = { ...dock, hyper: HYPER_TUNNEL, hyperSec: 0 };
    const cruise = fastFor(2);
    const speeds = [...cruise.speeds];
    const s = [...cruise.path.s];
    const { index, etaSec, replanIn, elapsedSec } = cruise;
    stepHyper(dock, cruise, 500, P, STEP);
    expect(dock).toEqual(before);
    expect([...cruise.speeds]).toEqual(speeds);
    expect([...cruise.path.s]).toEqual(s);
    expect(cruise).toMatchObject({ index, etaSec, replanIn, elapsedSec, fresh: false });
  });
});
