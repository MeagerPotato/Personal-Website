import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  HYPER_NONE,
  HYPER_OFFERED,
  HYPER_SPENT,
  HYPER_TUNNEL,
  HYPER_WINDUP,
  dockAt,
  releaseDock,
  requestDock,
} from './docking';
import { NO_INPUT, createShipState } from './flight';
import { engageHyper } from './hyper';
import {
  createSurroundings,
  flyStep,
  syncSurroundings,
  type Surroundings,
  type SurroundingsInput,
} from './surroundings';
import type { FlightInput, ShipState } from './types';

const input = (solidRadius?: number): SurroundingsInput => ({
  home: [0, 0],
  systems: [{ id: 'home', position: [0, 0], radius: 66 }],
  bodies: [
    {
      id: 'home',
      system: 'home',
      parent: null,
      orbit: null,
      radius: 14,
      dockRadius: 26.6,
      ...(solidRadius === undefined ? {} : { solidRadius }),
    },
    {
      id: 'relay',
      system: 'home',
      parent: 'home',
      orbit: { radius: 50, phase: 0, periodSec: 100 },
      radius: 1.4,
      dockRadius: 7.4,
      docks: false,
    },
  ],
});

describe('createSurroundings', () => {
  it('takes a world’s solid as its surface, and leaves its ring where it is', () => {
    const drawn = createSurroundings(input(21.98), tuning.edge.margin);
    const home = drawn.orbits.indexOf('home');
    // The cushions, the shells, the assist's swerve and the docking guard all measure from here.
    expect(drawn.field.radius[home]).toBe(21.98);
    expect(drawn.field.ringRadius[home]).toBe(26.6);

    // Without one, its radius, as always.
    const plain = createSurroundings(input(), tuning.edge.margin);
    expect(plain.field.radius[home]).toBe(14);
    expect(plain.field.radius[plain.orbits.indexOf('relay')]).toBe(1.4);
    expect(plain.field.docks[plain.orbits.indexOf('relay')]).toBe(0);
  });
});

// HYPERSPACE IS THE SAME FLIGHT (sim/hyper.ts): flyStep steps it, and it flies nothing. The
// journeys harness holds every journey of the real galaxy to its twin (scripts/journeys); this
// is the same promise, small enough to read.
describe('flyStep with a jump taken', () => {
  /** Two systems 920 u apart: home with its station, and a sun with two planets and a moon. */
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
        id: 'inner',
        system: 'code',
        parent: 'sun',
        orbit: { radius: 60.2, phase: 4, periodSec: 241 },
        radius: 8,
        dockRadius: 15.2,
      },
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
  const STEP = 1 / 60;

  interface Run {
    world: Surroundings;
    state: ShipState;
    flown: FlightInput;
    steps: number;
  }

  /** Docked at `from` for half a second, then sent to `to` as the Navigator sends a journey. */
  function setOut(from: string, to: string, startSteps: number): Run {
    const world = createSurroundings(GALAXY, tuning.edge.margin);
    const run: Run = { world, state: createShipState(), flown: { ...NO_INPUT }, steps: startSteps };
    syncSurroundings(world, startSteps * STEP);
    dockAt(world.field, run.state, tuning.dock, world.dock, world.orbits.indexOf(from), 2, 1);
    for (let k = 0; k < 30; k += 1) step(run);
    releaseDock(world.dock, world.assist);
    requestDock(world.dock, world.orbits.indexOf(to), NO_INPUT, true, tuning.cruise.minJourneySec);
    return run;
  }

  function step(run: Run): void {
    run.steps += 1;
    flyStep(
      run.world,
      run.state,
      NO_INPUT,
      tuning.flight,
      tuning,
      STEP,
      run.steps * STEP,
      run.flown,
    );
  }

  it('flies the journey bit for bit as it flies it without one, and docks on the same step', () => {
    for (const [from, to, startSteps] of [
      ['station', 'moon', 4321],
      ['moon', 'home', 90210],
      ['planet', 'station', 777],
    ] as const) {
      const plain = setOut(from, to, startSteps);
      const jumped = setOut(from, to, startSteps);
      const label = `${from} to ${to}`;
      /** Every state the jump was in, in the order it took them. */
      const taken: number[] = [];
      let offered = false;
      let steps = 0;
      for (; steps < 60 * 30 && plain.world.dock.phase !== 'docked'; steps += 1) {
        step(plain);
        step(jumped);
        // The press, the first step the offer is there: only one of the two takes it.
        if (jumped.world.dock.hyper === HYPER_OFFERED) {
          offered = true;
          expect(plain.world.dock.hyper, label).toBe(HYPER_OFFERED);
          expect(engageHyper(jumped.world.dock), label).toBe(true);
        }
        const now = jumped.world.dock.hyper;
        if (taken.at(-1) !== now) taken.push(now);
        // Every field of the ship, and what was flown: equal, to the bit.
        expect({ ...jumped.state }, `${label}, step ${steps}`).toStrictEqual({ ...plain.state });
        expect({ ...jumped.flown }, `${label}, step ${steps}`).toStrictEqual({ ...plain.flown });
        expect(jumped.world.dock.phase, `${label}, step ${steps}`).toBe(plain.world.dock.phase);
        // The one that did not press never leaves the offer but for "no more".
        expect([HYPER_NONE, HYPER_OFFERED, HYPER_SPENT], label).toContain(plain.world.dock.hyper);
      }
      expect(offered, label).toBe(true);
      expect(plain.world.dock.phase, label).toBe('docked');
      expect(jumped.world.dock.phase, label).toBe('docked');
      // The jump was a whole one: wound up, through the tunnel, out of it, and gone at the dock.
      expect(taken, label).toEqual([HYPER_WINDUP, HYPER_TUNNEL, HYPER_SPENT, HYPER_NONE]);
      // And the two are carried round alike from there.
      for (let k = 0; k < 60; k += 1) {
        step(plain);
        step(jumped);
      }
      expect({ ...jumped.state }, label).toStrictEqual({ ...plain.state });
      expect({ ...jumped.world.dock, hyper: 0, hyperSec: 0 }, label).toStrictEqual({
        ...plain.world.dock,
        hyper: 0,
        hyperSec: 0,
      });
    }
  });
});
