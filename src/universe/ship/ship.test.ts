import { PerspectiveCamera, ShaderMaterial, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyPose, createPose } from '../camera/CameraRig';
import { ChaseCam } from '../camera/ChaseCam';
import { AssetStore } from '../core/AssetStore';
import type { Frame } from '../core/Engine';
import { FixedClock } from '../core/loop';
import { tuning } from '../design/tuning';
import { dockAt, requestDock } from '../sim/docking';
import { topSpeed } from '../sim/flight';
import { createSurroundings } from '../sim/surroundings';
import type { FlightInput } from '../sim/types';
import { ShipSystem } from './ShipSystem';

const STEP = 1 / tuning.loop.stepHz;
const SPAWN = { x: 12, z: -52, heading: 0.35 };

function setup(reducedMotion = false) {
  const pilot = { current: { thrust: 0, turn: 0, brake: 0, boost: false } as FlightInput };
  const assets = new AssetStore();
  const ship = new ShipSystem({ spawn: SPAWN, pilot, assets, reducedMotion });
  return { pilot, assets, ship };
}

/** Drive the ship the way the engine does: fixed steps, then one in-between frame. */
function run(
  ship: ShipSystem,
  frameTimes: readonly number[],
  onFrame?: (frame: Frame) => void,
): void {
  const clock = new FixedClock({ stepSec: STEP, maxFrameSec: 0.1, maxStepsPerFrame: 5 });
  let elapsed = 0;
  for (const frameSec of frameTimes) {
    const slice = clock.advance(frameSec);
    for (let i = 0; i < slice.steps; i += 1) ship.fixedUpdate(STEP, 0);
    elapsed += slice.frameSec;
    const frame = { elapsed, dt: slice.frameSec, alpha: slice.alpha, simTime: clock.simTime };
    ship.frameUpdate(frame);
    onFrame?.(frame);
  }
}

const tiltOf = (ship: ShipSystem): Object3D => {
  const tilt = ship.object.children[0];
  if (!tilt) throw new Error('no tilt node');
  return tilt;
};

const flameOf = (ship: ShipSystem): Object3D => {
  let flame: Object3D | undefined;
  ship.object.traverse((node) => {
    if (node.name === 'flame') flame = node;
  });
  if (!flame) throw new Error('no flame');
  return flame;
};

describe('the ship', () => {
  it('starts at the spawn point, at rest, pointing the way it was told', () => {
    const { ship } = setup();
    expect(ship.position.x).toBe(SPAWN.x);
    expect(ship.position.z).toBe(SPAWN.z);
    expect(ship.heading).toBe(SPAWN.heading);
    expect(ship.object.rotation.y).toBe(SPAWN.heading);
    expect(ship.speed).toBe(0);
  });

  it('is drawn BETWEEN the last two simulated states', () => {
    const { ship, pilot } = setup();
    ship.placeAt(0, 0, 0);
    pilot.current.thrust = 1;
    ship.fixedUpdate(STEP, 0);
    ship.fixedUpdate(STEP, 0);
    const after = ship.state.z;

    ship.frameUpdate({ elapsed: 0, dt: STEP, alpha: 1, simTime: 0 });
    expect(ship.position.z).toBeCloseTo(after, 12);
    ship.frameUpdate({ elapsed: 0, dt: STEP, alpha: 0.5, simTime: 0 });
    expect(ship.position.z).toBeGreaterThan(0);
    expect(ship.position.z).toBeLessThan(after);
    expect(ship.object.position.z).toBe(ship.position.z);
  });

  it('leans INTO a turn, and only the model leans', () => {
    const { ship, pilot } = setup(true);
    ship.placeAt(0, 0, 0);
    pilot.current.thrust = 1;
    pilot.current.turn = 1; // to the pilot's left
    run(ship, Array<number>(120).fill(STEP));

    expect(ship.yawRate).toBeGreaterThan(1);
    // Left wing down is a NEGATIVE turn about the nose axis (+Z), seen from behind.
    expect(tiltOf(ship).rotation.z).toBeLessThan(-0.2);
    expect(ship.object.rotation.x).toBe(0);
    expect(ship.object.rotation.z).toBe(0);
    expect(ship.position.y).toBe(0);

    pilot.current.turn = -1;
    run(ship, Array<number>(120).fill(STEP));
    expect(tiltOf(ship).rotation.z).toBeGreaterThan(0.2);
  });

  it('says how far the model leans and nods, for whoever draws the same lean (the flight deck)', () => {
    const { ship, pilot } = setup(true);
    ship.placeAt(0, 0, 0);
    expect(ship.bank).toBeCloseTo(0, 12);
    expect(ship.pitch).toBeCloseTo(0, 12);

    pilot.current.thrust = 1;
    pilot.current.turn = 1; // to the pilot's left
    run(ship, Array<number>(120).fill(STEP));
    // A left turn at speed: the left wing is down, which is a negative bank, and never past bankRad.
    expect(ship.bank).toBeLessThan(-0.2);
    expect(ship.bank).toBeGreaterThanOrEqual(-tuning.ship.bankRad);
    // Exactly what the model wears.
    expect(tiltOf(ship).rotation.z).toBe(ship.bank);
    expect(tiltOf(ship).rotation.x).toBe(ship.pitch);

    // Nose up under boost, down under the brake.
    pilot.current.turn = 0;
    pilot.current.boost = true;
    run(ship, Array<number>(120).fill(STEP));
    expect(ship.pitch).toBeCloseTo((-tuning.ship.pitchBoostDeg * Math.PI) / 180, 3);
    pilot.current.thrust = 0;
    pilot.current.boost = false;
    pilot.current.brake = 1;
    run(ship, Array<number>(120).fill(STEP));
    expect(ship.pitch).toBeCloseTo((tuning.ship.pitchBrakeDeg * Math.PI) / 180, 3);
    expect(ship.bank).toBeCloseTo(0, 3);
  });

  it('says what the last step flew: the pilot’s own input, with nothing else in the sky', () => {
    const { ship, pilot } = setup(true);
    expect(ship.flown).toEqual({ thrust: 0, turn: 0, brake: 0, boost: false });
    Object.assign(pilot.current, { thrust: 0.75, turn: -0.5, brake: 0, boost: true });
    // Asked for, but not flown until a step has flown it.
    expect(ship.flown.thrust).toBe(0);
    ship.fixedUpdate(STEP, 0);
    expect(ship.flown).toEqual({ thrust: 0.75, turn: -0.5, brake: 0, boost: true });
    expect(ship.flown).not.toBe(pilot.current);
    Object.assign(pilot.current, { thrust: 0, turn: 0, brake: 1, boost: false });
    ship.fixedUpdate(STEP, STEP);
    expect(ship.flown).toEqual({ thrust: 0, turn: 0, brake: 1, boost: false });
  });

  it('says what the last step flew among bodies: the assist’s share, the autopilot’s, none in orbit', () => {
    const pilot = { current: { thrust: 0, turn: 0, brake: 0, boost: false } as FlightInput };
    const surroundings = createSurroundings(
      {
        home: [0, 0],
        systems: [
          { id: 'home', position: [0, 0], radius: 66 },
          { id: 'far', position: [0, 1500], radius: 30 },
        ],
        bodies: [
          { id: 'home', system: 'home', parent: null, orbit: null, radius: 14, dockRadius: 26.6 },
          { id: 'far', system: 'far', parent: null, orbit: null, radius: 5, dockRadius: 11 },
        ],
      },
      tuning.edge.margin,
    );
    const ship = new ShipSystem({
      // On the home planet's ring, nose along it, hands off the controls.
      spawn: { x: 26.6, z: 0, heading: 0 },
      pilot,
      surroundings,
      assets: new AssetStore(),
      reducedMotion: true,
    });
    let steps = 0;
    const step = (): void => {
      steps += 1;
      ship.fixedUpdate(STEP, steps * STEP);
    };
    for (let i = 0; i < 30; i += 1) step();
    // Nobody touched the controls, and the ship is under way: the orbit assist flew it.
    expect(surroundings.assist.weight).toBeGreaterThan(0.5);
    expect(ship.flown.thrust).toBeGreaterThan(0);
    expect(pilot.current.thrust).toBe(0);

    // A journey: the autopilot's throttle, and a speed no pilot's own drive reaches.
    requestDock(surroundings.dock, surroundings.orbits.indexOf('far'), pilot.current, true, 0);
    let throttle = 0;
    let fastest = 0;
    for (let i = 0; i < 90; i += 1) {
      step();
      expect(surroundings.dock.phase).toBe('cruise');
      throttle = Math.max(throttle, ship.flown.thrust);
      fastest = Math.max(fastest, Math.hypot(ship.state.vx, ship.state.vz));
    }
    expect(throttle).toBeGreaterThan(0.3);
    expect(fastest).toBeGreaterThan(topSpeed(tuning.flight, true));
    expect(pilot.current.thrust).toBe(0);

    // Carried round a dock, the ship is not flown at all.
    const placed = { ...ship.state };
    dockAt(surroundings.field, placed, tuning.dock, surroundings.dock, 0, 0, 1);
    ship.restore(placed);
    step();
    expect(surroundings.dock.phase).toBe('docked');
    expect(ship.flown).toEqual({ thrust: 0, turn: 0, brake: 0, boost: false });
  });

  it('shows a flame while the engine burns, longer under boost, and none at rest', () => {
    const { ship, pilot } = setup(true);
    expect(flameOf(ship).visible).toBe(false);

    pilot.current.thrust = 1;
    run(ship, Array<number>(60).fill(STEP));
    const cruise = flameOf(ship).scale.z;
    expect(flameOf(ship).visible).toBe(true);
    expect(cruise).toBeCloseTo(tuning.ship.flame.lengthCruise, 2);

    pilot.current.boost = true;
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).scale.z).toBeCloseTo(tuning.ship.flame.lengthBoost, 2);

    pilot.current.thrust = 0;
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).visible).toBe(false);
  });

  it('burns as long as under boost in hyperspace, by the share it is told, while it thrusts', () => {
    const { ship, pilot } = setup(true);
    const { lengthCruise, lengthBoost, width } = tuning.ship.flame;
    pilot.current.thrust = 1;
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).scale.z).toBeCloseTo(lengthCruise, 2);

    // The surge steps (the punch); the flame follows at its own rate.
    ship.setSurge(1);
    run(ship, [STEP, STEP]);
    expect(flameOf(ship).scale.z).toBeGreaterThan(lengthCruise + 0.05);
    expect(flameOf(ship).scale.z).toBeLessThan(lengthBoost - 0.3);
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).scale.z).toBeCloseTo(lengthBoost, 2);
    // Longer, and no wider: the width is the pilot's own boost.
    expect(flameOf(ship).scale.x).toBeCloseTo(width, 3);

    // Half of it is half way, and more than all of it is all of it.
    ship.setSurge(0.5);
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).scale.z).toBeCloseTo((lengthCruise + lengthBoost) / 2, 2);
    ship.setSurge(3);
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).scale.z).toBeCloseTo(lengthBoost, 2);

    // Back when the tunnel closes; and an engine that does not burn has no flame to lengthen.
    ship.setSurge(0);
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).scale.z).toBeCloseTo(lengthCruise, 2);
    ship.setSurge(1);
    pilot.current.thrust = 0;
    run(ship, Array<number>(60).fill(STEP));
    expect(flameOf(ship).visible).toBe(false);
  });

  it('bobs gently, unless the visitor asked for less motion', () => {
    const calm = setup(true);
    run(calm.ship, Array<number>(40).fill(STEP));
    expect(tiltOf(calm.ship).position.y).toBe(0);

    const lively = setup(false);
    run(lively.ship, Array<number>(40).fill(STEP));
    expect(tiltOf(lively.ship).position.y).not.toBe(0);
    expect(Math.abs(tiltOf(lively.ship).position.y)).toBeLessThanOrEqual(tuning.ship.bobAmplitude);
  });

  it('gives back every GPU resource it made', () => {
    const { ship, assets } = setup();
    const disposed = vi.fn();
    ship.object.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.addEventListener('dispose', disposed);
      (mesh.material as ShaderMaterial).addEventListener('dispose', disposed);
    });
    ship.dispose();
    assets.dispose();
    // Two models (rocket, flame), each a geometry and a material.
    expect(disposed).toHaveBeenCalledTimes(4);
  });
});

/**
 * The property the whole loop design exists for (docs/PLAN.md §5.5): at a steady cruise the ship
 * must sit perfectly still in the camera's view, however uneven the frames are. Any wobble here
 * is judder on screen.
 */
describe('the ship in the chase camera, under uneven frames', () => {
  const wobbleWith = (frameTimes: readonly number[]): number => {
    const { ship, pilot } = setup(true);
    ship.placeAt(0, 0, 0.3);
    pilot.current.thrust = 1;
    const cam = new ChaseCam(ship, { reducedMotion: true });
    const pose = createPose();
    const camera = new PerspectiveCamera();
    const seen: Vector3[] = [];

    // Reach top speed first, then measure.
    run(ship, Array<number>(900).fill(STEP), (frame) =>
      cam.update(
        frame,
        { aspect: 16 / 9, freeWidth: 1, freeHeight: 1, freeTop: 0, freeLeft: 0 },
        pose,
      ),
    );
    expect(ship.speed).toBeCloseTo(topSpeed(tuning.flight), 3);

    run(ship, frameTimes, (frame) => {
      cam.update(
        frame,
        { aspect: 16 / 9, freeWidth: 1, freeHeight: 1, freeTop: 0, freeLeft: 0 },
        pose,
      );
      applyPose(camera, pose);
      camera.updateMatrixWorld();
      seen.push(ship.position.clone().applyMatrix4(camera.matrixWorldInverse));
    });

    const first = seen[0];
    if (!first) throw new Error('no frames');
    return Math.max(...seen.map((at) => at.distanceTo(first)));
  };

  it('holds still at 60, 30 and 144 Hz', () => {
    for (const hz of [60, 30, 144]) {
      expect(wobbleWith(Array<number>(hz * 2).fill(1 / hz))).toBeLessThan(1e-3);
    }
  });

  it('holds still when frame times are all over the place', () => {
    const uneven = Array.from(
      { length: 240 },
      (_, i) => [0.004, 0.021, 0.013, 0.034, 0.008][i % 5] ?? 0.016,
    );
    expect(wobbleWith(uneven)).toBeLessThan(1e-3);
  });
});
