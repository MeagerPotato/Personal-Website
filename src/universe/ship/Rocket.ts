import { Group, type Object3D, type Vector3 } from 'three';
import type { AssetStore } from '../core/AssetStore';
import type { Scope } from '../core/scope';
import { createToonMaterial, type ToonMaterial } from '../design/materials';

/**
 * The rocket as the world sees it, in two nested nodes:
 *
 *   object  WHERE the ship is and where its nose points. This is the simulation's truth.
 *   tilt    how it LEANS: bank, nod and bob. Looks only; nothing reads it back.
 *
 * Keeping the two apart is what lets the ship lean into a turn while the flight model, the camera
 * and (later) docking all see a ship that is perfectly level.
 */
export class Rocket {
  readonly object = new Group();
  /** Where the flame attaches. */
  readonly engine: Object3D;

  private readonly tilt = new Group();
  private readonly material: ToonMaterial;
  private raised = 0;

  constructor(assets: AssetStore, scope: Scope) {
    this.material = scope.track(createToonMaterial({ vertexColors: true }));
    const handle = assets.acquire('rocket', this.material);
    scope.onDispose(() => {
      handle.release();
      this.object.removeFromParent();
    });

    this.engine = handle.socket('engine');
    this.tilt.add(handle.object);
    this.object.add(this.tilt);
    this.object.name = 'ship';
  }

  place(position: Readonly<Vector3>, heading: number): void {
    this.object.position.copy(position);
    this.object.position.y += this.raised;
    // The universe's angle convention IS three's rotation.y (sim/types.ts).
    this.object.rotation.y = heading;
  }

  /**
   * The ship as a MARKER (the star map): drawn `scale` times its size, `raised` units above the
   * flight plane so that it lies on top of whatever it is beside. Looks only, like the lean.
   */
  mark(scale: number, raised: number): void {
    this.object.scale.setScalar(scale);
    this.raised = raised;
  }

  /** `bank` > 0 rolls the LEFT wing up; `pitch` > 0 drops the nose; `lift` raises the model. */
  lean(bank: number, pitch: number, lift: number): void {
    this.tilt.rotation.set(pitch, 0, bank);
    this.tilt.position.y = lift;
  }

  /** The light that shades the ship: the sun of whichever system it is in. */
  setSun(position: Readonly<Vector3>): void {
    this.material.uniforms.uSunPosition.value.copy(position);
  }
}
