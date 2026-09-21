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
import { stepFlight } from './flight';
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
  /** Row of the body whose shell the ship touched in the last step, or -1. */
  touched: number;
}

export interface SurroundingsParams {
  readonly assist: AssistParams;
  readonly cushion: CushionParams;
  readonly edge: EdgeParams;
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
    touched: -1,
  };
}

const push: Vec2 = { x: 0, z: 0 };

/**
 * One step of flight among the bodies. `simTime` is the time the ship will have AFTER the step
 * (what core/Engine.ts hands to fixedUpdate), and the bodies are put where they are at that
 * time. `flown` receives what was actually flown: the pilot's input with the assist mixed in.
 *
 * Far from everything this is exactly `stepFlight`, bit for bit.
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

  assistInput(field, state, pilot, flight, params.assist, world.assist, flown);
  push.x = 0;
  push.z = 0;
  addCushions(field, state, params.cushion, push);
  addEdgePull(world.edge, state, params.edge, push);

  stepFlight(state, flown, flight, dt, push);
  world.touched = resolveShells(field, state, params.cushion);
  return state;
}
