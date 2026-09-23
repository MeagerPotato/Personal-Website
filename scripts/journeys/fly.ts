import type { UniverseManifest } from '../../src/universe/data/types';
import { tuning } from '../../src/universe/design/tuning';
import { homeSystemOf, nearestNeighbourOf } from '../../src/universe/manifest';
import { NO_INPUT, copyShipState, createShipState, speedOf } from '../../src/universe/sim/flight';
import { createRng } from '../../src/universe/sim/rng';
import { spawnPoint } from '../../src/universe/sim/spawn';
import {
  createSurroundings,
  flyStep,
  syncSurroundings,
  type Surroundings,
} from '../../src/universe/sim/surroundings';
import type { FlightInput, ShipState } from '../../src/universe/sim/types';
import type { AppMode } from '../../src/universe/state/appMachine';
import { Navigator, type NavigatorEvents } from '../../src/universe/state/Navigator';
import { mergeInto, type DeepPartial } from './merge';

// ONE JOURNEY, flown by the real simulation exactly as the engine flies it (universe/main.ts):
// the ship starts where the engine would put it (ShipSystem at the spawn point, then
// Navigator.place for a page opened on a body), and every fixed 60 Hz step is ShipSystem's
// flyStep followed by the Navigator's fixedUpdate, with its events delivered after the step as
// a frame would. The journey is asked for the way pointing at a body asks for it
// (Navigator.travel, main.ts flyToRow; a link's goTo makes the same call), with nobody touching
// the controls. It ends when the Navigator says `docked` there: the moment the page opens.
//
// Nothing about flight, the autopilot or docking is reimplemented here: this file only watches.

const TAU = Math.PI * 2;

/** The tuning blocks the simulation reads, as the engine passes them to flyStep and the Navigator. */
type SimBlocks = Pick<typeof tuning, 'flight' | 'cruise' | 'assist' | 'cushion' | 'edge' | 'dock'>;

export type SimTuning = SimBlocks & {
  /** tuning.ship.spawn: where a new visitor starts (sim/spawn.ts). */
  readonly spawn: (typeof tuning)['ship']['spawn'];
  readonly stepHz: number;
};

/** Overrides of those blocks, merged over tuning.ts (unknown keys throw). `spawn` is ship.spawn. */
export type TuningOverrides = DeepPartial<SimBlocks & { spawn: (typeof tuning)['ship']['spawn'] }>;

export function simTuning(overrides: TuningOverrides = {}): SimTuning {
  const blocks = structuredClone({
    flight: tuning.flight,
    cruise: tuning.cruise,
    assist: tuning.assist,
    cushion: tuning.cushion,
    edge: tuning.edge,
    dock: tuning.dock,
    spawn: tuning.ship.spawn,
  });
  mergeInto(blocks, overrides);
  return { ...blocks, stepHz: tuning.loop.stepHz };
}

export type JourneyKind = 'between' | 'within' | 'spawn';

export interface JourneySpec {
  kind: JourneyKind;
  /** Body id the ship starts docked at, or null: at rest at the spawn point, as a new visitor. */
  from: string | null;
  to: string;
  /** Simulation time (s) at which the ship is placed (0 for a new visitor: the engine starts at step 0). */
  startSec: number;
  /** A docked start: where on the ring (radians) and which way round. */
  angle: number;
  spin: 1 | -1;
  /** Seconds between being placed and asking for the journey (reading the page, or the hint). */
  dwellSec: number;
}

export type Failure = 'timeout' | 'shell' | 'graze';

export interface JourneyResult {
  kind: JourneyKind;
  from: string;
  to: string;
  fromSystem: string;
  toSystem: string;
  /** Simulation time of the request, s. */
  askedAt: number;
  /** Ship to the target's centre at the request, u. */
  straightU: number;
  /** Request to capture (the page opens), s. The limit when it never docked. */
  seconds: number;
  docked: boolean;
  /** What Navigator.travel did: set out on the autopilot, or (within reach) went straight to the approach. */
  how: 'travel' | 'approach';
  /** The cruise profile the first plan chose (tuning.cruise.longLeg), or '-' without a cruise. */
  profile: 'far' | 'near' | '-';
  /** Length (u) and expected duration (s) of the first plan. */
  planU: number;
  planEtaSec: number;
  peakSpeed: number;
  /**
   * The phases, which add up to `seconds`:
   *   takeoff   the request until the ship is out of the start body's reach (assist.soiRadii ring
   *             radii), or from the spawn point until the autopilot first gives full thrust.
   *   cruise    from there until the autopilot hands over to the docking approach.
   *   approach  from the hand-over until the ship is within 4 capture distances of the ring.
   *   capture   from there until it is captured (dock.captureDistance, captureRadialSpeed).
   */
  takeoffSec: number;
  cruiseSec: number;
  approachSec: number;
  captureSec: number;
  firstThrustSec: number;
  /** Closest the ship came to the SURFACE of a body it neither left nor went to, u. */
  closestGapU: number;
  closestBody: string;
  /** Steps in which the ship was stopped by a shell (sim/collide.ts, resolveShells). */
  shellTouches: number;
  /** The approach ran out of time and the ship was captured where it was (dock.approachTimeoutSec). */
  approachTimedOut: boolean;
  /**
   * timeout: not docked within the limit. shell: touched a shell. graze: came closer than half a
   * cushion to a body it was only passing (the bound the autopilot's own test pins).
   */
  failure: Failure | null;
}

export interface Galaxy {
  name: string;
  manifest: UniverseManifest;
}

/** What `watch` sees after every step of a journey: for traces while working on a proposal. */
export interface StepView {
  /** Seconds since the request. */
  t: number;
  state: Readonly<ShipState>;
  world: Readonly<Surroundings>;
  flown: Readonly<FlightInput>;
  mode: AppMode;
}

export function fly(
  galaxy: Galaxy,
  spec: JourneySpec,
  sim: SimTuning,
  limitSec = 60,
  watch?: (view: StepView) => void,
): JourneyResult {
  const { manifest } = galaxy;
  const dt = 1 / sim.stepHz;
  const home = homeSystemOf(manifest);
  const spawn = spawnPoint(
    home.position,
    nearestNeighbourOf(manifest, home)?.position ?? null,
    sim.spawn,
  );
  const world = createSurroundings(
    { systems: manifest.systems, bodies: manifest.bodies, home: home.position },
    sim.edge.margin,
  );
  const { field, orbits } = world;
  const state = createShipState(spawn.x, spawn.z, spawn.heading);
  const pilot: { current: Readonly<FlightInput> } = { current: NO_INPUT };
  const flown: FlightInput = { ...NO_INPUT };
  /** Every `docked` the Navigator announced, in order. */
  const dockings: string[] = [];
  const navigator = new Navigator({
    surroundings: world,
    ship: { state, restore: (to) => void copyShipState(to, state) },
    pilot,
    params: sim,
    emit: (event, payload) => {
      if (event === 'docked') dockings.push((payload as NavigatorEvents['docked']).id);
    },
  });

  let steps = Math.round(spec.startSec * sim.stepHz);
  const step = (): void => {
    steps += 1;
    flyStep(world, state, pilot.current, sim.flight, sim, dt, steps * dt, flown);
    navigator.fixedUpdate();
    navigator.frameUpdate();
  };

  // Where the engine would have the ship: docked (a page opened on a body), or at the spawn point.
  syncSurroundings(world, steps * dt);
  if (spec.from !== null && !navigator.place(spec.from, spec.angle, spec.spin)) {
    throw new Error(`${galaxy.name}: no body "${spec.from}"`);
  }
  navigator.frameUpdate();
  for (let k = Math.round(spec.dwellSec * sim.stepHz); k > 0; k -= 1) step();

  const target = orbits.indexOf(spec.to);
  const start = spec.from === null ? -1 : orbits.indexOf(spec.from);
  if (target < 0) throw new Error(`${galaxy.name}: no body "${spec.to}"`);
  const bodyX = (i: number): number => field.positions[i * 2] ?? 0;
  const bodyZ = (i: number): number => field.positions[i * 2 + 1] ?? 0;
  const straightU = Math.hypot(state.x - bodyX(target), state.z - bodyZ(target));

  dockings.length = 0;
  if (!navigator.travel(spec.to, 'pilot'))
    throw new Error(`${galaxy.name}: cannot go to "${spec.to}"`);
  const how = navigator.state.mode === 'autopilot' ? 'travel' : 'approach';
  const began = steps;
  const askedAt = began * dt;

  const startReach = start < 0 ? 0 : sim.assist.soiRadii * (field.ringRadius[start] ?? 0);
  const ring = field.ringRadius[target] ?? 0;
  const onRingBand = 4 * sim.dock.captureDistance;
  const grazeBelow = sim.cushion.depth * 0.5;

  let peakSpeed = 0;
  let firstThrust = -1;
  let clear = -1;
  let handOff = how === 'approach' ? 0 : -1;
  let onRing = -1;
  let planU = 0;
  let planEtaSec = 0;
  let profile: JourneyResult['profile'] = '-';
  let closestGapU = Infinity;
  let closestBody = -1;
  let shellTouches = 0;
  let seconds = limitSec;
  let docked = false;

  while ((steps - began) * dt < limitSec) {
    step();
    const t = (steps - began) * dt;

    peakSpeed = Math.max(peakSpeed, speedOf(state));
    if (world.touched >= 0) shellTouches += 1;
    for (let j = 0; j < field.count; j += 1) {
      if (j === start || j === target) continue;
      const gap = Math.hypot(state.x - bodyX(j), state.z - bodyZ(j)) - (field.radius[j] ?? 0);
      if (gap < closestGapU) {
        closestGapU = gap;
        closestBody = j;
      }
    }

    if (firstThrust < 0 && flown.thrust > 0.05) firstThrust = t;
    if (clear < 0) {
      const out =
        start >= 0
          ? Math.hypot(state.x - bodyX(start), state.z - bodyZ(start)) > startReach
          : flown.thrust >= 0.99;
      if (out) clear = t;
    }
    if (how === 'travel' && planU === 0 && world.cruise.path.count > 0) {
      planU = world.cruise.path.length;
      planEtaSec = world.cruise.etaSec;
      profile = world.cruise.far === null ? '-' : world.cruise.far ? 'far' : 'near';
    }
    if (handOff < 0 && world.dock.phase !== 'cruise') handOff = t;
    if (handOff >= 0 && onRing < 0) {
      const d = Math.hypot(state.x - bodyX(target), state.z - bodyZ(target));
      if (Math.abs(d - ring) < onRingBand) onRing = t;
    }
    watch?.({ t, state, world, flown, mode: navigator.state.mode });
    if (dockings.includes(spec.to)) {
      docked = true;
      seconds = t;
      break;
    }
  }

  const end = seconds;
  const handedOver = handOff >= 0 ? handOff : end;
  const takeoff = Math.min(clear >= 0 ? clear : handedOver, handedOver);
  const ringAt = onRing >= 0 ? Math.min(onRing, end) : end;
  const approachSec = ringAt - handedOver;
  const failure: Failure | null = !docked
    ? 'timeout'
    : shellTouches > 0
      ? 'shell'
      : closestGapU < grazeBelow
        ? 'graze'
        : null;

  const systemOf = (id: string | null): string =>
    id === null ? 'spawn' : (manifest.bodies.find((body) => body.id === id)?.system ?? '?');
  return {
    kind: spec.kind,
    from: spec.from ?? 'spawn',
    to: spec.to,
    fromSystem: systemOf(spec.from),
    toSystem: systemOf(spec.to),
    askedAt,
    straightU,
    seconds,
    docked,
    how,
    profile,
    planU,
    planEtaSec,
    peakSpeed,
    takeoffSec: takeoff,
    cruiseSec: handedOver - takeoff,
    approachSec,
    captureSec: end - ringAt,
    firstThrustSec: firstThrust,
    closestGapU,
    closestBody: orbits.ids[closestBody] ?? '-',
    shellTouches,
    approachTimedOut:
      docked && handOff >= 0 && end - handOff >= sim.dock.approachTimeoutSec - dt / 2,
    failure,
  };
}

// --- which journeys ----------------------------------------------------------------------------

export interface Sample {
  /** Ordered pairs of bodies in different systems: all of them, or a seeded sample of this many. */
  between: 'all' | number;
  /** Ordered pairs inside one system (home included): all, or a seeded sample of this many. */
  within: 'all' | number;
  /** From the spawn point, at rest, to every body. */
  spawn: boolean;
  /** Start conditions per pair: time (so where every planet is), place on the ring, way round. */
  starts: number;
}

function pick<T>(items: T[], count: 'all' | number, seed: string): T[] {
  if (count === 'all' || count >= items.length) return items;
  const rng = createRng(seed);
  const order = items.map((item, index) => ({ item, index, key: rng() }));
  return order
    .sort((a, b) => a.key - b.key)
    .slice(0, Math.max(0, count))
    .sort((a, b) => a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Every journey to fly in `galaxy`, with seeded start conditions: the same galaxy name, pair and
 * seed always give the same start, whatever the tuning, so variants are compared like for like.
 */
export function planJourneys(galaxy: Galaxy, sample: Sample, seed: string): JourneySpec[] {
  const { bodies } = galaxy.manifest;
  const between: Array<[string, string]> = [];
  const within: Array<[string, string]> = [];
  for (const a of bodies) {
    for (const b of bodies) {
      if (a.id === b.id) continue;
      (a.system === b.system ? within : between).push([a.id, b.id]);
    }
  }
  const specs: JourneySpec[] = [];
  const add = (kind: JourneyKind, from: string | null, to: string): void => {
    for (let k = 0; k < sample.starts; k += 1) {
      const rng = createRng(`${seed}|${galaxy.name}|${from ?? 'spawn'}|${to}|${k}`);
      const startSec = from === null ? 0 : rng() * 1200;
      const angle = rng() * TAU;
      const spin = rng() < 0.5 ? -1 : 1;
      // A new visitor reads the hint first; a docked one has been carried round for a moment.
      const dwellSec = from === null ? 0.5 + rng() * 7.5 : 0.5;
      specs.push({ kind, from, to, startSec, angle, spin, dwellSec });
    }
  };
  for (const [a, b] of pick(between, sample.between, `${seed}|${galaxy.name}|between`)) {
    add('between', a, b);
  }
  for (const [a, b] of pick(within, sample.within, `${seed}|${galaxy.name}|within`)) {
    add('within', a, b);
  }
  if (sample.spawn) for (const body of bodies) add('spawn', null, body.id);
  return specs;
}
