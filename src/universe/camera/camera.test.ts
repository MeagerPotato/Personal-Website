import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { applyPose, createPose } from './CameraRig';
import { ChaseCam } from './ChaseCam';

const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });
const params = tuning.chaseCam;
const DEG = Math.PI / 180;
const WIDE = { aspect: 16 / 9, freeWidth: 1, freeHeight: 1 };

function ship(x = 0, z = 0, heading = 0, speed = 0) {
  return { position: new Vector3(x, 0, z), heading, speed };
}

/** Where the camera stands and which way it faces, after the rig has applied a pose. */
function view(cam: ChaseCam, aspect = 16 / 9, dt = 1 / 60) {
  const pose = createPose();
  cam.update(frame(dt), { aspect, freeWidth: 1, freeHeight: 1 }, pose);
  const camera = new PerspectiveCamera();
  applyPose(camera, pose);
  camera.updateMatrixWorld();
  return {
    pose,
    camera,
    forward: new Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
    right: new Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
  };
}

describe('the chase camera', () => {
  it('starts straight behind and above the ship, looking ahead of it, with no swoop', () => {
    const target = ship(30, -40, 0);
    const { camera, pose, forward } = view(new ChaseCam(target, { reducedMotion: false }));

    expect(camera.position.x).toBeCloseTo(30, 6);
    expect(camera.position.y).toBeCloseTo(params.up, 6);
    expect(camera.position.z).toBeCloseTo(-40 - params.back, 6);
    expect(pose.focus.z).toBeCloseTo(-40 + params.lookAheadBase, 6);
    expect(forward.z).toBeGreaterThan(0.9); // along the ship's nose (+Z at heading 0)
    expect(forward.y).toBeLessThan(0); // and down at it
    expect(pose.fov).toBe(tuning.camera.fovDegrees);
  });

  it('never rolls, whichever way the ship points', () => {
    for (const heading of [0, 0.7, 2.4, -1.9, 9.5]) {
      const { right, forward } = view(new ChaseCam(ship(5, 5, heading), { reducedMotion: false }));
      expect(right.y).toBeCloseTo(0, 9);
      expect(forward.x).toBeCloseTo(Math.sin(heading) * Math.hypot(forward.x, forward.z), 6);
    }
  });

  it('trails a cruising ship by the same distance at any frame rate, easing into its limit', () => {
    const trailAt = (hz: number, speed: number): number => {
      const target = ship(0, 0, 0, speed);
      const cam = new ChaseCam(target, { reducedMotion: false });
      const pose = createPose();
      for (let i = 0; i < hz * 6; i += 1) {
        target.position.z += speed / hz;
        cam.update(frame(1 / hz), WIDE, pose);
      }
      const ahead = Math.min(
        params.lookAheadMax,
        params.lookAheadBase + params.lookAheadPerSpeed * speed,
      );
      return target.position.z - (pose.focus.z - ahead);
    };
    const spring = (2 * 40) / params.positionOmega;
    const expected = params.maxTrail * Math.tanh(spring / params.maxTrail);
    expect(trailAt(60, 40)).toBeCloseTo(expected, 6);
    expect(trailAt(30, 40)).toBeCloseTo(expected, 6);
    expect(trailAt(144, 40)).toBeCloseTo(expected, 6);

    // Slow: the spring's own trail, nearly untouched. Absurdly fast: never past the limit.
    expect(trailAt(60, 5)).toBeCloseTo((2 * 5) / params.positionOmega, 1);
    expect(trailAt(60, 500)).toBeLessThanOrEqual(params.maxTrail);
    expect(trailAt(60, 500)).toBeGreaterThan(params.maxTrail * 0.99);
  });

  it('moves in as the lens widens with speed, so the ship keeps some of its size', () => {
    const slow = view(new ChaseCam(ship(0, 0, 0, 0), { reducedMotion: false }));
    const fast = view(new ChaseCam(ship(0, 0, 0, 90), { reducedMotion: false }));
    expect(fast.camera.position.y).toBeLessThan(slow.camera.position.y);
    expect(fast.camera.position.y).toBeGreaterThan(slow.camera.position.y * 0.7);
    // Not for a lens that widened because the screen is tall: that one backs OFF.
    const tall = view(new ChaseCam(ship(0, 0, 0, 0), { reducedMotion: false }), 0.5);
    expect(tall.camera.position.y).toBeGreaterThan(slow.camera.position.y);
  });

  it('swings round behind a turning ship instead of snapping', () => {
    const target = ship();
    const cam = new ChaseCam(target, { reducedMotion: false });
    const pose = createPose();
    cam.update(frame(1 / 60), WIDE, pose);

    target.heading = Math.PI / 2; // the ship now points along +X
    const swing = (): number => {
      cam.update(frame(1 / 60), WIDE, pose);
      const forward = new Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
      return Math.atan2(forward.x, forward.z);
    };
    const first = swing();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.3);
    let last = first;
    for (let i = 0; i < 120; i += 1) last = swing();
    expect(last).toBeCloseTo(Math.PI / 2, 3);
  });

  it('never swings the view faster than its limit, nor under reduced motion than a pilot turns', () => {
    // The autopilot's snap turn: half a turn at 7 rad/s (cruise.flight.yawRateSlow), then straight.
    // Followed step for step, the view spun at up to 380 degrees a second (main: 146).
    const swing = (reducedMotion: boolean, hz: number) => {
      const target = ship();
      const cam = new ChaseCam(target, { reducedMotion });
      const pose = createPose();
      const yaw = (): number => {
        const forward = new Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
        return Math.atan2(forward.x, forward.z);
      };
      cam.update(frame(1 / hz), WIDE, pose);
      let last = yaw();
      let fastest = 0;
      let furthest = 0;
      for (let i = 0; i < hz * 3; i += 1) {
        target.heading = Math.min(Math.PI - 1e-6, target.heading + 7 / hz);
        cam.update(frame(1 / hz), WIDE, pose);
        const now = yaw();
        fastest = Math.max(fastest, Math.abs(now - last) * hz);
        furthest = Math.max(furthest, now);
        last = now;
      }
      return { fastest, furthest, end: last };
    };
    for (const hz of [60, 30, 144]) {
      const full = swing(false, hz);
      expect(full.fastest).toBeLessThanOrEqual(params.maxYawRate + 1e-6);
      expect(full.fastest).toBeGreaterThan(params.maxYawRate * 0.99);
      const calm = swing(true, hz);
      expect(calm.fastest).toBeLessThanOrEqual(tuning.flight.yawRateSlow + 1e-6);
      // Behind the ship in the end, without swinging past it.
      for (const { end, furthest } of [full, calm]) {
        expect(end).toBeCloseTo(Math.PI, 3);
        expect(furthest).toBeLessThan(Math.PI + 0.01);
      }
    }
    // A pilot's own full turn never meets the limit: it is followed exactly as it always was.
    expect(params.maxYawRate).toBeGreaterThan(tuning.flight.yawRateSlow);
  });

  it('widens the lens with speed, unless the visitor asked for less motion', () => {
    const fast = ship(0, 0, 0, 90);
    expect(view(new ChaseCam(fast, { reducedMotion: false })).pose.fov).toBeCloseTo(
      tuning.camera.fovDegrees + params.fovBoostDegrees,
      6,
    );
    expect(view(new ChaseCam(fast, { reducedMotion: true })).pose.fov).toBe(
      tuning.camera.fovDegrees,
    );
  });

  it('eases the lens wider as the autopilot takes off, instead of swinging it in a few frames', () => {
    // The autopilot goes from rest to 700 u/s in about a second; here, in a tenth of one.
    const target = ship();
    const cam = new ChaseCam(target, { reducedMotion: false });
    const pose = createPose();
    cam.update(frame(1 / 60), WIDE, pose);
    let last = pose.fov;
    let most = 0;
    for (let i = 1; i <= 180; i += 1) {
      target.speed = Math.min(700, 700 * (i / 6));
      target.position.z += target.speed / 60;
      cam.update(frame(1 / 60), WIDE, pose);
      most = Math.max(most, Math.abs(pose.fov - last));
      last = pose.fov;
    }
    // 13 degrees, never more than 0.4 of them in a frame (a lens that kept up with the speed
    // swung them in five frames), and all of them in the end.
    expect(most).toBeLessThan(0.5);
    expect(pose.fov).toBeCloseTo(tuning.camera.fovDegrees + params.fovBoostDegrees, 3);
    // And the look ahead grows as smoothly, to its limit.
    expect(pose.focus.z - target.position.z).toBeGreaterThan(
      params.lookAheadMax - params.maxTrail - 0.5,
    );

    // A pilot's own boost ends at the same lens, however it got there.
    const pilot = ship(0, 0, 0, 0);
    const own = new ChaseCam(pilot, { reducedMotion: false });
    own.update(frame(1 / 60), WIDE, pose);
    for (let i = 1; i <= 240; i += 1) {
      pilot.speed = Math.min(81, i);
      own.update(frame(1 / 60), WIDE, pose);
    }
    expect(pose.fov).toBeCloseTo(tuning.camera.fovDegrees + params.fovBoostDegrees, 3);

    // Under reduced motion the lens never changes at all.
    const calm = ship();
    const still = new ChaseCam(calm, { reducedMotion: true });
    for (let i = 0; i <= 60; i += 1) {
      calm.speed = 700 * Math.min(1, i / 6);
      still.update(frame(1 / 60), WIDE, pose);
      expect(pose.fov).toBe(tuning.camera.fovDegrees);
    }
  });

  it('looks no further ahead than its limit, so the view does not lie flat on the autopilot', () => {
    const { thrustAccel, forwardDrag, boostFactor } = tuning.flight;
    const top = (thrustAccel / forwardDrag) * boostFactor;
    const cruise = tuning.cruise.far.cruiseSpeed;
    // How far below the horizontal the camera looks, degrees.
    const pitch = (speed: number): number => {
      const { forward } = view(new ChaseCam(ship(0, 0, 0, speed), { reducedMotion: false }));
      return (-Math.asin(forward.y) * 180) / Math.PI;
    };
    const warp = view(new ChaseCam(ship(0, 0, 0, cruise), { reducedMotion: false }));
    expect(warp.pose.focus.z).toBeCloseTo(params.lookAheadMax, 6);
    // A pilot's own top speed is short of the limit: the same view as before the autopilot's drive.
    const piloted = view(new ChaseCam(ship(0, 0, 0, top), { reducedMotion: false }));
    expect(piloted.pose.focus.z).toBeCloseTo(
      params.lookAheadBase + params.lookAheadPerSpeed * top,
      6,
    );
    // At 700 u/s the view still looks down at the plane (3.2 degrees; uncapped, 140 u ahead, it
    // was 1.5), and it is the same view whatever the speed past the limit.
    expect(pitch(cruise)).toBeGreaterThan(3.1);
    expect(pitch(cruise)).toBeCloseTo(pitch(cruise * 3), 9);
    expect(pitch(top)).toBeGreaterThan(pitch(cruise));
  });

  it('keeps the horizontal view wide enough on a tall phone, and backs off', () => {
    const wide = view(new ChaseCam(ship(), { reducedMotion: false }), 16 / 9);
    const tall = view(new ChaseCam(ship(), { reducedMotion: false }), 390 / 844);

    const horizontal = 2 * Math.atan(Math.tan((tall.pose.fov / 2) * DEG) * (390 / 844));
    expect(horizontal / DEG).toBeCloseTo(params.minHorizontalFovDegrees, 6);
    expect(tall.camera.position.y).toBeCloseTo(
      wide.camera.position.y * params.portraitDistanceScale,
      6,
    );

    // A sliver of a window must not turn the lens inside out.
    const sliver = view(new ChaseCam(ship(), { reducedMotion: false }), 0.1);
    expect(sliver.pose.fov).toBe(params.maxFovDegrees);
  });

  it('cuts to the ship when told to, instead of flying there', () => {
    const target = ship();
    const cam = new ChaseCam(target, { reducedMotion: false });
    const pose = createPose();
    cam.update(frame(1 / 60), WIDE, pose);

    target.position.set(900, 0, -300);
    cam.snap();
    cam.update(frame(1 / 60), WIDE, pose);
    expect(pose.focus.x).toBeCloseTo(900, 6);
    expect(pose.focus.z).toBeCloseTo(-300 + params.lookAheadBase, 6);

    // And when the rig comes back to it after a while with another camera (docked, say).
    target.position.set(-40, 0, 77);
    cam.enter();
    cam.update(frame(1 / 60), WIDE, pose);
    expect(pose.focus.x).toBeCloseTo(-40, 6);
    expect(pose.focus.z).toBeCloseTo(77 + params.lookAheadBase, 6);
  });
});

describe('applyPose', () => {
  it('stands the camera `distance` away from the focus, looking straight at it', () => {
    const { camera, pose, forward } = view(
      new ChaseCam(ship(3, 4, 1.2, 20), { reducedMotion: false }),
    );
    const toFocus = pose.focus.clone().sub(camera.position);
    expect(toFocus.length()).toBeCloseTo(pose.distance, 6);
    expect(toFocus.normalize().dot(forward)).toBeCloseTo(1, 9);
  });
});
