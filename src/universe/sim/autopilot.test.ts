import { describe, expect, it } from 'vitest';
import { buildUniverse } from '../data/build';
import type { ProjectInput, UniverseInput } from '../data/types';
import { tuning } from '../design/tuning';
import { beginCruise, cruiseArrived, planCruise } from './autopilot';
import { dockAt, releaseDock, requestDock } from './docking';
import { NO_INPUT, copyShipState, createShipState, speedOf, stepFlight } from './flight';
import { angleDelta } from './math';
import { createRng } from './rng';
import { createSurroundings, flyStep, syncSurroundings, type Surroundings } from './surroundings';
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
  /** Relative to the body, at the moment the docking approach took over, u/s. */
  handOverPace: number;
  /** The hardest the stick was held over while going faster than 100 u/s. */
  fastTurn: number;
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
    fastTurn: 0,
  };
  const began = journey.t;
  let phase = world.dock.phase;
  while (journey.t - began < limitSec) {
    step(journey);
    const speed = speedOf(journey.state);
    report.topSpeed = Math.max(report.topSpeed, speed);
    report.touched ||= world.touched >= 0;
    if (speed > 100 && journey.t - began > 2.5) {
      report.fastTurn = Math.max(report.fastTurn, Math.abs(journey.flown.turn));
    }
    for (let j = 0; j < world.field.count; j += 1) {
      if (j !== i && j !== from) report.leastGap = Math.min(report.leastGap, gap(journey, j));
    }
    if (phase === 'cruise' && world.dock.phase === 'approach') {
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
    // About a thousand units: some six seconds of cruising. Leaving one ring, threading into a
    // crowded system at a careful pace, and settling onto another ring are on top of that.
    expect(report.seconds).toBeLessThan(17);
    expect(report.topSpeed).toBeGreaterThan(200);
    expect(report.topSpeed).toBeLessThanOrEqual(tuning.cruise.far.cruiseSpeed * 1.05);
    expect(report.handOverPace).toBeLessThan(tuning.assist.orbitSpeed * 2.5);
    expect(report.touched).toBe(false);
    expect(journey.world.dock.body).toBe(journey.world.orbits.indexOf('project/fishai'));
  });

  it('hops to the next planet at a calmer pace', () => {
    const journey = dockedAt('project/days2meet');
    const from = journey.world.orbits.indexOf('project/days2meet');
    const report = travel(journey, 'project/odds', from);
    expect(report.docked).toBe(true);
    expect(report.topSpeed).toBeLessThanOrEqual(tuning.cruise.near.cruiseSpeed * 1.05);
    expect(report.touched).toBe(false);
  });

  it('gets from anywhere to anywhere: 200 journeys, never touching a thing', () => {
    const rng = createRng('journeys');
    const range = (from: number, to: number): number => from + (to - from) * rng();
    let slowest = 0;
    let closest = Infinity;
    let total = 0;
    const turns: number[] = [];
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
      closest = Math.min(closest, report.leastGap);
      total += report.seconds;
      turns.push(report.fastTurn);
    }
    // The longest trip in this galaxy is some 2,500 u.
    expect(slowest).toBeLessThan(26);
    expect(total / 200).toBeLessThan(14);
    // Bodies passed on the way are given a wide berth: never so close as to feel their cushion.
    expect(closest).toBeGreaterThan(tuning.cushion.depth * 0.5);
    // At speed the stick is held still: nine journeys in ten never use a quarter of it.
    turns.sort((a, b) => a - b);
    expect(turns[180]).toBeLessThan(0.25);
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

  it('gives the controls back the moment the pilot steers, without touching the velocity', () => {
    const journey = dockedAt('page/about');
    const { world } = journey;
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf('project/fishai'), NO_INPUT, true);
    for (let k = 0; k < 240; k += 1) step(journey);
    expect(world.dock.phase).toBe('cruise');
    expect(speedOf(journey.state)).toBeGreaterThan(150);

    // Far from everything, the step in which the pilot grabs the stick is an ordinary step of
    // ordinary flight: same position, same velocity, the pilot's own engine from here on.
    const before = copyShipState(journey.state, createShipState());
    const steer: FlightInput = { thrust: 0, turn: 1, brake: 0, boost: false };
    step(journey, steer);
    expect(world.dock.phase).toBe('free');
    expect(world.dock.leftByPilot).toBe(true);
    expect(journey.state).toEqual(stepFlight(before, steer, tuning.flight, STEP));

    // And from there the ship simply coasts down: nobody is flying it any more.
    step(journey, NO_INPUT);
    expect(world.dock.leftByPilot).toBe(false);
    for (let k = 0; k < 300; k += 1) step(journey, NO_INPUT);
    expect(speedOf(journey.state)).toBeLessThan(20);
    expect(world.dock.phase).toBe('free');
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
      tuning.assist,
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

    // Not where the planet is now...
    const now = Math.hypot(
      endX - (world.field.positions[i * 2] ?? 0),
      endZ - (world.field.positions[i * 2 + 1] ?? 0),
    );
    expect(Math.abs(now - reach)).toBeGreaterThan(1);
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
    expect(long.far).toBe(true);
    expect(Math.max(...long.speeds.subarray(0, long.path.count))).toBeCloseTo(
      tuning.cruise.far.cruiseSpeed,
      6,
    );

    const near = dockedAt('project/days2meet');
    const short = plan(near, 'project/odds');
    expect(short.path.length).toBeLessThan(tuning.cruise.longLeg);
    expect(short.far).toBe(false);
    expect(Math.max(...short.speeds.subarray(0, short.path.count))).toBeLessThanOrEqual(
      tuning.cruise.near.cruiseSpeed,
    );

    // A long journey that has become short is still flown as a long one: no sudden braking.
    const { world } = far;
    const i = world.orbits.indexOf('project/fishai');
    far.state.x = (world.field.positions[i * 2] ?? 0) + 300;
    far.state.z = world.field.positions[i * 2 + 1] ?? 0;
    planCruise(world.orbits, world.field, far.state, i, far.t, tuning.cruise, tuning.assist, long);
    expect(long.path.length).toBeLessThan(tuning.cruise.longLeg);
    expect(long.far).toBe(true);
  });

  it('is slow wherever there is no room, however long the journey', () => {
    const journey = dockedAt('page/about');
    const cruise = plan(journey, 'project/fishai');
    // The first samples lie inside the keep-out of the body the ship is leaving.
    expect(cruise.ceiling[0]).toBe(tuning.cruise.keepOutSpeed);
    // Out in the open the ceiling is far above anything the profile asks for.
    const middle = Math.floor(cruise.path.count / 2);
    expect(cruise.ceiling[middle]).toBeGreaterThan(tuning.cruise.far.cruiseSpeed);
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
      tuning.assist,
      cruise,
    );
    expect(cruise.spin).toBe(chosen);
    expect(Math.abs(cruise.path.length - first)).toBeLessThan(first * 0.1);
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
    const arrived = (): boolean =>
      cruiseArrived(world.field, state, i, tuning.cruise, tuning.assist);

    // On the circle, keeping pace with the planet: handed over.
    state.x = (positions[i * 2] ?? 0) + reach;
    state.z = positions[i * 2 + 1] ?? 0;
    state.vx = velocities[i * 2] ?? 0;
    state.vz = velocities[i * 2 + 1] ?? 0;
    expect(arrived()).toBe(true);

    // The same place at a gallop: the approach is a gentle pilot, and is not given this.
    state.vz += 80;
    expect(arrived()).toBe(false);
    state.vz -= 80;

    // Too far out.
    state.x = (positions[i * 2] ?? 0) + reach * 1.3;
    expect(arrived()).toBe(false);
  });
});
