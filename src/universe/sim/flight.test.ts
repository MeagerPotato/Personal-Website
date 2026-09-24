import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  NO_INPUT,
  copyShipState,
  createShipState,
  isSteering,
  maxYawRate,
  speedOf,
  stepFlight,
  topSpeed,
} from './flight';
import { createRng } from './rng';
import type { FlightInput, FlightParams, ShipState } from './types';

const P: FlightParams = tuning.flight;
const DT = 1 / tuning.loop.stepHz;

const input = (partial: Partial<FlightInput>): FlightInput => ({ ...NO_INPUT, ...partial });

function fly(state: ShipState, seconds: number, stick: FlightInput, params = P): ShipState {
  for (let step = 0; step < Math.round(seconds / DT); step += 1) {
    stepFlight(state, stick, params, DT);
  }
  return state;
}

describe('straight-line flight', () => {
  it('reaches exactly the top speed the tuning promises, and no more', () => {
    const ship = fly(createShipState(), 20, input({ thrust: 1 }));
    expect(topSpeed(P)).toBeCloseTo(42.5, 6);
    expect(speedOf(ship)).toBeCloseTo(topSpeed(P), 4);

    fly(ship, 20, input({ thrust: 1, boost: true }));
    expect(speedOf(ship)).toBeCloseTo(topSpeed(P, true), 4);
    expect(topSpeed(P, true)).toBeCloseTo(80.75, 6);
  });

  it('flies along +Z at heading 0, and to +X after a quarter turn to the left', () => {
    const north = fly(createShipState(), 2, input({ thrust: 1 }));
    expect(north.z).toBeGreaterThan(10);
    expect(north.x).toBeCloseTo(0, 9);

    const east = fly(createShipState(0, 0, Math.PI / 2), 2, input({ thrust: 1 }));
    expect(east.x).toBeGreaterThan(10);
    expect(east.z).toBeCloseTo(0, 9);
  });

  it('coasts to a stop, and the brake stops it much sooner', () => {
    const cruising = fly(createShipState(), 20, input({ thrust: 1 }));
    const coasting = fly(copyShipState(cruising, createShipState()), 1, NO_INPUT);
    const braking = fly(copyShipState(cruising, createShipState()), 1, input({ brake: 1 }));

    expect(speedOf(coasting)).toBeCloseTo(topSpeed(P) * Math.exp(-P.forwardDrag), 3);
    expect(speedOf(braking)).toBeLessThan(speedOf(coasting) * 0.2);
  });

  it('has no reverse: braking never moves the ship backwards', () => {
    const ship = fly(createShipState(), 3, input({ thrust: 1 }));
    let furthest = ship.z;
    for (let step = 0; step < 600; step += 1) {
      stepFlight(ship, input({ brake: 1 }), P, DT);
      expect(ship.z).toBeGreaterThanOrEqual(furthest);
      furthest = ship.z;
    }
    expect(speedOf(ship)).toBeLessThan(1e-6);
  });
});

describe('steering', () => {
  it('turns left for a positive stick, right for a negative one', () => {
    const left = fly(createShipState(), 1, input({ turn: 1 }));
    const right = fly(createShipState(), 1, input({ turn: -1 }));
    expect(left.heading).toBeGreaterThan(0);
    expect(right.heading).toBeCloseTo(-left.heading, 12);
  });

  it('settles at the turn rate for its speed: nimble when slow, wider when fast', () => {
    const parked = fly(createShipState(), 2, input({ turn: 1 }));
    expect(parked.yawRate).toBeCloseTo(P.yawRateSlow, 4);

    // Long enough for the turn to become steady: turning costs speed, and the rate follows it.
    const fast = fly(createShipState(), 20, input({ thrust: 1, boost: true }));
    fly(fast, 15, input({ thrust: 1, boost: true, turn: 1 }));
    expect(fast.yawRate).toBeCloseTo(maxYawRate(speedOf(fast), P), 3);
    expect(fast.yawRate).toBeLessThan(P.yawRateSlow);
    expect(fast.yawRate).toBeGreaterThanOrEqual(P.yawRateFast);
  });

  it('follows the stick with the documented time constant', () => {
    const ship = fly(createShipState(), P.yawResponseSec, input({ turn: 1 }));
    // One time constant in: 1 - 1/e of the way there (the step count rounds, hence the slack).
    expect(ship.yawRate / P.yawRateSlow).toBeGreaterThan(0.6);
    expect(ship.yawRate / P.yawRateSlow).toBeLessThan(0.68);
  });

  it('goes where it points: sideways speed bleeds off while forward speed carries on', () => {
    const ship = createShipState();
    ship.vx = 20; // sliding sideways across the nose, which points along +Z
    ship.vz = 20;
    fly(ship, 1 / P.lateralGrip, NO_INPUT);
    expect(ship.vx).toBeCloseTo(20 / Math.E, 1);
    expect(ship.vz).toBeGreaterThan(ship.vx * 1.5);
  });

  it('drifts in a hard turn by the angle the tuning predicts, then straightens out', () => {
    const slipAngle = (ship: ShipState): number => {
      const along = ship.vx * Math.sin(ship.heading) + ship.vz * Math.cos(ship.heading);
      const across = ship.vx * Math.cos(ship.heading) - ship.vz * Math.sin(ship.heading);
      return Math.atan2(Math.abs(across), along);
    };

    const ship = fly(createShipState(), 10, input({ thrust: 1 }));
    fly(ship, 15, input({ thrust: 1, turn: 1 }));
    // In a steady turn the nose leads the direction of travel by atan(turn rate / grip): with
    // the shipped tuning about 27 degrees, which is the "drift" a designer hears about.
    expect(slipAngle(ship)).toBeCloseTo(Math.atan(ship.yawRate / P.lateralGrip), 1);
    expect(slipAngle(ship)).toBeLessThan(Math.PI / 4);

    fly(ship, 2, input({ thrust: 1 }));
    expect(slipAngle(ship)).toBeLessThan(0.01);
  });
});

describe('isSteering', () => {
  it('is thrust or a turn past the dead zone, and never boost or the brake alone', () => {
    expect(isSteering(NO_INPUT)).toBe(false);
    expect(isSteering(input({ thrust: 0.3 }))).toBe(true);
    expect(isSteering(input({ turn: -0.2 }))).toBe(true);
    expect(isSteering(input({ turn: -0.2 }), 0.25)).toBe(false);
    expect(isSteering(input({ boost: true }))).toBe(false);
    expect(isSteering(input({ brake: 1 }))).toBe(false);
  });
});

describe('robustness', () => {
  it('adds whatever else pushes on the ship', () => {
    const ship = createShipState();
    stepFlight(ship, NO_INPUT, P, DT, { x: 6, z: -3 });
    expect(ship.vx).toBeCloseTo(6 * DT, 12);
    expect(ship.vz).toBeCloseTo(-3 * DT, 12);
    expect(ship.x).toBeCloseTo(6 * DT * DT, 12);
  });

  it('treats nonsense from an input device as no input, and clamps the rest', () => {
    const wild = fly(
      createShipState(),
      20,
      input({ thrust: 99, turn: Number.NaN, brake: Number.NaN }),
    );
    expect(speedOf(wild)).toBeCloseTo(topSpeed(P), 4);
    expect(wild.heading).toBe(0);
  });

  it('is deterministic: the same flight gives the same bits', () => {
    const flyScript = (): ShipState => {
      const rng = createRng('replay');
      const ship = createShipState();
      for (let step = 0; step < 5000; step += 1) {
        stepFlight(
          ship,
          { thrust: rng(), turn: rng() * 2 - 1, brake: rng() < 0.1 ? 1 : 0, boost: rng() < 0.3 },
          P,
          DT,
        );
      }
      return ship;
    };
    expect(flyScript()).toEqual(flyScript());
  });

  it('stays finite and under the speed limit through 10,000 steps of random flying', () => {
    const rng = createRng('fuzz');
    const ship = createShipState();
    const limit = topSpeed(P, true) + 1e-6;
    for (let step = 0; step < 10_000; step += 1) {
      stepFlight(
        ship,
        { thrust: rng(), turn: rng() * 2 - 1, brake: rng() < 0.2 ? rng() : 0, boost: rng() < 0.5 },
        P,
        DT,
      );
      expect(speedOf(ship)).toBeLessThanOrEqual(limit);
    }
    for (const value of Object.values(ship)) expect(Number.isFinite(value)).toBe(true);
    // 10,000 steps at no more than 80.75 u/s cannot have gone further than this.
    expect(Math.hypot(ship.x, ship.z)).toBeLessThan((limit * 10_000) / 60);
  });

  it('cannot be made to explode by any tuning value', () => {
    const extremes: FlightParams[] = [
      { ...P, forwardDrag: 1e6, lateralGrip: 1e6, brakeDrag: 1e6 },
      { ...P, forwardDrag: 0, lateralGrip: 0, brakeDrag: 0 },
      { ...P, yawResponseSec: 0 },
      { ...P, yawResponseSec: 1e-12, yawRateFastSpeed: 0 },
    ];
    for (const params of extremes) {
      const ship = fly(createShipState(), 5, input({ thrust: 1, turn: 1, boost: true }), params);
      for (const value of Object.values(ship)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
