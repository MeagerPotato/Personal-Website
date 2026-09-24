import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { pullOf } from './assist';
import { dockAt, guardDock, guardInput, haltDock, releaseDock, requestDock } from './docking';
import { NO_INPUT, createShipState, speedOf } from './flight';
import { createRng } from './rng';
import {
  createSurroundings,
  flyStep,
  syncSurroundings,
  type Surroundings,
  type SurroundingsInput,
} from './surroundings';
import type { FlightInput, ShipState } from './types';

// TAKING THE CONTROLS BACK in the middle of a journey, with a touch of the controls instead of the
// prompt's Stop: a tap of the brake, an arrow or the throttle. The autopilot's speed goes at once
// (dropOutOfWarp), but the pilot's own top speed, 81 u/s, is still more than a cushion stops, and
// the end of a journey is among the target's moons. So the brake is taken as Stop (it brakes to
// rest), and a turn or the throttle keeps the reflex on until the ship is slow (sim/docking.ts,
// guardInput). Measured before that: 59 of 17,160 such taps met a shell, at up to 53 u/s.

const STEP = 1 / 60;

/**
 * THE LIVE GALAXY of 2026-09-23, as the simulation saw it (the real /universe.json, read from
 * src/content by scripts/journeys/galaxies.ts): the home system, and the code system with FishAI,
 * its two moons and Days2Meet. Frozen here, so that content edits do not move the reproductions.
 */
const LIVE: SurroundingsInput = {
  home: [0, 0],
  systems: [
    { id: 'home', position: [0, 0], radius: 66.2 },
    { id: 'code', position: [-431.34, 431.34], radius: 202.6 },
  ],
  bodies: [
    { id: 'page/about', system: 'home', parent: null, orbit: null, radius: 14, dockRadius: 26.6 },
    {
      id: 'page/resume',
      system: 'home',
      parent: 'page/about',
      orbit: { radius: 38.8, phase: 3.3143, periodSec: 124.8 },
      radius: 2.2,
      dockRadius: 8.2,
    },
    {
      id: 'page/contact',
      system: 'home',
      parent: 'page/about',
      orbit: { radius: 58.6, phase: 3.18, periodSec: 231.6 },
      radius: 1.6,
      dockRadius: 7.6,
    },
    { id: 'system/code', system: 'code', parent: null, orbit: null, radius: 20, dockRadius: 38 },
    {
      id: 'project/days2meet',
      system: 'code',
      parent: 'system/code',
      orbit: { radius: 60.2, phase: 1.6094, periodSec: 241.2 },
      radius: 8,
      dockRadius: 15.2,
    },
    {
      id: 'project/fishai',
      system: 'code',
      parent: 'system/code',
      orbit: { radius: 143, phase: 5.5, periodSec: 883.1 },
      radius: 12,
      dockRadius: 22.8,
    },
    {
      id: 'project/canadian-fish-demo',
      system: 'code',
      parent: 'project/fishai',
      orbit: { radius: 34, phase: 2.9899, periodSec: 102.4 },
      radius: 1.2,
      dockRadius: 7.2,
    },
    {
      id: 'project/fish-onboarding',
      system: 'code',
      parent: 'project/fishai',
      orbit: { radius: 52.4, phase: 2.0076, periodSec: 195.9 },
      radius: 1.2,
      dockRadius: 7.2,
    },
  ],
};

interface Run {
  world: Surroundings;
  state: ShipState;
  flown: FlightInput;
  /** Simulation steps so far: the engine's clock. */
  steps: number;
}

function step(run: Run, pilot: Readonly<FlightInput> = NO_INPUT): void {
  run.steps += 1;
  flyStep(run.world, run.state, pilot, tuning.flight, tuning, STEP, run.steps * STEP, run.flown);
}

/**
 * As a visitor on a page is when they point at another body: docked at `from` (a page opened on
 * it at step `startSteps`), carried round for half a second, then sent to `to` the way
 * Navigator.travel sends it (the approach within reach, else the autopilot), no quicker than a
 * journey.
 */
function setOut(from: string, to: string, startSteps: number, angle: number, spin: number): Run {
  const world = createSurroundings(LIVE, tuning.edge.margin);
  const run: Run = { world, state: createShipState(), flown: { ...NO_INPUT }, steps: startSteps };
  syncSurroundings(world, startSteps * STEP);
  const { field, orbits } = world;
  dockAt(field, run.state, tuning.dock, world.dock, orbits.indexOf(from), angle, spin);
  for (let k = 0; k < 30; k += 1) step(run);
  const i = orbits.indexOf(to);
  const within = pullOf(field, i, run.state.x, run.state.z, tuning.assist) > 0;
  releaseDock(world.dock, world.assist);
  requestDock(world.dock, i, NO_INPUT, !within, tuning.cruise.minJourneySec);
  return run;
}

interface Watched {
  /** Steps in which a shell stopped the ship. */
  touches: number;
  /** Least gap to any body's surface over the whole of every step (in its own frame), u. */
  gap: number;
  /** The furthest from where the watch began, u. */
  slide: number;
}

/** Hands off for `seconds`, watching the whole of every step against every body. */
function watch(run: Run, seconds: number): Watched {
  const { world, state } = run;
  const { positions, radius, count } = world.field;
  const before = new Float64Array(count * 2);
  const seen: Watched = { touches: 0, gap: Infinity, slide: 0 };
  const x0 = state.x;
  const z0 = state.z;
  for (let k = Math.round(seconds / STEP); k > 0; k -= 1) {
    before.set(positions);
    const fromX = state.x;
    const fromZ = state.z;
    step(run);
    if (world.touched >= 0) seen.touches += 1;
    seen.slide = Math.max(seen.slide, Math.hypot(state.x - x0, state.z - z0));
    for (let j = 0; j < count; j += 1) {
      const ax = fromX - (before[j * 2] ?? 0);
      const az = fromZ - (before[j * 2 + 1] ?? 0);
      const dx = state.x - (positions[j * 2] ?? 0) - ax;
      const dz = state.z - (positions[j * 2 + 1] ?? 0) - az;
      const span = dx * dx + dz * dz;
      const t = span < 1e-12 ? 0 : Math.min(1, Math.max(0, -(ax * dx + az * dz) / span));
      seen.gap = Math.min(seen.gap, Math.hypot(ax + dx * t, az + dz * t) - (radius[j] ?? 0));
    }
  }
  return seen;
}

/** Hold `input` for `steps` steps, the way a quick tap of a key does. */
function tap(run: Run, input: Readonly<FlightInput>, steps: number): void {
  for (let k = 0; k < steps; k += 1) step(run, input);
}

const BRAKE: FlightInput = { thrust: 0, turn: 0, brake: 1, boost: false };
const LEFT: FlightInput = { thrust: 0, turn: -1, brake: 0, boost: false };
const RIGHT: FlightInput = { thrust: 0, turn: 1, brake: 0, boost: false };
const THRUST: FlightInput = { thrust: 1, turn: 0, brake: 0, boost: false };

describe('taking the controls back mid-journey', () => {
  it('brakes to rest after a tap of the brake, as Stop does (a reproduction in the live galaxy)', () => {
    // Resume -> Canadian Fish Demo, 185 u/s among FishAI's moons: the brake held for 133 ms and
    // let go. It used to hand the ship back coasting: into FishAI's shell at 44.9 u/s.
    const run = setOut('page/resume', 'project/canadian-fish-demo', 11090, 5.760168687934057, -1);
    for (let k = 0; k < 123; k += 1) step(run);
    expect(run.world.dock.phase).toBe('cruise');
    expect(speedOf(run.state)).toBeGreaterThan(150);
    tap(run, BRAKE, 8);
    expect(run.world.dock.phase).toBe('free');
    expect(run.world.dock.halting).toBe(true);
    const seen = watch(run, 6);
    expect(seen.touches).toBe(0);
    expect(seen.gap).toBeGreaterThan(tuning.cushion.depth * 0.5);
    expect(run.world.dock.halting).toBe(false);
    expect(speedOf(run.state)).toBeLessThan(15);
  });

  it('keeps the reflex on after a tap of an arrow key (a reproduction in the live galaxy)', () => {
    // Resume -> Fish Onboarding, 283 u/s: an arrow for 67 ms. It used to coast on into Canadian
    // Fish Demo's shell at 33.4 u/s.
    const run = setOut('page/resume', 'project/fish-onboarding', 9920, 3.117, 1);
    for (let k = 0; k < 111; k += 1) step(run);
    expect(run.world.dock.phase).toBe('cruise');
    expect(speedOf(run.state)).toBeGreaterThan(250);
    tap(run, LEFT, 4);
    expect(run.world.dock.phase).toBe('free');
    expect(run.world.dock.guarding).toBe(true);
    const seen = watch(run, 8);
    expect(seen.touches).toBe(0);
    expect(seen.gap).toBeGreaterThan(tuning.cushion.depth * 0.5);
    // Slow enough for the cushions by then, and the pilot's own again.
    expect(run.world.dock.guarding).toBe(false);
  });

  it('keeps the reflex on through a second tap of the throttle while the speed is the autopilot’s', () => {
    // FishAI -> About, 211 u/s: W for 50 ms, let go for 33 ms, W again (at 140 u/s), hands off.
    // The second press used to end the guard as the pilot's own "I am flying this now", and the
    // ship coasted on into a shell of the home system (1.0 u from a surface). Its speed was not
    // theirs. (Found by the review's double taps: up to 41 u/s at impact, 1.3% of such taps.)
    const run = setOut('project/fishai', 'page/about', 12679, 4.114, 1);
    for (let k = 0; k < 186; k += 1) step(run);
    expect(run.world.dock.phase).toBe('cruise');
    expect(speedOf(run.state)).toBeGreaterThan(200);
    tap(run, THRUST, 3);
    expect(run.world.dock.guarding).toBe(true);
    tap(run, NO_INPUT, 2);
    tap(run, THRUST, 3);
    expect(run.world.dock.guarding).toBe(true);
    const seen = watch(run, 6);
    expect(seen.touches).toBe(0);
    expect(seen.gap).toBeGreaterThan(tuning.cushion.depth * 0.5);
    expect(run.world.dock.guarding).toBe(false);
  });

  it('meets nothing after a tap at any moment of a journey, whichever control it was', () => {
    // Every 0.1 s of journeys between the two systems, and on each of their last 20 steps: the
    // brake, either arrow, or the throttle, held for 67 ms, and then nobody at the controls.
    const rng = createRng('taps');
    const ids = LIVE.bodies.map((body) => body.id);
    const homes = ids.filter((id) => LIVE.bodies.find((body) => body.id === id)?.system === 'home');
    let flights = 0;
    let fastest = 0;
    let least = Infinity;
    let leastAt = '';
    let slideMost = 0;
    for (let journey = 0; journey < 8; journey += 1) {
      const outward = journey % 2 === 0;
      const pick = (from: readonly string[]): string => from[Math.floor(rng() * from.length)] ?? '';
      const away = ids.filter((id) => !homes.includes(id));
      const from = pick(outward ? homes : away);
      const to = pick(outward ? away : homes);
      const startSteps = Math.floor(rng() * 60 * 1200);
      const angle = rng() * Math.PI * 2;
      const spin = rng() < 0.5 ? 1 : -1;
      // The journey undisturbed: how many steps the autopilot flies it.
      const plain = setOut(from, to, startSteps, angle, spin);
      let cruise = 0;
      while (plain.world.dock.phase === 'cruise' && cruise < 1200) {
        step(plain);
        cruise += 1;
      }
      const moments = new Set<number>();
      for (let k = 6; k < cruise; k += 6) moments.add(k);
      for (let back = 1; back <= 20; back += 1) if (cruise - back > 0) moments.add(cruise - back);
      for (const at of moments) {
        for (const input of [BRAKE, LEFT, RIGHT, THRUST]) {
          const run = setOut(from, to, startSteps, angle, spin);
          for (let k = 0; k < at; k += 1) step(run);
          if (run.world.dock.phase !== 'cruise') continue;
          fastest = Math.max(fastest, speedOf(run.state));
          tap(run, input, 4);
          const seen = watch(run, 6);
          const label = `${from} -> ${to} (${startSteps}), tap after ${at} steps`;
          expect(seen.touches, label).toBe(0);
          slideMost = Math.max(slideMost, seen.slide);
          if (seen.gap < least) {
            least = seen.gap;
            leastAt = label;
          }
          flights += 1;
        }
      }
    }
    // 1,492 taps at up to 573 u/s: none met a shell, none came closer than 2.4 u to a surface
    // (FishAI, a tap 3.5 s into a journey there), and none slid further than 208 u, measured. With
    // the ship handed back coasting, 20 of them met a shell here (and 59 of 17,160 in bigger
    // galaxies, at up to 53 u/s).
    expect(flights).toBeGreaterThan(1000);
    expect(fastest).toBeGreaterThan(0.75 * tuning.cruise.far.cruiseSpeed);
    expect(least, leastAt).toBeGreaterThan(tuning.cushion.depth * 0.5);
    expect(slideMost).toBeLessThan(300);
  });
});

/** The live galaxy at step 0, the ship at the origin at rest. */
function at(): Run {
  const world = createSurroundings(LIVE, tuning.edge.margin);
  const run: Run = { world, state: createShipState(), flown: { ...NO_INPUT }, steps: 0 };
  syncSurroundings(world, 0);
  return run;
}

/** `speed` u/s at `id` from `gap` u above its surface, `off` radians wide of its centre. */
function diving(gap: number, speed = 60, id = 'project/fishai', off = 0): Run {
  const run = at();
  const { field, orbits } = run.world;
  const i = orbits.indexOf(id);
  const d = (field.radius[i] ?? 0) + gap;
  run.state.x = (field.positions[i * 2] ?? 0) - d;
  run.state.z = field.positions[i * 2 + 1] ?? 0;
  run.state.heading = Math.PI / 2 + off;
  run.state.vx = speed * Math.sin(run.state.heading);
  run.state.vz = speed * Math.cos(run.state.heading);
  return run;
}

describe('an approach that begins diving at its own body', () => {
  it('is braked by the reflex for that body too: it meets the shell only from too close to stop', () => {
    // A body asked for just after one beside it (the journey harness's `reachBack`): the approach
    // begins with the ship already closing on the body whose ring it wants. With the reflex
    // leaving that body out, 44 u/s from 8 u above (in a grown galaxy) met its shell at 14 u/s.
    const { flight } = tuning.cruise;
    let dives = 0;
    let touched = 0;
    for (const id of ['project/days2meet', 'project/fishai', 'project/canadian-fish-demo']) {
      const i = at().world.orbits.indexOf(id);
      for (const gap of [5, 6, 8, 10, 12, 16]) {
        for (const speed of [30, 45, 60, 81]) {
          for (const off of [0, 0.3, -0.3]) {
            const run = diving(gap, speed, id, off);
            requestDock(run.world.dock, i, NO_INPUT);
            const label = `${id} from ${gap} u at ${speed} u/s, ${off} rad off`;
            const seen = watch(run, 6);
            expect(run.world.dock.phase, label).toBe('docked');
            dives += 1;
            if (seen.touches === 0) continue;
            touched += 1;
            // Only from nearer than the full brake could stop the ship in.
            const stopping = speed / (flight.brakeDrag + flight.forwardDrag);
            expect(gap - tuning.cushion.shellGap, label).toBeLessThan(stopping);
          }
        }
      }
    }
    // 216 dives from 5 to 16 u above, at 30 to 81 u/s: 17 meet the shell, all from nearer than the
    // brake could stop in (at 60 u/s or more, from 8 u or less). With the body left out: 54, from
    // as far as 12 u above at 81 u/s and 10 u at 60. Measured.
    expect(dives).toBe(216);
    expect(touched).toBeLessThanOrEqual(20);
  });
});

describe('the guard (a ship taken back at speed)', () => {
  it('is the pilot flying, exactly, where nothing is in the way', () => {
    const run = at();
    run.state.x = 250;
    run.state.z = -250;
    run.state.vz = 70;
    guardDock(run.world.dock, NO_INPUT, tuning.dock.leaveDeadZone);
    const left = { ...LEFT };
    expect(
      guardInput(run.world.field, run.world.dock, left, run.state, tuning.flight, tuning.dock),
    ).toBe(left);
    expect(run.world.dock.guarding).toBe(true);
  });

  it('brakes for a body on the course, and not a shell is touched', () => {
    // FishAI dead ahead, but far enough off for the ship to go on as it is...
    const far = diving(150, 81);
    guardDock(far.world.dock, NO_INPUT, tuning.dock.leaveDeadZone);
    expect(
      guardInput(far.world.field, far.world.dock, NO_INPUT, far.state, tuning.flight, tuning.dock),
    ).toBe(NO_INPUT);
    // ...and nearer, it brakes as the way runs out, until the ship is slow enough for the cushion.
    const run = diving(40, 81);
    guardDock(run.world.dock, NO_INPUT, tuning.dock.leaveDeadZone);
    let hardest = 0;
    let touches = 0;
    for (let k = 0; k < 180; k += 1) {
      step(run);
      hardest = Math.max(hardest, run.flown.brake);
      if (run.world.touched >= 0) touches += 1;
    }
    expect(hardest).toBeGreaterThan(0.25);
    expect(touches).toBe(0);
    expect(run.world.dock.guarding).toBe(false);
    // Unguarded, the same dive meets the shell.
    const bare = diving(40, 81);
    expect(watch(bare, 3).touches).toBeGreaterThan(0);
  });

  it('ends once the ship is slow, or at a fresh press of the throttle at the pilot’s own pace, and never with Stop', () => {
    const slow = diving(200);
    slow.state.vx = 20;
    guardDock(slow.world.dock, NO_INPUT, tuning.dock.leaveDeadZone);
    step(slow);
    expect(slow.world.dock.guarding).toBe(false);

    // Taken back WITH the throttle: that press is not news, and the guard stays on while it is
    // held; let go and pressed again at a speed the pilot's own drive gives (42.5 u/s), it is the
    // pilot flying at the planet on purpose.
    const own = tuning.flight.thrustAccel / tuning.flight.forwardDrag;
    const run = diving(200, own - 2);
    guardDock(run.world.dock, THRUST, tuning.dock.leaveDeadZone);
    step(run, THRUST);
    expect(run.world.dock.guarding).toBe(true);
    step(run);
    expect(run.world.dock.guarding).toBe(true);
    step(run, THRUST);
    expect(run.world.dock.guarding).toBe(false);

    // At that pace but closer in, let go of it would coast into the planet's cushion: there is
    // still something to guard, and the guard stays until the ship is slow.
    const close = diving(20, own - 2);
    guardDock(close.world.dock, THRUST, tuning.dock.leaveDeadZone);
    step(close, THRUST);
    step(close);
    step(close, THRUST);
    expect(close.world.dock.guarding).toBe(true);

    // Faster than that, the speed is still the autopilot's: a fresh press is the pilot flying, and
    // the reflex stays on for them until the ship is slow, however the throttle comes and goes.
    const fast = diving(200, 60);
    guardDock(fast.world.dock, THRUST, tuning.dock.leaveDeadZone);
    step(fast, THRUST);
    step(fast);
    step(fast, THRUST);
    expect(fast.world.dock.guarding).toBe(true);
    step(fast);
    step(fast, { ...THRUST, boost: true });
    expect(fast.world.dock.guarding).toBe(true);

    // A Stop brakes to rest instead, and steering out of it while still fast is guarded.
    const stopped = diving(200);
    guardDock(stopped.world.dock, NO_INPUT, tuning.dock.leaveDeadZone);
    haltDock(stopped.world.dock, stopped.world.assist);
    expect(stopped.world.dock.guarding).toBe(false);
    expect(stopped.world.dock.halting).toBe(true);
    step(stopped, RIGHT);
    expect(stopped.world.dock.halting).toBe(false);
    expect(stopped.world.dock.guarding).toBe(true);
  });

  it('takes a bare Shift (half of Shift+Tab) for nothing: no takeover, no end to a Stop or a guard', () => {
    // Boost only multiplies the pilot's own thrust (sim/flight.ts, isSteering): a reader moving
    // the focus back with Shift+Tab mid-journey is not taking the controls.
    const SHIFT: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: true };
    const run = setOut('page/resume', 'project/fish-onboarding', 9920, 3.117, 1);
    for (let k = 0; k < 111; k += 1) step(run);
    expect(run.world.dock.phase).toBe('cruise');
    tap(run, SHIFT, 30);
    expect(run.world.dock.phase).not.toBe('free');
    expect(run.world.dock.leftByPilot).toBe(false);
    expect(run.world.dock.halting).toBe(false);
    expect(run.world.dock.guarding).toBe(false);

    // A Stop still brakes to rest...
    const stopped = diving(200);
    haltDock(stopped.world.dock, stopped.world.assist);
    step(stopped, SHIFT);
    expect(stopped.world.dock.halting).toBe(true);
    expect(stopped.world.dock.guarding).toBe(false);

    // ...and a guard still guards. Nor is a held Shift a throttle held from before: the first
    // press of the throttle with it is fresh, and (at the pilot's own pace) ends the guard.
    const guarded = diving(200, 40);
    guardDock(guarded.world.dock, SHIFT, tuning.dock.leaveDeadZone);
    step(guarded, SHIFT);
    expect(guarded.world.dock.guarding).toBe(true);
    step(guarded, { ...THRUST, boost: true });
    expect(guarded.world.dock.guarding).toBe(false);
  });
});
