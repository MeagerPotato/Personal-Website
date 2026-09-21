import type { Object3D } from 'three';
import type { AssetHandle, AssetStore } from '../core/AssetStore';
import type { Frame } from '../core/Engine';
import type { Scope } from '../core/scope';
import { createGlowMaterial } from '../design/materials';
import { approach, lerp } from '../sim/math';
import type { FlightInput } from '../sim/types';

export interface FlameParams {
  readonly width: number;
  readonly lengthCruise: number;
  readonly lengthBoost: number;
  readonly boostWidthFactor: number;
  readonly responsePerSec: number;
  readonly flicker: number;
  readonly intensity: number;
}

/**
 * The flame behind the ship: the pilot's throttle, made visible. The model is one unit long and
 * wide (design/models/flame.ts); this only scales it, so restyling the flame never touches this.
 */
export class EngineFlame {
  private readonly handle: AssetHandle;
  private throttle = 0;
  private boost = 0;

  constructor(
    assets: AssetStore,
    socket: Object3D,
    scope: Scope,
    private readonly params: FlameParams,
    /** The flicker is motion for its own sake. */
    private readonly flickers: boolean,
  ) {
    const material = scope.track(createGlowMaterial({ intensity: params.intensity }));
    this.handle = assets.acquire('flame', material);
    scope.onDispose(() => this.handle.release());
    this.handle.object.visible = false;
    socket.add(this.handle.object);
  }

  update(input: Readonly<FlightInput>, frame: Frame): void {
    const { params } = this;
    this.throttle = approach(this.throttle, input.thrust, params.responsePerSec, frame.dt);
    const boosting = input.boost && input.thrust > 0 ? 1 : 0;
    this.boost = approach(this.boost, boosting, params.responsePerSec, frame.dt);

    const flame = this.handle.object;
    flame.visible = this.throttle > 0.01;
    if (!flame.visible) return;

    // Two sines that never line up: cheap, deterministic, and restless enough for a flame.
    const t = frame.elapsed;
    const wobble = this.flickers ? 0.6 * Math.sin(t * 41) + 0.4 * Math.sin(t * 67 + 1.3) : 0;
    const length =
      this.throttle *
      lerp(params.lengthCruise, params.lengthBoost, this.boost) *
      (1 + params.flicker * wobble);
    // Full width almost at once, so a tap of the throttle shows; the length carries the rest.
    const width =
      params.width * lerp(1, params.boostWidthFactor, this.boost) * Math.min(1, this.throttle * 3);
    flame.scale.set(width, width, length);
  }
}
