import { Vector3, type Object3D } from 'three';
import type { AssetStore } from '../core/AssetStore';
import type { Frame, System } from '../core/Engine';
import { Scope } from '../core/scope';
import { tuning } from '../design/tuning';
import { copyShipState, createShipState, stepFlight } from '../sim/flight';
import { TAU, lerp, smoothstep } from '../sim/math';
import { createSpring, stepSpring } from '../sim/spring';
import type { FlightInput, ShipState } from '../sim/types';
import { EngineFlame, type FlameParams } from './EngineFlame';
import { Rocket } from './Rocket';

/** Whoever flies the ship: the merged input devices now, the autopilot too from Phase 2. */
export interface Pilot {
  readonly current: Readonly<FlightInput>;
}

export interface ShipLookParams {
  readonly spawn: { readonly x: number; readonly z: number; readonly headingDeg: number };
  readonly bankRad: number;
  readonly bankFullSpeed: number;
  readonly pitchBoostDeg: number;
  readonly pitchBrakeDeg: number;
  readonly pitchOmega: number;
  readonly bobAmplitude: number;
  readonly bobHz: number;
  readonly flame: FlameParams;
}

export interface ShipOptions {
  pilot: Pilot;
  assets: AssetStore;
  reducedMotion: boolean;
}

const RAD_PER_DEG = Math.PI / 180;

/**
 * The ship: steps the flight model at the fixed rate, and each frame draws the ship BETWEEN the
 * last two simulated states (core/Engine.ts explains why). Everything public here is that
 * in-between pose: it is what the camera, the dust and the HUD should follow.
 */
export class ShipSystem implements System {
  /** Interpolated, world space. The ship flies on the y = 0 plane. */
  readonly position = new Vector3();
  /** Interpolated, units per second. */
  readonly velocity = new Vector3();
  /** Interpolated, unwrapped radians (sim/types.ts). */
  heading = 0;
  yawRate = 0;
  speed = 0;

  private readonly scope = new Scope();
  private readonly rocket: Rocket;
  private readonly flame: EngineFlame;
  private readonly previous: ShipState;
  private readonly current: ShipState;
  private readonly pitch = createSpring(0);

  constructor(private readonly options: ShipOptions) {
    const look = tuning.ship;
    this.current = createShipState(look.spawn.x, look.spawn.z, look.spawn.headingDeg * RAD_PER_DEG);
    this.previous = copyShipState(this.current, createShipState());

    this.rocket = new Rocket(options.assets, this.scope);
    this.flame = new EngineFlame(
      options.assets,
      this.rocket.engine,
      this.scope,
      look.flame,
      !options.reducedMotion,
    );
    this.present(1, 0, 0);
  }

  /** Add this to the scene. */
  get object(): Object3D {
    return this.rocket.object;
  }

  /** The latest SIMULATED state, for logic that steps with the simulation. Read only. */
  get state(): Readonly<ShipState> {
    return this.current;
  }

  /** Put the ship somewhere at rest, with no in-between frame (spawning, deep links). */
  placeAt(x: number, z: number, heading: number): void {
    this.restore(createShipState(x, z, heading));
  }

  /** Put the ship into an exact state, speed and spin included (replays, later snapshots). */
  restore(state: Readonly<ShipState>): void {
    copyShipState(state, this.current);
    copyShipState(state, this.previous);
  }

  fixedUpdate(dt: number): void {
    copyShipState(this.current, this.previous);
    stepFlight(this.current, this.options.pilot.current, tuning.flight, dt);
  }

  frameUpdate(frame: Frame): void {
    this.present(frame.alpha, frame.dt, frame.elapsed);
    this.flame.update(this.options.pilot.current, frame);
  }

  dispose(): void {
    this.scope.dispose();
  }

  private present(alpha: number, frameSec: number, elapsed: number): void {
    const { previous: a, current: b } = this;
    this.position.set(lerp(a.x, b.x, alpha), 0, lerp(a.z, b.z, alpha));
    this.velocity.set(lerp(a.vx, b.vx, alpha), 0, lerp(a.vz, b.vz, alpha));
    this.heading = lerp(a.heading, b.heading, alpha);
    this.yawRate = lerp(a.yawRate, b.yawRate, alpha);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.rocket.place(this.position, this.heading);

    // Looks only, from here on. A left turn (yawRate > 0) drops the left wing: negative bank.
    const look = tuning.ship;
    const bank =
      -look.bankRad *
      (this.yawRate / tuning.flight.yawRateSlow) *
      smoothstep(0, look.bankFullSpeed, this.speed);

    const input = this.options.pilot.current;
    const nod =
      input.brake > 0
        ? look.pitchBrakeDeg * input.brake
        : input.boost && input.thrust > 0
          ? -look.pitchBoostDeg
          : 0;
    stepSpring(this.pitch, nod * RAD_PER_DEG, look.pitchOmega, frameSec);

    const bob = this.options.reducedMotion
      ? 0
      : look.bobAmplitude * Math.sin(TAU * look.bobHz * elapsed);
    this.rocket.lean(bank, this.pitch.value, bob);
  }
}
