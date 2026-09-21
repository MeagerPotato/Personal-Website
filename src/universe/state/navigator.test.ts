import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { NO_INPUT, copyShipState, createShipState } from '../sim/flight';
import {
  createSurroundings,
  flyStep,
  syncSurroundings,
  type SurroundingsInput,
} from '../sim/surroundings';
import type { FlightInput, ShipState } from '../sim/types';
import { Navigator, type NavigatorEvents } from './Navigator';

const STEP = 1 / 60;

const GALAXY: SurroundingsInput = {
  home: [0, 0],
  systems: [{ id: 'home', position: [0, 0], radius: 66 }],
  bodies: [
    { id: 'page/about', system: 'home', parent: null, orbit: null, radius: 14, dockRadius: 26.6 },
    {
      id: 'page/resume',
      system: 'home',
      parent: 'page/about',
      orbit: { radius: 60, phase: 0, periodSec: 125 },
      radius: 2.2,
      dockRadius: 8.2,
    },
  ],
};

/** The same, and a second system a good way off: somewhere to travel to. */
const WIDE_GALAXY: SurroundingsInput = {
  home: [0, 0],
  systems: [...GALAXY.systems, { id: 'code', position: [-700, 600], radius: 120 }],
  bodies: [
    ...GALAXY.bodies,
    { id: 'system/code', system: 'code', parent: null, orbit: null, radius: 20, dockRadius: 38 },
    {
      id: 'project/fishai',
      system: 'code',
      parent: 'system/code',
      orbit: { radius: 100, phase: 1, periodSec: 500 },
      radius: 12,
      dockRadius: 22.8,
    },
  ],
};

type Heard = { [K in keyof NavigatorEvents]: [K, NavigatorEvents[K]] }[keyof NavigatorEvents];

/** A little engine: the ship, the world, the navigator, in the order main.ts steps them. */
function harness(x: number, z: number, heading = 0, galaxy = GALAXY) {
  const surroundings = createSurroundings(galaxy, tuning.edge.margin);
  const state = createShipState(x, z, heading);
  const pilot: { current: FlightInput } = { current: { ...NO_INPUT } };
  const heard: Heard[] = [];
  const flown = { ...NO_INPUT };
  let t = 0;
  const ship = {
    state: state as Readonly<ShipState>,
    restore: (to: Readonly<ShipState>) => void copyShipState(to, state),
  };
  const navigator = new Navigator({
    surroundings,
    ship,
    pilot,
    params: tuning,
    emit: (event, payload) => void heard.push([event, payload] as Heard),
  });
  const step = (): void => {
    t += STEP;
    flyStep(surroundings, state, pilot.current, tuning.flight, tuning, STEP, t, flown);
    navigator.fixedUpdate();
  };
  return {
    surroundings,
    state,
    pilot,
    heard,
    navigator,
    step,
    time: () => t,
    /** Simulate `seconds`, one frame (and one delivery of events) per step. */
    run(seconds: number): void {
      for (let i = Math.round(seconds / STEP); i > 0; i -= 1) {
        step();
        navigator.frameUpdate();
      }
    },
    names: () => heard.map(([name]) => name),
  };
}

describe('Navigator', () => {
  it('offers the body the ship is within reach of, and takes the offer back', () => {
    const h = harness(0, -200, 0);
    h.run(0.5);
    expect(h.navigator.candidate).toBeNull();

    h.pilot.current = { ...NO_INPUT, thrust: 1 };
    h.run(5);
    expect(h.navigator.candidate).toBe('page/about');
    expect(h.heard).toContainEqual(['soi', { id: 'page/about' }]);

    h.pilot.current = { ...NO_INPUT, thrust: 1, boost: true };
    h.run(8);
    expect(h.navigator.candidate).toBeNull();
    expect(h.heard.at(-1)).toEqual(['soi', { id: null }]);
  });

  it('docks on request: approach, then docked, each announced once and with the frame', () => {
    const h = harness(0, -40, Math.PI / 2);
    h.run(0.2);
    expect(h.navigator.approach('page/about')).toBe(true);
    // Said with the next frame, not in the middle of whatever asked.
    expect(h.names()).not.toContain('statechange');
    h.run(8);

    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'page/about' });
    const story = h.heard.filter(([name]) => name !== 'soi');
    expect(story).toEqual([
      ['statechange', { mode: 'approach', target: 'page/about' }],
      ['statechange', { mode: 'docked', target: 'page/about' }],
      ['docked', { id: 'page/about' }],
    ]);
    // Docked ships are not offered a dock.
    expect(h.navigator.candidate).toBeNull();
    // Asking again is not news.
    expect(h.navigator.approach('page/about')).toBe(true);
    h.run(0.1);
    expect(h.heard.filter(([name]) => name !== 'soi')).toHaveLength(3);
  });

  it('refuses what is out of reach or unknown, and changes nothing', () => {
    const h = harness(0, -300);
    h.run(0.1);
    expect(h.navigator.approach('page/about')).toBe(false);
    expect(h.navigator.approach('page/nope')).toBe(false);
    expect(h.navigator.place('page/nope')).toBe(false);
    h.run(0.1);
    expect(h.navigator.state.mode).toBe('flight');
    expect(h.heard).toEqual([]);
  });

  it('says who ended a dock: the pilot, or whoever asked', () => {
    const h = harness(0, -40, Math.PI / 2);
    h.run(0.2);
    h.navigator.approach('page/about');
    h.run(8);
    h.heard.length = 0;

    h.pilot.current = { ...NO_INPUT, thrust: 1 };
    h.run(0.1);
    expect(h.heard.filter(([name]) => name !== 'soi')).toEqual([
      ['undocked', { id: 'page/about', by: 'pilot' }],
      ['statechange', { mode: 'flight', target: null }],
    ]);

    h.pilot.current = { ...NO_INPUT };
    h.run(1);
    h.navigator.approach('page/about');
    h.run(8);
    h.heard.length = 0;
    h.navigator.release();
    h.run(0.1);
    expect(h.heard.filter(([name]) => name !== 'soi')).toEqual([
      ['undocked', { id: 'page/about', by: 'asked' }],
      ['statechange', { mode: 'flight', target: null }],
    ]);
    // Released into the assist's loose orbit: still there a while later, and offered the dock again.
    h.run(5);
    expect(h.navigator.candidate).toBe('page/about');
  });

  it('cuts to a body on request, and from one dock to another', () => {
    const h = harness(500, 500);
    h.run(0.1);
    expect(h.navigator.place('page/resume', 1)).toBe(true);
    h.run(0.1);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'page/resume' });
    const i = h.surroundings.orbits.indexOf('page/resume');
    const d = Math.hypot(
      h.state.x - (h.surroundings.field.positions[i * 2] ?? 0),
      h.state.z - (h.surroundings.field.positions[i * 2 + 1] ?? 0),
    );
    expect(d).toBeCloseTo(8.2, 6);

    h.heard.length = 0;
    h.navigator.place('page/about');
    h.run(0.1);
    expect(h.heard.filter(([name]) => name !== 'soi')).toEqual([
      ['undocked', { id: 'page/resume', by: 'asked' }],
      ['statechange', { mode: 'docked', target: 'page/about' }],
      ['docked', { id: 'page/about' }],
    ]);
  });

  it('starts a visit IN orbit when a page was opened on a body: never in flight, not even once', () => {
    // What main.ts does for `start.at`: place the ship before the first step and the first frame.
    const h = harness(64, -99);
    syncSurroundings(h.surroundings, 0);
    expect(h.navigator.place('page/resume')).toBe(true);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'page/resume' });
    expect(h.navigator.lastArrival).toBe('cut');

    h.run(2);
    expect(h.heard.filter(([name]) => name !== 'soi')).toEqual([
      ['statechange', { mode: 'docked', target: 'page/resume' }],
      ['docked', { id: 'page/resume' }],
    ]);
    // A body this galaxy does not have is no error: the visit starts in open sky.
    const lost = harness(64, -99);
    expect(lost.navigator.place('project/unpublished')).toBe(false);
    lost.run(0.5);
    expect(lost.navigator.state).toEqual({ mode: 'flight', target: null });
    expect(lost.names()).toEqual([]);
  });

  it('comes back from a snapshot exactly where it was: docked, same place, same way round', () => {
    const h = harness(0, -40, -Math.PI / 2);
    h.run(0.2);
    h.navigator.approach('page/about');
    h.run(20);
    const snapshot = {
      steps: Math.round(h.time() / STEP),
      ship: { ...h.state },
      dock: h.navigator.snapshot(),
    };
    expect(snapshot.dock?.docked).toBe(true);

    const again = harness(0, 0);
    copyShipState(snapshot.ship, again.state);
    syncSurroundings(again.surroundings, snapshot.steps * STEP);
    again.navigator.restore(snapshot.dock);
    expect(again.navigator.state).toEqual({ mode: 'docked', target: 'page/about' });
    expect(again.surroundings.dock.spin).toBe(h.surroundings.dock.spin);
    expect(again.state.x).toBeCloseTo(snapshot.ship.x, 6);
    expect(again.state.z).toBeCloseTo(snapshot.ship.z, 6);
    expect(again.state.heading).toBeCloseTo(snapshot.ship.heading, 6);
    // And it goes on exactly as the original does.
    h.run(3);
    again.run(3);
    expect(again.state.x).toBeCloseTo(h.state.x, 6);
    expect(again.state.z).toBeCloseTo(h.state.z, 6);
  });

  it('takes up an approach again after a snapshot', () => {
    const h = harness(0, -44, 0);
    h.run(0.2);
    h.navigator.approach('page/about');
    h.run(0.3);
    const dock = h.navigator.snapshot();
    expect(dock).toMatchObject({ id: 'page/about', docked: false });

    const again = harness(h.state.x, h.state.z, h.state.heading);
    copyShipState(h.state, again.state);
    again.navigator.restore(dock);
    again.run(8);
    expect(again.navigator.state).toEqual({ mode: 'docked', target: 'page/about' });
  });
});

describe('Navigator, travelling', () => {
  const story = (h: ReturnType<typeof harness>): Heard[] =>
    h.heard.filter(([name]) => name !== 'soi');

  it('flies to a body that is out of reach: autopilot, approach, docked, each said once', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    expect(h.navigator.withinReach('project/fishai')).toBe(false);
    expect(h.navigator.approach('project/fishai')).toBe(false);
    expect(h.navigator.travel('project/nope')).toBe(false);
    expect(h.navigator.travel('project/fishai')).toBe(true);
    expect(h.navigator.lastArrival).toBe('flown');
    h.run(0.1);
    expect(h.navigator.state).toEqual({ mode: 'autopilot', target: 'project/fishai' });
    // Nobody on the way there is offered a dock.
    expect(h.navigator.candidate).toBeNull();
    // Asking again is not news.
    expect(h.navigator.travel('project/fishai')).toBe(true);

    h.run(30);
    expect(story(h)).toEqual([
      ['statechange', { mode: 'autopilot', target: 'project/fishai' }],
      ['statechange', { mode: 'approach', target: 'project/fishai' }],
      ['statechange', { mode: 'docked', target: 'project/fishai' }],
      ['docked', { id: 'project/fishai' }],
    ]);
  });

  it('simply approaches what is within reach already', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    expect(h.navigator.travel('page/about')).toBe(true);
    h.run(0.1);
    expect(h.navigator.state).toEqual({ mode: 'approach', target: 'page/about' });
  });

  it('sets out from a dock, and says that the dock was left because somebody asked', () => {
    const h = harness(0, 0, 0, WIDE_GALAXY);
    h.navigator.place('page/about');
    h.run(1);
    h.heard.length = 0;
    expect(h.navigator.travel('project/fishai')).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'page/about', by: 'asked' }],
      ['statechange', { mode: 'autopilot', target: 'project/fishai' }],
    ]);
    h.run(30);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'project/fishai' });
  });

  it('hands the ship back to the pilot who steers, and says who ended the journey', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(3);
    h.heard.length = 0;
    h.pilot.current = { ...NO_INPUT, turn: 1 };
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'project/fishai', by: 'pilot' }],
      ['statechange', { mode: 'flight', target: null }],
    ]);
    expect(h.surroundings.dock.phase).toBe('free');
  });

  it('changes destination mid-journey when asked for somewhere else', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(3);
    h.heard.length = 0;
    expect(h.navigator.travel('system/code')).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'project/fishai', by: 'asked' }],
      ['statechange', { mode: 'autopilot', target: 'system/code' }],
    ]);
    h.run(30);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'system/code' });
  });

  it('takes up a journey again after a snapshot', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(4);
    const dock = h.navigator.snapshot();
    expect(dock).toMatchObject({ id: 'project/fishai', docked: false });

    const again = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(h.state, again.state);
    syncSurroundings(again.surroundings, h.time());
    again.navigator.restore(dock);
    again.run(0.1);
    expect(again.navigator.state).toEqual({ mode: 'autopilot', target: 'project/fishai' });
    again.run(30);
    expect(again.navigator.state).toEqual({ mode: 'docked', target: 'project/fishai' });
  });
});
