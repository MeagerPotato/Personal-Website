// @vitest-environment happy-dom
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyPose, createPose } from '../camera/CameraRig';
import type { Frame } from '../core/Engine';
import { directionOf, SKY_POSES } from '../sim/skyDirections';
import { TurntableCam } from './TurntableCam';

const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });

function view(cam: TurntableCam, aspect = 16 / 9, dt = 0) {
  const pose = createPose();
  cam.update(frame(dt), { aspect, freeWidth: 1, freeHeight: 1, freeTop: 0, freeLeft: 0 }, pose);
  const camera = new PerspectiveCamera();
  applyPose(camera, pose);
  return { pose, camera, forward: new Vector3(0, 0, -1).applyQuaternion(camera.quaternion) };
}

describe('TurntableCam', () => {
  it('looks at the middle of the table, from above when pitched up', () => {
    const cam = new TurntableCam(document.createElement('div'));
    cam.frame(8);
    const { camera, forward, pose } = view(cam);
    expect(camera.position.y).toBeGreaterThan(0);
    // Straight at the origin: where it stands is exactly "back along where it looks".
    const back = camera.position.clone().normalize().negate();
    expect(back.distanceTo(forward)).toBeLessThan(1e-6);
    expect(camera.position.length()).toBeCloseTo(pose.distance, 6);
  });

  it('steps back far enough to see all of the subject, further on an upright screen', () => {
    const cam = new TurntableCam(document.createElement('div'));
    cam.frame(8);
    const wide = view(cam, 16 / 9).pose.distance;
    const halfFov = (view(cam, 16 / 9).pose.fov * Math.PI) / 360;
    // The ball's outline fits inside the vertical field of view, with room to spare.
    expect(Math.asin(8 / wide)).toBeLessThan(halfFov * 0.7);

    const upright = view(cam, 9 / 16).pose.distance;
    expect(upright).toBeGreaterThan(wide * 1.5);
    // ...and coming back to a wide window undoes it.
    expect(view(cam, 16 / 9).pose.distance).toBeCloseTo(wide, 6);
  });

  it('scales with what is on the table', () => {
    const cam = new TurntableCam(document.createElement('div'));
    cam.frame(2);
    const small = view(cam).pose.distance;
    cam.frame(20);
    expect(view(cam).pose.distance).toBeCloseTo(small * 10, 6);
  });

  it('cannot be dragged over the pole or zoomed through the subject', () => {
    const cam = new TurntableCam(document.createElement('div'));
    cam.frame(8);
    cam.drag(0, 100_000);
    expect(view(cam).camera.position.y).toBeGreaterThan(0);
    expect(Math.abs(cam.pitch)).toBeLessThan(Math.PI / 2);
    cam.drag(0, -200_000);
    expect(view(cam).camera.position.y).toBeLessThan(0);
    expect(Math.abs(cam.pitch)).toBeLessThan(Math.PI / 2);

    cam.zoom(-1_000_000);
    expect(view(cam).pose.distance).toBeGreaterThan(8);
    cam.zoom(1_000_000);
    expect(Number.isFinite(view(cam).pose.distance)).toBe(true);
    expect(view(cam).pose.distance).toBeLessThan(8 * 20);
  });

  it('turns by itself at its turn rate, and holds still while dragged', () => {
    const cam = new TurntableCam(document.createElement('div'));
    cam.turnRate = 0.5;
    const before = cam.yaw;
    view(cam, 16 / 9, 2);
    expect(cam.yaw).toBeCloseTo(before + 1, 6);
  });

  it('looks OUT, where a gaze says, and holds still there', () => {
    const cam = new TurntableCam(document.createElement('div'));
    for (const pose of Object.values(SKY_POSES)) {
      cam.gaze = { yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg, fovDeg: pose.fovDeg };
      // A second goes by: a turntable would have turned, a gaze does not.
      const { forward, pose: out, camera } = view(cam, 1.6, 1);
      const want = directionOf(pose.yawDeg, pose.pitchDeg);
      expect(forward.distanceTo(new Vector3(...want))).toBeLessThan(1e-6);
      expect(out.fov).toBe(pose.fovDeg);
      // No roll: the camera's right is level.
      expect(new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).y).toBeCloseTo(0, 9);
    }
  });

  it('pulls the sky round with the hand, and zooms the lens with the wheel', () => {
    const cam = new TurntableCam(document.createElement('div'));
    cam.gaze = { yawDeg: 0, pitchDeg: 0, fovDeg: 50 };
    cam.drag(100, 50);
    // Dragged right and down: the camera has turned left (azimuth grows) and up.
    expect(cam.gaze.yawDeg).toBeGreaterThan(0);
    expect(cam.gaze.pitchDeg).toBeGreaterThan(0);
    cam.drag(0, 1e6);
    expect(cam.gaze.pitchDeg).toBeLessThan(90);
    cam.zoom(-400);
    expect(cam.gaze.fovDeg).toBeLessThan(50);
    cam.zoom(1e6);
    expect(cam.gaze.fovDeg).toBeLessThanOrEqual(100);
  });
});
