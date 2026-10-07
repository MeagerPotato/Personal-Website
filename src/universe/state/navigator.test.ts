import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../core/snapshot';
import { tuning } from '../design/tuning';
import { HYPER_NONE } from '../sim/docking';
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

/** The same, with a relay: a body nothing docks at (a link: GitHub), beside the station. */
const LINKED_GALAXY: SurroundingsInput = {
  ...WIDE_GALAXY,
  bodies: [
    ...WIDE_GALAXY.bodies,
    {
      id: 'link/github',
      system: 'home',
      parent: 'page/about',
      orbit: { radius: 60, phase: Math.PI, periodSec: 125 },
      radius: 1.4,
      dockRadius: 7.4,
      docks: false,
    },
  ],
};

type Heard = { [K in keyof NavigatorEvents]: [K, NavigatorEvents[K]] }[keyof NavigatorEvents];

/** A little engine: the ship, the world, the navigator, in the order main.ts steps them. */
function harness(x: number, z: number, heading = 0, galaxy = GALAXY, reducedMotion = false) {
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
    reducedMotion,
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

describe('Navigator and a body nothing docks at (a link)', () => {
  /** Where the relay is at t = 0: 60 u out along -Z from home. */
  const RELAY = { x: 0, z: -60 };

  it('never sets out for it, approaches it or puts the ship round it, from anywhere', () => {
    for (const [x, z] of [
      [RELAY.x + 9, RELAY.z],
      [0, -200],
      [-700, 480],
    ] as const) {
      const h = harness(x, z, 0, LINKED_GALAXY);
      h.run(0.1);
      const before = { ...h.state };
      expect(h.navigator.withinReach('link/github')).toBe(false);
      expect(h.navigator.travel('link/github', 'pilot')).toBe(false);
      expect(h.navigator.approach('link/github', 'pilot')).toBe(false);
      expect(h.navigator.place('link/github')).toBe(false);
      expect(h.surroundings.dock.phase).toBe('free');
      expect(h.state).toEqual(before);
      h.run(0.5);
      expect(h.navigator.state).toEqual({ mode: 'flight', target: null });
      expect(h.names()).not.toContain('statechange');
    }
  });

  it('never offers it, however slowly the ship drifts round it', () => {
    const h = harness(RELAY.x + 8, RELAY.z, Math.PI, LINKED_GALAXY);
    h.state.vz = -3;
    let offered = false;
    for (let k = 0; k < 120; k += 1) {
      h.run(1 / 30);
      offered ||= h.navigator.candidate === 'link/github';
    }
    expect(offered).toBe(false);
    expect(h.heard).not.toContainEqual(['soi', { id: 'link/github' }]);
  });

  it('keeps the ship headed where it was going when someone asks for it on the way', () => {
    const h = harness(0, -200, 0, LINKED_GALAXY);
    h.run(0.1);
    expect(h.navigator.travel('project/fishai')).toBe(true);
    h.run(0.5);
    expect(h.navigator.travel('link/github')).toBe(false);
    expect(h.navigator.state).toEqual({ mode: 'autopilot', target: 'project/fishai' });
  });

  it('takes a snapshot that says the ship is headed for it, or docked at it, as a Stop', () => {
    for (const dock of [
      { id: 'link/github', docked: true, angle: 1, spin: 1, holdSec: 0, hyper: false },
      { id: 'link/github', docked: false, angle: 0, spin: 1, holdSec: 1, hyper: false },
    ]) {
      for (const cut of [false, true]) {
        const h = harness(RELAY.x + 30, RELAY.z, 0, LINKED_GALAXY);
        h.state.vz = 200;
        h.run(0.05);
        h.navigator.restore(dock, cut);
        h.run(0.05);
        expect(
          h.navigator.state,
          `${dock.docked ? 'docked' : 'on the way'}${cut ? ', cut' : ''}`,
        ).toEqual({ mode: 'flight', target: null });
        // Braking to rest where it is, as after any Stop.
        expect(h.navigator.halting).toBe(true);
        expect(h.surroundings.dock.phase).toBe('free');
      }
    }
  });

  it('takes a docked snapshot of a body this world does not have as a Stop too', () => {
    const h = harness(0, -200, 0, LINKED_GALAXY);
    h.state.vz = 14;
    h.run(0.05);
    h.navigator.restore({
      id: 'project/gone',
      docked: true,
      angle: 0,
      spin: 1,
      holdSec: 0,
      hyper: false,
    });
    h.run(0.05);
    expect(h.navigator.state).toEqual({ mode: 'flight', target: null });
    expect(h.navigator.halting).toBe(true);
  });
});

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
      ['undocked', { id: 'page/about', by: 'pilot', halting: false }],
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
      ['undocked', { id: 'page/about', by: 'asked', halting: false }],
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
      ['undocked', { id: 'page/resume', by: 'asked', halting: false }],
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
  /** The journey's own news. (What hyperspace says on the way is told further down.) */
  const story = (h: ReturnType<typeof harness>): Heard[] =>
    h.heard.filter(([name]) => name !== 'soi' && name !== 'hyper');

  it('flies to a body that is out of reach: autopilot, then docked, each said once', () => {
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
      // No approach in between: the autopilot's arrival is the capture.
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
    // ...and takes as long as the shortest journey all the same: it still reads as a journey.
    h.run(tuning.cruise.minJourneySec - 0.4);
    expect(h.navigator.state).toEqual({ mode: 'approach', target: 'page/about' });
    h.run(10);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'page/about' });
  });

  it('lets the pilot dock at once where they asked to themselves', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    expect(h.navigator.approach('page/about')).toBe(true);
    h.run(0.1);
    expect(h.surroundings.dock.holdSec).toBe(0);
  });

  it('sets out from a dock, and says that the dock was left because somebody asked', () => {
    const h = harness(0, 0, 0, WIDE_GALAXY);
    h.navigator.place('page/about');
    h.run(1);
    h.heard.length = 0;
    expect(h.navigator.travel('project/fishai')).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'page/about', by: 'asked', halting: false }],
      ['statechange', { mode: 'autopilot', target: 'project/fishai' }],
    ]);
    h.run(30);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'project/fishai' });
  });

  it('sets out because the PILOT pointed somewhere, and says so to what it leaves behind', () => {
    const h = harness(0, 0, 0, WIDE_GALAXY);
    h.navigator.place('page/about');
    h.run(1);
    h.heard.length = 0;
    expect(h.navigator.travel('project/fishai', 'pilot')).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'page/about', by: 'pilot', halting: false }],
      ['statechange', { mode: 'autopilot', target: 'project/fishai' }],
    ]);

    // Pointing at another one on the way: the journey that ends is the pilot's doing too.
    h.heard.length = 0;
    expect(h.navigator.travel('system/code', 'pilot')).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'project/fishai', by: 'pilot', halting: false }],
      ['statechange', { mode: 'autopilot', target: 'system/code' }],
    ]);
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
      ['undocked', { id: 'project/fishai', by: 'pilot', halting: false }],
      ['statechange', { mode: 'flight', target: null }],
    ]);
    expect(h.surroundings.dock.phase).toBe('free');
    // The brake, on the way, is a Stop: the ship brakes to rest, and says so.
    const braked = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    braked.run(0.2);
    braked.navigator.travel('project/fishai');
    braked.run(1.2);
    braked.heard.length = 0;
    braked.pilot.current = { ...NO_INPUT, brake: 1 };
    braked.run(0.1);
    expect(story(braked)).toEqual([
      ['undocked', { id: 'project/fishai', by: 'pilot', halting: true }],
      ['statechange', { mode: 'flight', target: null }],
    ]);
  });

  it('forgets that it left a body it is headed for again before anyone heard: three requests in a frame', () => {
    // Docked; a planet pointed at, another, and then a link back to the first, all in one frame.
    // Heard after the link, "left Resume" cancelled the link's own journey (api.ts goTo) and sent
    // the page it opened home (shell/follow.ts).
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.navigator.place('page/about');
    h.run(0.5);
    h.heard.length = 0;
    expect(h.navigator.travel('page/resume', 'pilot')).toBe(true);
    expect(h.navigator.travel('project/fishai', 'pilot')).toBe(true);
    expect(h.navigator.travel('page/resume')).toBe(true);
    h.navigator.frameUpdate();
    const left = h.heard.filter(([name]) => name === 'undocked');
    expect(left).toEqual([
      ['undocked', { id: 'page/about', by: 'pilot', halting: false }],
      ['undocked', { id: 'project/fishai', by: 'asked', halting: false }],
    ]);
    expect(h.navigator.state.target).toBe('page/resume');
  });

  it('stops where the pilot says STOP: brakes to rest, and says the pilot ended the journey', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(1.2);
    const fast = Math.hypot(h.state.vx, h.state.vz);
    expect(fast).toBeGreaterThan(200);
    h.heard.length = 0;
    const x0 = h.state.x;
    const z0 = h.state.z;
    h.navigator.stop('pilot');
    expect(h.navigator.halting).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'project/fishai', by: 'pilot', halting: true }],
      ['statechange', { mode: 'flight', target: null }],
    ]);
    h.run(4);
    // At rest where it was stopped (not coasting on toward where it was going), braking no more.
    expect(h.navigator.halting).toBe(false);
    expect(Math.hypot(h.state.vx, h.state.vz)).toBeLessThan(1);
    expect(Math.hypot(h.state.x - x0, h.state.z - z0)).toBeLessThan(150);
  });

  it('takes a journey let go of by the web layer as a STOP: it brakes to rest, and Leave orbit is still only that', () => {
    // The route moved to a page with no body (Projects, the wordmark, Close, Back to the sky)
    // while the ship was on its way: api.ts undock, shell/follow.ts. Let go of at the autopilot's
    // speed, it coasted on at the pilot's own top speed into whatever lay ahead.
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(1.2);
    expect(Math.hypot(h.state.vx, h.state.vz)).toBeGreaterThan(200);
    h.heard.length = 0;
    const x0 = h.state.x;
    const z0 = h.state.z;
    h.navigator.release('asked');
    expect(h.navigator.halting).toBe(true);
    h.run(0.1);
    expect(story(h)).toEqual([
      ['undocked', { id: 'project/fishai', by: 'asked', halting: true }],
      ['statechange', { mode: 'flight', target: null }],
    ]);
    h.run(4);
    expect(h.navigator.halting).toBe(false);
    expect(Math.hypot(h.state.vx, h.state.vz)).toBeLessThan(1);
    expect(Math.hypot(h.state.x - x0, h.state.z - z0)).toBeLessThan(150);

    // The same on the ring's own approach, however it began.
    const near = harness(0, -40, Math.PI / 2);
    near.run(0.2);
    near.navigator.approach('page/about');
    near.run(0.3);
    near.navigator.release('asked');
    expect(near.navigator.halting).toBe(true);

    // Out of an orbit, letting go is all it does: a docked ship is slow already.
    const docked = harness(0, -40, Math.PI / 2);
    docked.run(0.2);
    docked.navigator.approach('page/about');
    docked.run(8);
    expect(docked.navigator.state.mode).toBe('docked');
    docked.navigator.release('asked');
    expect(docked.navigator.halting).toBe(false);
    expect(docked.navigator.state).toEqual({ mode: 'flight', target: null });
  });

  it('takes an orbit a journey has only just arrived in for the journey still: Close as the page opens', () => {
    // A journey arrives beside the ring at up to 2.5 times the approach's pace, and the dock's
    // springs take that out over the first half second in orbit (sim/docking.ts, arrive).
    const arrived = (): ReturnType<typeof harness> => {
      const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
      h.run(0.2);
      h.navigator.travel('project/fishai');
      for (let k = 0; k < 60 * 30 && h.navigator.state.mode !== 'docked'; k += 1) h.run(1 / 60);
      expect(h.navigator.state.mode).toBe('docked');
      return h;
    };
    const carried = (h: ReturnType<typeof harness>): number => {
      const { field, orbits } = h.surroundings;
      const i = orbits.indexOf('project/fishai');
      const vx = h.state.vx - (field.velocities[i * 2] ?? 0);
      const vz = h.state.vz - (field.velocities[i * 2 + 1] ?? 0);
      return Math.hypot(vx, vz);
    };
    // Let go of there and then, the ship brakes to rest as it would have a moment before.
    const letGo = arrived();
    expect(carried(letGo)).toBeGreaterThan(25);
    letGo.navigator.release('asked');
    expect(letGo.navigator.halting).toBe(true);
    for (let k = 0; k < 60 * 4 && letGo.navigator.halting; k += 1) letGo.run(1 / 60);
    // At rest by the planet; the orbit assist has it from there.
    expect(letGo.navigator.halting).toBe(false);
    expect(Math.hypot(letGo.state.vx, letGo.state.vz)).toBeLessThan(1);
    // Steered off there and then, the reflex stays on for the pilot.
    const steered = arrived();
    steered.pilot.current = { ...NO_INPUT, turn: 1 };
    steered.run(1 / 60);
    expect(steered.navigator.state).toEqual({ mode: 'flight', target: null });
    expect(steered.navigator.guarding).toBe(true);
    // Once the orbit has settled, both only let go.
    const settled = arrived();
    settled.run(3);
    expect(carried(settled)).toBeLessThan(tuning.dock.maxSpeed + 0.01);
    settled.navigator.release('asked');
    expect(settled.navigator.halting).toBe(false);
    expect(settled.navigator.guarding).toBe(false);
  });

  it('goes on braking after a rebuild, if it was stopped a moment before', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(1.2);
    h.navigator.stop('pilot');
    h.run(0.1);
    // What core/snapshot.ts keeps: no dock, and a ship still braking.
    expect(h.navigator.snapshot()).toBeNull();
    expect(h.navigator.halting).toBe(true);
    const again = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(h.state, again.state);
    syncSurroundings(again.surroundings, h.time());
    again.navigator.restore(null, false, { halting: true, guarding: false });
    expect(again.navigator.halting).toBe(true);
    expect(again.navigator.state).toEqual({ mode: 'flight', target: null });
    again.run(4);
    expect(Math.hypot(again.state.vx, again.state.vz)).toBeLessThan(1);
    // And a rebuild of a ship that was not stopped leaves it be.
    const idle = harness(0, 0, 0, WIDE_GALAXY);
    idle.navigator.restore(null);
    expect(idle.navigator.halting).toBe(false);
    expect(idle.navigator.guarding).toBe(false);
  });

  it('stops a journey it cannot take up after a rebuild: a body this world does not have', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(1.2);
    expect(Math.hypot(h.state.vx, h.state.vz)).toBeGreaterThan(100);
    // A snapshot from another deploy, headed for a body this manifest no longer has.
    const headed = h.navigator.snapshot();
    if (headed === null) throw new Error('no journey under way');
    const dock = { ...headed, id: 'project/gone' };
    for (const cut of [false, true]) {
      const again = harness(0, 0, 0, WIDE_GALAXY);
      copyShipState(h.state, again.state);
      syncSurroundings(again.surroundings, h.time());
      again.navigator.restore(dock, cut);
      expect(again.navigator.state).toEqual({ mode: 'flight', target: null });
      expect(again.navigator.halting).toBe(true);
      again.run(4);
      expect(Math.hypot(again.state.vx, again.state.vz)).toBeLessThan(1);
    }
  });

  it('stops an orbit it cannot put back after a rebuild: round a body this world does not have', () => {
    const h = harness(0, 0, 0, WIDE_GALAXY);
    syncSurroundings(h.surroundings, 0);
    h.navigator.place('project/fishai');
    h.run(2);
    const docked = h.navigator.snapshot();
    expect(docked?.docked).toBe(true);
    // The ship is carried round its ring: let go of, it would drift off at the ring's speed.
    expect(Math.hypot(h.state.vx, h.state.vz)).toBeGreaterThan(5);

    // The next deploy has no FishAI: the snapshot is docked at a body this world does not have.
    const gone: SurroundingsInput = {
      ...WIDE_GALAXY,
      bodies: WIDE_GALAXY.bodies.filter(({ id }) => id !== 'project/fishai'),
    };
    const again = harness(0, 0, 0, gone);
    copyShipState(h.state, again.state);
    syncSurroundings(again.surroundings, h.time());
    again.navigator.restore(docked);
    expect(again.navigator.state).toEqual({ mode: 'flight', target: null });
    expect(again.navigator.halting).toBe(true);
    again.run(4);
    expect(Math.hypot(again.state.vx, again.state.vz)).toBeLessThan(1);
    // Nothing to announce: it never was docked anywhere in this world.
    expect(again.names().filter((name) => name !== 'soi')).toEqual([]);
  });

  it('keeps the reflex on after a rebuild, if the pilot took the ship back at speed a moment before', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(1.2);
    // A tap of an arrow key: the pilot has the ship back, and the reflex stays on for them.
    h.pilot.current = { ...NO_INPUT, turn: 1 };
    h.run(1 / 60);
    h.pilot.current = { ...NO_INPUT };
    h.run(0.1);
    expect(h.navigator.state).toEqual({ mode: 'flight', target: null });
    expect(h.navigator.guarding).toBe(true);
    expect(h.navigator.halting).toBe(false);
    // What core/snapshot.ts keeps: no dock, and a ship that is still guarded.
    expect(h.navigator.snapshot()).toBeNull();
    const again = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(h.state, again.state);
    syncSurroundings(again.surroundings, h.time());
    again.navigator.restore(null, false, { halting: false, guarding: true });
    expect(again.navigator.guarding).toBe(true);
    expect(again.navigator.state).toEqual({ mode: 'flight', target: null });
    // Until it is slow enough for the cushions, and not a moment longer.
    again.run(6);
    expect(again.navigator.guarding).toBe(false);
    expect(Math.hypot(again.state.vx, again.state.vz)).toBeLessThan(30);
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
      ['undocked', { id: 'project/fishai', by: 'asked', halting: false }],
      ['statechange', { mode: 'autopilot', target: 'system/code' }],
    ]);
    h.run(30);
    expect(h.navigator.state).toEqual({ mode: 'docked', target: 'system/code' });
  });

  it('takes up a journey again after a snapshot', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    // Mid-way: no journey is over before cruise.minJourneySec.
    h.run(1);
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

  it('keeps what is left of a hop after a rebuild: no quicker, and not started over', () => {
    // Half a second into a hop that must take cruise.minJourneySec (the ring's own pilot flies
    // it, within reach): the engine is rebuilt (core/snapshot.ts).
    const { minJourneySec } = tuning.cruise;
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('page/about');
    h.run(0.5);
    const dock = h.navigator.snapshot();
    expect(dock?.docked).toBe(false);
    expect(dock?.holdSec).toBeCloseTo(minJourneySec - 0.5, 6);

    const again = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(h.state, again.state);
    syncSurroundings(again.surroundings, h.time());
    again.navigator.restore(dock);
    expect(again.surroundings.dock.holdSec).toBeCloseTo(minJourneySec - 0.5, 6);
    // Not in orbit before the hop has lasted minJourneySec in all...
    again.run(minJourneySec - 0.5 - 0.1);
    expect(again.navigator.state).toEqual({ mode: 'approach', target: 'page/about' });
    // ...and then as soon as it is on the ring, as it would have been without the rebuild.
    again.run(10);
    expect(again.navigator.state).toEqual({ mode: 'docked', target: 'page/about' });
  });

  it('keeps what is left of a journey on the autopilot after a rebuild, too', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    h.navigator.travel('project/fishai');
    h.run(0.25);
    const dock = h.navigator.snapshot();
    expect(dock?.holdSec).toBeCloseTo(tuning.cruise.minJourneySec - 0.25, 6);

    const again = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(h.state, again.state);
    syncSurroundings(again.surroundings, h.time());
    again.navigator.restore(dock);
    again.run(1 / 60);
    expect(again.navigator.state).toEqual({ mode: 'autopilot', target: 'project/fishai' });
    expect(again.surroundings.cruise.holdSec).toBeCloseTo(tuning.cruise.minJourneySec - 0.25, 6);
  });

  it("takes up the pilot's own dock with no hold, as it was", () => {
    const h = harness(0, -44, 0);
    h.run(0.2);
    h.navigator.approach('page/about');
    h.run(0.1);
    const dock = h.navigator.snapshot();
    expect(dock?.holdSec).toBe(0);
    const again = harness(0, 0, 0);
    copyShipState(h.state, again.state);
    again.navigator.restore(dock);
    expect(again.surroundings.dock.holdSec).toBe(0);
  });

  it('never flies a journey it takes up for a visitor who asked for less motion', () => {
    // Out of reach: a cut, there and then, as a link would be (api.ts goTo).
    const far = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    far.run(0.2);
    far.navigator.travel('project/fishai');
    far.run(0.5);
    const headed = far.navigator.snapshot();
    const cut = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(far.state, cut.state);
    syncSurroundings(cut.surroundings, far.time());
    cut.navigator.restore(headed, true);
    expect(cut.navigator.state).toEqual({ mode: 'docked', target: 'project/fishai' });
    expect(cut.navigator.lastArrival).toBe('cut');

    // Within reach: the short approach, as pointing at it would be (main.ts flyToRow).
    const near = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    near.run(0.2);
    near.navigator.travel('page/about');
    near.run(0.2);
    const close = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(near.state, close.state);
    syncSurroundings(close.surroundings, near.time());
    close.navigator.restore(near.navigator.snapshot(), true);
    expect(close.navigator.state).toEqual({ mode: 'approach', target: 'page/about' });
    // With no hold, as pointing at it would be: theirs is no journey.
    expect(close.surroundings.dock.holdSec).toBe(0);
  });
});

describe('Navigator and hyperspace', () => {
  type Harness = ReturnType<typeof harness>;
  const hyperStory = (h: Harness): string[] =>
    h.heard.flatMap((heard) => (heard[0] === 'hyper' ? [heard[1].state] : []));
  /** Step (a frame after each) until `done`; a journey that never gets there fails the test. */
  const until = (h: Harness, done: () => boolean, limitSec = 30): void => {
    for (let k = Math.round(limitSec / STEP); k > 0 && !done(); k -= 1) h.run(STEP);
    expect(done()).toBe(true);
  };
  const docked = (h: Harness) => (): boolean => h.navigator.state.mode === 'docked';
  /** Off for FishAI, 950 u away: long and fast enough for a jump to be offered. */
  const setOut = (reducedMotion = false): Harness => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY, reducedMotion);
    h.run(0.2);
    expect(h.navigator.travel('project/fishai')).toBe(true);
    return h;
  };
  /** The same, the jump taken, and the tunnel open. */
  const inTheTunnel = (): Harness => {
    const h = setOut();
    until(h, () => h.navigator.hyper === 'offered');
    expect(h.navigator.engageHyper()).toBe(true);
    until(h, () => h.navigator.hyper === 'tunnel');
    return h;
  };

  it('takes the jump that is offered, and nothing else', () => {
    const h = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    h.run(0.2);
    // Free flight is offered nothing...
    expect(h.navigator.hyper).toBe('off');
    expect(h.navigator.engageHyper()).toBe(false);
    h.navigator.travel('project/fishai');
    // ...and a journey nothing before its first step has planned it.
    expect(h.navigator.engageHyper()).toBe(false);
    h.run(STEP);
    expect(h.navigator.hyper).toBe('offered');
    expect(h.navigator.engageHyper()).toBe(true);
    expect(h.navigator.hyper).toBe('windup');
    // Pressing twice is pressing once.
    expect(h.navigator.engageHyper()).toBe(false);
    expect(h.navigator.hyper).toBe('windup');

    // A hop to somewhere within reach is flown by the ring's own pilot: never a jump.
    const hop = harness(0, -40, Math.PI / 2, WIDE_GALAXY);
    hop.run(0.2);
    hop.navigator.travel('page/about');
    for (let k = 0; k < 120; k += 1) {
      hop.run(STEP);
      expect(hop.navigator.hyper).toBe('off');
      expect(hop.navigator.engageHyper()).toBe(false);
    }
    expect(hyperStory(hop)).toEqual([]);
  });

  it('tells a jump as it goes: offered, wound up, the tunnel, and over, each once', () => {
    const h = setOut();
    h.run(STEP);
    // The journey's own news comes first.
    expect(h.heard.filter(([name]) => name !== 'soi')).toEqual([
      ['statechange', { mode: 'autopilot', target: 'project/fishai' }],
      ['hyper', { state: 'offered' }],
    ]);
    h.navigator.engageHyper();
    until(h, docked(h));
    expect(hyperStory(h)).toEqual(['offered', 'windup', 'tunnel', 'off']);
    // The tunnel closes on the way in: the ship is out of it before it is in orbit.
    const names = h.names();
    expect(names.lastIndexOf('hyper')).toBeLessThan(names.indexOf('docked'));
    // And an orbit has none.
    h.run(1);
    expect(h.navigator.hyper).toBe('off');
    expect(h.navigator.engageHyper()).toBe(false);
    expect(hyperStory(h)).toHaveLength(4);
  });

  it('tells every change in order however slow the frames are: once a step, not once a frame', () => {
    const h = setOut();
    h.step();
    h.navigator.engageHyper();
    // A tab that drew nothing for the whole journey.
    for (let k = 0; k < 60 * 30 && !docked(h)(); k += 1) h.step();
    expect(docked(h)()).toBe(true);
    expect(hyperStory(h)).toEqual([]);
    h.navigator.frameUpdate();
    expect(hyperStory(h)).toEqual(['offered', 'windup', 'tunnel', 'off']);
  });

  it('never offers twice on one journey: an offer left alone is simply over', () => {
    const h = setOut();
    until(h, docked(h));
    expect(hyperStory(h)).toEqual(['offered', 'off']);
  });

  it('takes a wind-up back while it is one (Shift was half of a chord), and never the tunnel', () => {
    const h = setOut();
    h.run(STEP);
    // Nothing to take back yet.
    expect(h.navigator.cancelHyper()).toBe(false);
    h.navigator.engageHyper();
    h.run(0.1);
    expect(h.navigator.cancelHyper()).toBe(true);
    expect(h.navigator.hyper).toBe('offered');
    h.run(STEP);
    expect(hyperStory(h)).toEqual(['offered', 'windup', 'offered']);
    // The offer stands: taken again, it opens, and then nothing takes it back.
    expect(h.navigator.engageHyper()).toBe(true);
    until(h, () => h.navigator.hyper === 'tunnel');
    expect(h.navigator.cancelHyper()).toBe(false);
    expect(h.navigator.hyper).toBe('tunnel');

    // Pressed and taken back between two steps, it never happened.
    const quick = setOut();
    quick.run(STEP);
    quick.navigator.engageHyper();
    quick.navigator.cancelHyper();
    quick.run(STEP);
    expect(hyperStory(quick)).toEqual(['offered']);
  });

  it('ends the jump with its journey: Stop, the web layer letting go, the controls', () => {
    const ways: ReadonlyArray<readonly [string, (h: Harness) => void]> = [
      ['Stop', (h) => h.navigator.stop('pilot')],
      ['let go', (h) => h.navigator.release('asked')],
      ['an arrow key', (h) => void (h.pilot.current = { ...NO_INPUT, turn: 1 })],
      ['the brake', (h) => void (h.pilot.current = { ...NO_INPUT, brake: 1 })],
    ];
    for (const [name, end] of ways) {
      const h = inTheTunnel();
      h.run(0.2);
      end(h);
      h.run(STEP);
      expect(h.navigator.state, name).toEqual({ mode: 'flight', target: null });
      expect(h.navigator.hyper, name).toBe('off');
      expect(h.surroundings.dock.hyper, name).toBe(HYPER_NONE);
      expect(hyperStory(h), name).toEqual(['offered', 'windup', 'tunnel', 'off']);
      // Nothing is left to take or to keep.
      expect(h.navigator.engageHyper(), name).toBe(false);
      expect(h.navigator.snapshot(), name).toBeNull();
    }
  });

  it('ends it for another destination, a new journey with an offer of its own, and keeps it for the same one', () => {
    const h = inTheTunnel();
    h.run(0.2);
    // Asking for where it is going already is not news.
    expect(h.navigator.travel('project/fishai')).toBe(true);
    h.run(STEP);
    expect(h.navigator.hyper).toBe('tunnel');
    expect(hyperStory(h)).toEqual(['offered', 'windup', 'tunnel']);

    expect(h.navigator.travel('system/code', 'pilot')).toBe(true);
    // At once, before any step: the tunnel was the old journey's.
    expect(h.navigator.hyper).toBe('off');
    h.run(STEP);
    expect(h.navigator.state).toEqual({ mode: 'autopilot', target: 'system/code' });
    expect(['off', 'offered']).toContain(h.navigator.hyper);
    expect(hyperStory(h).at(-1)).toBe(h.navigator.hyper);
    // Nobody presses on the new journey: it has no wind-up and no tunnel.
    until(h, docked(h));
    const after = hyperStory(h).slice(3);
    expect(after).not.toContain('windup');
    expect(after).not.toContain('tunnel');
    expect(after.at(-1)).toBe('off');
  });

  it('keeps a jump through a rebuild only in the tunnel', () => {
    const h = setOut();
    h.run(STEP);
    expect(h.navigator.snapshot()).toMatchObject({ docked: false, hyper: false });
    h.navigator.engageHyper();
    h.run(STEP);
    expect(h.navigator.hyper).toBe('windup');
    expect(h.navigator.snapshot()).toMatchObject({ docked: false, hyper: false });
    until(h, () => h.navigator.hyper === 'tunnel');
    expect(h.navigator.snapshot()).toMatchObject({
      id: 'project/fishai',
      docked: false,
      hyper: true,
    });
    until(h, () => h.navigator.hyper === 'off');
    expect(h.navigator.snapshot()).toMatchObject({ docked: false, hyper: false });
    until(h, docked(h));
    expect(h.navigator.snapshot()).toMatchObject({ docked: true, hyper: false });
  });

  it('takes a journey up again in the tunnel after a rebuild, and says so without a wind-up', () => {
    const h = inTheTunnel();
    h.run(0.2);
    // Away and back, as the web layer keeps it (sessionStorage) and the engine reads it again.
    const kept = parseSnapshot(
      JSON.parse(
        JSON.stringify({
          steps: Math.round(h.time() / STEP),
          ship: h.state,
          dock: h.navigator.snapshot(),
          halting: h.navigator.halting,
          guarding: h.navigator.guarding,
        }),
      ),
    );
    if (kept === null) throw new Error('not a snapshot');
    expect(kept.dock).toMatchObject({ id: 'project/fishai', docked: false, hyper: true });

    const again = harness(0, 0, 0, WIDE_GALAXY);
    copyShipState(kept.ship, again.state);
    syncSurroundings(again.surroundings, kept.steps * STEP);
    again.navigator.restore(kept.dock);
    expect(again.navigator.hyper).toBe('tunnel');
    again.run(STEP);
    // The new journey's own plan still has its fast stretch ahead: the tunnel holds.
    expect(again.navigator.hyper).toBe('tunnel');
    expect(again.heard.filter(([name]) => name !== 'soi')).toEqual([
      ['statechange', { mode: 'autopilot', target: 'project/fishai' }],
      ['hyper', { state: 'tunnel' }],
    ]);
    until(again, docked(again));
    expect(hyperStory(again)).toEqual(['tunnel', 'off']);
    expect(again.navigator.state).toEqual({ mode: 'docked', target: 'project/fishai' });
  });

  it('does not take up a tunnel on a journey the autopilot does not fly, or one with nothing fast left', () => {
    // Within reach, the journey is taken up as an approach: no tunnel there.
    const near = harness(0, -44, 0, WIDE_GALAXY);
    near.run(0.2);
    near.navigator.restore({
      id: 'page/about',
      docked: false,
      angle: 0,
      spin: 1,
      holdSec: 1,
      hyper: true,
    });
    expect(near.navigator.state).toEqual({ mode: 'approach', target: 'page/about' });
    expect(near.navigator.hyper).toBe('off');
    near.run(0.5);
    expect(hyperStory(near)).toEqual([]);

    // A short journey from rest: the autopilot flies it, but its plan has nothing fast, and the
    // first step closes a tunnel the snapshot claimed. Nobody is told of either.
    const slow = harness(0, -200, 0, WIDE_GALAXY);
    slow.run(0.2);
    expect(slow.navigator.withinReach('page/about')).toBe(false);
    slow.navigator.restore({
      id: 'page/about',
      docked: false,
      angle: 0,
      spin: 1,
      holdSec: 0,
      hyper: true,
    });
    expect(slow.surroundings.dock.phase).toBe('cruise');
    expect(slow.navigator.hyper).toBe('tunnel');
    slow.run(STEP);
    expect(slow.navigator.hyper).toBe('off');
    expect(hyperStory(slow)).toEqual([]);
    until(slow, docked(slow));
    expect(hyperStory(slow)).toEqual([]);
  });

  it('has no hyperspace at all for a visitor who asked for less motion', () => {
    const h = setOut(true);
    h.run(1);
    expect(h.navigator.hyper).toBe('off');
    expect(h.navigator.engageHyper()).toBe(false);
    expect(h.navigator.snapshot()).toMatchObject({ docked: false, hyper: false });
    until(h, docked(h));
    expect(hyperStory(h)).toEqual([]);

    // A tunnel kept by a visitor who has asked for less motion since is not taken up: their
    // journey is a cut (main.ts restores with `cut`), and even flown, it has no tunnel.
    const kept = {
      id: 'project/fishai',
      docked: false,
      angle: 0,
      spin: 1,
      holdSec: 0,
      hyper: true,
    };
    for (const cut of [true, false]) {
      const again = harness(0, -40, Math.PI / 2, WIDE_GALAXY, true);
      again.run(0.2);
      again.navigator.restore(kept, cut);
      expect(again.surroundings.dock.hyper, String(cut)).toBe(HYPER_NONE);
      expect(again.navigator.hyper, String(cut)).toBe('off');
      until(again, docked(again));
      expect(hyperStory(again), String(cut)).toEqual([]);
    }
  });
});
