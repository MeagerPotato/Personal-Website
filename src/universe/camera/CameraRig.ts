import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Frame, System, Viewport } from '../core/Engine';

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

/** One way of looking at the world: chase now; orbit, map and cinematic from Phase 2. */
export interface CameraMode {
  /** Fill `out` for this frame. `aspect` is the viewport's width / height. */
  update(frame: Frame, aspect: number, out: Pose): void;
}

const BACK = new Vector3();

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

/**
 * Drives the engine's one camera from the active mode. (Blending between modes arrives with the
 * second mode, the orbit camera.) Add it AFTER whatever the mode follows, so that it sees this
 * frame's ship and not the last one's.
 */
export class CameraRig implements System {
  private readonly pose = createPose();
  private aspect = 1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly mode: CameraMode,
  ) {}

  frameUpdate(frame: Frame): void {
    this.mode.update(frame, this.aspect, this.pose);
    applyPose(this.camera, this.pose);
  }

  resize(viewport: Viewport): void {
    this.aspect = viewport.width / viewport.height;
  }

  dispose(): void {
    // Owns nothing: the camera is the engine's.
  }
}
