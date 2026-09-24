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
  const story = (h: ReturnType<typeof harness>): Heard[] =>
    h.heard.filter(([name]) => name !== 'soi');

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
