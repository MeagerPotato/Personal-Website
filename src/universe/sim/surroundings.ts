import {
  assistInput,
  createAssistState,
  type AssistParams,
  type AssistState,
  type BodyField,
} from './assist';
import {
  beginCruise,
  createCruiseState,
  cruiseArrived,
  cruiseInput,
  type CruiseParams,
  type CruiseState,
} from './autopilot';
import {
  addCushions,
  addEdgePull,
  resolveShells,
  worldEdge,
  type CushionParams,
  type EdgeParams,
  type WorldEdge,
} from './collide';
import {
  approachInput,
  arrive,
  createDockState,
  pilotLeaves,
  stepDocked,
  tryCapture,
  type DockParams,
  type DockState,
} from './docking';
import { NO_INPUT, stepFlight } from './flight';
import { bodyPositions, createOrbitTable, type OrbitTable, type OrbitingBody } from './orbits';
import type { FlightInput, FlightParams, ShipState, Vec2 } from './types';

/**
 * WHAT THE SHIP FLIES AMONG: the bodies of the galaxy as the simulation sees them (where they
 * are, how big, which ring a ship circles them on), the edge of the world, and what the orbit
 * assist is doing. `flyStep` is one whole step of flight among them.
 */
export interface Surroundings {
  readonly orbits: OrbitTable;
  readonly field: BodyField;
  readonly edge: WorldEdge;
  readonly assist: AssistState;
  /** Whether the ship is asking to stay at a body, or staying there (sim/docking.ts). */
  readonly dock: DockState;
  /** The journey to a body that is out of reach, while `dock.phase` is `cruise`. */
  readonly cruise: CruiseState;
  /** Row of the body whose shell the ship touched in the last step, or -1. */
  touched: number;
}

export interface SurroundingsParams {
  readonly assist: AssistParams;
  readonly cushion: CushionParams;
  readonly edge: EdgeParams;
  readonly dock: DockParams;
  readonly cruise: CruiseParams;
}

/** The few fields of a manifest body that matter here (structural, like sim/orbits.ts). */
export interface SolidBody extends OrbitingBody {
  readonly radius: number;
  readonly dockRadius: number;
}

export interface SurroundingsInput {
  readonly systems: readonly {
    readonly id: string;
    readonly position: readonly [number, number];
    readonly radius: number;
  }[];
  readonly bodies: readonly SolidBody[];
  /** Centre of the world: the home system. */
  readonly home: readonly [x: number, z: number];
}

export function createSurroundings(input: SurroundingsInput, edgeMargin: number): Surroundings {
  const orbits = createOrbitTable(input.systems, input.bodies);
  const field = {
    count: orbits.count,
    positions: new Float64Array(orbits.count * 2),
    velocities: new Float64Array(orbits.count * 2),
    radius: new Float64Array(orbits.count),
    ringRadius: new Float64Array(orbits.count),
  };
  for (const body of input.bodies) {
    const i = orbits.indexOf(body.id);
    field.radius[i] = body.radius;
    field.ringRadius[i] = body.dockRadius;
  }
  bodyPositions(orbits, 0, field.positions, field.velocities);
  return {
    orbits,
    field,
    edge: worldEdge(input.systems, input.home, edgeMargin),
    assist: createAssistState(),
    dock: createDockState(),
    cruise: createCruiseState(orbits.count),
    touched: -1,
  };
}

/** Put every body where it is at `simTime`: before placing a ship among them between steps. */
export function syncSurroundings(world: Surroundings, simTime: number): void {
  bodyPositions(world.orbits, simTime, world.field.positions, world.field.velocities);
}

const push: Vec2 = { x: 0, z: 0 };

/**
 * One step of flight among the bodies. `simTime` is the time the ship will have AFTER the step
 * (what core/Engine.ts hands to fixedUpdate), and the bodies are put where they are at that
 * time. `flown` receives what was actually flown: the pilot's input with the assist mixed in.
 *
 * Far from everything this is exactly `stepFlight`, bit for bit (at any speed the pilot's own
 * drive can reach: faster than that, the ship drops out of warp, `dropOutOfWarp`). A DOCKED ship
 * is not flown at all: it is carried round its body (sim/docking.ts), and `flown` is empty. A
 * CRUISING ship is flown by the autopilot, with the autopilot's stronger drive, until it arrives
 * beside its body's ring and is taken into orbit there.
 */
export function flyStep(
  world: Surroundings,
  state: ShipState,
  pilot: Readonly<FlightInput>,
  flight: FlightParams,
  params: SurroundingsParams,
  dt: number,
  simTime: number,
  flown: FlightInput,
): ShipState {
  const { field } = world;
  bodyPositions(world.orbits, simTime, field.positions, field.velocities);

  const { dock } = world;
  pilotLeaves(dock, pilot, params.dock, world.assist);
  if (dock.phase === 'docked') {
    stepDocked(field, state, params.dock, dock, dt);
    copyInput(NO_INPUT, flown);
    world.assist.weight = 1;
    world.touched = -1;
    return state;
  }

  let drive = flight;
  if (dock.phase === 'cruise') {
    const { cruise } = world;
    if (dock.phaseSec === 0) beginCruise(cruise, dock.holdSec);
    dock.phaseSec += dt;
    cruiseInput(
      world.orbits,
      field,
      state,
      dock.body,
      simTime,
      dt,
      params.cruise,
      params.dock,
      cruise,
      flown,
    );
    drive = params.cruise.flight;
    world.assist.weight = 1;
  } else if (dock.phase === 'approach') {
    // The approach is the autopilot's last stretch, and flies with its drive.
    approachInput(
      field,
      state,
      params.cruise.flight,
      params.assist,
      params.dock,
      dock,
      world.assist,
      flown,
    );
    drive = params.cruise.flight;
  } else {
    assistInput(field, state, pilot, flight, params.assist, world.assist, flown);
  }
  push.x = 0;
  push.z = 0;
  addCushions(field, state, params.cushion, push);
  addEdgePull(world.edge, state, params.edge, push);

  stepFlight(state, flown, drive, dt, push);
  if (dock.phase === 'free') dropOutOfWarp(state, flight, params.cruise.dropOutPerSec, dt);
  world.touched = resolveShells(field, state, params.cushion);
  if (
    dock.phase === 'cruise' &&
    cruiseArrived(
      field,
      state,
      dock.body,
      params.cruise,
      params.dock,
      world.cruise.holdSec - world.cruise.elapsedSec,
    )
  ) {
    // Arrived beside the ring, along it: in orbit from here, the same way round as the journey
    // came in, and the dock's springs settle the rest (sim/docking.ts, arrive).
    world.assist.body = dock.body;
    world.assist.spin = world.cruise.spin;
    arrive(field, state, dock, world.cruise.spin);
  } else if (dock.phase === 'approach') {
    tryCapture(field, state, params.dock, dock, world.assist, dt);
  }
  return state;
}

/**
 * OUT OF WARP. A ship going faster than its pilot's own drive ever could (the autopilot's doing,
 * handed back in the middle of a journey: Stop, or a touch of the controls) loses the difference
 * at `perSec` per second: under a second from 700 u/s down to what the pilot can fly, instead of
 * coasting on for most of a thousand units, past the next system. Its course stays as it is, and
 * so does where it is this step (it has already moved); at any speed the pilot can reach by
 * themselves it does nothing at all.
 */
export function dropOutOfWarp(
  state: ShipState,
  flight: FlightParams,
  perSec: number,
  dt: number,
): ShipState {
  const top = (flight.thrustAccel * flight.boostFactor) / Math.max(flight.forwardDrag, 1e-9);
  const speed = Math.hypot(state.vx, state.vz);
  if (!(speed > top) || !(perSec > 0)) return state;
  const scale = (top + (speed - top) * Math.exp(-perSec * dt)) / speed;
  state.vx *= scale;
  state.vz *= scale;
  return state;
}

function copyInput(from: Readonly<FlightInput>, to: FlightInput): void {
  to.thrust = from.thrust;
  to.turn = from.turn;
  to.brake = from.brake;
  to.boost = from.boost;
}
