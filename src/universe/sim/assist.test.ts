import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { pullOf } from './assist';
import { pastEdge } from './collide';
import { NO_INPUT, copyShipState, createShipState, speedOf, stepFlight } from './flight';
import { angleDelta, angleOf } from './math';
import { createRng } from './rng';
import {
  createSurroundings,
  flyStep,
  type Surroundings,
  type SurroundingsInput,
} from './surroundings';
import type { FlightInput, ShipState } from './types';

const STEP = 1 / 60;

/** The shape of the real galaxy: a home planet with a station, and a sun with a planet and a moon. */
const GALAXY: SurroundingsInput = {
  home: [0, 0],
  systems: [
    { id: 'home', position: [0, 0], radius: 66 },
    { id: 'code', position: [-700, 600], radius: 200 },
  ],
  bodies: [
    { id: 'home', system: 'home', parent: null, orbit: null, radius: 14, dockRadius: 26.6 },
    {
      id: 'station',
      system: 'home',
      parent: 'home',
      orbit: { radius: 38.8, phase: 0, periodSec: 125 },
      radius: 2.2,
      dockRadius: 8.2,
    },
    { id: 'sun', system: 'code', parent: null, orbit: null, radius: 20, dockRadius: 38 },
    {
      id: 'planet',
      system: 'code',
      parent: 'sun',
      orbit: { radius: 143, phase: 1, periodSec: 883 },
      radius: 12,
      dockRadius: 22.8,
    },
    {
      id: 'moon',
      system: 'code',
      parent: 'planet',
      orbit: { radius: 52.4, phase: 2, periodSec: 196 },
      radius: 1.2,
      dockRadius: 7.2,
    },
  ],
};

const world = (): Surroundings => createSurroundings(GALAXY, tuning.edge.margin);

type Pilot = (state: Readonly<ShipState>, t: number) => Readonly<FlightInput>;
const handsOff: Pilot = () => NO_INPUT;
const held = (input: Partial<FlightInput>): Pilot => {
  const fixed = { ...NO_INPUT, ...input };
  return () => fixed;
};

interface Flight {
  state: ShipState;
  t: number;
}

/** Fly for `seconds`, calling `watch` after every step. */
function fly(
  surroundings: Surroundings,
  flight: Flight,
  pilot: Pilot,
  seconds: number,
  watch?: (state: Readonly<ShipState>, t: number) => void,
): Flight {
  const flown = { ...NO_INPUT };
  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) {
    flight.t += STEP;
    flyStep(
      surroundings,
      flight.state,
      pilot(flight.state, flight.t),
      tuning.flight,
      tuning,
      STEP,
      flight.t,
      flown,
    );
    watch?.(flight.state, flight.t);
  }
  return flight;
}

function distanceTo(surroundings: Surroundings, id: string, state: Readonly<ShipState>): number {
  const i = surroundings.orbits.indexOf(id);
  return Math.hypot(
    state.x - (surroundings.field.positions[i * 2] ?? 0),
    state.z - (surroundings.field.positions[i * 2 + 1] ?? 0),
  );
}

describe('orbit assist', () => {
  it('leaves a ship alone when it is far from everything: exactly the plain flight model', () => {
    const surroundings = world();
    const assisted = { state: createShipState(300, -300, 0.7), t: 0 };
    const plain = copyShipState(assisted.state, createShipState());
    const rng = createRng('far away');
    const input = { thrust: 0, turn: 0, brake: 0, boost: false };
    const pilot: Pilot = () => input;

    for (let step = 0; step < 600; step += 1) {
      input.thrust = rng() < 0.7 ? 1 : 0;
      input.turn = rng() * 2 - 1;
      input.boost = rng() < 0.2;
      fly(surroundings, assisted, pilot, STEP);
      stepFlight(plain, input, tuning.flight, STEP);
    }
    expect(assisted.state).toEqual(plain);
    expect(surroundings.assist.body).toBe(-1);
  });

  it('eases a ship that lets go near a planet onto its ring, and keeps it there', () => {
    const surroundings = world();
    // Outside the ring, drifting past the home planet.
    const flight = { state: createShipState(40, 0, 0), t: 0 };
    flight.state.vz = 12;
    fly(surroundings, flight, handsOff, 20);

    let worst = 0;
    let slowest = Infinity;
    fly(surroundings, flight, handsOff, 60, (state) => {
      worst = Math.max(worst, Math.abs(distanceTo(surroundings, 'home', state) - 26.6));
      slowest = Math.min(slowest, speedOf(state));
    });
    expect(worst).toBeLessThan(0.5);
    expect(slowest).toBeGreaterThan(tuning.assist.orbitSpeed * 0.9);
    expect(surroundings.assist.body).toBe(surroundings.orbits.indexOf('home'));
    expect(surroundings.assist.weight).toBeCloseTo(1, 5);
  });

  it('goes round the way the ship was already going', () => {
    for (const side of [1, -1]) {
      const surroundings = world();
      // Flying along +Z past the planet: on its right (+X... seen from above) or on its left.
      const flight = { state: createShipState(30 * side, -20, 0), t: 0 };
      flight.state.vz = 15;
      fly(surroundings, flight, handsOff, 12);
      // With the planet on the ship's LEFT (+X side means the planet is toward -X, the right...).
      const angularMomentum = flight.state.z * flight.state.vx - flight.state.x * flight.state.vz;
      expect(Math.sign(angularMomentum)).toBe(-side);
      expect(surroundings.assist.spin).toBe(-side);
    }
  });

  it('follows a moon that circles a planet that circles a sun', () => {
    const surroundings = world();
    const moon = surroundings.orbits.indexOf('moon');
    fly(surroundings, { state: createShipState(), t: 0 }, handsOff, STEP); // place the bodies
    const x = (surroundings.field.positions[moon * 2] ?? 0) + 9;
    const z = surroundings.field.positions[moon * 2 + 1] ?? 0;
    const flight = { state: createShipState(x, z, 0), t: STEP };
    fly(surroundings, flight, handsOff, 25);

    let worst = 0;
    fly(surroundings, flight, handsOff, 90, (state) => {
      worst = Math.max(worst, Math.abs(distanceTo(surroundings, 'moon', state) - 7.2));
    });
    expect(surroundings.assist.body).toBe(moon);
    expect(worst).toBeLessThan(0.6);
  });

  it('is always escapable: full thrust away from the ring leaves within 3 seconds', () => {
    const surroundings = world();
    const flight = { state: createShipState(40, 0, 0), t: 0 };
    flight.state.vz = 12;
    fly(surroundings, flight, handsOff, 25);
    expect(Math.abs(distanceTo(surroundings, 'home', flight.state) - 26.6)).toBeLessThan(0.5);

    // Point straight away from the planet and push, with no steering at all.
    flight.state.heading = angleOf(flight.state.x, flight.state.z);
    let escapedAt = Infinity;
    fly(surroundings, flight, held({ thrust: 1 }), 3, (state, t) => {
      const home = surroundings.orbits.indexOf('home');
      if (pullOf(surroundings.field, home, state.x, state.z, tuning.assist) === 0) {
        escapedAt = Math.min(escapedAt, t);
      }
    });
    expect(escapedAt).toBeLessThan(flight.t);
  });

  it('gives the stick back the moment the pilot steers', () => {
    const surroundings = world();
    const flight = { state: createShipState(40, 0, 0), t: 0 };
    flight.state.vz = 12;
    fly(surroundings, flight, handsOff, 25);

    const flown = { ...NO_INPUT };
    const pilot = { ...NO_INPUT, turn: -1, thrust: 1 };
    flyStep(surroundings, flight.state, pilot, tuning.flight, tuning, STEP, flight.t + STEP, flown);
    expect(flown.turn).toBe(-1);
    expect(flown.thrust).toBe(1);
  });

  it('does not hurry a ship round its ring for a bare boost (Shift, half of Shift+Tab)', () => {
    const settled = () => {
      const surroundings = world();
      const flight = { state: createShipState(40, 0, 0), t: 0 };
      flight.state.vz = 12;
      fly(surroundings, flight, handsOff, 25);
      return { surroundings, flight };
    };
    const alone = settled();
    const shifted = settled();
    expect(alone.surroundings.assist.weight).toBeCloseTo(1, 5);
    fly(alone.surroundings, alone.flight, handsOff, 5);
    fly(shifted.surroundings, shifted.flight, held({ boost: true }), 5);
    expect(shifted.flight.state).toEqual(alone.flight.state);

    // With thrust of the pilot's own, boost still boosts.
    const flown = { ...NO_INPUT };
    const pilot = { ...NO_INPUT, thrust: 0.5, boost: true };
    const { surroundings, flight } = shifted;
    flyStep(surroundings, flight.state, pilot, tuning.flight, tuning, STEP, flight.t + STEP, flown);
    expect(flown.boost).toBe(true);
  });

  it('does not let a passing station steal a ship from its planet', () => {
    const surroundings = world();
    const flight = { state: createShipState(40, 0, 0), t: 0 };
    flight.state.vz = 12;
    const home = surroundings.orbits.indexOf('home');
    fly(surroundings, flight, handsOff, 20);
    // Several laps of the station (125 s each) against the ship's own 12 s laps.
    fly(surroundings, flight, handsOff, 300, () => {
      expect(surroundings.assist.body).toBe(home);
    });
  });
});

describe('you cannot crash', () => {
  it('never lets a ship under a shell, however hard it tries', () => {
    const surroundings = world();
    const flight = { state: createShipState(0, -120, 0), t: 0 };
    // A pilot who MEANS it: full boost, and the stick hard over toward the centre of the planet
    // the whole time, which switches the assist's steering off.
    const kamikaze: Pilot = (state) => ({
      thrust: 1,
      boost: true,
      brake: 0,
      turn: Math.sign(angleDelta(state.heading, angleOf(-state.x, -state.z))),
    });
    let closest = Infinity;
    let touched = false;
    fly(surroundings, flight, kamikaze, 10, (state) => {
      closest = Math.min(closest, distanceTo(surroundings, 'home', state));
      touched ||= surroundings.touched >= 0;
    });
    expect(touched).toBe(true);
    expect(closest).toBeGreaterThanOrEqual(14 + tuning.cushion.shellGap - 1e-9);
    expect(Number.isFinite(flight.state.x + flight.state.z + flight.state.vx)).toBe(true);
  });

  it('sweeps a ship that flies straight at a planet round it, without a bump', () => {
    for (const [x, boost] of [
      [0, false],
      [0, true],
      [4, true],
      [-9, false],
    ] as const) {
      const surroundings = world();
      const flight = { state: createShipState(x, -120, 0), t: 0 };
      let closest = Infinity;
      let slowest = Infinity;
      fly(surroundings, flight, held({ thrust: 1, boost }), 6, (state, t) => {
        closest = Math.min(closest, distanceTo(surroundings, 'home', state));
        if (t > 1.5) slowest = Math.min(slowest, speedOf(state));
      });
      // Never even into the cushion, never slowed to a crawl, and out the other side.
      expect(surroundings.touched).toBe(-1);
      expect(closest).toBeGreaterThan(14 + tuning.cushion.depth);
      expect(slowest).toBeGreaterThan(25);
      expect(distanceTo(surroundings, 'home', flight.state)).toBeGreaterThan(60);
    }
  });

  it('a soft landing never reaches the shell: the cushion alone stops it', () => {
    const surroundings = world();
    const flight = { state: createShipState(0, -40, 0), t: 0 };
    flight.state.vz = 12;
    let touched = false;
    fly(surroundings, flight, held({ brake: 1 }), 6, () => {
      touched ||= surroundings.touched >= 0;
    });
    expect(touched).toBe(false);
  });

  it('a planet that sweeps over a parked ship pushes it along', () => {
    const surroundings = world();
    const planet = surroundings.orbits.indexOf('planet');
    fly(surroundings, { state: createShipState(), t: 0 }, handsOff, STEP);
    // Park just ahead of the planet on its orbit, brakes on (so the assist stays out of it).
    const vx = surroundings.field.velocities[planet * 2] ?? 0;
    const vz = surroundings.field.velocities[planet * 2 + 1] ?? 0;
    const speed = Math.hypot(vx, vz);
    const x = (surroundings.field.positions[planet * 2] ?? 0) + (vx / speed) * 17;
    const z = (surroundings.field.positions[planet * 2 + 1] ?? 0) + (vz / speed) * 17;
    const flight = { state: createShipState(x, z, 0), t: STEP };
    let closest = Infinity;
    fly(surroundings, flight, held({ brake: 1 }), 30, (state) => {
      closest = Math.min(closest, distanceTo(surroundings, 'planet', state));
    });
    expect(closest).toBeGreaterThanOrEqual(12 + tuning.cushion.shellGap - 1e-9);
    expect(Math.hypot(flight.state.x - x, flight.state.z - z)).toBeGreaterThan(5);
  });
});

describe('you cannot get lost', () => {
  it('stalls a ship that insists on leaving, and brings back one that lets go', () => {
    const surroundings = world();
    const { edge } = surroundings;
    const flight = { state: createShipState(edge.radius - 50, 0, Math.PI / 2), t: 0 };
    let furthest = 0;
    fly(surroundings, flight, held({ thrust: 1, boost: true }), 120, (state) => {
      furthest = Math.max(furthest, pastEdge(edge, state.x, state.z));
    });
    const stall = (tuning.flight.thrustAccel * tuning.flight.boostFactor) / tuning.edge.pullPerUnit;
    expect(furthest).toBeGreaterThan(100);
    expect(furthest).toBeLessThan(stall * 1.2);

    fly(surroundings, flight, handsOff, 120);
    expect(pastEdge(edge, flight.state.x, flight.state.z)).toBeLessThan(40);
  });

  it('contains every system', () => {
    const { edge } = world();
    expect(edge.radius).toBeCloseTo(Math.hypot(700, 600) + 200 + tuning.edge.margin, 6);
  });
});

describe('flight among the bodies', () => {
  it('is deterministic, and survives ten thousand steps of a pilot with no plan', () => {
    const run = (): ShipState => {
      const surroundings = world();
      const flight = { state: createShipState(60, -40, 1), t: 0 };
      const rng = createRng('monkey');
      const input = { thrust: 0, turn: 0, brake: 0, boost: false };
      const pilot: Pilot = () => input;
      for (let step = 0; step < 10_000; step += 1) {
        if (step % 20 === 0) {
          input.thrust = rng() < 0.6 ? 1 : 0;
          input.turn = Math.round(rng() * 2 - 1);
          input.brake = rng() < 0.1 ? 1 : 0;
          input.boost = rng() < 0.3;
        }
        fly(surroundings, flight, pilot, STEP);
        const { state } = flight;
        if (!Number.isFinite(state.x + state.z + state.vx + state.vz + state.heading)) {
          throw new Error(`not finite at step ${step}`);
        }
        for (const id of ['home', 'station', 'sun', 'planet', 'moon']) {
          const i = surroundings.orbits.indexOf(id);
          const limit = (surroundings.field.radius[i] ?? 0) + tuning.cushion.shellGap;
          expect(distanceTo(surroundings, id, state)).toBeGreaterThanOrEqual(limit - 1e-9);
        }
      }
      return flight.state;
    };
    expect(run()).toEqual(run());
  });
});
