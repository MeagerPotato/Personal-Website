import { Matrix4, Vector3 } from 'three';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import { clamp, lerp, smoothstep } from '../sim/math';
import { createSpring, snapSpring, stepSpring } from '../sim/spring';
import type { CameraMode, Pose, ViewShape } from './CameraRig';

export interface ChaseCamParams {
  readonly back: number;
  readonly up: number;
  readonly lookAheadBase: number;
  readonly lookAheadPerSpeed: number;
  readonly lookAheadMax: number;
  readonly positionOmega: number;
  readonly maxTrail: number;
  readonly yawOmega: number;
  readonly maxYawRate: number;
  readonly fovBoostDegrees: number;
  readonly fovBoostSpeeds: readonly [from: number, to: number];
  readonly fovOmega: number;
  readonly fovDolly: number;
  readonly minHorizontalFovDegrees: number;
  readonly maxFovDegrees: number;
  readonly portraitDistanceScale: number;
  readonly fitDegrees: number;
  readonly maxFitWiden: number;
}

/** What the camera follows: the ship's in-between pose (ship/ShipSystem.ts). */
export interface ChaseTarget {
  readonly position: Readonly<Vector3>;
  readonly heading: number;
  readonly speed: number;
}

const RAD_PER_DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);

/**
 * The camera that follows the ship: behind and above, looking a little ahead of it, and never
 * rolling. It does not hold on to the ship rigidly. A spring trails the ship's position and
 * another its heading, so the ship visibly pulls away when it speeds up and swings across the
 * frame when it turns, and the camera catches up. That slack is most of what flying FEELS like.
 *
 * The springs are exact and are told how fast their targets move (sim/spring.ts), so the view is
 * the same at 30, 60 or 144 frames per second, and uneven frames do not show as judder.
 *
 * The picture is composed for a whole screen: the horizon (where every planet is) about a third
 * of the way down, the ship at about 70 %. On a phone with the sheet up only a strip of it is
 * free, between the solid top bar and the sheet, and the rig puts the middle of the view in the
 * middle of that strip (`avoidsTop`). The lens then widens until the strip holds the same picture,
 * smaller: the planet ahead clear of the bar, the ship clear of the sheet.
 */
export class ChaseCam implements CameraMode {
  /** It frames the ship and what lies ahead of it: clear of a phone's solid top bar too. */
  readonly avoidsTop = true;
  private readonly x = createSpring();
  private readonly z = createSpring();
  private readonly yaw = createSpring();
  /** How much of the speed's widening of the lens is on (0 to 1), and how far ahead it looks (u). */
  private readonly rush = createSpring();
  private readonly ahead = createSpring();
  private readonly eye = new Vector3();
  private readonly look = new Matrix4();
  private lastX = 0;
  private lastZ = 0;
  private lastHeading = 0;
  private following = false;

  constructor(
    private readonly target: ChaseTarget,
    private readonly options: { reducedMotion: boolean },
    private readonly params: ChaseCamParams = tuning.chaseCam,
  ) {}

  /** Jump straight behind the target on the next update: a cut, not a swoop. */
  snap(): void {
    this.following = false;
  }

  /** Back in charge after a while away: what the springs remember is where the ship WAS. */
  enter(): void {
    this.snap();
  }

  update(frame: Frame, view: ViewShape, out: Pose): void {
    const { params, target } = this;
    const { aspect } = view;
    const { x, z } = target.position;
    const dt = frame.dt;

    // The lens widens with speed, and the view looks further ahead. Both EASE there (fovOmega):
    // the autopilot goes from rest to 700 u/s in a second, and a lens that followed the speed
    // step for step swung 13 degrees in five frames. A pilot's own boost ends at the same lens.
    const [slow, fast] = params.fovBoostSpeeds;
    const rushTo = this.options.reducedMotion ? 0 : smoothstep(slow, fast, target.speed);
    // Never further than lookAheadMax: at the autopilot's 700 u/s it would be 140 u, and from
    // 4.4 u up the view would lie flat along the plane (a pitch of 1.5 degrees; 3.2 at the cap).
    const aheadTo = Math.min(
      params.lookAheadMax,
      params.lookAheadBase + params.lookAheadPerSpeed * target.speed,
    );
    if (!this.following) {
      snapSpring(this.x, x);
      snapSpring(this.z, z);
      snapSpring(this.yaw, target.heading);
      snapSpring(this.rush, rushTo);
      snapSpring(this.ahead, aheadTo);
      this.following = true;
    } else if (dt > 0) {
      stepSpring(this.x, x, params.positionOmega, dt, (x - this.lastX) / dt);
      stepSpring(this.z, z, params.positionOmega, dt, (z - this.lastZ) / dt);
      const turned = (target.heading - this.lastHeading) / dt;
      const from = this.yaw.value;
      stepSpring(this.yaw, target.heading, params.yawOmega, dt, turned);
      // The view never swings faster than maxYawRate, and under reduced motion never faster than a
      // pilot can turn the ship by hand: the autopilot snaps round at 7 rad/s, and a view that
      // kept up spun the whole world past at 380 degrees a second. The ship turns in the frame
      // instead, and the view comes round after it.
      const most = this.options.reducedMotion
        ? Math.min(params.maxYawRate, tuning.flight.yawRateSlow)
        : params.maxYawRate;
      if (Math.abs(this.yaw.value - from) > most * dt) {
        this.yaw.value = from + Math.sign(this.yaw.value - from) * most * dt;
        this.yaw.velocity = clamp(this.yaw.velocity, -most, most);
      }
      stepSpring(this.rush, rushTo, params.fovOmega, dt);
      stepSpring(this.ahead, aheadTo, params.fovOmega, dt);
    }
    this.lastX = x;
    this.lastZ = z;
    this.lastHeading = target.heading;

    // The spring may trail as far as it likes; the VIEW trails by at most maxTrail, easing into
    // that limit, so a boosting ship pulls away and then holds instead of shrinking to a dot.
    const trailX = x - this.x.value;
    const trailZ = z - this.z.value;
    const trail = Math.hypot(trailX, trailZ);
    const held =
      trail > 1e-6 && params.maxTrail > 0
        ? (params.maxTrail * Math.tanh(trail / params.maxTrail)) / trail
        : 1;
    const anchorX = x - trailX * held;
    const anchorZ = z - trailZ * held;

    const base = tuning.camera.fovDegrees;
    const wanted = base + params.fovBoostDegrees * clamp(this.rush.value, 0, 1);
    const halfHorizontal = (params.minHorizontalFovDegrees / 2) * RAD_PER_DEG;
    const needed = (2 * Math.atan(Math.tan(halfHorizontal) / aspect)) / RAD_PER_DEG;
    // The free strip sees `strip` of the lens's height (in tangents: the view offset keeps the
    // strip in the middle of the lens). Too little, and the lens widens, within reason.
    const asked = Math.max(wanted, needed);
    const lens = Math.tan((asked / 2) * RAD_PER_DEG);
    const strip = Math.max(view.freeHeight - view.freeTop, 1e-3);
    const fit = clamp(
      Math.tan((params.fitDegrees / 2) * RAD_PER_DEG) / (lens * strip),
      1,
      params.maxFitWiden,
    );
    const fitted = fit > 1 ? (2 * Math.atan(lens * fit)) / RAD_PER_DEG : asked;
    out.fov = clamp(fitted, 1, params.maxFovDegrees);

    // A wider lens makes everything smaller. Moving in as the lens widens with SPEED gives some of
    // that back to the ship, while the sky still stretches: the rush without losing the hero.
    const dolly = lerp(
      1,
      Math.tan((base / 2) * RAD_PER_DEG) / Math.tan((wanted / 2) * RAD_PER_DEG),
      params.fovDolly,
    );
    // Tall screens see less to the sides: back off (the lens has already widened, above).
    const reach = dolly * lerp(1, params.portraitDistanceScale, smoothstep(1, 0.6, aspect));

    const forwardX = Math.sin(this.yaw.value);
    const forwardZ = Math.cos(this.yaw.value);
    const ahead = this.ahead.value;
    out.focus.set(anchorX + forwardX * ahead, 0, anchorZ + forwardZ * ahead);
    this.eye.set(
      anchorX - forwardX * params.back * reach,
      params.up * reach,
      anchorZ - forwardZ * params.back * reach,
    );
    out.distance = this.eye.distanceTo(out.focus);
    // A level `up` is what "never rolls" means.
    out.quaternion.setFromRotationMatrix(this.look.lookAt(this.eye, out.focus, UP));
  }
}
