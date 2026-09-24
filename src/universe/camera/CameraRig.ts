import { Euler, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Frame, System, Viewport } from '../core/Engine';
import { angleDelta, clamp, TAU } from '../sim/math';
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
   * The part of the viewport that the page's chrome leaves FREE, as shares of its width and height
   * (1 = all of it), from the top left corner: across to `freeWidth`, and down from `freeTop` to
   * `freeHeight` (where a bottom sheet begins). The rig already puts the middle of the view in the
   * middle of that part; a mode that frames something uses these to decide how far to stand back.
   */
  readonly freeWidth: number;
  readonly freeHeight: number;
  /**
   * How much of the top is covered, as a share of the height: 0 but on a phone with the sheet
   * up, where the top bar and the row of controls under it are solid (shell/panel-inset.ts).
   */
  readonly freeTop: number;
}

/** One way of looking at the world: chase, orbit, map; cinematic later. */
export interface CameraMode {
  /** Fill `out` for this frame. */
  update(frame: Frame, view: ViewShape, out: Pose): void;
  /**
   * The rig is about to ask this mode again after a time of not asking, so whatever it remembers
   * of its subject is stale. (A chase camera then starts from behind the ship, instead of swooping
   * in from where it last saw it.)
   */
  enter?(): void;
  /**
   * Does this mode leave a covered top band out of the view, as it does what the panel covers
   * (`setInset`'s `top`)? A mode that FRAMES a subject does: the orbit camera puts the body
   * clear of a phone's solid top bar. A mode that looks past its subject into the top of the
   * picture does not: the chase camera keeps the ship low and looks ahead, and the star map
   * fits itself below the bar on its own. Left out, it does not.
   */
  readonly avoidsTop?: boolean;
}

export interface RigParams {
  /** 1/s: how quickly the view slides over when the panel opens, closes or changes size. */
  readonly insetOmega: number;
  /**
   * The depth range follows the camera out. From the map, thousands of units up, the range that
   * suits a chase camera (half a unit to twelve thousand) would leave the depth buffer a few units
   * coarse: nothing is drawn nearer than this share of the distance to what the camera looks at,
   * and the far end is at least this many times that distance. Never tighter than the camera's own.
   */
  readonly nearShare: number;
  readonly farShare: number;
}

/** The depth range a camera was made with, and how it may stretch (RigParams). */
export interface DepthRange {
  readonly near: number;
  readonly far: number;
  readonly nearShare: number;
  readonly farShare: number;
}

/**
 * Which way round a blend turns, remembered from frame to frame. Two views that face nearly
 * opposite ways can be turned into each other either way round, and while both keep moving the
 * shorter way may change sides: a blend that followed it would flip the picture over in one frame.
 * So a blend makes up its mind once, and then stays with the turn nearest to its last one.
 */
export interface Turn {
  /** Radians round the vertical, from the old view to the new one. NaN: not decided yet. */
  yaw: number;
}

const BACK = new Vector3();
// Yaw first, then pitch, then roll: the order in which a camera on a tripod is turned.
const FROM = new Euler(0, 0, 0, 'YXZ');
const TO = new Euler(0, 0, 0, 'YXZ');

export function applyPose(camera: PerspectiveCamera, pose: Pose, depth?: DepthRange): void {
  camera.quaternion.copy(pose.quaternion);
  // A camera looks down its own -Z, so it stands `distance` along its +Z from what it looks at.
  camera.position
    .copy(pose.focus)
    .add(BACK.set(0, 0, pose.distance).applyQuaternion(pose.quaternion));
  const near = depth ? Math.max(depth.near, pose.distance * depth.nearShare) : camera.near;
  const far = depth ? Math.max(depth.far, pose.distance * depth.farShare) : camera.far;
  if (camera.fov !== pose.fov || camera.near !== near || camera.far !== far) {
    camera.fov = pose.fov;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** `t` from 0 to 1, eased so that it starts and ends with no speed and no acceleration. */
export function easeBlend(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * `out` may be `from` or `to`: the rig mixes in place.
 *
 * Distance mixes BY RATIO: from 20 u behind the ship to 6,000 u above the galaxy, halfway is 350 u,
 * not 3,000, so pulling out looks like one steady zoom instead of a leap followed by a crawl. And
 * what is looked at moves over in step with the distance actually covered, so it travels while
 * the view is wide and a long way is a few pixels: the ship stays in the picture all the way out
 * to the map, and comes back into the middle before the camera closes in on it.
 *
 * The turn mixes as a TRIPOD turns: so much round, so much down. Every camera here is level, and
 * halfway between two level views must be level too; the shortest turn between them (a slerp) is
 * not, it tips the horizon on the way, and the further round it has to go the more.
 */
export function mixPose(from: Pose, to: Pose, k: number, out: Pose, turn?: Turn): Pose {
  const near = Math.max(from.distance, 1e-6);
  const far = Math.max(to.distance, 1e-6);
  const distance = near * Math.pow(far / near, k);
  const apart = far - near;
  const covered = Math.abs(apart) > 1e-6 * Math.max(near, far) ? (distance - near) / apart : k;
  out.focus.lerpVectors(from.focus, to.focus, covered);
  // (Read both before writing either: `out` may be one of them.)
  FROM.setFromQuaternion(from.quaternion, 'YXZ');
  TO.setFromQuaternion(to.quaternion, 'YXZ');
  let yaw = angleDelta(FROM.y, TO.y);
  if (turn) {
    if (Number.isFinite(turn.yaw)) yaw += TAU * Math.round((turn.yaw - yaw) / TAU);
    turn.yaw = yaw;
  }
  out.quaternion.setFromEuler(
    FROM.set(
      FROM.x + (TO.x - FROM.x) * k,
      FROM.y + yaw * k,
      FROM.z + angleDelta(FROM.z, TO.z) * k,
      'YXZ',
    ),
  );
  out.distance = distance;
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
  private readonly turn: Turn = { yaw: Number.NaN };

  private width = 1;
  private height = 1;
  private readonly insetTop = createSpring(0);
  private readonly insetRight = createSpring(0);
  private readonly insetBottom = createSpring(0);
  private wantTop = 0;
  private wantRight = 0;
  private wantBottom = 0;
  private offsetX = 0;
  private offsetY = 0;
  private readonly view = { aspect: 1, freeWidth: 1, freeHeight: 1, freeTop: 0 };
  private readonly depth: DepthRange;

  constructor(
    private readonly camera: PerspectiveCamera,
    initial: CameraMode,
    private readonly params: RigParams,
  ) {
    this.mode = initial;
    const { near, far } = camera;
    this.depth = {
      near,
      far,
      get nearShare() {
        return params.nearShare;
      },
      get farShare() {
        return params.farShare;
      },
    };
  }

  /** The mode in charge (or on its way to being). */
  get active(): CameraMode {
    return this.mode;
  }

  /** The shape of the view right now, the free part of it included. A LIVE object: do not keep copies. */
  get shape(): ViewShape {
    return this.view;
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
      this.turn.yaw = -this.turn.yaw;
    } else {
      if (this.progress < 1) {
        // A third mode cuts into a blend: start from the picture as it is, held still.
        copyPose(this.pose, this.frozen);
        this.from = null;
      } else {
        this.from = this.mode;
      }
      this.progress = 0;
      this.turn.yaw = Number.NaN;
    }
    this.blendSec = blendSec;
    this.mode = mode;
    // A cut is a cut for the window too: the new mode's view of the top band, at once.
    if (blendSec <= 0) {
      snapSpring(this.insetTop, this.topWanted());
      this.slide(0);
    }
  }

  /**
   * How much of the viewport the page's chrome covers, in CSS pixels from the right and from the
   * bottom (the info panel), and from the top (a phone's solid top bar, over the sheet: only a
   * mode that `avoidsTop` leaves that out). The view eases over; `cut` jumps (the first layout
   * of a page).
   */
  setInset(inset: { top?: number; right?: number; bottom?: number }, cut = false): void {
    this.wantTop = Math.max(0, inset.top ?? 0);
    this.wantRight = Math.max(0, inset.right ?? 0);
    this.wantBottom = Math.max(0, inset.bottom ?? 0);
    if (cut) {
      snapSpring(this.insetTop, this.topWanted());
      snapSpring(this.insetRight, this.wantRight);
      snapSpring(this.insetBottom, this.wantBottom);
      // Whoever asks for the shape of the view before the next frame (the star map, fitting the
      // galaxy into it) must hear of a cut at once.
      this.slide(0);
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
      mixPose(source, this.pose, easeBlend(this.progress), this.pose, this.turn);
      if (this.progress >= 1) this.from = null;
    }
    applyPose(this.camera, this.pose, this.depth);
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
    // Owns nothing: the camera is the engine's, and gets back the depth range it came with.
    this.camera.near = this.depth.near;
    this.camera.far = this.depth.far;
    this.camera.clearViewOffset();
  }

  /** The covered top band, if the mode in charge leaves it out of the view. */
  private topWanted(): number {
    return this.mode.avoidsTop === true ? this.wantTop : 0;
  }

  /** Ease the inset, and slide the window onto the view so that its middle is the free part's. */
  private slide(dt: number): void {
    const { width, height, params } = this;
    stepSpring(this.insetTop, this.topWanted(), params.insetOmega, dt);
    stepSpring(this.insetRight, this.wantRight, params.insetOmega, dt);
    stepSpring(this.insetBottom, this.wantBottom, params.insetOmega, dt);
    // Never more than most of the view: something of the world must stay in sight. The top
    // band comes out of what the sheet leaves.
    const right = clamp(this.insetRight.value, 0, width * 0.8);
    const bottom = clamp(this.insetBottom.value, 0, height * 0.8);
    const top = clamp(this.insetTop.value, 0, height * 0.8 - bottom);
    this.view.freeWidth = 1 - right / width;
    this.view.freeHeight = 1 - bottom / height;
    this.view.freeTop = top / height;

    // The middle of the free part is (bottom - top) / 2 above the middle of the viewport.
    const x = Math.round(right) / 2;
    const y = (Math.round(bottom) - Math.round(top)) / 2;
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
