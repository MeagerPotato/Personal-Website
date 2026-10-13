import { Euler, type Vector3 } from 'three';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { angleDelta, angleOf, approach, clamp } from '../sim/math';
import { createSpring, snapSpring, stepSpring } from '../sim/spring';
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
  /** ...and this many while it faces a landmark: it closes in on the body. */
  readonly focusFitRingRadii: number;
  /** 1/s. How quickly it turns to a landmark and closes in, and lets go again. */
  readonly faceOmega: number;
  /** It never turns faster than this, however far round the landmark is. */
  readonly faceMaxRadPerSec: number;
  /**
   * A landmark it faces rests this far round from the middle of the disc, toward the side its
   * card is on: turned to the card that speaks of it, and never hidden behind the line to it.
   */
  readonly faceBiasDeg: number;
}

/** What the camera frames: a docked-at body (world/Galaxy.ts knows them). */
export interface OrbitSubject {
  readonly position: Readonly<Vector3>;
  /** Radius of the ring the ship circles it on. */
  readonly ringRadius: number;
  /** Where its light comes from, or null for a body that IS the light. */
  readonly light: Readonly<Vector3> | null;
}

/** Something on the body to turn to: a landmark, and the side of the view its card is on. */
export interface FaceTarget {
  /**
   * How far round the body it is NOW: the angle of its offset from the body's middle
   * (sim/math.ts, `angleOf`). Asked every frame, because a landmark on a turning world moves.
   */
  azimuth(): number;
  /** -1: its card is left of the body. 1: right of it. */
  readonly side: -1 | 1;
}

const RAD_PER_DEG = Math.PI / 180;

/**
 * The camera of a docked ship: the BODY is the subject now, framed with its docking ring (so the
 * circling ship stays in the picture) in the part of the view the info panel leaves free, seen
 * from a little above, from the side the light falls on. It wanders round slowly, because a
 * still picture of a turning world looks like a mistake.
 *
 * TOLD TO FACE something on the body (`face`: the landmark of the card that is open), it turns
 * to it the short way round, closes in, and then holds it, going round with the body as the body
 * turns; told to face nothing, it wanders on from wherever it is. It only ever turns ROUND the
 * body: how far above it looks from never changes.
 */
export class OrbitCam implements CameraMode {
  /** It frames the body: clear of a phone's solid top bar too (CameraRig.ts). */
  readonly avoidsTop = true;
  private subject: OrbitSubject | null = null;
  /** Where the camera stands round the body, and how fast it is going round (rad, rad/s). */
  private readonly round = createSpring(0);
  private target: FaceTarget | null = null;
  /** 0: the whole ring in view. 1: closed in on what it faces. */
  private readonly closeIn = createSpring(0);
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly options: { reducedMotion: boolean },
    private readonly params: OrbitCamParams = tuning.orbitCam,
  ) {}

  /**
   * Frame this body from now on: from its sunlit side, or, with something to face, facing that
   * already (an arrival ends on the picture the page asks for, and does not swing to it after).
   */
  look(subject: OrbitSubject): void {
    this.subject = subject;
    const { light, position } = subject;
    const sunward = light ? angleOf(light.x - position.x, light.z - position.z) : 0;
    snapSpring(this.round, sunward + this.params.sunwardOffsetDeg * RAD_PER_DEG);
    this.round.velocity = this.drift();
    if (this.target) this.cut(this.target);
    else snapSpring(this.closeIn, 0);
  }

  /**
   * Turn to `target` and stay on it, or (null) wander again from where the camera is. `cut`: be
   * there at once, as under reduced motion.
   */
  face(target: FaceTarget | null, cut = false): void {
    this.target = target;
    if (!cut && !this.options.reducedMotion) return;
    if (target) this.cut(target);
    else {
      snapSpring(this.closeIn, 0);
      this.round.velocity = this.drift();
    }
  }

  /**
   * The rig asks again after a time of not asking (the star map was up): the landmark has gone
   * on round meanwhile, and the view comes back facing where it is now.
   */
  enter(): void {
    if (this.target) this.cut(this.target);
  }

  /** How far it has closed in on what it faces: 0 the whole ring in view, 1 all the way. */
  get focus(): number {
    return clamp(this.closeIn.value, 0, 1);
  }

  update(frame: Frame, view: ViewShape, out: Pose): void {
    const { params, subject, target, round, closeIn } = this;
    if (!subject) return;
    const still = this.options.reducedMotion;
    if (target && still) {
      this.cut(target);
    } else if (target) {
      // The short way round from where the camera is. A landmark on a turning world keeps
      // moving, and the camera goes round after it, a degree or so behind a planet's spin (a
      // spring trails what moves at speed u by 2u / omega).
      const from = round.value;
      const goal = from + angleDelta(from, this.standFor(target));
      stepSpring(round, goal, params.faceOmega, frame.dt);
      // Never faster than a head can follow, however far round it has to go.
      const most = params.faceMaxRadPerSec;
      round.value = from + clamp(round.value - from, -most * frame.dt, most * frame.dt);
      round.velocity = clamp(round.velocity, -most, most);
      stepSpring(closeIn, 1, params.faceOmega, frame.dt);
    } else {
      // Wandering. Whatever turn it was in runs out into the slow drift.
      round.velocity = approach(round.velocity, this.drift(), params.faceOmega, frame.dt);
      round.value += round.velocity * frame.dt;
      if (still) snapSpring(closeIn, 0);
      else stepSpring(closeIn, 0, params.faceOmega, frame.dt);
    }

    // The free part of the view, as half-angles: the lens is `fov` tall over the WHOLE viewport.
    const tanHalf = Math.tan((params.fovDegrees / 2) * RAD_PER_DEG);
    const halfTall = Math.atan(tanHalf * (view.freeHeight - view.freeTop));
    const halfWide = Math.atan(tanHalf * view.aspect * (view.freeWidth - view.freeLeft));
    const radii =
      params.fitRingRadii + (params.focusFitRingRadii - params.fitRingRadii) * this.focus;
    const fit = radii * subject.ringRadius;

    out.focus.copy(subject.position);
    out.distance = fit / Math.sin(Math.min(halfTall, halfWide));
    out.fov = params.fovDegrees;
    out.quaternion.setFromEuler(this.euler.set(-params.elevationDeg * RAD_PER_DEG, round.value, 0));
  }

  /** How fast the view wanders when it faces nothing. */
  private drift(): number {
    return this.options.reducedMotion ? 0 : this.params.driftRadPerSec;
  }

  /** Where the camera stands to face `target`: the landmark a little round from the middle, toward its card. */
  private standFor(target: FaceTarget): number {
    return target.azimuth() - target.side * this.params.faceBiasDeg * RAD_PER_DEG;
  }

  /** Be facing `target` now, closed in. */
  private cut(target: FaceTarget): void {
    // The same picture whichever way round the number is: keep it near where the camera was.
    const { round } = this;
    snapSpring(round, round.value + angleDelta(round.value, this.standFor(target)));
    snapSpring(this.closeIn, 1);
  }
}
