import {
  assistInput,
  createAssistState,
  type AssistParams,
  type AssistState,
  type BodyField,
} from './assist';
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
  /** Row of the body whose shell the ship touched in the last step, or -1. */
  touched: number;
}

export interface SurroundingsParams {
  readonly assist: AssistParams;
  readonly cushion: CushionParams;
  readonly edge: EdgeParams;
  readonly dock: DockParams;
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
 * Far from everything this is exactly `stepFlight`, bit for bit. A DOCKED ship is not flown at
 * all: it is carried round its body (sim/docking.ts), and `flown` is empty.
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

  if (dock.phase === 'approach') {
    approachInput(field, state, flight, params.assist, params.dock, dock, world.assist, flown);
  } else {
    assistInput(field, state, pilot, flight, params.assist, world.assist, flown);
  }
  push.x = 0;
  push.z = 0;
  addCushions(field, state, params.cushion, push);
  addEdgePull(world.edge, state, params.edge, push);

  stepFlight(state, flown, flight, dt, push);
  world.touched = resolveShells(field, state, params.cushion);
  if (dock.phase === 'approach') tryCapture(field, state, params.dock, dock, world.assist, dt);
  return state;
}

function copyInput(from: Readonly<FlightInput>, to: FlightInput): void {
  to.thrust = from.thrust;
  to.turn = from.turn;
  to.brake = from.brake;
  to.boost = from.boost;
}
