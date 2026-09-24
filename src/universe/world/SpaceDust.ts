import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Vector3,
} from 'three';
import type { System } from '../core/Engine';
import { Scope } from '../core/scope';
import { createDustMaterial, type DustMaterial } from '../design/materials';
import { tuning } from '../design/tuning';
import { slideField } from '../sim/dustField';
import { createRng } from '../sim/rng';

/** Whoever the dust surrounds: the ship. */
export interface DustViewer {
  readonly position: Readonly<Vector3>;
  /** World units per second: it sets the direction and length of the streaks. */
  readonly velocity: Readonly<Vector3>;
}

export interface SpaceDustOptions {
  viewer: DustViewer;
  coarsePointer: boolean;
  reducedMotion: boolean;
}

/**
 * The motes that slide past the ship (the look, and the endless-field trick, live in
 * design/shaders/dust.ts). This class only builds the instanced quads, and each frame tells the
 * shader where the viewer is and how fast it moves. Add it AFTER the viewer.
 */
export class SpaceDust implements System {
  readonly object: Mesh<InstancedBufferGeometry, DustMaterial>;
  private readonly scope = new Scope();
  /** Where the viewer was last frame. */
  private readonly last = new Vector3();

  constructor(private readonly options: SpaceDustOptions) {
    const params = tuning.dust;
    const count = options.coarsePointer ? params.countCoarse : params.count;
    const rng = createRng(params.seed);

    const seeds = new Float32Array(count * 3);
    const styles = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      seeds[i * 3] = rng();
      seeds[i * 3 + 1] = rng();
      seeds[i * 3 + 2] = rng();
      styles[i * 2] = 1 + (rng() * 2 - 1) * params.sizeVariation;
      styles[i * 2 + 1] = params.brightnessMin + (1 - params.brightnessMin) * rng();
    }

    const geometry = this.scope.track(new InstancedBufferGeometry());
    // One quad, two triangles. x: -1 is the head end of a streak, +1 the tail end; y: the sides.
    const corners = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    geometry.setAttribute('position', new BufferAttribute(corners, 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 3));
    geometry.setAttribute('aStyle', new InstancedBufferAttribute(styles, 2));
    geometry.instanceCount = count;

    // Streaks are motion for its own sake: round motes only under reduced motion.
    const material = this.scope.track(createDustMaterial({ streaks: !options.reducedMotion }));
    this.object = new Mesh(geometry, material);
    this.object.frustumCulled = false; // the field is wherever the viewer is
    this.object.matrixAutoUpdate = false;
    this.scope.onDispose(() => this.object.removeFromParent());
  }

  /** How much of the dust shows, 0 to 1. None on the star map: from up there it is only noise. */
  setPresence(presence: number): void {
    this.object.visible = presence > 0;
    this.object.material.uniforms.uOpacity.value = tuning.dust.opacity * presence;
  }

  frameUpdate(): void {
    const { uCenter, uField, uVelocity } = this.object.material.uniforms;
    const { position, velocity } = this.options.viewer;
    const params = tuning.dust;
    // The field keeps up with the ship only so fast (sim/dustField.ts), and the streaks show
    // what it does keep up with.
    const share = slideField(
      uField.value,
      this.last,
      position,
      velocity.length(),
      params.maxFieldSpeed,
      params.box,
    );
    this.last.copy(position);
    uCenter.value.copy(position);
    uVelocity.value.copy(velocity).multiplyScalar(share);
  }

  dispose(): void {
    this.scope.dispose();
  }
}
