import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Frame, System, Viewport } from '../core/Engine';
import { clamp } from '../sim/math';
import { createSpring, snapSpring, stepSpring } from '../sim/spring';

/**
 * A camera described by what it LOOKS AT, not where it stands: look at `focus` from `distance`
 * away, turned by `quaternion`, through a lens of `fov` degrees (vertical). Every camera mode
 * speaks this, because poses in this form blend well: halfway between a chase view and an orbit
 * view is still a sensible view of something, where halfway between two camera POSITIONS can be
 * inside a planet (docs/PLAN.md §5.5, Appendix A).
 */
export interface Pose {
  readonly focus: Vector3;
  readonly quaternion: Quaternion;
  distance: number;
  fov: number;
}

export function createPose(): Pose {
  return { focus: new Vector3(), quaternion: new Quaternion(), distance: 1, fov: 50 };
}

/** The shape of what the camera draws into. */
export interface ViewShape {
  /** Width / height of the whole viewport. */
  readonly aspect: number;
  /**
   * The part of the viewport that the info panel leaves FREE, as shares of its width and height
   * (1 = all of it). The rig already puts the middle of the view in the middle of that part; a
   * mode that frames something uses these to decide how far to stand back.
   */
  readonly freeWidth: number;
  readonly freeHeight: number;
}

/** One way of looking at the world: chase, orbit; map and cinematic later. */
export interface CameraMode {
  /** Fill `out` for this frame. */
  update(frame: Frame, view: ViewShape, out: Pose): void;
  /**
   * The rig is about to ask this mode again after a time of not asking, so whatever it remembers
   * of its subject is stale. (A chase camera then starts from behind the ship, instead of swooping
   * in from where it last saw it.)
   */
  enter?(): void;
}

export interface RigParams {
  /** 1/s: how quickly the view slides over when the panel opens, closes or changes size. */
  readonly insetOmega: number;
}

const BACK = new Vector3();
const TURN = new Quaternion();

export function applyPose(camera: PerspectiveCamera, pose: Pose): void {
  camera.quaternion.copy(pose.quaternion);
  // A camera looks down its own -Z, so it stands `distance` along its +Z from what it looks at.
  camera.position
    .copy(pose.focus)
    .add(BACK.set(0, 0, pose.distance).applyQuaternion(pose.quaternion));
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
}

/** `t` from 0 to 1, eased so that it starts and ends with no speed and no acceleration. */
export function easeBlend(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** `out` may be `from` or `to`: the rig mixes in place. */
export function mixPose(from: Pose, to: Pose, k: number, out: Pose): Pose {
  out.focus.lerpVectors(from.focus, to.focus, k);
  // Not straight into `out`: slerpQuaternions starts by overwriting its target with `from`.
  out.quaternion.copy(TURN.slerpQuaternions(from.quaternion, to.quaternion, k));
  out.distance = from.distance + (to.distance - from.distance) * k;
  out.fov = from.fov + (to.fov - from.fov) * k;
  return out;
}

/**
 * Drives the engine's one camera. Two jobs:
 *
 * BLENDING between modes, LIVE: while a blend runs both modes keep following their subjects, so
 * a blend that starts while the ship moves carries that motion over instead of stopping dead.
 * Changing back mid-blend simply runs the same blend the other way.
 *
 * THE PANEL. The info panel covers part of the viewport (`setInset`), and what matters should be
 * in the middle of what is left. Turning the camera would do it, but then spheres near the edge
 * of a wide view stretch into eggs. Instead the whole view is slid sideways with a view offset:
 * same camera, same perspective, a different window onto it, so a planet stays round.
 *
 * Add it AFTER whatever the modes follow, so that it sees this frame's ship and planets.
 */
export class CameraRig implements System {
  private readonly pose = createPose();
  private readonly other = createPose();
  private mode: CameraMode;
  /** The mode being blended away from, live, or a pose frozen when a third mode cut in. */
  private from: CameraMode | null = null;
  private readonly frozen = createPose();
  private progress = 1;
  private blendSec = 0;

  private width = 1;
  private height = 1;
  private readonly insetRight = createSpring(0);
  private readonly insetBottom = createSpring(0);
  private wantRight = 0;
  private wantBottom = 0;
  private offsetX = 0;
  private offsetY = 0;
  private readonly view = { aspect: 1, freeWidth: 1, freeHeight: 1 };

  constructor(
    private readonly camera: PerspectiveCamera,
    initial: CameraMode,
    private readonly params: RigParams,
  ) {
    this.mode = initial;
  }

  /** The mode in charge (or on its way to being). */
  get active(): CameraMode {
    return this.mode;
  }

  /** Hand over to `mode` over `blendSec` seconds. 0 is a cut. */
  use(mode: CameraMode, blendSec: number): void {
    if (mode === this.mode) return;
    // The mode being blended away from is still being asked every frame: it is not stale.
    if (this.from !== mode) mode.enter?.();
    if (blendSec <= 0) {
      this.from = null;
      this.progress = 1;
    } else if (this.from === mode) {
      // Turning back halfway: the same blend, the other way. The easing is symmetric, so the
      // view carries on from exactly where it is.
      this.from = this.mode;
      this.progress = 1 - this.progress;
    } else {
      if (this.progress < 1) {
        // A third mode cuts into a blend: start from the picture as it is, held still.
        copyPose(this.pose, this.frozen);
        this.from = null;
      } else {
        this.from = this.mode;
      }
      this.progress = 0;
    }
    this.blendSec = blendSec;
    this.mode = mode;
  }

  /**
   * How much of the viewport the info panel covers, in CSS pixels from the right and from the
   * bottom. The view eases over; `cut` jumps (the first layout of a page).
   */
  setInset(inset: { right?: number; bottom?: number }, cut = false): void {
    this.wantRight = Math.max(0, inset.right ?? 0);
    this.wantBottom = Math.max(0, inset.bottom ?? 0);
    if (cut) {
      snapSpring(this.insetRight, this.wantRight);
      snapSpring(this.insetBottom, this.wantBottom);
    }
  }

  frameUpdate(frame: Frame): void {
    this.slide(frame.dt);

    this.mode.update(frame, this.view, this.pose);
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + frame.dt / this.blendSec);
      let source = this.frozen;
      if (this.from) {
        this.from.update(frame, this.view, this.other);
        source = this.other;
      }
      mixPose(source, this.pose, easeBlend(this.progress), this.pose);
      if (this.progress >= 1) this.from = null;
    }
    applyPose(this.camera, this.pose);
  }

  resize(viewport: Viewport): void {
    this.width = viewport.width;
    this.height = viewport.height;
    this.view.aspect = viewport.width / viewport.height;
    // The window onto the view is measured in pixels of the viewport: measure again.
    this.offsetX = Number.NaN;
    this.slide(0);
  }

  dispose(): void {
    // Owns nothing: the camera is the engine's.
    this.camera.clearViewOffset();
  }

  /** Ease the inset, and slide the window onto the view so that its middle is the free part's. */
  private slide(dt: number): void {
    const { width, height, params } = this;
    stepSpring(this.insetRight, this.wantRight, params.insetOmega, dt);
    stepSpring(this.insetBottom, this.wantBottom, params.insetOmega, dt);
    // Never more than most of the view: something of the world must stay in sight.
    const right = clamp(this.insetRight.value, 0, width * 0.8);
    const bottom = clamp(this.insetBottom.value, 0, height * 0.8);
    this.view.freeWidth = 1 - right / width;
    this.view.freeHeight = 1 - bottom / height;

    const x = Math.round(right) / 2;
    const y = Math.round(bottom) / 2;
    if (x === this.offsetX && y === this.offsetY) return;
    this.offsetX = x;
    this.offsetY = y;
    if (x === 0 && y === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, x, y, width, height);
  }
}

function copyPose(from: Pose, to: Pose): void {
  to.focus.copy(from.focus);
  to.quaternion.copy(from.quaternion);
  to.distance = from.distance;
  to.fov = from.fov;
}
