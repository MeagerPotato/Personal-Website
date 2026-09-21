// @vitest-environment happy-dom
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyPose, createPose } from '../camera/CameraRig';
import type { Frame } from '../core/Engine';
import { TurntableCam } from './TurntableCam';

const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });

function view(cam: TurntableCam, aspect = 16 / 9, dt = 0) {
  const pose = createPose();
  cam.update(frame(dt), { aspect, freeWidth: 1, freeHeight: 1 }, pose);
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
});
