import { Euler, type Vector3 } from 'three';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { angleOf } from '../sim/math';
import type { CameraMode, Pose, ViewShape } from './CameraRig';

export interface OrbitCamParams {
  readonly fovDegrees: number;
  /** How far above the flight plane the camera looks down from. */
  readonly elevationDeg: number;
  /** The camera stands this far round from the direction of the light: mostly day, some night. */
  readonly sunwardOffsetDeg: number;
  /** What must fit into the free part of the view: this many radii of the docking ring. */
  readonly fitRingRadii: number;
  /** The view wanders round the body this fast. Off under reduced motion. */
  readonly driftRadPerSec: number;
}

/** What the camera frames: a docked-at body (world/Galaxy.ts knows them). */
export interface OrbitSubject {
  readonly position: Readonly<Vector3>;
  /** Radius of the ring the ship circles it on. */
  readonly ringRadius: number;
  /** Where its light comes from, or null for a body that IS the light. */
  readonly light: Readonly<Vector3> | null;
}

const RAD_PER_DEG = Math.PI / 180;

/**
 * The camera of a docked ship: the BODY is the subject now, framed with its docking ring (so the
 * circling ship stays in the picture) in the part of the view the info panel leaves free, seen
 * from a little above, from the side the light falls on. It wanders round slowly, because a
 * still picture of a turning world looks like a mistake.
 */
export class OrbitCam implements CameraMode {
  /** It frames the body: clear of a phone's solid top bar too (CameraRig.ts). */
  readonly avoidsTop = true;
  private subject: OrbitSubject | null = null;
  private azimuth = 0;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly options: { reducedMotion: boolean },
    private readonly params: OrbitCamParams = tuning.orbitCam,
  ) {}

  /** Frame this body from now on, starting from its sunlit side. */
  look(subject: OrbitSubject): void {
    this.subject = subject;
    const { light, position } = subject;
    const sunward = light ? angleOf(light.x - position.x, light.z - position.z) : 0;
    this.azimuth = sunward + this.params.sunwardOffsetDeg * RAD_PER_DEG;
  }

  update(frame: Frame, view: ViewShape, out: Pose): void {
    const { params, subject } = this;
    if (!subject) return;
    if (!this.options.reducedMotion) this.azimuth += params.driftRadPerSec * frame.dt;

    // The free part of the view, as half-angles: the lens is `fov` tall over the WHOLE viewport.
    const tanHalf = Math.tan((params.fovDegrees / 2) * RAD_PER_DEG);
    const halfTall = Math.atan(tanHalf * (view.freeHeight - view.freeTop));
    const halfWide = Math.atan(tanHalf * view.aspect * view.freeWidth);
    const fit = params.fitRingRadii * subject.ringRadius;

    out.focus.copy(subject.position);
    out.distance = fit / Math.sin(Math.min(halfTall, halfWide));
    out.fov = params.fovDegrees;
    out.quaternion.setFromEuler(
      this.euler.set(-params.elevationDeg * RAD_PER_DEG, this.azimuth, 0),
    );
  }
}
