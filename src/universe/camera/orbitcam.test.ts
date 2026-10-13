import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { CameraRig, createPose, type Pose } from './CameraRig';
import { angleDelta } from '../sim/math';
import { OrbitCam, type FaceTarget, type OrbitSubject } from './OrbitCam';

const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });
const params = tuning.orbitCam;
const DEG = Math.PI / 180;
const STILL = { reducedMotion: true };
const WHOLE = { aspect: 1.6, freeWidth: 1, freeHeight: 1, freeTop: 0, freeLeft: 0 };

function planet(x: number, z: number, ringRadius: number, light: Vector3 | null): OrbitSubject {
  return { position: new Vector3(x, 0, z), ringRadius, light };
}

/** The orbit view of `subject` as the rig shows it, with the panel covering part of the viewport. */
function shown(
  subject: OrbitSubject,
  width: number,
  height: number,
  inset: { top?: number; right?: number; bottom?: number; left?: number },
) {
  const camera = new PerspectiveCamera(50, width / height, 0.1, 5000);
  const orbit = new OrbitCam(STILL);
  orbit.look(subject);
  const rig = new CameraRig(camera, orbit, tuning.cameraRig);
  rig.resize({ width, height, pixelRatio: 1 });
  rig.setInset(inset, true);
  rig.frameUpdate(frame(1 / 60));
  camera.updateMatrixWorld();
  return (point: Vector3) => {
    const ndc = point.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
  };
}

/** Points all over a ball round `centre`. */
function ball(centre: Readonly<Vector3>, radius: number): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i < 48; i += 1) {
    for (let j = 1; j < 24; j += 1) {
      const point = new Vector3().setFromSphericalCoords(
        radius,
        (j / 24) * Math.PI,
        (i / 24) * Math.PI,
      );
      points.push(point.add(centre));
    }
  }
  return points;
}

describe('the orbit camera', () => {
  it('fits the docking ring, with some air, beside a 480 px panel on a desktop', () => {
    const subject = planet(200, -120, 14, new Vector3(0, 0, 0));
    const project = shown(subject, 1280, 800, { right: 496 });
    const free = { left: 0, right: 1280 - 496, top: 0, bottom: 800 };

    const centre = project(new Vector3(200, 0, -120));
    expect(centre.x).toBeCloseTo(392, 6);
    expect(centre.y).toBeCloseTo(400, 6);

    const spots = ball(subject.position, params.fitRingRadii * subject.ringRadius).map(project);
    const xs = spots.map((spot) => spot.x);
    const ys = spots.map((spot) => spot.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(free.left - 0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(free.right + 0.5);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(free.top);
    expect(Math.max(...ys)).toBeLessThanOrEqual(free.bottom);
    // And not from needlessly far away: the narrower way (across, here) is filled.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((free.right - free.left) * 0.97);
  });

  it('and above a bottom sheet that covers more than half of a phone', () => {
    const subject = planet(-40, 300, 9, new Vector3(0, 0, 0));
    const project = shown(subject, 390, 844, { bottom: 490 });
    const free = { left: 0, right: 390, top: 0, bottom: 844 - 490 };

    const centre = project(new Vector3(-40, 0, 300));
    expect(centre.x).toBeCloseTo(195, 6);
    expect(centre.y).toBeCloseTo(177, 6);

    const spots = ball(subject.position, params.fitRingRadii * subject.ringRadius).map(project);
    const xs = spots.map((spot) => spot.x);
    const ys = spots.map((spot) => spot.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(free.left);
    expect(Math.max(...xs)).toBeLessThanOrEqual(free.right);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(free.top - 0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(free.bottom + 0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((free.bottom - free.top) * 0.97);
  });

  it('and in the strip between the sheet and a solid top bar with a row of controls under it', () => {
    const subject = planet(-40, 300, 9, new Vector3(0, 0, 0));
    const project = shown(subject, 390, 844, { top: 160, bottom: 490 });
    const free = { left: 0, right: 390, top: 160, bottom: 844 - 490 };

    const centre = project(new Vector3(-40, 0, 300));
    expect(centre.x).toBeCloseTo(195, 6);
    expect(centre.y).toBeCloseTo((free.top + free.bottom) / 2, 6);

    const spots = ball(subject.position, params.fitRingRadii * subject.ringRadius).map(project);
    const ys = spots.map((spot) => spot.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(free.top - 0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(free.bottom + 0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((free.bottom - free.top) * 0.97);
  });

  it('and between what stands on both sides of it, in the middle of what they leave', () => {
    const subject = planet(200, -120, 14, new Vector3(0, 0, 0));
    // Not the same on both sides: the middle of what is left is not the middle of the window.
    const project = shown(subject, 1280, 800, { left: 400, right: 340 });
    const free = { left: 400, right: 1280 - 340, top: 0, bottom: 800 };

    const centre = project(new Vector3(200, 0, -120));
    expect(centre.x).toBeCloseTo((free.left + free.right) / 2, 6);
    expect(centre.y).toBeCloseTo(400, 6);

    const spots = ball(subject.position, params.fitRingRadii * subject.ringRadius).map(project);
    const xs = spots.map((spot) => spot.x);
    const ys = spots.map((spot) => spot.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(free.left - 0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(free.right + 0.5);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(free.top);
    expect(Math.max(...ys)).toBeLessThanOrEqual(free.bottom);
    // Fitted to the span between them, not to the width less one side.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((free.right - free.left) * 0.97);
  });

  it('stands on the lit side, a little round from the light, looking down from above', () => {
    const light = new Vector3(0, 0, 0);
    const subject = planet(100, 100, 12, light);
    const orbit = new OrbitCam(STILL);
    orbit.look(subject);
    const pose = createPose();
    orbit.update(frame(1 / 60), WHOLE, pose);

    expect(pose.focus.equals(subject.position)).toBe(true);
    expect(pose.fov).toBe(params.fovDegrees);
    const stand = new Vector3(0, 0, pose.distance).applyQuaternion(pose.quaternion);
    expect(Math.asin(stand.y / pose.distance) / DEG).toBeCloseTo(params.elevationDeg, 6);
    // The light is towards (-1, -1) from here: 225 degrees round from +Z.
    const round = Math.atan2(stand.x, stand.z) / DEG;
    expect((round + 360) % 360).toBeCloseTo(225 + params.sunwardOffsetDeg, 6);
    // More of the day side than of the night side faces the camera.
    const toLight = light.clone().sub(subject.position).normalize();
    expect(stand.clone().normalize().dot(toLight)).toBeGreaterThan(0.5);
    // And it never rolls.
    expect(new Vector3(1, 0, 0).applyQuaternion(pose.quaternion).y).toBeCloseTo(0, 12);
  });

  it('looks at a sun, which has no lit side, from a fixed side', () => {
    const orbit = new OrbitCam(STILL);
    orbit.look(planet(0, 0, 40, null));
    const pose = createPose();
    orbit.update(frame(1 / 60), WHOLE, pose);
    const stand = new Vector3(0, 0, pose.distance).applyQuaternion(pose.quaternion);
    expect(Math.atan2(stand.x, stand.z) / DEG).toBeCloseTo(params.sunwardOffsetDeg, 6);
  });

  it('wanders slowly round the body, unless the visitor asked for less motion', () => {
    const round = (reducedMotion: boolean): number => {
      const orbit = new OrbitCam({ reducedMotion });
      orbit.look(planet(0, 0, 12, null));
      const pose = createPose();
      for (let i = 0; i < 600; i += 1) orbit.update(frame(1 / 60), WHOLE, pose);
      const stand = new Vector3(0, 0, pose.distance).applyQuaternion(pose.quaternion);
      return Math.atan2(stand.x, stand.z) - params.sunwardOffsetDeg * DEG;
    };
    expect(round(false)).toBeCloseTo(params.driftRadPerSec * 10, 6);
    expect(round(true)).toBeCloseTo(0, 9);
  });

  it('follows a body that moves along its own orbit', () => {
    const subject = planet(50, 0, 12, new Vector3(0, 0, 0));
    const orbit = new OrbitCam(STILL);
    orbit.look(subject);
    const pose = createPose();
    orbit.update(frame(1 / 60), WHOLE, pose);
    (subject.position as Vector3).set(48, 0, 14);
    orbit.update(frame(1 / 60), WHOLE, pose);
    expect(pose.focus.x).toBe(48);
    expect(pose.focus.z).toBe(14);
  });

  it('stands further back the less of the view is free, and leaves a pose alone with no subject', () => {
    const subject = planet(0, 0, 12, null);
    const orbit = new OrbitCam(STILL);
    const pose = createPose();
    orbit.update(frame(1 / 60), WHOLE, pose);
    expect(pose.distance).toBe(1);

    orbit.look(subject);
    orbit.update(frame(1 / 60), WHOLE, pose);
    const whole = pose.distance;
    orbit.update(frame(1 / 60), { ...WHOLE, freeWidth: 0.6125 }, pose);
    const beside = pose.distance;
    orbit.update(frame(1 / 60), { ...WHOLE, freeWidth: 0.2 }, pose);
    expect(beside).toBeGreaterThan(whole);
    expect(pose.distance).toBeGreaterThan(beside * 2);
  });

  it('goes by how WIDE the free part is, wherever in the view it lies', () => {
    const orbit = new OrbitCam(STILL);
    orbit.look(planet(0, 0, 12, null));
    const pose = createPose();
    orbit.update(frame(1 / 60), { ...WHOLE, freeWidth: 0.5 }, pose);
    const beside = pose.distance;
    // The same half of the width, between something on the left and something on the right.
    orbit.update(frame(1 / 60), { ...WHOLE, freeLeft: 0.25, freeWidth: 0.75 }, pose);
    expect(pose.distance).toBe(beside);
    orbit.update(frame(1 / 60), { ...WHOLE, freeLeft: 0.5, freeWidth: 1 }, pose);
    expect(pose.distance).toBe(beside);
    // More taken on the left: further back, as for more taken on the right.
    orbit.update(frame(1 / 60), { ...WHOLE, freeLeft: 0.4, freeWidth: 0.75 }, pose);
    expect(pose.distance).toBeGreaterThan(beside);
  });
});

describe('the orbit camera, told to face a landmark', () => {
  const MOVING = { reducedMotion: false };
  const dt = 1 / 60;
  const roundOf = (pose: Pose): number => {
    const stand = new Vector3(0, 0, pose.distance).applyQuaternion(pose.quaternion);
    return Math.atan2(stand.x, stand.z);
  };
  /** How far round the body the camera stands now (a look that moves nothing on). */
  const standing = (orbit: OrbitCam): number => {
    const pose = createPose();
    orbit.update(frame(0), WHOLE, pose);
    return roundOf(pose);
  };
  /** A landmark that stays where it is, round the body. */
  const fixed = (deg: number, side: -1 | 1): FaceTarget => ({ azimuth: () => deg * DEG, side });
  const run = (orbit: OrbitCam, seconds: number, each?: (pose: Pose) => void): Pose => {
    const pose = createPose();
    for (let i = 0; i < Math.round(seconds / dt); i += 1) {
      orbit.update(frame(dt), WHOLE, pose);
      each?.(pose);
    }
    return pose;
  };
  const started = (): OrbitCam => {
    const orbit = new OrbitCam(MOVING);
    // No light: it starts sunwardOffsetDeg round, 35 degrees.
    orbit.look(planet(0, 0, 12, null));
    return orbit;
  };

  it('turns until the landmark rests a little round from the middle, toward its card', () => {
    const right = started();
    right.face(fixed(120, 1));
    run(right, 6);
    // A card on the right: the landmark is right of the middle, so the camera stands short of it.
    expect(standing(right) / DEG).toBeCloseTo(120 - params.faceBiasDeg, 3);

    const left = started();
    left.face(fixed(120, -1));
    run(left, 6);
    expect(standing(left) / DEG).toBeCloseTo(120 + params.faceBiasDeg, 3);
  });

  it('goes the short way round, and never faster than its limit', () => {
    // From 35 degrees to a stand at 300 - 27 = 273: 122 degrees backwards, not 238 forwards.
    const orbit = started();
    orbit.face(fixed(300, 1));
    let before = standing(orbit);
    let travelled = 0;
    let fastest = 0;
    run(orbit, 6, (pose) => {
      const step = angleDelta(before, roundOf(pose));
      travelled += step;
      fastest = Math.max(fastest, Math.abs(step) / dt);
      before = roundOf(pose);
    });
    expect(travelled / DEG).toBeCloseTo(-122, 2);
    expect(fastest).toBeLessThanOrEqual(params.faceMaxRadPerSec + 1e-9);

    // Half a turn is held to the limit on the way, and is all but there in 1.6 s.
    const far = started();
    far.face(fixed(35 + 180 + params.faceBiasDeg, 1));
    let top = 0;
    let at = standing(far);
    run(far, 1.6, (pose) => {
      top = Math.max(top, Math.abs(angleDelta(at, roundOf(pose))) / dt);
      at = roundOf(pose);
    });
    expect(top).toBeCloseTo(params.faceMaxRadPerSec, 6);
    expect(Math.abs(angleDelta(standing(far), (35 + 180) * DEG)) / DEG).toBeLessThan(12);
  });

  it('eases in and out: no jump when it starts to turn, none when it arrives', () => {
    const orbit = started();
    orbit.face(fixed(150, 1));
    const steps: number[] = [];
    let before = standing(orbit);
    run(orbit, 4, (pose) => {
      steps.push(angleDelta(before, roundOf(pose)));
      before = roundOf(pose);
    });
    // The first frame moves a hair; the fastest frame comes later; the last ones barely move.
    expect(Math.abs(steps[0] ?? 1)).toBeLessThan(0.005);
    expect(Math.max(...steps.map(Math.abs))).toBeGreaterThan(0.015);
    expect(Math.abs(steps.at(-1) ?? 1)).toBeLessThan(1e-4);
    // And nothing jerks: from one frame to the next the speed never changes by more than the
    // spring's own pull at the start, with the whole turn still ahead (omega squared times it).
    const turn = (150 - params.faceBiasDeg - params.sunwardOffsetDeg) * DEG;
    const hardest = params.faceOmega ** 2 * turn * dt * dt;
    for (let i = 1; i < steps.length; i += 1) {
      expect(Math.abs((steps[i] ?? 0) - (steps[i - 1] ?? 0))).toBeLessThanOrEqual(hardest);
    }
  });

  it('holds a landmark that goes round with a turning world', () => {
    const spin = tuning.world.spinRadPerSec;
    /** How far the camera trails where it should stand, after ten seconds of a turning world. */
    const behind = (step: number): number => {
      let at = 80 * DEG;
      const orbit = started();
      orbit.face({ azimuth: () => at, side: 1 });
      const pose = createPose();
      for (let t = 0; t < 10 - 1e-9; t += step) {
        at += spin * step;
        orbit.update(frame(step), WHOLE, pose);
      }
      return angleDelta(roundOf(pose), at - params.faceBiasDeg * DEG);
    };
    // The world has turned 23 degrees and the camera with it: it trails by the spring's own lag
    // (2u / omega), about a degree, and no more.
    expect(behind(dt)).toBeGreaterThan(0);
    expect(behind(dt)).toBeCloseTo((2 * spin) / params.faceOmega, 3);
    // The same at half the frame rate: the lag is the spring's, not the frame's.
    expect(behind(dt * 2)).toBeCloseTo(behind(dt), 3);
  });

  it('closes in on the body while it faces something, and stands back again after', () => {
    const orbit = started();
    const whole = run(orbit, dt).distance;
    expect(orbit.focus).toBe(0);
    orbit.face(fixed(60, 1));
    const closing = run(orbit, 0.3);
    expect(orbit.focus).toBeGreaterThan(0);
    expect(orbit.focus).toBeLessThan(1);
    expect(closing.distance).toBeLessThan(whole);
    const close = run(orbit, 6);
    expect(orbit.focus).toBeCloseTo(1, 6);
    expect(close.distance / whole).toBeCloseTo(params.focusFitRingRadii / params.fitRingRadii, 6);

    orbit.face(null);
    const back = run(orbit, 6);
    expect(orbit.focus).toBeCloseTo(0, 6);
    expect(back.distance).toBeCloseTo(whole, 6);
  });

  it('wanders on from where it is once it faces nothing, the turn running out into the drift', () => {
    const orbit = started();
    orbit.face(fixed(200, 1));
    run(orbit, 0.5);
    // Let go in the middle of the turn: it is going fast, and must not stop dead.
    const mid = standing(orbit);
    orbit.face(null);
    const next = roundOf(run(orbit, dt));
    expect(Math.abs(angleDelta(mid, next)) / dt).toBeGreaterThan(1);
    run(orbit, 6);
    const settled = standing(orbit);
    run(orbit, 10);
    // From then on, the drift and nothing else.
    expect(angleDelta(settled, standing(orbit))).toBeCloseTo(params.driftRadPerSec * 10, 6);
  });

  it('is simply there under reduced motion, and when told to cut', () => {
    const still = new OrbitCam(STILL);
    still.look(planet(0, 0, 12, null));
    let at = 250 * DEG;
    still.face({ azimuth: () => at, side: -1 });
    expect(standing(still) / DEG).toBeCloseTo(250 + params.faceBiasDeg - 360, 9);
    expect(still.focus).toBe(1);
    // It goes on holding it, wherever it goes, with nothing to ease.
    at = 20 * DEG;
    expect(standing(still) / DEG).toBeCloseTo(20 + params.faceBiasDeg, 9);
    still.face(null);
    expect(still.focus).toBe(0);
    expect(standing(still) / DEG).toBeCloseTo(20 + params.faceBiasDeg, 9);

    const moving = started();
    moving.face(fixed(250, -1), true);
    expect(moving.focus).toBe(1);
    expect(standing(moving) / DEG).toBeCloseTo(250 + params.faceBiasDeg - 360, 9);
    moving.face(null, true);
    expect(moving.focus).toBe(0);
  });

  it('arrives facing what it was told to face, and comes back to it after the star map', () => {
    // Told before the ship docks: the view of the new body starts where the page wants it.
    const orbit = new OrbitCam(MOVING);
    let at = 140 * DEG;
    orbit.face({ azimuth: () => at, side: 1 });
    orbit.look(planet(0, 0, 12, new Vector3(100, 0, 0)));
    expect(standing(orbit) / DEG).toBeCloseTo(140 - params.faceBiasDeg, 9);
    expect(orbit.focus).toBe(1);

    // The rig stops asking while the map is up, and the world turns on. Asked again, the camera
    // faces where the landmark is NOW, at once: no swing, and no kick from a stale speed.
    run(orbit, 1);
    at += 1.2;
    orbit.enter();
    expect(angleDelta(standing(orbit), at - params.faceBiasDeg * DEG)).toBeCloseTo(0, 9);
    const before = standing(orbit);
    expect(Math.abs(angleDelta(before, roundOf(run(orbit, dt))))).toBeLessThan(1e-3);
  });

  it('wanders exactly as it always did when nothing was ever faced', () => {
    const orbit = started();
    const from = standing(orbit);
    run(orbit, 10);
    expect(angleDelta(from, standing(orbit))).toBeCloseTo(params.driftRadPerSec * 10, 12);
    expect(orbit.focus).toBe(0);
  });
});
