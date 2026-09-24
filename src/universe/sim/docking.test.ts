import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  approachPace,
  arrive,
  dockAt,
  haltDock,
  haltingInput,
  releaseDock,
  requestDock,
} from './docking';
import { NO_INPUT, createShipState, speedOf } from './flight';
import { TAU } from './math';
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

interface Flight {
  world: Surroundings;
  state: ShipState;
  t: number;
  flown: FlightInput;
}

function start(x: number, z: number, heading = 0): Flight {
  return { world: world(), state: createShipState(x, z, heading), t: 0, flown: { ...NO_INPUT } };
}

function step(flight: Flight, pilot: Readonly<FlightInput> = NO_INPUT): void {
  flight.t += STEP;
  flyStep(flight.world, flight.state, pilot, tuning.flight, tuning, STEP, flight.t, flight.flown);
}

function fly(flight: Flight, seconds: number, pilot: Readonly<FlightInput> = NO_INPUT): void {
  for (let i = Math.round(seconds / STEP); i > 0; i -= 1) step(flight, pilot);
}

function place(flight: Flight, id: string): { x: number; z: number; vx: number; vz: number } {
  const i = flight.world.orbits.indexOf(id);
  const { positions, velocities } = flight.world.field;
  return {
    x: positions[i * 2] ?? 0,
    z: positions[i * 2 + 1] ?? 0,
    vx: velocities[i * 2] ?? 0,
    vz: velocities[i * 2 + 1] ?? 0,
  };
}

function offRing(flight: Flight, id: string): number {
  const body = place(flight, id);
  const ring = flight.world.field.ringRadius[flight.world.orbits.indexOf(id)] ?? 0;
  return Math.hypot(flight.state.x - body.x, flight.state.z - body.z) - ring;
}

/** Put the ship `radii` ring radii from `id`, at `angle`, moving with the body plus (vx, vz). */
function near(id: string, radii: number, angle: number, heading: number, vx = 0, vz = 0): Flight {
  const flight = start(0, 0, heading);
  // One step so that the field holds real positions and velocities, then place the ship.
  step(flight);
  const body = place(flight, id);
  const ring = flight.world.field.ringRadius[flight.world.orbits.indexOf(id)] ?? 0;
  flight.state.x = body.x + radii * ring * Math.sin(angle);
  flight.state.z = body.z + radii * ring * Math.cos(angle);
  flight.state.vx = body.vx + vx;
  flight.state.vz = body.vz + vz;
  flight.state.heading = heading;
  flight.state.yawRate = 0;
  return flight;
}

function request(flight: Flight, id: string, pilot: Readonly<FlightInput> = NO_INPUT): void {
  requestDock(flight.world.dock, flight.world.orbits.indexOf(id), pilot);
}

describe('docking', () => {
  it('docks from any side, heading and speed within 6 seconds, round things that move', () => {
    const rng = createRng('dock from anywhere');
    for (const id of ['home', 'planet', 'moon', 'station', 'sun']) {
      for (let run = 0; run < 12; run += 1) {
        const speed = rng() * 30;
        const course = rng() * TAU;
        const flight = near(
          id,
          0.75 + rng() * 0.95,
          rng() * TAU,
          rng() * TAU,
          speed * Math.sin(course),
          speed * Math.cos(course),
        );
        request(flight, id);
        let seconds = 0;
        while (flight.world.dock.phase !== 'docked' && seconds < 6) {
          step(flight);
          seconds += STEP;
        }
        expect(flight.world.dock.phase, `${id} run ${run}`).toBe('docked');
      }
    }
  });

  it('hands over without a jolt: position, velocity, heading and spin are all continuous', () => {
    const rng = createRng('smooth capture');
    for (let run = 0; run < 20; run += 1) {
      // Off the ring to begin with (inside or outside it), so that there is an approach to compare.
      const radii = rng() < 0.5 ? 0.6 + rng() * 0.3 : 1.15 + rng() * 0.55;
      const flight = near('moon', radii, rng() * TAU, rng() * TAU, 8, -5);
      request(flight, 'moon');
      let before = { ...flight.state };
      let earlier = { ...flight.state };
      let steps = 0;
      for (; steps < 600 && flight.world.dock.phase !== 'docked'; steps += 1) {
        earlier = before;
        before = { ...flight.state };
        step(flight);
      }
      const after = flight.state;
      expect(flight.world.dock.phase).toBe('docked');
      expect(steps).toBeGreaterThan(1);
      // One step of travel, and no more change in anything than the approach's own last step made
      // (it flies with the autopilot's drive, which can change a lot in a step: the capture must
      // not add to that).
      const travelled = Math.hypot(after.x - before.x, after.z - before.z);
      expect(travelled).toBeLessThan((speedOf(before) + 1) * STEP * 1.5);
      const dv = Math.hypot(after.vx - before.vx, after.vz - before.vz);
      const dvBefore = Math.hypot(before.vx - earlier.vx, before.vz - earlier.vz);
      expect(dv).toBeLessThan(dvBefore + 0.5);
      const turn = Math.abs(after.heading - before.heading);
      expect(turn).toBeLessThan(Math.abs(before.heading - earlier.heading) + 0.02);
      const spin = Math.abs(after.yawRate - before.yawRate);
      expect(spin).toBeLessThan(Math.abs(before.yawRate - earlier.yawRate) + 0.3);
    }
  });

  it("takes a journey's end into orbit as it is, and the springs bring it onto the ring", () => {
    const flight = near('planet', 1.25, 0.7, 0);
    const planet = place(flight, 'planet');
    const i = flight.world.orbits.indexOf('planet');
    const ring = flight.world.field.ringRadius[i] ?? 0;
    // Beside the ring, going round it at 40 u/s (its own frame), nose along the way it goes.
    const rx = flight.state.x - planet.x;
    const rz = flight.state.z - planet.z;
    const d = Math.hypot(rx, rz);
    flight.state.vx = planet.vx + (40 * rz) / d;
    flight.state.vz = planet.vz - (40 * rx) / d;
    flight.state.heading = Math.atan2(rz, -rx);
    requestDock(flight.world.dock, i, NO_INPUT, true);
    expect(flight.world.dock.phase).toBe('cruise');
    const before = { ...flight.state };
    arrive(flight.world.field, flight.state, flight.world.dock, 1);
    expect(flight.world.dock.phase).toBe('docked');
    // Nothing moves at the moment it is taken: it carries on from exactly where it is.
    expect(flight.state).toEqual(before);
    step(flight);
    const travelled = Math.hypot(flight.state.x - before.x, flight.state.z - before.z);
    expect(travelled).toBeLessThan((speedOf(before) + 1) * STEP * 1.5);
    // Five settling times later it is on the ring, going round at the docked pace.
    fly(flight, 5 / tuning.dock.settleOmega + 2);
    expect(Math.abs(offRing(flight, 'planet'))).toBeLessThan(0.05);
    const now = place(flight, 'planet');
    const pace = Math.hypot(flight.state.vx - now.vx, flight.state.vz - now.vz);
    expect(pace).toBeCloseTo(Math.min(ring * tuning.dock.orbitRate, tuning.dock.maxSpeed), 1);
  });

  it('settles onto the ring, nose along it, and then does not drift in ten minutes', () => {
    const flight = near('moon', 1.5, 1, 4, 10, 0);
    request(flight, 'moon');
    fly(flight, 12);
    expect(flight.world.dock.phase).toBe('docked');
    expect(Math.abs(offRing(flight, 'moon'))).toBeLessThan(0.01);

    let worst = 0;
    for (let i = 0; i < 600 * 60; i += 1) {
      step(flight);
      worst = Math.max(worst, Math.abs(offRing(flight, 'moon')));
    }
    expect(worst).toBeLessThan(1e-6);
    // Along the ring: the velocity in the moon's frame is at right angles to the radius.
    const moon = place(flight, 'moon');
    const rx = flight.state.x - moon.x;
    const rz = flight.state.z - moon.z;
    const vx = flight.state.vx - moon.vx;
    const vz = flight.state.vz - moon.vz;
    expect(Math.abs(rx * vx + rz * vz)).toBeLessThan(1e-6);
    // The nose points the way it goes, and the pace is the docked pace.
    expect(Math.sin(flight.state.heading) * vx + Math.cos(flight.state.heading) * vz).toBeCloseTo(
      Math.hypot(vx, vz),
      6,
    );
    const ring = flight.world.field.ringRadius[flight.world.orbits.indexOf('moon')] ?? 1;
    expect(Math.hypot(vx, vz) / ring).toBeCloseTo(tuning.dock.orbitRate, 6);
  });

  it('never goes round a big ring faster than the speed limit', () => {
    const flight = near('sun', 1, 0, Math.PI / 2, 10, 0);
    request(flight, 'sun');
    fly(flight, 20);
    const sun = place(flight, 'sun');
    const pace = Math.hypot(flight.state.vx - sun.vx, flight.state.vz - sun.vz);
    expect(pace).toBeLessThanOrEqual(tuning.dock.maxSpeed + 1e-9);
    expect(pace).toBeLessThanOrEqual(38 * tuning.dock.orbitRate + 1e-9);
  });

  it('keeps headings unwrapped through a capture, however many turns the ship has made', () => {
    const flight = near('home', 1.2, 2, 0, 0, 6);
    flight.state.heading += 5 * TAU;
    request(flight, 'home');
    // Never more than a step of the fastest turn either drive makes: no jump of a whole turn.
    const fastest = Math.max(tuning.flight.yawRateSlow, tuning.cruise.flight.yawRateSlow);
    let last = flight.state.heading;
    for (let i = 0; i < 20 * 60; i += 1) {
      step(flight);
      expect(Math.abs(flight.state.heading - last)).toBeLessThan(fastest * STEP + 0.01);
      last = flight.state.heading;
    }
    expect(flight.world.dock.phase).toBe('docked');
    expect(flight.state.heading).toBeGreaterThan(4 * TAU);
  });

  it('takes "dock" from a pilot who is still holding the throttle, and "leave" from a fresh press', () => {
    const thrust = { ...NO_INPUT, thrust: 1 };
    const flight = near('planet', 1.4, 0.5, 2, 5, 5);
    request(flight, 'planet', thrust);
    fly(flight, 2, thrust);
    expect(flight.world.dock.phase).not.toBe('free');

    fly(flight, 8); // let go: the approach finishes
    expect(flight.world.dock.phase).toBe('docked');

    step(flight, thrust);
    expect(flight.world.dock.phase).toBe('free');
    expect(flight.world.dock.leftByPilot).toBe(true);
    step(flight, thrust);
    expect(flight.world.dock.leftByPilot).toBe(false);
  });

  it('lets steering cancel an approach, and braking too; a docked ship ignores the brake', () => {
    const left = { ...NO_INPUT, turn: 1 };
    const brake = { ...NO_INPUT, brake: 1 };
    for (const input of [left, brake]) {
      const flight = near('planet', 1.6, 0.5, 2, 5, 5);
      request(flight, 'planet');
      fly(flight, 0.5);
      expect(flight.world.dock.phase).toBe('approach');
      step(flight, input);
      expect(flight.world.dock.phase).toBe('free');
    }

    const flight = near('planet', 1.1, 0.5, 2, 5, 5);
    request(flight, 'planet');
    fly(flight, 10);
    fly(flight, 1, brake);
    expect(flight.world.dock.phase).toBe('docked');
    // A touch that is not meant: below the dead zone nothing happens.
    fly(flight, 1, { ...NO_INPUT, turn: tuning.dock.leaveDeadZone * 0.9 });
    expect(flight.world.dock.phase).toBe('docked');
  });

  it('brakes to rest after STOP, and gives the controls back at a touch', () => {
    // STOP on the way somewhere (Navigator.stop): let go, and the brake is held for the pilot.
    const flight = start(300, -300, 0);
    flight.state.vz = 80;
    request(flight, 'home');
    haltDock(flight.world.dock, flight.world.assist);
    expect(flight.world.dock.phase).toBe('free');
    expect(flight.world.dock.halting).toBe(true);
    const held = haltingInput(flight.world.dock, NO_INPUT, flight.state, tuning.dock);
    expect(held).toEqual({ thrust: 0, turn: 0, brake: 1, boost: false });
    // In open space it comes to rest, and then the brake is let go of by itself.
    let t = 0;
    while (flight.world.dock.halting && t < 10) {
      step(flight);
      t += STEP;
    }
    expect(flight.world.dock.halting).toBe(false);
    expect(speedOf(flight.state)).toBeLessThan(0.5);
    expect(t).toBeLessThan(4);
    // Any steering of the pilot's own ends it at once, and is flown as it is.
    const again = start(300, -300, 0);
    again.state.vz = 80;
    haltDock(again.world.dock, again.world.assist);
    const left = { ...NO_INPUT, turn: 1 };
    expect(haltingInput(again.world.dock, left, again.state, tuning.dock)).toBe(left);
    expect(again.world.dock.halting).toBe(false);
    // A new request is no longer a Stop.
    const asked = start(300, -300, 0);
    haltDock(asked.world.dock, asked.world.assist);
    request(asked, 'home');
    expect(asked.world.dock.halting).toBe(false);
  });

  it('leaves without a jolt, and full thrust is clear of the ring in 3 seconds', () => {
    const flight = near('planet', 1, 0, Math.PI / 2, 10, 0);
    request(flight, 'planet');
    fly(flight, 10);
    expect(flight.world.dock.phase).toBe('docked');

    const before = { ...flight.state };
    const thrust = { ...NO_INPUT, thrust: 1 };
    step(flight, thrust);
    expect(flight.world.dock.phase).toBe('free');
    expect(Math.hypot(flight.state.vx - before.vx, flight.state.vz - before.vz)).toBeLessThan(1);
    expect(Math.abs(flight.state.heading - before.heading)).toBeLessThan(0.05);

    fly(flight, 3, thrust);
    expect(offRing(flight, 'planet')).toBeGreaterThan(10);
  });

  it('goes on circling the same way when it is released, held by the assist', () => {
    for (const spinVx of [10, -10]) {
      const flight = near('home', 1, 0, spinVx > 0 ? Math.PI / 2 : -Math.PI / 2, spinVx, 0);
      request(flight, 'home');
      fly(flight, 10);
      const { spin } = flight.world.dock;
      expect(spin).toBe(spinVx > 0 ? 1 : -1);
      releaseDock(flight.world.dock, flight.world.assist);
      fly(flight, 20);
      expect(flight.world.assist.spin).toBe(spin);
      expect(Math.abs(offRing(flight, 'home'))).toBeLessThan(1);
    }
  });

  it('puts a ship straight into orbit for a page that opens on a planet', () => {
    const flight = start(500, 500);
    step(flight);
    const i = flight.world.orbits.indexOf('moon');
    dockAt(flight.world.field, flight.state, tuning.dock, flight.world.dock, i, 1.25);
    expect(flight.world.dock.phase).toBe('docked');
    expect(Math.abs(offRing(flight, 'moon'))).toBeLessThan(1e-9);

    const before = { ...flight.state };
    step(flight);
    // Already at the docked pace, nose along the ring: the first step is like every later one.
    const moon = place(flight, 'moon');
    const pace = Math.hypot(flight.state.vx - moon.vx, flight.state.vz - moon.vz);
    expect(pace / 7.2).toBeCloseTo(tuning.dock.orbitRate, 6);
    expect(Math.hypot(flight.state.x - before.x, flight.state.z - before.z)).toBeLessThan(
      (speedOf(before) + 1) * STEP * 1.5,
    );
    expect(Math.abs(offRing(flight, 'moon'))).toBeLessThan(1e-9);
  });

  it('slows a ship skimming the ring before it takes it, instead of leaving that to the springs', () => {
    // The pilot's own "dock here" (E) while going round a small moon's ring far faster than its
    // approach pace. Taken as it was, the springs would brake it at twice settleOmega times the
    // excess (380 u/s^2 measured); so the approach flies on until it goes round no faster than a
    // journey arrives (2.5 times its pace).
    const rng = createRng('skimming');
    const i = world().orbits.indexOf('moon');
    const ring = 7.2;
    const bound = approachPace(ring, tuning.dock) * 2.5;
    let fastest = 0;
    for (let run = 0; run < 60; run += 1) {
      const angle = rng() * TAU;
      const way = rng() < 0.5 ? -1 : 1;
      const course = angle + way * (Math.PI / 2) + (rng() - 0.5) * 1.2;
      const flight = near('moon', 0.95 + rng() * 0.35, angle, course);
      flight.state.vx += 50 * Math.sin(course);
      flight.state.vz += 50 * Math.cos(course);
      expect(flight.world.field.ringRadius[i]).toBe(ring);
      request(flight, 'moon');
      for (let k = 0; k < 6 * 60 && flight.world.dock.phase !== 'docked'; k += 1) step(flight);
      expect(flight.world.dock.phase, `run ${run}`).toBe('docked');
      // How fast it went round when it was taken (one step of the springs later).
      const { rate, offset } = flight.world.dock;
      fastest = Math.max(fastest, Math.abs(rate.value) * (ring + offset.value));
    }
    expect(fastest).toBeLessThan(bound * 1.1);
  });

  it('captures where it is when an approach cannot finish', () => {
    const flight = near('planet', 1.7, 0, 0);
    request(flight, 'planet');
    const impossible = { ...tuning, dock: { ...tuning.dock, captureDistance: 0 } };
    for (let i = 0; i < (tuning.dock.approachTimeoutSec + 1) * 60; i += 1) {
      flight.t += STEP;
      flyStep(
        flight.world,
        flight.state,
        NO_INPUT,
        tuning.flight,
        impossible,
        STEP,
        flight.t,
        flight.flown,
      );
    }
    expect(flight.world.dock.phase).toBe('docked');
  });

  it('is deterministic', () => {
    const run = (): ShipState => {
      const flight = near('moon', 1.6, 3, 1, -12, 7);
      request(flight, 'moon');
      fly(flight, 30);
      return flight.state;
    };
    expect(run()).toEqual(run());
  });

  it('goes round a moon that lies between the ship and its planet, not into it', () => {
    for (const heading of [0, 1.5, 3, 4.5]) {
      // In orbit round the moon, on the far side of it from the planet: the planet's ring lies
      // straight through the moon. (From proposal/warp: without GIVE_WAY in sim/assist.ts the
      // approach skims the moon, inside its cushion.)
      const flight = start(0, 0, heading);
      step(flight);
      const planet = place(flight, 'planet');
      const moon = place(flight, 'moon');
      const ux = moon.x - planet.x;
      const uz = moon.z - planet.z;
      const u = Math.hypot(ux, uz);
      const ring = flight.world.field.ringRadius[flight.world.orbits.indexOf('moon')] ?? 0;
      flight.state.x = moon.x + (ux / u) * ring;
      flight.state.z = moon.z + (uz / u) * ring;
      flight.state.vx = moon.vx;
      flight.state.vz = moon.vz;
      request(flight, 'planet');
      const m = flight.world.orbits.indexOf('moon');
      let touched = false;
      let least = Infinity;
      for (let i = 0; i < 600 && flight.world.dock.phase !== 'docked'; i += 1) {
        step(flight);
        touched ||= flight.world.touched >= 0;
        const at = place(flight, 'moon');
        least = Math.min(
          least,
          Math.hypot(flight.state.x - at.x, flight.state.z - at.z) -
            (flight.world.field.radius[m] ?? 0),
        );
      }
      expect(flight.world.dock.phase, `heading ${heading}`).toBe('docked');
      expect(touched, `heading ${heading}`).toBe(false);
      // Clear of the moon's cushion, not merely of its shell.
      expect(least, `heading ${heading}`).toBeGreaterThan(tuning.cushion.depth);
    }
  });
});
