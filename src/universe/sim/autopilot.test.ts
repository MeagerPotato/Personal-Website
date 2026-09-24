import { describe, expect, it } from 'vitest';
import { buildUniverse } from '../data/build';
import type { ProjectInput, UniverseInput } from '../data/types';
import { tuning } from '../design/tuning';
import { beginCruise, cruiseArrived, passingLimit, planCruise } from './autopilot';
import { approachPace, dockAt, releaseDock, requestDock } from './docking';
import { NO_INPUT, copyShipState, createShipState, speedOf, stepFlight } from './flight';
import { angleDelta } from './math';
import { createRng } from './rng';
import {
  createSurroundings,
  dropOutOfWarp,
  flyStep,
  syncSurroundings,
  type Surroundings,
} from './surroundings';
import type { FlightInput, ShipState } from './types';

const STEP = 1 / 60;

// A galaxy of the size the site is planned to grow to, laid out by the real build: three systems
// of projects with moons, and the home system with its station and satellite.
const project = (id: string, over: Partial<ProjectInput>): ProjectInput => ({
  id,
  title: id,
  href: `/projects/${id}/`,
  date: '2026-01',
  size: 'm',
  biome: 'terra',
  rings: false,
  decorMoons: 0,
  flagship: false,
  related: [],
  draft: false,
  ...over,
});
const INPUT: UniverseInput = {
  systems: ['code', 'rocketry', 'berkeley'].map((id, index) => ({
    id,
    name: id,
    href: `/systems/${id}/`,
    theme: 'sky',
    order: index + 1,
    position: 'auto',
  })),
  projects: [
    project('fishai', { system: 'code', size: 'l', date: '2026-07' }),
    project('fish-demo', { parent: 'fishai', size: 's' }),
    project('fish-onboarding', { parent: 'fishai', size: 's' }),
    project('days2meet', { system: 'code', date: '2026-03' }),
    project('odds', { system: 'code', size: 's', date: '2025-05' }),
    project('dashboard', { system: 'code', size: 's', date: '2025-01' }),
    project('staged-recovery', { system: 'rocketry', size: 'l', date: '2024-07' }),
    project('payload', { parent: 'staged-recovery', size: 'm' }),
    project('arc-team', { system: 'rocketry', date: '2023-05' }),
    project('l1-cert', { system: 'rocketry', size: 's', date: '2025-02' }),
    project('club', { system: 'berkeley', date: '2026-09' }),
    project('research', { system: 'berkeley', size: 'l', date: '2026-10' }),
  ],
  pages: [
    { id: 'about', title: 'About', href: '/about/', dock: 'home' },
    { id: 'resume', title: 'Resume', href: '/resume/', dock: 'station' },
    { id: 'contact', title: 'Contact', href: '/contact/', dock: 'satellite' },
  ],
  includeDrafts: false,
};
const MANIFEST = buildUniverse(INPUT);
const HOME = MANIFEST.systems[0]?.position ?? [0, 0];

interface Journey {
  world: Surroundings;
  state: ShipState;
  flown: FlightInput;
  t: number;
}

function begin(t = 0): Journey {
  const world = createSurroundings(
    { systems: MANIFEST.systems, bodies: MANIFEST.bodies, home: HOME },
    tuning.edge.margin,
  );
  syncSurroundings(world, t);
  return { world, state: createShipState(), flown: { ...NO_INPUT }, t };
}

function step(journey: Journey, pilot: Readonly<FlightInput> = NO_INPUT): void {
  journey.t += STEP;
  flyStep(
    journey.world,
    journey.state,
    pilot,
    tuning.flight,
    tuning,
    STEP,
    journey.t,
    journey.flown,
  );
}

/** As a visitor reading a page is: in orbit round `id`, carried along for half a second. */
function dockedAt(id: string, t = 0, angle = 0, spin = 1): Journey {
  const journey = begin(t);
  const { world } = journey;
  dockAt(
    world.field,
    journey.state,
    tuning.dock,
    world.dock,
    world.orbits.indexOf(id),
    angle,
    spin,
  );
  for (let k = 0; k < 30; k += 1) step(journey);
  return journey;
}

/** In open space: `distance` from body `id` at bearing `angle`, nose at `heading`, going `speed`. */
function flyingNear(
  id: string,
  distance: number,
  angle: number,
  heading: number,
  speed: number,
  t = 0,
): Journey {
  const journey = begin(t);
  const { positions } = journey.world.field;
  const i = journey.world.orbits.indexOf(id);
  journey.state.x = (positions[i * 2] ?? 0) + distance * Math.sin(angle);
  journey.state.z = (positions[i * 2 + 1] ?? 0) + distance * Math.cos(angle);
  journey.state.heading = heading;
  journey.state.vx = speed * Math.sin(heading);
  journey.state.vz = speed * Math.cos(heading);
  return journey;
}

/** How far the ship is from the SURFACE of body `i`, u. */
function gap(journey: Journey, i: number): number {
  const { positions, radius } = journey.world.field;
  return (
    Math.hypot(
      journey.state.x - (positions[i * 2] ?? 0),
      journey.state.z - (positions[i * 2 + 1] ?? 0),
    ) - (radius[i] ?? 0)
  );
}

interface Report {
  docked: boolean;
  seconds: number;
  topSpeed: number;
  /** Closest the ship came to the surface of any body it neither left nor went to, u. */
  leastGap: number;
  touched: boolean;
  /** Relative to the body, at the moment the journey was taken into orbit, u/s. */
  handOverPace: number;
  /**
   * How often the stick went hard over one way and then hard over the other while going faster
   * than 100 u/s: a slalom, or a nose hunting for its course.
   */
  reversals: number;
}

/** Set out for `target` and fly until docked (or for a minute), watching what a passenger would mind. */
function travel(journey: Journey, target: string, from = -1, limitSec = 60): Report {
  const { world } = journey;
  const i = world.orbits.indexOf(target);
  if (world.dock.phase !== 'free') releaseDock(world.dock, world.assist);
  requestDock(world.dock, i, NO_INPUT, true);
  const report: Report = {
    docked: false,
    seconds: 0,
    topSpeed: 0,
    leastGap: Infinity,
    touched: false,
    handOverPace: 0,
    reversals: 0,
  };
  const began = journey.t;
  let lastSide = 0;
  let phase = world.dock.phase;
  while (journey.t - began < limitSec) {
    step(journey);
    const speed = speedOf(journey.state);
    report.topSpeed = Math.max(report.topSpeed, speed);
    report.touched ||= world.touched >= 0;
    if (speed > 100) {
      const turn = journey.flown.turn;
      const side = turn > 0.25 ? 1 : turn < -0.25 ? -1 : 0;
      if (side !== 0 && lastSide !== 0 && side !== lastSide) report.reversals += 1;
      if (side !== 0) lastSide = side;
    } else lastSide = 0;
    for (let j = 0; j < world.field.count; j += 1) {
      if (j !== i && j !== from) report.leastGap = Math.min(report.leastGap, gap(journey, j));
    }
    if (phase === 'cruise' && world.dock.phase === 'docked') {
      report.handOverPace = Math.hypot(
        journey.state.vx - (world.field.velocities[i * 2] ?? 0),
        journey.state.vz - (world.field.velocities[i * 2 + 1] ?? 0),
      );
    }
    phase = world.dock.phase;
    if (phase === 'docked') {
      report.docked = true;
      break;
    }
  }
  report.seconds = journey.t - began;
  return report;
}

describe('the autopilot', () => {
  it('crosses the galaxy in seconds, docks, and hands over gently', () => {
    const journey = dockedAt('page/about');
    const from = journey.world.orbits.indexOf('page/about');
    const report = travel(journey, 'project/fishai', from);
    expect(report.docked).toBe(true);
    // About a thousand units, leaving one ring and arriving beside another: a few seconds.
    expect(report.seconds).toBeLessThan(5);
    expect(report.topSpeed).toBeGreaterThan(400);
    expect(report.topSpeed).toBeLessThanOrEqual(tuning.cruise.far.cruiseSpeed * 1.05);
    // Taken into orbit at no more than two and a half times the pace the ring is flown onto at.
    const ring =
      journey.world.field.ringRadius[journey.world.orbits.indexOf('project/fishai')] ?? 0;
    expect(report.handOverPace).toBeGreaterThan(0);
    expect(report.handOverPace).toBeLessThanOrEqual(approachPace(ring, tuning.dock) * 2.5 + 1e-9);
    expect(report.touched).toBe(false);
    expect(journey.world.dock.body).toBe(journey.world.orbits.indexOf('project/fishai'));
  });

  it('hops to the next planet at a calmer pace', () => {
    const journey = dockedAt('project/days2meet');
    const from = journey.world.orbits.indexOf('project/days2meet');
    const report = travel(journey, 'project/odds', from);
    expect(report.docked).toBe(true);
    // Flown by a profile much nearer `near` than `far`, and no faster than it.
    const { cruise } = journey.world;
    expect(cruise.far).toBeLessThan(0.5);
    expect(report.topSpeed).toBeLessThanOrEqual(cruise.profile.cruiseSpeed * 1.05);
    expect(report.topSpeed).toBeLessThan(tuning.cruise.far.cruiseSpeed / 2);
    expect(report.touched).toBe(false);
  });

  it('gets from anywhere to anywhere: 200 journeys, never touching a thing', () => {
    const rng = createRng('journeys');
    const range = (from: number, to: number): number => from + (to - from) * rng();
    let slowest = 0;
    let quickest = Infinity;
    let closest = Infinity;
    let total = 0;
    const revs: number[] = [];
    for (let run = 0; run < 200; run += 1) {
      const t0 = range(0, 900);
      const count = MANIFEST.bodies.length;
      const from = Math.floor(range(0, count));
      let to = Math.floor(range(0, count - 1));
      if (to >= from) to += 1;
      let journey = begin(t0);
      const ids = journey.world.orbits.ids;
      if (rng() < 0.7) {
        // In orbit somewhere, at any point of the ring, either way round: where journeys begin.
        journey = dockedAt(ids[from] ?? '', t0, range(0, Math.PI * 2), rng() < 0.5 ? 1 : -1);
      } else {
        // Or flying about in open space, pointing anywhere, at any speed up to a boost.
        const { positions } = journey.world.field;
        for (let tries = 0; tries < 50; tries += 1) {
          const angle = range(0, Math.PI * 2);
          const distance = range(80, 420);
          journey.state.x = (positions[from * 2] ?? 0) + distance * Math.sin(angle);
          journey.state.z = (positions[from * 2 + 1] ?? 0) + distance * Math.cos(angle);
          let room = Infinity;
          for (let j = 0; j < journey.world.field.count; j += 1) {
            room = Math.min(room, gap(journey, j));
          }
          if (room > 70) break;
        }
        const heading = range(0, Math.PI * 2);
        const fast = range(0, 80);
        journey.state.heading = heading;
        journey.state.vx = fast * Math.sin(heading);
        journey.state.vz = fast * Math.cos(heading);
      }

      const report = travel(journey, ids[to] ?? '', from);
      const label = `run ${run}: ${ids[from]} -> ${ids[to]}`;
      expect(report.docked, label).toBe(true);
      expect(report.touched, label).toBe(false);
      expect(report.topSpeed, label).toBeLessThanOrEqual(tuning.cruise.far.cruiseSpeed * 1.05);
      slowest = Math.max(slowest, report.seconds);
      expect(report.seconds, label).toBeGreaterThanOrEqual(tuning.cruise.minJourneySec);
      closest = Math.min(closest, report.leastGap);
      total += report.seconds;
      quickest = Math.min(quickest, report.seconds);
      revs.push(report.reversals);
    }
    // The longest trip in this galaxy is some 1,500 u, and most are across a system or two.
    expect(slowest).toBeLessThan(6);
    expect(total / 200).toBeLessThan(3.5);
    // A journey reads as a journey, however near the next body.
    expect(quickest).toBeGreaterThanOrEqual(tuning.cruise.minJourneySec);
    // Bodies passed on the way are given a wide berth: never so close as to feel their cushion.
    expect(closest).toBeGreaterThan(tuning.cushion.depth * 0.5);
    // At speed the ship carves its bends, but it does not slalom: nine journeys in ten never
    // throw the stick from one side to the other more than once, and none does it often.
    revs.sort((a, b) => a - b);
    expect(revs[180]).toBeLessThanOrEqual(1);
    expect(revs[199]).toBeLessThanOrEqual(8);
  });

  it('turns round first when asked while flying the other way at full boost', () => {
    const journey = flyingNear('page/about', 150, 0, 0, 80);
    const to = journey.world.orbits.indexOf('project/fishai');
    const { positions } = journey.world.field;
    // Nose and 80 u/s pointing straight AWAY from the target.
    const away = Math.atan2(
      journey.state.x - (positions[to * 2] ?? 0),
      journey.state.z - (positions[to * 2 + 1] ?? 0),
    );
    journey.state.heading = away;
    journey.state.vx = 80 * Math.sin(away);
    journey.state.vz = 80 * Math.cos(away);
    const report = travel(journey, 'project/fishai');
    expect(report.docked).toBe(true);
    expect(report.touched).toBe(false);
    expect(report.seconds).toBeLessThan(18);
  });

  it('goes round a sun that is in the way', () => {
    const journey = begin();
    const { world, state } = journey;
    const sun = world.orbits.indexOf('system/code');
    const to = world.orbits.indexOf('project/odds');
    const { positions } = world.field;
    // Start on the far side of the sun from the planet, 150 u out, at rest, nose at the sun.
    const dx = (positions[sun * 2] ?? 0) - (positions[to * 2] ?? 0);
    const dz = (positions[sun * 2 + 1] ?? 0) - (positions[to * 2 + 1] ?? 0);
    const d = Math.hypot(dx, dz);
    state.x = (positions[sun * 2] ?? 0) + (dx / d) * 150;
    state.z = (positions[sun * 2 + 1] ?? 0) + (dz / d) * 150;
    state.heading = Math.atan2(-dx, -dz);

    requestDock(world.dock, to, NO_INPUT, true);
    let least = Infinity;
    let touched = false;
    for (let k = 0; k < 3600 && world.dock.phase !== 'docked'; k += 1) {
      step(journey);
      least = Math.min(least, gap(journey, sun));
      touched ||= world.touched >= 0;
    }
    expect(world.dock.phase).toBe('docked');
    expect(touched).toBe(false);
    // Clear of the sun's surface by about its docking ring: the keep-out, give or take how
    // loosely a ship follows a path.
    const ring = (world.field.ringRadius[sun] ?? 0) - (world.field.radius[sun] ?? 0);
    expect(least).toBeGreaterThan(ring * 0.6);
  });

  it('brings its nose round before it opens the throttle', () => {
    // In orbit round the home planet, nose along the ring; FishAI lies well behind the ship.
    const journey = dockedAt('page/about', 0, 0, 1);
    const { world } = journey;
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/fishai'), NO_INPUT, true);
    let waited = 0;
    let went = 0;
    for (let k = 0; k < 240; k += 1) {
      step(journey);
      const { path, index } = world.cruise;
      const runs = Math.atan2(
        (path.x[index + 1] ?? 0) - (path.x[index] ?? 0),
        (path.z[index + 1] ?? 0) - (path.z[index] ?? 0),
      );
      const off = Math.abs(angleDelta(journey.state.heading, runs));
      // Beyond 40 degrees off the way the path runs (and a little, for the slip in a bend): none.
      if (off > 0.8) {
        expect(journey.flown.thrust).toBe(0);
        waited += 1;
      } else if (journey.flown.thrust > 0) went += 1;
    }
    expect(waited).toBeGreaterThan(10);
    expect(went).toBeGreaterThan(60);
  });

  it('gives the controls back the moment the pilot steers, and drops out of warp', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/fishai'), NO_INPUT, true);
    for (let k = 0; k < 240 && speedOf(journey.state) < 400; k += 1) step(journey);
    expect(world.dock.phase).toBe('cruise');
    expect(speedOf(journey.state)).toBeGreaterThan(400);

    // Far from everything, the step in which the pilot grabs the stick is an ordinary step of
    // ordinary flight, the pilot's own engine from here on: the same place, the same course. Only
    // the speed that engine could never have made starts to go (sim/surroundings.ts).
    const before = copyShipState(journey.state, createShipState());
    const steer: FlightInput = { thrust: 0, turn: 1, brake: 0, boost: false };
    step(journey, steer);
    expect(world.dock.phase).toBe('free');
    expect(world.dock.leftByPilot).toBe(true);
    const ordinary = stepFlight(
      copyShipState(before, createShipState()),
      steer,
      tuning.flight,
      STEP,
    );
    expect(journey.state.x).toBe(ordinary.x);
    expect(journey.state.z).toBe(ordinary.z);
    expect(journey.state.heading).toBe(ordinary.heading);
    expect(journey.state).toEqual(
      dropOutOfWarp(ordinary, tuning.flight, tuning.cruise.dropOutPerSec, STEP),
    );
    expect(speedOf(journey.state)).toBeGreaterThan(speedOf(before) * 0.9);

    // And from there the ship slows to what its pilot can fly, and coasts down: nobody is flying
    // it any more. Out of warp in under a second, not hundreds of units later.
    step(journey, NO_INPUT);
    expect(world.dock.leftByPilot).toBe(false);
    const x = journey.state.x;
    const z = journey.state.z;
    for (let k = 0; k < 60; k += 1) step(journey, NO_INPUT);
    const { thrustAccel, forwardDrag, boostFactor } = tuning.flight;
    expect(speedOf(journey.state)).toBeLessThanOrEqual((thrustAccel * boostFactor) / forwardDrag);
    expect(Math.hypot(journey.state.x - x, journey.state.z - z)).toBeLessThan(250);
    for (let k = 0; k < 300; k += 1) step(journey, NO_INPUT);
    expect(speedOf(journey.state)).toBeLessThan(20);
    expect(world.dock.phase).toBe('free');
  });

  it('never slows a ship its own pilot flies, however hard it is flown', () => {
    const { thrustAccel, forwardDrag, boostFactor } = tuning.flight;
    const top = (thrustAccel * boostFactor) / forwardDrag;
    const flying = { ...createShipState(), vx: top * 0.6, vz: top * 0.8 };
    expect(dropOutOfWarp({ ...flying }, tuning.flight, tuning.cruise.dropOutPerSec, STEP)).toEqual(
      flying,
    );
    // Faster than that, only the difference goes, and along the way it was going.
    const warp = { ...createShipState(), vx: 0, vz: 2000 };
    dropOutOfWarp(warp, tuning.flight, 5, 0.1);
    expect(warp.vx).toBe(0);
    expect(warp.vz).toBeCloseTo(top + (2000 - top) * Math.exp(-0.5), 9);
  });

  it('stops within a couple of hundred units when Stop is pressed at full speed', () => {
    // Stop (ui/Prompt.ts) lets go of the journey (Navigator.release, releaseDock) at the fastest
    // point of a crossing between systems. Nobody flies the ship from there: it drops out of warp
    // and coasts, and it must not coast on into the next system, or into a planet.
    const { thrustAccel, forwardDrag, boostFactor } = tuning.flight;
    const top = (thrustAccel * boostFactor) / forwardDrag;
    const pairs: Array<[string, string]> = [
      ['page/about', 'project/research'],
      ['project/fishai', 'project/staged-recovery'],
      ['project/research', 'project/days2meet'],
      ['page/contact', 'project/arc-team'],
      ['project/l1-cert', 'project/club'],
      ['project/payload', 'page/resume'],
    ];
    let peakMost = 0;
    let dropMost = 0;
    let slideMost = 0;
    let closest = Infinity;
    for (const [from, to] of pairs) {
      for (const t0 of [0, 400]) {
        const label = `${from} -> ${to} at ${t0} s`;
        const setOut = (): Journey => {
          const journey = dockedAt(from, t0);
          releaseDock(journey.world.dock, journey.world.assist);
          requestDock(journey.world.dock, journey.world.orbits.indexOf(to), NO_INPUT, true);
          return journey;
        };
        // The journey as flown to the end, to find its fastest moment (flights are exact
        // repeats: see 'flies the same journey the same way every time')...
        const whole = setOut();
        let peak = 0;
        let peakAt = 0;
        for (let k = 1; k <= 600 && whole.world.dock.phase === 'cruise'; k += 1) {
          step(whole);
          if (speedOf(whole.state) > peak) {
            peak = speedOf(whole.state);
            peakAt = k;
          }
        }
        // ...and again, Stop pressed right there.
        const journey = setOut();
        const { world } = journey;
        for (let k = 0; k < peakAt; k += 1) step(journey);
        expect(world.dock.phase, label).toBe('cruise');
        expect(speedOf(journey.state), label).toBe(peak);
        peakMost = Math.max(peakMost, peak);

        releaseDock(world.dock, world.assist);
        const x0 = journey.state.x;
        const z0 = journey.state.z;
        let dropped = -1;
        let slide = 0;
        for (let k = 0; k < 600; k += 1) {
          step(journey, NO_INPUT);
          expect(world.touched, label).toBe(-1);
          const away = Math.hypot(journey.state.x - x0, journey.state.z - z0);
          slide = Math.max(slide, away);
          if (dropped < 0 && speedOf(journey.state) <= top + 1e-9) dropped = away;
          for (let j = 0; j < world.field.count; j += 1)
            closest = Math.min(closest, gap(journey, j));
        }
        expect(dropped, label).toBeGreaterThan(0);
        dropMost = Math.max(dropMost, dropped);
        slideMost = Math.max(slideMost, slide);
      }
    }
    // Stopped at 698 u/s: back to the pilot's own top speed (81 u/s) within 160 u, and at
    // rest (or in an orbit the assist found) within 259 u, never a system further on. (Without
    // dropOutOfWarp it coasted some 875 u, and a Stop in the wrong place met a planet.)
    expect(peakMost).toBeGreaterThan(0.9 * tuning.cruise.far.cruiseSpeed);
    expect(dropMost).toBeLessThan(170);
    expect(slideMost).toBeLessThan(280);
    expect(closest).toBeGreaterThan(tuning.cushion.depth * 0.5);
  });

  it('ignores controls that were already held when the journey was asked for', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    const held: FlightInput = { thrust: 1, turn: 0, brake: 0, boost: false };
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/fishai'), held, true);
    for (let k = 0; k < 30; k += 1) step(journey, held);
    expect(world.dock.phase).toBe('cruise');
    // Let go, and the same push is news.
    for (let k = 0; k < 5; k += 1) step(journey, NO_INPUT);
    step(journey, held);
    expect(world.dock.phase).toBe('free');
    expect(world.dock.leftByPilot).toBe(true);
  });

  it('stops for the brake, too', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/fishai'), NO_INPUT, true);
    for (let k = 0; k < 60; k += 1) step(journey);
    step(journey, { thrust: 0, turn: 0, brake: 1, boost: false });
    expect(world.dock.phase).toBe('free');
  });

  it('changes its mind mid-flight when asked for somewhere else', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/fishai'), NO_INPUT, true);
    for (let k = 0; k < 180; k += 1) step(journey);
    expect(speedOf(journey.state)).toBeGreaterThan(100);
    const report = travel(journey, 'project/research');
    expect(report.docked).toBe(true);
    expect(report.touched).toBe(false);
    expect(world.dock.body).toBe(world.orbits.indexOf('project/research'));
  });

  it('flies the same journey the same way every time', () => {
    const fly = (): ShipState => {
      const journey = dockedAt('project/payload', 321);
      travel(journey, 'project/research');
      return journey.state;
    };
    expect(fly()).toEqual(fly());
  });
});

describe('planning a journey', () => {
  /** A plan for the journey from where `journey` is to `target`, and the world it was made in. */
  function plan(journey: Journey, target: string): Surroundings['cruise'] {
    const { world } = journey;
    beginCruise(world.cruise);
    planCruise(
      world.orbits,
      world.field,
      journey.state,
      world.orbits.indexOf(target),
      journey.t,
      tuning.cruise,
      tuning.dock,
      world.cruise,
    );
    return world.cruise;
  }

  it('ends on the hand-over circle of where the body WILL be, travelling along it', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    const cruise = plan(journey, 'project/odds');
    const i = world.orbits.indexOf('project/odds');
    const { path } = cruise;
    const endX = path.x[path.count - 1] ?? 0;
    const endZ = path.z[path.count - 1] ?? 0;
    const reach = (world.field.ringRadius[i] ?? 0) * tuning.cruise.handOffRadii;

    // Not where the planet is now (a journey of a second or two: it moves about half a unit)...
    const now = Math.hypot(
      endX - (world.field.positions[i * 2] ?? 0),
      endZ - (world.field.positions[i * 2 + 1] ?? 0),
    );
    expect(Math.abs(now - reach)).toBeGreaterThan(0.25);
    // ...but where it is when the ship gets there.
    syncSurroundings(world, journey.t + cruise.etaSec);
    const cx = world.field.positions[i * 2] ?? 0;
    const cz = world.field.positions[i * 2 + 1] ?? 0;
    expect(Math.hypot(endX - cx, endZ - cz)).toBeCloseTo(reach, 1);
    // Along the circle: the last stretch of the path is at right angles to the radius.
    const backX = path.x[path.count - 2] ?? 0;
    const backZ = path.z[path.count - 2] ?? 0;
    const along =
      ((endX - backX) * (endX - cx) + (endZ - backZ) * (endZ - cz)) /
      (Math.hypot(endX - backX, endZ - backZ) * reach);
    expect(Math.abs(along)).toBeLessThan(0.2);
  });

  it('flies long journeys fast and short ones calmly, and decides that once', () => {
    const far = dockedAt('page/about');
    const long = plan(far, 'project/fishai');
    expect(long.path.length).toBeGreaterThan(tuning.cruise.longLeg);
    expect(long.far).toBe(1);
    // Flown by `far`, and faster than `near` could ever go (a thousand units is too short to reach
    // the far profile's cruising speed and brake again: it gets most of the way).
    expect(long.profile.cruiseSpeed).toBe(tuning.cruise.far.cruiseSpeed);
    const top = Math.max(...long.speeds.subarray(0, long.path.count));
    expect(top).toBeGreaterThan(tuning.cruise.near.cruiseSpeed * 2);
    expect(top).toBeLessThanOrEqual(tuning.cruise.far.cruiseSpeed);

    const near = dockedAt('project/days2meet');
    const short = plan(near, 'project/odds');
    expect(short.path.length).toBeLessThan(tuning.cruise.longLeg);
    // In between the two lengths: a blend of the two profiles, weighted by where between them the
    // journey lies (as its first plan measured it).
    expect(short.path.length).toBeGreaterThan(tuning.cruise.shortLeg);
    expect(short.far).toBeGreaterThan(0);
    expect(short.far).toBeLessThan(0.5);
    const blended =
      tuning.cruise.near.cruiseSpeed +
      (tuning.cruise.far.cruiseSpeed - tuning.cruise.near.cruiseSpeed) * (short.far ?? 0);
    expect(short.profile.cruiseSpeed).toBeCloseTo(blended, 9);
    expect(Math.max(...short.speeds.subarray(0, short.path.count))).toBeLessThanOrEqual(
      short.profile.cruiseSpeed + 1e-9,
    );

    // A long journey that has become short is still flown as a long one: no sudden braking.
    const { world } = far;
    const i = world.orbits.indexOf('project/fishai');
    far.state.x = (world.field.positions[i * 2] ?? 0) + 300;
    far.state.z = world.field.positions[i * 2 + 1] ?? 0;
    planCruise(world.orbits, world.field, far.state, i, far.t, tuning.cruise, tuning.dock, long);
    expect(long.path.length).toBeLessThan(tuning.cruise.longLeg);
    expect(long.far).toBe(1);
  });

  it('is slow wherever there is no room, however long the journey', () => {
    const journey = dockedAt('page/about');
    const cruise = plan(journey, 'project/fishai');
    // The first samples lie inside the keep-out of the body the ship is leaving: going AWAY from
    // it, which no speed is too fast for (sim/autopilot.ts, passingLimit).
    expect(cruise.ceiling[0]).toBeGreaterThan(tuning.cruise.far.cruiseSpeed);
    // Out in the open it is above anything the profile could ask for.
    expect(Math.max(...cruise.ceiling.subarray(0, cruise.path.count))).toBeGreaterThan(
      tuning.cruise.far.cruiseSpeed,
    );
    for (let k = 0; k < cruise.path.count; k += 1) {
      expect(cruise.speeds[k]).toBeLessThanOrEqual((cruise.ceiling[k] ?? 0) + 1e-9);
    }
  });

  it('goes round a planet and its moons as one, unless the journey begins or ends among them', () => {
    // Passing by: FishAI and its moons are one disc, and it is the planet that stands for them.
    const passing = dockedAt('page/about');
    const cruise = plan(passing, 'project/odds');
    const { orbits } = passing.world;
    const planet = orbits.indexOf('project/fishai');
    const moon = orbits.indexOf('project/fish-demo');
    expect(cruise.head[moon]).toBe(planet);
    expect(cruise.whole[planet]).toBe(1);
    expect(cruise.family[planet]).toBeGreaterThan(
      (orbits.radius[moon] ?? 0) + (passing.world.field.ringRadius[moon] ?? 0),
    );
    expect(cruise.family[planet]).toBeLessThanOrEqual(tuning.cruise.familyReach);
    // A sun and its planets are no family: going round a whole system would be a detour.
    const sun = orbits.indexOf('system/code');
    expect(cruise.head[planet]).toBe(planet);
    expect(cruise.family[sun]).toBeGreaterThan(tuning.cruise.familyReach);

    // Going to a moon, or leaving from one: its family is threaded, not gone round.
    const arriving = plan(dockedAt('page/about'), 'project/fish-demo');
    expect(arriving.whole[planet]).toBe(0);
    const leaving = plan(dockedAt('project/fish-onboarding'), 'project/odds');
    expect(leaving.whole[planet]).toBe(0);
  });

  it('keeps to the way round it chose, unless the other becomes much the shorter', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    const i = world.orbits.indexOf('project/fishai');
    const cruise = plan(journey, 'project/fishai');
    const chosen = cruise.spin;
    const first = cruise.path.length;

    // The other way round is a little shorter from a little to the side: not worth a change.
    const endX = cruise.path.x[cruise.path.count - 1] ?? 0;
    const endZ = cruise.path.z[cruise.path.count - 1] ?? 0;
    const cx = world.field.positions[i * 2] ?? 0;
    const cz = world.field.positions[i * 2 + 1] ?? 0;
    // Mirror the ship in the line from the start to the body: what was the near side is the far side.
    const ux = cx - journey.state.x;
    const uz = cz - journey.state.z;
    const u = Math.hypot(ux, uz);
    const side = ((endX - journey.state.x) * uz - (endZ - journey.state.z) * ux) / u;
    journey.state.x += (uz / u) * side * 0.5;
    journey.state.z -= (ux / u) * side * 0.5;
    planCruise(
      world.orbits,
      world.field,
      journey.state,
      i,
      journey.t,
      tuning.cruise,
      tuning.dock,
      cruise,
    );
    expect(cruise.spin).toBe(chosen);
    expect(Math.abs(cruise.path.length - first)).toBeLessThan(first * 0.1);
  });

  it('never plans a journey quicker than the shortest one, however near the body', () => {
    // From a planet to its own moon: a few dozen units.
    const cruise = plan(dockedAt('project/fishai'), 'project/fish-demo');
    expect(cruise.path.length).toBeLessThan(150);
    expect(cruise.etaSec).toBeGreaterThanOrEqual(tuning.cruise.minJourneySec - 1e-9);
  });

  it('keeps to the stretch of its last plan the ship is on: no bend straightened twice a second', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/research'), NO_INPUT, true);
    for (let k = 0; k < 50; k += 1) step(journey);
    expect(speedOf(journey.state)).toBeGreaterThan(60);
    // The plan as it stands...
    const { path } = world.cruise;
    const oldX = path.x.slice(0, path.count);
    const oldZ = path.z.slice(0, path.count);
    const offOld = (x: number, z: number): number => {
      let off = Infinity;
      for (let k = 0; k + 1 < oldX.length; k += 1) {
        const ax = oldX[k] ?? 0;
        const az = oldZ[k] ?? 0;
        const lx = (oldX[k + 1] ?? 0) - ax;
        const lz = (oldZ[k + 1] ?? 0) - az;
        const span = lx * lx + lz * lz;
        const t =
          span < 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - ax) * lx + (z - az) * lz) / span));
        off = Math.min(off, Math.hypot(ax + lx * t - x, az + lz * t - z));
      }
      return off;
    };
    // ...and the next one: it goes through points of the old one first (a plan that began the way
    // the ship is going would put its first corner straight ahead of the ship, off the old plan).
    world.cruise.replanIn = 0;
    step(journey);
    const { corners } = world.cruise.path;
    for (let c = 1; c <= 3; c += 1) {
      expect(offOld(corners[c * 2] ?? 0, corners[c * 2 + 1] ?? 0)).toBeLessThan(1e-6);
    }
    // They lie ahead of the ship, over no more than the next leadSec of the way.
    const lead = speedOf(journey.state) * tuning.cruise.path.leadSec;
    const last = Math.hypot(
      (corners[6] ?? 0) - journey.state.x,
      (corners[7] ?? 0) - journey.state.z,
    );
    expect(last).toBeGreaterThan(lead * 0.3);
    expect(last).toBeLessThanOrEqual(lead * 1.05);
  });

  it('never ends a journey inside the keep-out of a moon passing by', () => {
    // Moons circle within reach of their planet's hand-over circle: whenever a journey to the
    // planet is planned, the end of its path must be outside each of their keep-outs.
    const rng = createRng('moons');
    for (let run = 0; run < 60; run += 1) {
      const journey = flyingNear(
        'project/fishai',
        200 + 200 * rng(),
        rng() * Math.PI * 2,
        0,
        0,
        rng() * 900,
      );
      const { world } = journey;
      const cruise = plan(journey, 'project/fishai');
      const endX = cruise.path.x[cruise.path.count - 1] ?? 0;
      const endZ = cruise.path.z[cruise.path.count - 1] ?? 0;
      syncSurroundings(world, journey.t + cruise.etaSec);
      for (const id of ['project/fish-demo', 'project/fish-onboarding']) {
        const j = world.orbits.indexOf(id);
        const away = Math.hypot(
          endX - (world.field.positions[j * 2] ?? 0),
          endZ - (world.field.positions[j * 2 + 1] ?? 0),
        );
        expect(away, `run ${run}, ${id}`).toBeGreaterThan(
          (world.field.ringRadius[j] ?? 0) + tuning.cruise.keepOut - 1e-6,
        );
      }
    }
  });
});

describe('arriving', () => {
  it('takes a ship that is within reach and slow, and no other', () => {
    const journey = begin();
    const { world, state } = journey;
    const i = world.orbits.indexOf('project/days2meet');
    const { positions, velocities, ringRadius } = world.field;
    const reach = (ringRadius[i] ?? 0) * tuning.cruise.handOffRadii;
    const arrived = (): boolean => cruiseArrived(world.field, state, i, tuning.cruise, tuning.dock);

    // On the circle, keeping pace with the planet: handed over.
    state.x = (positions[i * 2] ?? 0) + reach;
    state.z = positions[i * 2 + 1] ?? 0;
    state.vx = velocities[i * 2] ?? 0;
    state.vz = velocities[i * 2 + 1] ?? 0;
    expect(arrived()).toBe(true);
    // ...but not before the journey has lasted as long as the shortest journey does.
    const { minJourneySec } = tuning.cruise;
    const after = (sec: number): boolean =>
      cruiseArrived(world.field, state, i, tuning.cruise, tuning.dock, sec);
    expect(after(minJourneySec - 0.1)).toBe(false);
    expect(after(minJourneySec)).toBe(true);

    // The same place at a gallop: the approach is a gentle pilot, and is not given this.
    state.vz += 80;
    expect(arrived()).toBe(false);
    state.vz -= 80;

    // Too far out.
    state.x = (positions[i * 2] ?? 0) + reach * 1.3;
    expect(arrived()).toBe(false);
  });
});

describe('the speed limit beside a keep-out', () => {
  const params = tuning.cruise;

  it('holds a ship heading straight at one to keepOutSpeed, and lets one going past go faster', () => {
    expect(passingLimit(0, 1, params)).toBeCloseTo(params.keepOutSpeed, 9);
    expect(passingLimit(0, 0.1, params)).toBeCloseTo(params.keepOutSpeed / params.passShare, 9);
    // With room, more: openSpaceGain for every unit of it.
    expect(passingLimit(100, 1, params)).toBeCloseTo(
      params.keepOutSpeed + params.openSpaceGain * 100,
      9,
    );
  });

  it('does not hold back a ship going away from one', () => {
    expect(passingLimit(-5, 0, params)).toBe(Infinity);
    expect(passingLimit(0, -0.5, params)).toBe(Infinity);
  });

  it('is keepOutSpeed deep inside one, whichever way, and has no step at the edge', () => {
    expect(passingLimit(-10, 0.1, params)).toBeCloseTo(params.keepOutSpeed, 9);
    expect(passingLimit(-1e-9, 0.1, params)).toBeCloseTo(passingLimit(1e-9, 0.1, params), 6);
    let last = Infinity;
    for (let room = 20; room >= -20; room -= 0.5) {
      const limit = passingLimit(room, 0.2, params);
      expect(limit).toBeLessThanOrEqual(last + 1e-9);
      last = limit;
    }
  });
});
