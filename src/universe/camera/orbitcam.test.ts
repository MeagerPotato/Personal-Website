import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { CameraRig, createPose } from './CameraRig';
import { OrbitCam, type OrbitSubject } from './OrbitCam';

const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });
const params = tuning.orbitCam;
const DEG = Math.PI / 180;
const STILL = { reducedMotion: true };
const WHOLE = { aspect: 1.6, freeWidth: 1, freeHeight: 1 };

function planet(x: number, z: number, ringRadius: number, light: Vector3 | null): OrbitSubject {
  return { position: new Vector3(x, 0, z), ringRadius, light };
}

/** The orbit view of `subject` as the rig shows it, with the panel covering part of the viewport. */
function shown(
  subject: OrbitSubject,
  width: number,
  height: number,
  inset: { right?: number; bottom?: number },
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
    orbit.update(frame(1 / 60), { aspect: 1.6, freeWidth: 0.6125, freeHeight: 1 }, pose);
    const beside = pose.distance;
    orbit.update(frame(1 / 60), { aspect: 1.6, freeWidth: 0.2, freeHeight: 1 }, pose);
    expect(beside).toBeGreaterThan(whole);
    expect(pose.distance).toBeGreaterThan(beside * 2);
  });
});
