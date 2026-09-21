import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import {
  CameraRig,
  createPose,
  easeBlend,
  mixPose,
  type CameraMode,
  type Pose,
  type RigParams,
  type ViewShape,
} from './CameraRig';

const frame = (dt: number): Frame => ({ elapsed: 0, dt, alpha: 1, simTime: 0 });
const PARAMS: RigParams = { insetOmega: 7 };
const UP = new Vector3(0, 1, 0);

/** A camera mode that looks at a point which may move, from a fixed side. */
class Looking implements CameraMode {
  readonly focus = new Vector3();
  readonly quaternion = new Quaternion();
  seen: ViewShape | null = null;
  updates = 0;
  entered = 0;

  constructor(
    x: number,
    yaw: number,
    private readonly distance: number,
    private readonly fov: number,
    /** Units per second along +Z: a subject that keeps moving. */
    private readonly speed = 0,
  ) {
    this.focus.set(x, 0, 0);
    this.quaternion.setFromAxisAngle(UP, yaw);
  }

  enter(): void {
    this.entered += 1;
  }

  update(step: Frame, view: ViewShape, out: Pose): void {
    this.focus.z += this.speed * step.dt;
    this.updates += 1;
    this.seen = { ...view };
    out.focus.copy(this.focus);
    out.quaternion.copy(this.quaternion);
    out.distance = this.distance;
    out.fov = this.fov;
  }
}

function rigWith(initial: CameraMode, width = 1280, height = 800) {
  const camera = new PerspectiveCamera(50, width / height, 0.1, 5000);
  const rig = new CameraRig(camera, initial, PARAMS);
  rig.resize({ width, height, pixelRatio: 1 });
  return { camera, rig };
}

/** Where the camera looks: the point `distance` ahead of it is its pose's focus. */
function focusOf(camera: PerspectiveCamera, distance: number): Vector3 {
  return new Vector3(0, 0, -distance).applyQuaternion(camera.quaternion).add(camera.position);
}

/** Where a world point lands on screen, in CSS pixels from the top left corner. */
function onScreen(camera: PerspectiveCamera, point: Vector3, width: number, height: number) {
  camera.updateMatrixWorld();
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

describe('easeBlend', () => {
  it('runs from 0 to 1, flat at both ends, and the same in both directions', () => {
    expect(easeBlend(0)).toBe(0);
    expect(easeBlend(1)).toBe(1);
    expect(easeBlend(-3)).toBe(0);
    expect(easeBlend(7)).toBe(1);
    expect(easeBlend(0.5)).toBeCloseTo(0.5, 12);
    expect(easeBlend(0.001)).toBeLessThan(1e-7);
    for (const t of [0.1, 0.25, 0.4, 0.8]) {
      expect(easeBlend(1 - t)).toBeCloseTo(1 - easeBlend(t), 12);
    }
  });
});

describe('mixPose', () => {
  it('can write over either of the poses it mixes', () => {
    const make = (x: number, yaw: number, distance: number, fov: number): Pose => {
      const pose = createPose();
      pose.focus.set(x, 0, 0);
      pose.quaternion.setFromAxisAngle(UP, yaw);
      pose.distance = distance;
      pose.fov = fov;
      return pose;
    };
    const apart = mixPose(make(0, 0, 10, 50), make(8, 1, 30, 40), 0.25, createPose());
    expect(apart.focus.x).toBeCloseTo(2, 12);
    expect(apart.quaternion.angleTo(new Quaternion())).toBeCloseTo(0.25, 9);

    const to = make(8, 1, 30, 40);
    mixPose(make(0, 0, 10, 50), to, 0.25, to);
    const from = make(0, 0, 10, 50);
    mixPose(from, make(8, 1, 30, 40), 0.25, from);
    for (const mixed of [to, from]) {
      expect(mixed.focus.x).toBeCloseTo(2, 12);
      // (acos near 1 is only good to about 1e-8.)
      expect(mixed.quaternion.angleTo(apart.quaternion)).toBeCloseTo(0, 6);
      expect(mixed.distance).toBeCloseTo(15, 12);
      expect(mixed.fov).toBeCloseTo(47.5, 12);
    }
  });
});

describe('the camera rig, changing modes', () => {
  it('blends from the old view to the new one without a jump at either end', () => {
    const a = new Looking(0, 0, 10, 50);
    const b = new Looking(100, 1, 30, 40);
    const { camera, rig } = rigWith(a);
    rig.frameUpdate(frame(1 / 60));
    expect(focusOf(camera, 10).x).toBeCloseTo(0, 9);

    rig.use(b, 1);
    expect(rig.active).toBe(b);
    rig.frameUpdate(frame(1 / 60));
    // The first frame of a blend is still, to the eye, the old view.
    expect(camera.fov).toBeCloseTo(50, 2);
    expect(camera.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(0.01);

    for (let i = 0; i < 29; i += 1) rig.frameUpdate(frame(1 / 60));
    expect(camera.fov).toBeCloseTo(45, 6); // halfway in time is halfway there
    for (let i = 0; i < 40; i += 1) rig.frameUpdate(frame(1 / 60));
    expect(camera.fov).toBe(40);
    expect(focusOf(camera, 30).x).toBeCloseTo(100, 9);

    // And the old mode is let go of: it is not asked again.
    const asked = a.updates;
    rig.frameUpdate(frame(1 / 60));
    expect(a.updates).toBe(asked);
  });

  it('blends LIVE: both views keep following their subjects while it runs', () => {
    const chase = new Looking(0, 0, 10, 50, 60); // its subject flies along +Z at 60 u/s
    const orbit = new Looking(0, 0, 10, 50);
    const { camera, rig } = rigWith(chase);
    rig.frameUpdate(frame(1 / 60));

    rig.use(orbit, 1);
    for (let i = 0; i < 30; i += 1) rig.frameUpdate(frame(1 / 60));
    // Halfway: halfway between where the ship is NOW (31 frames on) and the planet.
    expect(focusOf(camera, 10).z).toBeCloseTo((31 / 2) * (60 / 60), 6);
  });

  it('turns back mid-blend from exactly where the view is', () => {
    const a = new Looking(0, 0, 10, 50);
    const b = new Looking(100, 1.4, 30, 40);
    const { camera, rig } = rigWith(a);
    rig.frameUpdate(frame(1 / 60));
    rig.use(b, 1);
    for (let i = 0; i < 18; i += 1) rig.frameUpdate(frame(1 / 60));
    const at = camera.position.clone();
    const fov = camera.fov;

    rig.use(a, 1);
    rig.frameUpdate(frame(1e-6));
    expect(camera.position.distanceTo(at)).toBeLessThan(1e-3);
    expect(camera.fov).toBeCloseTo(fov, 4);

    // It takes as long to get back as it took to get here, not the whole blend again.
    for (let i = 0; i < 18; i += 1) rig.frameUpdate(frame(1 / 60));
    expect(camera.fov).toBeCloseTo(50, 6);
    expect(camera.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6);
  });

  it('lets a third view cut into a blend, starting from the picture as it is', () => {
    const a = new Looking(0, 0, 10, 50);
    const b = new Looking(100, 1.4, 30, 40);
    const c = new Looking(-50, -0.6, 80, 30);
    const { camera, rig } = rigWith(a);
    rig.frameUpdate(frame(1 / 60));
    rig.use(b, 1);
    for (let i = 0; i < 30; i += 1) rig.frameUpdate(frame(1 / 60));
    const at = camera.position.clone();

    rig.use(c, 1);
    rig.frameUpdate(frame(1e-6));
    expect(camera.position.distanceTo(at)).toBeLessThan(1e-3);
    for (let i = 0; i < 61; i += 1) rig.frameUpdate(frame(1 / 60));
    expect(camera.fov).toBe(30);
    expect(focusOf(camera, 80).x).toBeCloseTo(-50, 9);
  });

  it('warns a view that comes back from the cold, not one it never stopped asking', () => {
    const a = new Looking(0, 0, 10, 50);
    const b = new Looking(100, 1, 30, 40);
    const { rig } = rigWith(a);
    rig.frameUpdate(frame(1 / 60));

    rig.use(b, 1);
    expect(b.entered).toBe(1);
    for (let i = 0; i < 20; i += 1) rig.frameUpdate(frame(1 / 60));
    rig.use(a, 1); // mid-blend: `a` has been followed all along
    expect(a.entered).toBe(0);
    for (let i = 0; i < 61; i += 1) rig.frameUpdate(frame(1 / 60));

    rig.use(b, 0); // by now `b` has been let go of, so even a cut to it is from the cold
    expect(b.entered).toBe(2);
    rig.frameUpdate(frame(1 / 60));
    rig.use(a, 1);
    expect(a.entered).toBe(1);
  });

  it('cuts when the blend is no time at all, and ignores being told what it already does', () => {
    const a = new Looking(0, 0, 10, 50);
    const b = new Looking(100, 1, 30, 40);
    const { camera, rig } = rigWith(a);
    rig.frameUpdate(frame(1 / 60));

    rig.use(b, 0);
    rig.frameUpdate(frame(1 / 60));
    expect(camera.fov).toBe(40);
    expect(focusOf(camera, 30).x).toBeCloseTo(100, 9);

    rig.use(b, 5);
    rig.frameUpdate(frame(1 / 60));
    expect(camera.fov).toBe(40);
  });
});

describe('the camera rig, making room for the panel', () => {
  it('puts the middle of the view in the middle of what a side panel leaves free', () => {
    const subject = new Looking(0, 0.4, 60, 40);
    const { camera, rig } = rigWith(subject, 1280, 800);
    rig.setInset({ right: 496 }, true);
    rig.frameUpdate(frame(1 / 60));

    const spot = onScreen(camera, subject.focus, 1280, 800);
    expect(spot.x).toBeCloseTo((1280 - 496) / 2, 6);
    expect(spot.y).toBeCloseTo(400, 6);
    expect(subject.seen).toEqual({ aspect: 1.6, freeWidth: 1 - 496 / 1280, freeHeight: 1 });
  });

  it('and of what a bottom sheet leaves free, on a phone', () => {
    const subject = new Looking(0, 0.4, 60, 40);
    const { camera, rig } = rigWith(subject, 390, 844);
    rig.setInset({ bottom: 490 }, true);
    rig.frameUpdate(frame(1 / 60));

    const spot = onScreen(camera, subject.focus, 390, 844);
    expect(spot.x).toBeCloseTo(195, 6);
    expect(spot.y).toBeCloseTo((844 - 490) / 2, 6);
    expect(subject.seen?.freeHeight).toBeCloseTo(1 - 490 / 844, 12);
  });

  it('keeps a sphere round: the window slides, the perspective stays', () => {
    const subject = new Looking(0, 0, 60, 40);
    const { camera, rig } = rigWith(subject, 1280, 800);
    rig.setInset({ right: 496 }, true);
    rig.frameUpdate(frame(1 / 60));

    // The silhouette of a ball at the focus, left to right and top to bottom.
    const left = onScreen(camera, new Vector3(-10, 0, 0), 1280, 800);
    const right = onScreen(camera, new Vector3(10, 0, 0), 1280, 800);
    const top = onScreen(camera, new Vector3(0, 10, 0), 1280, 800);
    const bottom = onScreen(camera, new Vector3(0, -10, 0), 1280, 800);
    expect(right.x - left.x).toBeCloseTo(bottom.y - top.y, 6);
    expect((left.x + right.x) / 2).toBeCloseTo(392, 6);
  });

  it('eases over when the panel opens and closes, and jumps only when told to', () => {
    const subject = new Looking(0, 0, 60, 40);
    const { camera, rig } = rigWith(subject, 1280, 800);
    rig.frameUpdate(frame(1 / 60));
    expect(camera.view).toBeNull();

    rig.setInset({ right: 496 });
    rig.frameUpdate(frame(1 / 60));
    const early = onScreen(camera, subject.focus, 1280, 800).x;
    expect(early).toBeLessThan(640);
    expect(early).toBeGreaterThan(600);
    for (let i = 0; i < 180; i += 1) rig.frameUpdate(frame(1 / 60));
    expect(onScreen(camera, subject.focus, 1280, 800).x).toBeCloseTo(392, 6);

    rig.setInset({});
    for (let i = 0; i < 180; i += 1) rig.frameUpdate(frame(1 / 60));
    expect(onScreen(camera, subject.focus, 1280, 800).x).toBeCloseTo(640, 6);
    expect(camera.view?.enabled ?? false).toBe(false);
  });

  it('measures again when the viewport changes', () => {
    const subject = new Looking(0, 0, 60, 40);
    const { camera, rig } = rigWith(subject, 1280, 800);
    rig.setInset({ right: 496 }, true);
    rig.frameUpdate(frame(1 / 60));

    rig.resize({ width: 1600, height: 900, pixelRatio: 1 });
    camera.aspect = 1600 / 900;
    camera.updateProjectionMatrix();
    expect(onScreen(camera, subject.focus, 1600, 900).x).toBeCloseTo((1600 - 496) / 2, 6);
  });

  it('never gives the panel more than most of the view, nor less than none', () => {
    const subject = new Looking(0, 0, 60, 40);
    const { rig } = rigWith(subject, 1000, 500);
    rig.setInset({ right: 5000, bottom: -40 }, true);
    rig.frameUpdate(frame(1 / 60));
    expect(subject.seen?.freeWidth).toBeCloseTo(0.2, 12);
    expect(subject.seen?.freeHeight).toBe(1);
  });

  it('leaves the camera as it found it', () => {
    const subject = new Looking(0, 0, 60, 40);
    const { camera, rig } = rigWith(subject);
    rig.setInset({ right: 496 }, true);
    rig.frameUpdate(frame(1 / 60));
    expect(camera.view?.enabled).toBe(true);
    rig.dispose();
    expect(camera.view?.enabled ?? false).toBe(false);
  });
});
