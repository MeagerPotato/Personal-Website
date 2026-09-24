import { describe, expect, it } from 'vitest';
import { buildUniverse } from '../data/build';
import type { ProjectInput, UniverseInput } from '../data/types';
import { tuning } from '../design/tuning';
import { beginCruise, cruiseArrived, passingLimit, planCruise } from './autopilot';
import { pullOf } from './assist';
import { approachPace, dockAt, haltDock, releaseDock, requestDock } from './docking';
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
  /** The hardest the velocity changed in one step, u/s²: what a passenger would feel as a jolt. */
  hardest: number;
}

/** Set out for `target` and fly until docked (or for a minute), watching what a passenger would mind. */
function travel(journey: Journey, target: string, from = -1, limitSec = 60): Report {
  const { world } = journey;
  const i = world.orbits.indexOf(target);
  if (world.dock.phase !== 'free') releaseDock(world.dock, world.assist);
  // As the Navigator asks for every journey: none quicker than cruise.minJourneySec.
  requestDock(world.dock, i, NO_INPUT, true, tuning.cruise.minJourneySec);
  const report: Report = {
    docked: false,
    seconds: 0,
    topSpeed: 0,
    leastGap: Infinity,
    touched: false,
    handOverPace: 0,
    reversals: 0,
    hardest: 0,
  };
  const began = journey.t;
  let lastSide = 0;
  let phase = world.dock.phase;
  while (journey.t - began < limitSec) {
    const vx = journey.state.vx;
    const vz = journey.state.vz;
    step(journey);
    report.hardest = Math.max(
      report.hardest,
      Math.hypot(journey.state.vx - vx, journey.state.vz - vz) / STEP,
    );
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

/** What `watchWhole` saw. */
interface Watched {
  docked: boolean;
  seconds: number;
  touched: boolean;
  /** Least clearance to ANY body's shell over the whole of every step, u (below 0: through one). */
  shellClear: number;
  /** Least gap to the surface of a body not in `except`, over the whole of every step, u, and which. */
  gap: number;
  gapBody: string;
  /** The hardest the velocity changed in one step, u/s². */
  accel: number;
  /** The furthest from where the watch began, u. */
  slide: number;
  /** How far from there it was when it was first no faster than `below`, u (NaN if never). */
  dropU: number;
}

/**
 * Fly on with nobody at the controls for `limitSec`, or until docked and a second more (the dock's
 * springs settle the ship then), watching the WHOLE of every step: the straight line the ship
 * flew, seen from each body (which moved too). At 700 u/s a step is 12 u, and a small moon's shell
 * is 4.4 u across.
 */
function watchWhole(
  journey: Journey,
  except: readonly number[],
  limitSec: number,
  below = 0,
): Watched {
  const { world, state } = journey;
  const { positions, radius, count } = world.field;
  const before = new Float64Array(count * 2);
  const seen: Watched = {
    docked: false,
    seconds: limitSec,
    touched: false,
    shellClear: Infinity,
    gap: Infinity,
    gapBody: '',
    accel: 0,
    slide: 0,
    dropU: NaN,
  };
  const x0 = state.x;
  const z0 = state.z;
  const began = journey.t;
  let dockedAt = -1;
  while (journey.t - began < limitSec - STEP / 2 && (dockedAt < 0 || journey.t - dockedAt < 1)) {
    before.set(positions);
    const fromX = state.x;
    const fromZ = state.z;
    const vx = state.vx;
    const vz = state.vz;
    step(journey);
    seen.accel = Math.max(seen.accel, Math.hypot(state.vx - vx, state.vz - vz) / STEP);
    seen.touched ||= world.touched >= 0;
    const away = Math.hypot(state.x - x0, state.z - z0);
    seen.slide = Math.max(seen.slide, away);
    if (Number.isNaN(seen.dropU) && speedOf(state) <= below) seen.dropU = away;
    for (let j = 0; j < count; j += 1) {
      const ax = fromX - (before[j * 2] ?? 0);
      const az = fromZ - (before[j * 2 + 1] ?? 0);
      const dx = state.x - (positions[j * 2] ?? 0) - ax;
      const dz = state.z - (positions[j * 2 + 1] ?? 0) - az;
      const span = dx * dx + dz * dz;
      const t = span < 1e-12 ? 0 : Math.min(1, Math.max(0, -(ax * dx + az * dz) / span));
      const surface = Math.hypot(ax + dx * t, az + dz * t) - (radius[j] ?? 0);
      seen.shellClear = Math.min(seen.shellClear, surface - tuning.cushion.shellGap);
      if (!except.includes(j) && surface < seen.gap) {
        seen.gap = surface;
        seen.gapBody = world.orbits.ids[j] ?? '';
      }
    }
    if (dockedAt < 0 && world.dock.phase === 'docked') {
      dockedAt = journey.t;
      seen.docked = true;
      seen.seconds = journey.t - began;
    }
  }
  return seen;
}

/**
 * A new destination, as Navigator.travel asks for it: the autopilot, or the approach for a body
 * that is within reach (the ship racing past it), and never quicker than a journey.
 */
function sendTo(journey: Journey, id: string): void {
  const { world, state } = journey;
  const i = world.orbits.indexOf(id);
  const within = pullOf(world.field, i, state.x, state.z, tuning.assist) > 0;
  releaseDock(world.dock, world.assist);
  requestDock(world.dock, i, NO_INPUT, !within, tuning.cruise.minJourneySec);
}

/** Journeys between systems in MANIFEST, each from a dock at a given moment, place and way round. */
const CROSSINGS: ReadonlyArray<readonly [string, string, number, number, 1 | -1]> = [
  ['page/about', 'project/research', 0, 0.3, 1],
  ['project/fishai', 'project/staged-recovery', 400, 2.1, -1],
  ['project/research', 'project/days2meet', 130, 4.4, 1],
  ['page/contact', 'project/arc-team', 700, 1.2, -1],
  ['project/l1-cert', 'project/club', 260, 5.5, 1],
  ['project/payload', 'page/resume', 820, 3.3, -1],
];

/** Set out on crossing `c`; and how many steps it flies on the autopilot before it is handed over. */
function setOutOn(c: (typeof CROSSINGS)[number]): Journey {
  const [from, to, t0, angle, spin] = c;
  const journey = dockedAt(from, t0, angle, spin);
  sendTo(journey, to);
  return journey;
}
function cruiseStepsOf(c: (typeof CROSSINGS)[number]): { steps: number; peakAt: number } {
  const journey = setOutOn(c);
  let peak = 0;
  let peakAt = 0;
  let k = 0;
  while (journey.world.dock.phase === 'cruise' && k < 1200) {
    step(journey);
    k += 1;
    if (speedOf(journey.state) > peak) {
      peak = speedOf(journey.state);
      peakAt = k;
    }
  }
  return { steps: k - 1, peakAt };
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
    let hardest = 0;
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
      hardest = Math.max(hardest, report.hardest);
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
    // And no jolts: the plan's braking is held to cruise.comfortDecel, so the hardest the velocity
    // changes in a step is that, the drag and a bend: 898 u/s², measured. (A replan that found a
    // bend close ahead used to brake for it in one step, 2,200 u/s².)
    expect(hardest).toBeLessThan(1000);
  });

  it('never passes through a shell between two steps: 200 journeys, every step swept', () => {
    // Shells are checked where the ship IS after a step (sim/collide.ts, resolveShells). At
    // 700 u/s a step is 12 u, and a small moon's shell is 4.4 u across: a ship could be outside it
    // after one step and past it after the next. So the whole of every step is checked here: the
    // straight line the ship flew, in each body's own frame (the body moves too), must stay out of
    // every shell, from the request until a second after the ship is in orbit (the dock's springs
    // are still settling it then: sim/docking.ts, arrive).
    const rng = createRng('swept');
    const range = (from: number, to: number): number => from + (to - from) * rng();
    const { shellGap } = tuning.cushion;
    const count = MANIFEST.bodies.length;
    const before = new Float64Array(count * 2);
    let least = Infinity;
    let where = '';
    let fastest = 0;
    for (let run = 0; run < 200; run += 1) {
      const t0 = range(0, 900);
      const from = Math.floor(range(0, count));
      let to = Math.floor(range(0, count - 1));
      if (to >= from) to += 1;
      const ids = begin(t0).world.orbits.ids;
      const journey = dockedAt(ids[from] ?? '', t0, range(0, Math.PI * 2), rng() < 0.5 ? 1 : -1);
      const { world, state } = journey;
      const { positions, radius } = world.field;
      const label = `run ${run}: ${ids[from]} -> ${ids[to]}`;
      releaseDock(world.dock, world.assist);
      requestDock(world.dock, to, NO_INPUT, true, tuning.cruise.minJourneySec);
      let docked = -1;
      for (let k = 0; k < 1200 && (docked < 0 || k - docked < 60); k += 1) {
        before.set(positions);
        const x0 = state.x;
        const z0 = state.z;
        step(journey);
        fastest = Math.max(fastest, speedOf(state));
        for (let j = 0; j < count; j += 1) {
          // The step, seen from body j: from where the ship was relative to it to where it is.
          const ax = x0 - (before[j * 2] ?? 0);
          const az = z0 - (before[j * 2 + 1] ?? 0);
          const dx = state.x - (positions[j * 2] ?? 0) - ax;
          const dz = state.z - (positions[j * 2 + 1] ?? 0) - az;
          const span = dx * dx + dz * dz;
          const t = span < 1e-12 ? 0 : Math.min(1, Math.max(0, -(ax * dx + az * dz) / span));
          const clear = Math.hypot(ax + dx * t, az + dz * t) - (radius[j] ?? 0) - shellGap;
          if (clear < least) {
            least = clear;
            where = `${label}, step ${k}, past ${ids[j]}`;
          }
        }
        if (docked < 0 && world.dock.phase === 'docked') docked = k;
      }
      expect(docked, label).toBeGreaterThanOrEqual(0);
    }
    // At full speed, and never through a shell, whatever it went past or came to: the least,
    // measured, is 3.1 u, leaving the ship's own dock (run 155). It was 0.63 u (run 171): a moon
    // passed at 250 u/s just after a replan that kept to a stretch of the old plan 19 degrees off
    // the ship's course (keepStretch). The plan still does that; the reflex (sim/reflex.ts), which
    // looks along the ship's own course, now brakes for the moon.
    expect(fastest).toBeGreaterThan(0.9 * tuning.cruise.far.cruiseSpeed);
    expect(least, where).toBeGreaterThan(tuning.cushion.depth * 0.5);
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

  it('brakes to rest when Stop is pressed, at any moment of a journey, and meets nothing', () => {
    // Stop (ui/Prompt.ts, Navigator.stop) lets go of the journey and brakes the ship to rest where
    // it is (haltDock): at its fastest, every 0.25 s, and 1 to 12 steps before it is handed over.
    // The autopilot's speed goes at once (dropOutOfWarp) and the brake takes the rest: it must not
    // coast on into the next moon, or the next system. (Coasting, as Stop did at first, a Stop in
    // a bend or just before the ship arrived slid on into a moon.)
    const { thrustAccel, forwardDrag, boostFactor } = tuning.flight;
    const top = (thrustAccel * boostFactor) / forwardDrag;
    let fastest = 0;
    let dropMost = 0;
    let slideMost = 0;
    let closest = Infinity;
    let closestAt = '';
    for (const c of CROSSINGS) {
      const { steps, peakAt } = cruiseStepsOf(c);
      const moments = new Set([peakAt, ...[1, 2, 3, 6, 12].map((back) => steps + 1 - back)]);
      for (let k = 15; k < steps; k += 15) moments.add(k);
      for (const at of moments) {
        const label = `${c[0]} -> ${c[1]}, Stop after ${at} steps`;
        const journey = setOutOn(c);
        for (let k = 0; k < at; k += 1) step(journey);
        const { world, state } = journey;
        expect(world.dock.phase, label).toBe('cruise');
        fastest = Math.max(fastest, speedOf(state));
        haltDock(world.dock, world.assist);
        const seen = watchWhole(journey, [], 8, top);
        expect(seen.touched, label).toBe(false);
        // At rest by then (or in an orbit the assist found there), and nobody braking any more.
        expect(world.dock.halting, label).toBe(false);
        dropMost = Math.max(dropMost, seen.dropU);
        slideMost = Math.max(slideMost, seen.slide);
        if (seen.gap < closest) {
          closest = seen.gap;
          closestAt = `${label}: ${seen.gapBody}`;
        }
      }
    }
    // Stopped at 698 u/s: back to the pilot's own top speed (81 u/s) within 94 u, and at rest
    // within 139 u, measured over 105 Stops. Never closer than 5.5 u to anything.
    expect(fastest).toBeGreaterThan(0.9 * tuning.cruise.far.cruiseSpeed);
    expect(dropMost).toBeLessThan(110);
    expect(slideMost).toBeLessThan(160);
    expect(closest, closestAt).toBeGreaterThan(tuning.cushion.depth * 0.5);
  });

  it('changes its mind at any moment of a journey, at any speed, and meets nothing', () => {
    // A visitor pointing at one body and then another: a new destination every 0.1 s of a
    // journey between systems and on its very last step, somewhere different each time, asked
    // for as Navigator.travel does it (sendTo). The plan starts from the way the ship is really
    // going (sim/autopilot.ts, alongPath), and the reflex (sim/reflex.ts) brakes whatever it runs
    // at. The journey harness does the same over bigger galaxies (npm run journeys, "stress").
    const rng = createRng('redirect');
    const ids = begin().world.orbits.ids;
    let flights = 0;
    let slowest = 0;
    let fastest = 0;
    let closest = Infinity;
    let closestAt = '';
    let shellClear = Infinity;
    for (const c of CROSSINGS) {
      const { steps } = cruiseStepsOf(c);
      const moments: number[] = [];
      for (let k = 6; k < steps; k += 6) moments.push(k);
      moments.push(steps);
      for (const at of moments) {
        let to = c[1];
        while (to === c[1]) to = ids[Math.floor(rng() * ids.length)] ?? c[1];
        const label = `${c[0]} -> ${c[1]}, after ${at} steps to ${to}`;
        const journey = setOutOn(c);
        for (let k = 0; k < at; k += 1) step(journey);
        expect(journey.world.dock.phase, label).toBe('cruise');
        fastest = Math.max(fastest, speedOf(journey.state));
        sendTo(journey, to);
        const { orbits } = journey.world;
        const seen = watchWhole(journey, [orbits.indexOf(c[0]), orbits.indexOf(to)], 20);
        expect(seen.docked, label).toBe(true);
        expect(journey.world.dock.body, label).toBe(orbits.indexOf(to));
        expect(seen.touched, label).toBe(false);
        slowest = Math.max(slowest, seen.seconds);
        shellClear = Math.min(shellClear, seen.shellClear);
        if (seen.gap < closest) {
          closest = seen.gap;
          closestAt = `${label}: ${seen.gapBody}`;
        }
        flights += 1;
      }
    }
    // 185 new destinations, asked for at up to 698 u/s: all docked within 6.5 s, never closer
    // than 4.1 u to a surface (3.1 u to a shell), measured.
    expect(flights).toBeGreaterThan(150);
    expect(fastest).toBeGreaterThan(0.9 * tuning.cruise.far.cruiseSpeed);
    expect(slowest).toBeLessThan(8);
    expect(shellClear).toBeGreaterThan(0);
    expect(closest, closestAt).toBeGreaterThan(tuning.cushion.depth * 0.5);
  });

  it('takes a body within reach asked for at cruise speed onto its ring: a firm stop, not a wall', () => {
    // Pointing at a moon the autopilot is racing past: it is within reach, so the Navigator hands
    // it to the APPROACH (sendTo), from whatever speed the ship has. The approach brakes off what
    // it does not want as the autopilot would (sim/docking.ts, approachInput; sim/assist.ts,
    // orbitWish), with the reflex keeping a wider berth for a ship with no plan (REFLEX_LEAD_SEC).
    let flights = 0;
    let fastest = 0;
    let hardest = 0;
    let hardestAt = '';
    let slowest = 0;
    let closest = Infinity;
    let closestAt = '';
    for (const c of CROSSINGS) {
      const probe = setOutOn(c);
      const chances: Array<{ at: number; id: string; speed: number }> = [];
      const { orbits, field } = probe.world;
      for (let k = 1; probe.world.dock.phase === 'cruise' && k < 1200; k += 1) {
        step(probe);
        if (probe.world.dock.phase !== 'cruise' || speedOf(probe.state) < 60) continue;
        for (let j = 0; j < field.count; j += 1) {
          const id = orbits.ids[j] ?? '';
          if (id === c[0] || id === c[1]) continue;
          if (pullOf(field, j, probe.state.x, probe.state.z, tuning.assist) > 0) {
            chances.push({ at: k, id, speed: speedOf(probe.state) });
          }
        }
      }
      for (const chance of chances.filter((_, index) => index % 3 === 0)) {
        const label = `${c[0]} -> ${c[1]}, after ${chance.at} steps to ${chance.id} at ${chance.speed.toFixed(0)} u/s`;
        const journey = setOutOn(c);
        for (let k = 0; k < chance.at; k += 1) step(journey);
        sendTo(journey, chance.id);
        expect(journey.world.dock.phase, label).toBe('approach');
        fastest = Math.max(fastest, chance.speed);
        const to = orbits.indexOf(chance.id);
        const seen = watchWhole(journey, [orbits.indexOf(c[0]), to], 20);
        expect(seen.docked, label).toBe(true);
        expect(journey.world.dock.body, label).toBe(to);
        expect(seen.touched, label).toBe(false);
        slowest = Math.max(slowest, seen.seconds);
        if (seen.accel > hardest) {
          hardest = seen.accel;
          hardestAt = label;
        }
        if (seen.gap < closest) {
          closest = seen.gap;
          closestAt = `${label}: ${seen.gapBody}`;
        }
        flights += 1;
      }
    }
    // And faster than any journey here passes a body: a sun, a planet and a moon skimmed at up to
    // full cruise speed, going past it and cutting in; wherever the autopilot could be going that
    // fast (the plans and the reflex allow openSpaceGain u/s for each unit of room: no other body
    // nearer than speed / openSpaceGain, and no faster toward this one than its room allows).
    let fastCases = 0;
    for (const id of ['system/berkeley', 'system/code', 'project/research', 'project/payload']) {
      for (const speed of [440, 700]) {
        for (const inward of [0, 0.4, 0.8]) {
          for (let angle = 0; angle < 6.2; angle += 0.5) {
            const probe = begin(300);
            const i = probe.world.orbits.indexOf(id);
            const reach = tuning.assist.soiRadii * (probe.world.field.ringRadius[i] ?? 0);
            const journey = flyingNear(
              id,
              reach - 2,
              angle,
              angle + Math.PI / 2 + inward,
              speed,
              300,
            );
            let room = Infinity;
            for (let j = 0; j < journey.world.field.count; j += 1) {
              if (j !== i) room = Math.min(room, gap(journey, j));
            }
            const toward = speed * Math.sin(inward);
            const own = gap(journey, i) - tuning.cushion.depth;
            if (room < speed / tuning.cruise.openSpaceGain) continue;
            if (toward > tuning.cruise.openSpaceGain * own) continue;
            fastCases += 1;
            fastest = Math.max(fastest, speed);
            sendTo(journey, id);
            const label = `${id} at ${speed} u/s, ${inward} rad in, from ${angle}`;
            expect(journey.world.dock.phase, label).toBe('approach');
            const seen = watchWhole(journey, [i], 20);
            expect(seen.docked, label).toBe(true);
            expect(seen.touched, label).toBe(false);
            slowest = Math.max(slowest, seen.seconds);
            if (seen.accel > hardest) {
              hardest = seen.accel;
              hardestAt = label;
            }
            if (seen.gap < closest) {
              closest = seen.gap;
              closestAt = `${label}: ${seen.gapBody}`;
            }
            flights += 1;
          }
        }
      }
    }
    // 66 approaches, 21 of them begun at 440 u/s: all docked within 5.4 s, never closer than
    // 2.7 u to a surface. The hardest the velocity changed in a step was 1,336 u/s² (the approach
    // brakes off what it does not want at up to 1,000 u/s², sim/assist.ts FAR_DECEL, while it turns
    // for the ring; the reflex may brake harder), measured: a firm stop from cruise speed, not a
    // wall (the brake could do 2,750 u/s² at 440 u/s).
    expect(fastCases).toBeGreaterThan(15);
    expect(flights).toBeGreaterThan(50);
    expect(slowest).toBeLessThan(8);
    expect(hardest, hardestAt).toBeLessThan(1400);
    expect(closest, closestAt).toBeGreaterThan(tuning.cushion.depth * 0.5);
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
    beginCruise(world.cruise, tuning.cruise.minJourneySec);
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
    // ...but not while the journey must still last a little longer (its hold: the shortest
    // journey, cruise.minJourneySec, less what has passed).
    const waiting = (sec: number): boolean =>
      cruiseArrived(world.field, state, i, tuning.cruise, tuning.dock, sec);
    expect(waiting(0.1)).toBe(false);
    expect(waiting(0)).toBe(true);

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
