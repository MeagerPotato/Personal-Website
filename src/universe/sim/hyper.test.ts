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
import {
  LOOK_DROPOUT,
  LOOK_OFF,
  LOOK_TUNNEL,
  LOOK_WINDUP,
  cancelHyper,
  copyHyperLook,
  createHyperLook,
  engageHyper,
  fastAhead,
  hyperLook,
  resumeHyper,
  starCalm,
  stepHyper,
  type Ahead,
  type HyperLook,
  type LookStage,
} from './hyper';

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

describe('hyperLook: what a jump looks like at one moment', () => {
  const TOP = tuning.cruise.far.cruiseSpeed;
  const PARTS = ['stretch', 'dots', 'veil', 'calm', 'surge'] as const;
  const NOTHING = createHyperLook();

  /** The look `seconds` into `stage`, at `speed`; on the way out, from `level`. */
  const lookAt = (
    stage: LookStage,
    seconds: number,
    speed = TOP,
    level: Readonly<HyperLook> = NOTHING,
    fromTunnel = false,
  ): HyperLook =>
    hyperLook({ stage, seconds, speed, topSpeed: TOP, level, fromTunnel }, P, createHyperLook());

  it('shows nothing when nothing is on, whatever the ship does', () => {
    for (const speed of [0, 150, 700]) {
      expect(lookAt(LOOK_OFF, 3, speed)).toEqual(NOTHING);
    }
    // Nor when the way out has had its time, to the step.
    const full = lookAt(LOOK_TUNNEL, 2);
    expect(lookAt(LOOK_DROPOUT, P.dropoutSec, TOP, full, true)).toEqual(NOTHING);
    expect(lookAt(LOOK_DROPOUT, P.dropoutSec + 5, TOP, full, true)).toEqual(NOTHING);
  });

  it('keeps every part between 0 and 1, and a ring between 0 and 1 or away', () => {
    const full = lookAt(LOOK_TUNNEL, 2);
    for (const stage of [LOOK_OFF, LOOK_WINDUP, LOOK_TUNNEL, LOOK_DROPOUT] as const) {
      for (let k = -2; k <= 400; k += 1) {
        for (const speed of [0, 60, 199, 200, 350, 700, 3000]) {
          const look = lookAt(stage, k / 100, speed, full, k % 2 === 0);
          for (const part of PARTS) {
            expect(look[part], `${stage} ${k} ${speed} ${part}`).toBeGreaterThanOrEqual(0);
            expect(look[part], `${stage} ${k} ${speed} ${part}`).toBeLessThanOrEqual(1);
          }
          for (const ring of [look.punch, look.drop]) {
            expect(ring === -1 || (ring >= 0 && ring <= 1), `${stage} ${k} ${speed}`).toBe(true);
          }
        }
      }
    }
  });

  it('winds up from nothing: dots over the stars, then pulled out, the sky dimmer round one spot', () => {
    expect(lookAt(LOOK_WINDUP, 0, 100)).toEqual(NOTHING);
    // The dots come first, as points; no ring, no tunnel to speak of.
    const early = lookAt(LOOK_WINDUP, 0.1, 100);
    expect(early.dots).toBeGreaterThan(0);
    expect(early.stretch).toBeLessThan(0.05);
    const wound = lookAt(LOOK_WINDUP, P.windupSec, P.punchSpeed);
    expect(wound).toEqual({
      stretch: 0.35,
      dots: 1,
      veil: 0.15,
      calm: 0.3,
      surge: 0.3,
      punch: -1,
      drop: -1,
    });
    // It holds there until the ship is fast enough to punch (a press from rest)...
    expect(lookAt(LOOK_WINDUP, 2, P.punchSpeed)).toEqual(wound);
    // ...with the dashes shorter while it is still slow, and never gone.
    expect(lookAt(LOOK_WINDUP, 2, 20).stretch).toBeCloseTo(0.35 * 0.25, 12);
  });

  it('opens the tunnel from what the wind-up built: nothing but the dashes and the lens jumps', () => {
    const wound = lookAt(LOOK_WINDUP, P.windupSec, P.punchSpeed);
    const punched = lookAt(LOOK_TUNNEL, 0, P.punchSpeed);
    for (const part of ['dots', 'veil', 'calm'] as const) {
      expect(punched[part], part).toBeCloseTo(wound[part], 12);
    }
    // The punch's own step: the lens is asked for all of it at once, and eases there.
    expect(punched.surge).toBe(1);
    expect(punched.punch).toBe(0);
    // A tenth of a second on, the dashes are at their length for that speed, and at the top
    // speed that is all of it; the tube is open after 0.22 s; the ring is gone after 0.35.
    expect(lookAt(LOOK_TUNNEL, 0.1, TOP).stretch).toBeCloseTo(1, 12);
    expect(lookAt(LOOK_TUNNEL, 0.1, P.punchSpeed).stretch).toBeCloseTo(
      0.45 + (0.55 * P.punchSpeed) / TOP,
      12,
    );
    expect(lookAt(LOOK_TUNNEL, 0.22, TOP).veil).toBeCloseTo(1, 12);
    expect(lookAt(LOOK_TUNNEL, 0.12, TOP).calm).toBeCloseTo(1, 12);
    expect(lookAt(LOOK_TUNNEL, 0.35, TOP).punch).toBeCloseTo(1, 12);
    expect(lookAt(LOOK_TUNNEL, 0.36, TOP).punch).toBe(-1);
  });

  it('takes up a tunnel a second in with no punch: the engine was rebuilt inside it', () => {
    const dock = journey();
    resumeHyper(dock);
    const resumed = lookAt(LOOK_TUNNEL, dock.hyperSec);
    expect(resumed).toEqual({
      stretch: 1,
      dots: 1,
      veil: 1,
      calm: 1,
      surge: 1,
      punch: -1,
      drop: -1,
    });
  });

  it('thins out in a slow bend and comes back, with no step', () => {
    expect(lookAt(LOOK_TUNNEL, 1, P.punchSpeed).dots).toBe(1);
    expect(lookAt(LOOK_TUNNEL, 1, 0.4 * P.punchSpeed)).toMatchObject({
      stretch: 0,
      dots: 0,
      veil: 0,
      calm: 0,
      surge: 0,
    });
    const half = lookAt(LOOK_TUNNEL, 1, 0.7 * P.punchSpeed);
    expect(half.dots).toBeCloseTo(0.5, 12);
    expect(half.veil).toBeCloseTo(0.5, 12);
  });

  it('never steps, but at the punch: a frame later every part is a little further, no more', () => {
    // The whole of a jump at the frame rate of a slow phone, the ship speeding up, cruising and
    // slowing as the autopilot does (700 u/s in a second, 600 u/s² down).
    const dt = 1 / 30;
    const speedAt = (t: number): number => Math.max(0, Math.min(700 * t, 700, 700 - 600 * (t - 2)));
    const level = createHyperLook();
    let last = createHyperLook();
    let lastStage: LookStage = LOOK_OFF;
    let left = 0;
    let steepest = 0;
    for (let t = 0; t < 4; t += dt) {
      const speed = speedAt(t);
      // Pressed at 0.2 s; the tunnel from 0.55 s until the ship is slow again; then the way out.
      const stage: LookStage =
        t < 0.2 ? LOOK_OFF : t < 0.55 ? LOOK_WINDUP : speed >= 300 ? LOOK_TUNNEL : LOOK_DROPOUT;
      if (stage === LOOK_DROPOUT && lastStage === LOOK_TUNNEL) left = t - dt;
      const seconds = stage === LOOK_WINDUP ? t - 0.2 : stage === LOOK_TUNNEL ? t - 0.55 : t - left;
      const look = hyperLook(
        { stage, seconds, speed, topSpeed: TOP, level, fromTunnel: true },
        P,
        createHyperLook(),
      );
      if (stage === LOOK_WINDUP || stage === LOOK_TUNNEL) copyHyperLook(look, level);
      const punch = stage === LOOK_TUNNEL && lastStage === LOOK_WINDUP;
      for (const part of ['stretch', 'dots', 'veil', 'calm'] as const) {
        const jump = Math.abs(look[part] - last[part]);
        // The dashes shoot out in a tenth of a second from the punch: that is the punch.
        if (!(part === 'stretch' && t >= 0.55 && t < 0.7)) steepest = Math.max(steepest, jump);
        if (!punch) expect(jump, `${part} at ${t.toFixed(2)} s`).toBeLessThan(0.45);
      }
      last = look;
      lastStage = stage;
    }
    // At 30 frames a second, the quickest part (the real stars, down in 0.12 s) moves by a
    // quarter of its way in a frame, the tube by a third, as it opens in its 0.22 s.
    expect(steepest).toBeLessThan(0.45);
    expect(last).toEqual(NOTHING);
  });

  it('goes the same way out from anywhere: gone by dropoutSec, a ring only after the tunnel', () => {
    const full = lookAt(LOOK_TUNNEL, 2);
    const out = (seconds: number, fromTunnel = true, level = full): HyperLook =>
      lookAt(LOOK_DROPOUT, seconds, 250, level, fromTunnel);
    // It begins exactly where the tunnel was, the lens let go of at once (it eases back)...
    expect(out(0)).toEqual({ ...full, surge: 0, punch: -1, drop: 0 });
    // ...the dashes are points before the dots go, so that what is left is stars...
    const late = out(P.dropoutSec * 0.72);
    expect(late.stretch).toBe(0);
    expect(late.dots).toBeGreaterThan(0.7);
    // ...and every part only ever falls.
    let last = out(0);
    for (let k = 1; k <= 35; k += 1) {
      const look = out((k / 35) * P.dropoutSec);
      for (const part of PARTS) expect(look[part], `${part} ${k}`).toBeLessThanOrEqual(last[part]);
      last = look;
    }
    expect(last).toEqual(NOTHING);
    // The ring closes onto the destination while the tube goes, and only after a tunnel.
    expect(out(P.dropoutSec * 0.5).drop).toBeCloseTo(0.5 / (6 / 7), 12);
    expect(out(P.dropoutSec * 0.9).drop).toBe(-1);
    const wound = lookAt(LOOK_WINDUP, P.windupSec, P.punchSpeed);
    const taken = out(0.1, false, wound);
    expect(taken.drop).toBe(-1);
    expect(taken.stretch).toBeLessThan(wound.stretch);
    expect(taken.dots).toBe(1);
  });
});

describe('starCalm: the stars under the map and a jump at once', () => {
  const MAP = tuning.map.starOpacity;
  const JUMP = P.starOpacity;
  const calm = (map: number, hyper: number): { calm: number; opacity: number } =>
    starCalm(map, MAP, hyper, JUMP, { calm: -1, opacity: -1 });
  /** What world/Starfield.ts makes of it: its uOpacity. */
  const shown = ({ calm: c, opacity }: { calm: number; opacity: number }): number =>
    1 + (opacity - 1) * c;

  it('is the call the map alone always made while there is no jump', () => {
    for (const map of [0, 0.25, 0.5, 1]) {
      expect(calm(map, 0)).toEqual({ calm: map, opacity: MAP });
    }
  });

  it('shows the stars at exactly the product of the two dimmers', () => {
    for (const map of [0, 0.3, 1]) {
      for (const hyper of [0.1, 0.3, 0.7, 1]) {
        const expected = (1 + (MAP - 1) * map) * (1 + (JUMP - 1) * hyper);
        expect(shown(calm(map, hyper)), `${map} ${hyper}`).toBeCloseTo(expected, 12);
        // The sky's slow drift stops with whichever is calmer.
        expect(calm(map, hyper).calm).toBe(Math.max(map, hyper));
      }
    }
    // The tunnel alone: down to its own share, 15 % of the stars.
    expect(shown(calm(0, 1))).toBeCloseTo(JUMP, 12);
  });
});
