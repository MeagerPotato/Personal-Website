import { BufferAttribute, BufferGeometry, Group, IcosahedronGeometry, Mesh, Vector3 } from 'three';
import type { Frame, System, Viewport } from '../core/Engine';
import type { QualityTier } from '../core/quality/tiers';
import { Scope } from '../core/scope';
import {
  HYPER_FAMILY_TINT,
  HYPER_TINT_SHARES,
  createHyperDashMaterial,
  createHyperTubeMaterial,
  wearHyperFamily,
  type HyperDashMaterial,
  type HyperTubeMaterial,
} from '../design/materials';
import type { ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { HYPER_TUNNEL, HYPER_WINDUP, type DockState } from '../sim/docking';
import {
  LOOK_DROPOUT,
  LOOK_OFF,
  LOOK_TUNNEL,
  LOOK_WINDUP,
  copyHyperLook,
  createHyperLook,
  hyperLook,
  type HyperLook,
  type HyperLookParams,
  type LookAt,
} from '../sim/hyper';
import { TAU, clamp } from '../sim/math';
import { createRng, hashSeed, pickWeighted } from '../sim/rng';

/** How a jump looks (design/tuning.ts, `hyper`): what the simulation reads of that block is HyperParams. */
export interface HyperViewParams extends HyperLookParams {
  /**
   * The real stars dim to this share of themselves in the tunnel (main.ts, `starCalm`), and the
   * baked sky's light with them (world/SkyBake.ts, `setJump`).
   */
  readonly starOpacity: number;
  /** How many dashes, by quality tier. */
  readonly dashes: Readonly<Record<QualityTier, number>>;
  /** rad. The dark eye in the middle of the tunnel. */
  readonly eyeRad: number;
  /** The wash's alpha, on every other band. */
  readonly wash: readonly [even: number, odd: number];
  readonly ribAlpha: number;
  readonly ringAlpha: number;
  /** Bands for each time the angle off the course grows e-fold. */
  readonly bands: number;
  /** How fast it streams at the autopilot's top speed. */
  readonly flowPerSec: number;
  /** A dash at full stretch reaches this share of the way back to the eye. */
  readonly dashLength: number;
  /** CSS px. */
  readonly dashWidthPx: number;
}

/** Where a journey is headed: which body, and the family it wears. */
export interface HyperTarget {
  readonly id: string;
  readonly theme: ThemeKey | undefined;
}

export interface HyperspaceOptions {
  /** The jump as the simulation has it (sim/hyper.ts): the journey's dock. */
  dock: Readonly<Pick<DockState, 'hyper' | 'hyperSec'>>;
  /** The ship's in-between pose (ship/ShipSystem.ts). */
  ship: {
    readonly position: Readonly<Vector3>;
    readonly velocity: Readonly<Vector3>;
    readonly heading: number;
    readonly speed: number;
  };
  /** Where the ship is headed, or null. Read at once: the object may be the same one every time. */
  target(): HyperTarget | null;
  /** How much of the picture is the star map's, 0 to 1: the map hides all of this. */
  mapWeight(): number;
  /** The lens (degrees, vertical): how big a pixel is among the dashes. */
  camera: { readonly fov: number };
  /** How many dashes (tuning.hyper.dashes, by tier), and whether the tunnel has its thin lines. */
  dashes: number;
  ribs: boolean;
  params?: HyperViewParams;
}

/** Each dash runs at its own pace, between these shares of the flow. */
const RATE: readonly [slowest: number, fastest: number] = [0.6, 1.4];
/**
 * And has a brightness of its own: none dimmer than this share, and most of them dim (the draw is
 * squared), so that a few bright dashes are the picture and the rest are its grain.
 */
const BRIGHTNESS_MIN = 0.2;
/**
 * A dash in a family's colour is never that dim, and as often bright as not: a pastel at a fifth
 * of itself over navy is a grey, and the colours are what a jump is told by.
 */
const COLOUR_MIN = 0.5;
/** rad. How far off the course the ring is at its widest: past the corner of any screen. */
const RING_REACH = 1.3;
/** A dash's four corners: which end (-1 the tail, +1 the head) and which side. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1] as const;
/** u/s. Slower than this the ship has no course to speak of: the tunnel is where it points. */
const COURSE_MIN_SPEED = 20;
/** 1/s. How quickly the tunnel comes round to a new course: it never jumps. */
const COURSE_RATE = 10;
/** The flow at rest, as a share of the flow at the autopilot's top speed. */
const FLOW_AT_REST = 0.35;

/**
 * The dashes' buffers, the same for the same count on every visit (seeded): for each dash a ray
 * round the course, a phase along it, a brightness, a pace and one of the tints; four vertices a
 * dash, two triangles, indices in 16 bits. (design/shaders/hyperspace.ts says what the shader makes of it.)
 */
export function dashBuffers(count: number): {
  position: Float32Array;
  dash: Float32Array;
  index: Uint16Array;
} {
  if (count * 4 > 65536) throw new RangeError(`hyperspace: ${count} dashes do not fit 16 bits`);
  const rng = createRng('hyperspace');
  const tints = HYPER_TINT_SHARES.map((share, tint) => [tint, share] as const);
  const position = new Float32Array(count * 12);
  const dash = new Float32Array(count * 16);
  const index = new Uint16Array(count * 6);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const phase = rng();
    const rate = RATE[0] + (RATE[1] - RATE[0]) * rng();
    const tint = pickWeighted(rng, tints);
    const draw = rng();
    const brightness =
      tint < HYPER_FAMILY_TINT
        ? BRIGHTNESS_MIN + (1 - BRIGHTNESS_MIN) * draw * draw
        : COLOUR_MIN + (1 - COLOUR_MIN) * draw;
    for (let corner = 0; corner < 4; corner += 1) {
      const v = i * 4 + corner;
      position[v * 3] = angle;
      position[v * 3 + 1] = phase;
      position[v * 3 + 2] = brightness;
      dash[v * 4] = CORNERS[corner * 2] ?? 0;
      dash[v * 4 + 1] = CORNERS[corner * 2 + 1] ?? 0;
      dash[v * 4 + 2] = rate;
      dash[v * 4 + 3] = tint;
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  return { position, dash, index };
}

/**
 * HYPERSPACE, AS IT LOOKS. A journey's fast stretch is shown as a jump: dots over the stars
 * stretch into dashes that point away from where the ship is going, half of them in the galaxy's
 * pastels with the destination's in the lead, a tunnel ribbed in that colour opens round the
 * spot, and both go again before the ship arrives. The flight is untouched: this only READS the
 * dock's two fields (sim/hyper.ts) and the ship's pose, and what it shows is decided by one pure
 * function, `hyperLook`. `look` is that frame's answer, for whoever else wears it: the stars
 * and the baked sky's light (main.ts), the lens (camera/ChaseCam.ts), the flame.
 *
 * Two draw calls while it shows and none otherwise, both sky (design/shaders/hyperspace.ts).
 * Not built at all for a visitor who asked for less motion. Add it BEFORE the camera rig, whose
 * lens follows it.
 *
 * What it keeps of its own, a rebuilt engine does not miss: how far the picture has streamed,
 * what it last showed, and when. Any way out of a wind-up or a tunnel (arriving, Stop, the
 * controls, another destination) the picture goes in the same `dropoutSec`; and a jump taken
 * while the last one is still going does not cut that short: it goes on going, under the new one
 * (`under`).
 */
export class Hyperspace implements System {
  readonly object = new Group();

  private readonly scope = new Scope();
  private readonly params: HyperViewParams;
  private readonly tube: Mesh<IcosahedronGeometry, HyperTubeMaterial>;
  private readonly dashes: Mesh<BufferGeometry, HyperDashMaterial>;
  /** What shows this frame, the star map's share taken off. */
  private readonly shown = createHyperLook();
  private readonly raw = createHyperLook();
  /** The last picture of a wind-up or a tunnel: what its way out fades from. */
  private readonly level = createHyperLook();
  private readonly at: LookAt = {
    stage: LOOK_OFF,
    seconds: 0,
    speed: 0,
    topSpeed: 1,
    level: this.level,
    fromTunnel: false,
  };
  /** The simulation time of the last frame a wind-up or a tunnel showed. */
  private lastOn = Number.NEGATIVE_INFINITY;
  /** The jump before this one, where it was still on its way out when this one was taken. */
  private readonly under: LookAt & { level: HyperLook } = {
    ...this.at,
    stage: LOOK_DROPOUT,
    level: createHyperLook(),
  };
  private underFrom = Number.NEGATIVE_INFINITY;
  private readonly rest = createHyperLook();
  private flow = 0;
  private readonly course = new Vector3(0, 0, 1);
  private readonly want = new Vector3();
  /** The destination the picture is dressed for. */
  private dressed: string | null = null;
  /** Drawn once at nothing, so that both programs are compiled before the first jump. */
  private warming = true;
  private heightPx = 1;
  private pixelRatio = 1;

  constructor(private readonly options: HyperspaceOptions) {
    this.params = options.params ?? tuning.hyper;
    const { scope } = this;
    this.object.name = 'hyperspace';

    this.tube = new Mesh(
      scope.track(new IcosahedronGeometry(10, 1)),
      scope.track(createHyperTubeMaterial({ ribs: options.ribs })),
    );
    const buffers = dashBuffers(options.dashes);
    const geometry = scope.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(buffers.position, 3));
    geometry.setAttribute('aDash', new BufferAttribute(buffers.dash, 4));
    geometry.setIndex(new BufferAttribute(buffers.index, 1));
    this.dashes = new Mesh(geometry, scope.track(createHyperDashMaterial()));

    // The sky surrounds the camera: always in view. After the stars (-1), before all else.
    this.tube.frustumCulled = false;
    this.tube.renderOrder = -0.9;
    this.dashes.frustumCulled = false;
    this.dashes.renderOrder = -0.8;
    this.object.add(this.tube, this.dashes);
    scope.onDispose(() => this.object.removeFromParent());
  }

  /** What shows this frame (after this system's turn in it). Read only. */
  get look(): Readonly<HyperLook> {
    return this.shown;
  }

  frameUpdate(frame: Frame): void {
    const { dock, ship } = this.options;
    const { at, params, raw, shown, under } = this;
    // The exact time of this frame: between the last two simulation steps.
    const behind = (1 - frame.alpha) / tuning.loop.stepHz;
    const now = frame.simTime - behind;

    const on = dock.hyper === HYPER_WINDUP || dock.hyper === HYPER_TUNNEL;
    const fresh = at.stage === LOOK_OFF;
    if (on) {
      // A new jump streams from the start (and a number that only grew would lose its digits).
      if (fresh) this.flow = 0;
      else if (at.stage === LOOK_DROPOUT) {
        copyHyperLook(this.level, under.level);
        under.fromTunnel = at.fromTunnel;
        this.underFrom = this.lastOn;
      }
      at.stage = dock.hyper === HYPER_TUNNEL ? LOOK_TUNNEL : LOOK_WINDUP;
      at.seconds = Math.max(0, dock.hyperSec - behind);
      at.fromTunnel = at.stage === LOOK_TUNNEL;
      this.lastOn = now;
    } else if (!fresh) {
      at.seconds = now - this.lastOn;
      at.stage = at.seconds < params.dropoutSec ? LOOK_DROPOUT : LOOK_OFF;
    }
    at.speed = ship.speed;
    at.topSpeed = tuning.cruise.far.cruiseSpeed;
    hyperLook(at, params, raw);
    if (on) {
      // The jump before this one, while it is still going. (Never one from the future: the lab
      // holds a jump at any moment, and puts its clock back to do it.)
      under.seconds = now - this.underFrom;
      if (under.seconds >= 0 && under.seconds < params.dropoutSec) {
        const { rest } = this;
        hyperLook(under, params, rest);
        raw.stretch = Math.max(raw.stretch, rest.stretch);
        raw.dots = Math.max(raw.dots, rest.dots);
        raw.veil = Math.max(raw.veil, rest.veil);
        raw.calm = Math.max(raw.calm, rest.calm);
        raw.drop = rest.drop;
      }
      copyHyperLook(raw, this.level);
    }

    const clear = 1 - clamp(this.options.mapWeight(), 0, 1);
    shown.stretch = raw.stretch * clear;
    shown.dots = raw.dots * clear;
    shown.veil = raw.veil * clear;
    shown.calm = raw.calm * clear;
    shown.surge = raw.surge * clear;
    shown.punch = clear > 0 ? raw.punch : -1;
    shown.drop = clear > 0 ? raw.drop : -1;

    const tube = this.tube.material.uniforms;
    const dashes = this.dashes.material.uniforms;
    this.tube.visible = this.warming || shown.veil > 0 || shown.punch >= 0 || shown.drop >= 0;
    this.dashes.visible = this.warming || shown.dots > 0;
    this.object.visible = this.tube.visible || this.dashes.visible;
    this.warming = false;
    if (!this.object.visible) return;

    // The course: the way the ship is going, or the way it points while it has no speed yet.
    const { course, want } = this;
    if (ship.speed >= COURSE_MIN_SPEED) {
      want.set(ship.velocity.x / ship.speed, 0, ship.velocity.z / ship.speed);
    } else {
      want.set(Math.sin(ship.heading), 0, Math.cos(ship.heading));
    }
    if (fresh) course.copy(want);
    else course.lerp(want, 1 - Math.exp(-COURSE_RATE * frame.dt));
    // (Half way between two opposite courses there is none: take the new one.)
    if (course.lengthSq() < 1e-6) course.copy(want);
    course.normalize();
    tube.uAxis.value.copy(course);
    // Right, up, the course: the plane the dashes lie in faces the course, level.
    dashes.uFrame.value.set(course.z, 0, course.x, 0, 1, 0, -course.x, 0, course.z);

    // Dressed for where it is going while the jump lasts; on its way out it keeps what it wore,
    // whatever the ship is told next.
    const target = this.options.target();
    if (target && on && target.id !== this.dressed) {
      this.dressed = target.id;
      wearHyperFamily(this.tube.material, this.dashes.material, target.theme);
      // A field of its own for every destination.
      dashes.uTwist.value = (hashSeed(target.id) % 4096) / 64;
    }

    if (at.stage === LOOK_TUNNEL) {
      const pace = FLOW_AT_REST + (1 - FLOW_AT_REST) * Math.min(1, at.speed / at.topSpeed);
      this.flow += frame.dt * params.flowPerSec * pace;
    }
    tube.uFlow.value = this.flow;
    tube.uOpen.value = shown.veil;
    // The ring, round the course like the tunnel: out from the eye as the tunnel opens, fading as
    // it goes; back onto the eye as the tunnel closes, all but unseen while it is wide (the square)
    // and gone as it gets there. (Never one sweep of cream across the whole view.)
    const { punch, drop } = shown;
    const ring = params.ringAlpha * clear;
    if (punch >= 0) tube.uRing.value.set(punch * RING_REACH, ring * (1 - punch));
    else if (drop >= 0) {
      tube.uRing.value.set(
        (1 - drop) * RING_REACH,
        ring * drop * drop * Math.min(1, 6 * (1 - drop)),
      );
    } else tube.uRing.value.set(0, 0);
    tube.uBands.value = params.bands;
    tube.uEye.value = params.eyeRad;
    tube.uWash.value.set(params.wash[0], params.wash[1]);
    tube.uRibAlpha.value = params.ribAlpha;

    dashes.uFlow.value = this.flow;
    dashes.uStretch.value = shown.stretch;
    dashes.uAlpha.value = shown.dots;
    dashes.uLength.value = params.dashLength;
    // The plane of the dashes is, near enough, the screen's: one CSS pixel in its units.
    const cssPixel = (2 * Math.tan((this.options.camera.fov * Math.PI) / 360)) / this.heightPx;
    dashes.uWidth.value = params.dashWidthPx * cssPixel;
    dashes.uPixel.value = cssPixel / this.pixelRatio;
  }

  resize(viewport: Viewport): void {
    this.heightPx = Math.max(1, viewport.height);
    this.pixelRatio = Math.max(1e-3, viewport.pixelRatio);
  }

  dispose(): void {
    this.scope.dispose();
  }
}
