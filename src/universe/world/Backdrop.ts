import { IcosahedronGeometry, Mesh } from 'three';
import type { System } from '../core/Engine';
import { Scope } from '../core/scope';
import { createBackdropMaterial } from '../design/materials';

/**
 * The sky behind the stars: one shaded ball around the camera. Its shader ignores where the
 * camera IS and draws at the far plane (design/shaders/sky.ts), so it needs no update per frame
 * and costs one draw call.
 */
export class Backdrop implements System {
  readonly object: Mesh;
  private readonly scope = new Scope();

  constructor() {
    // Only directions matter, so the size is arbitrary; it just has to clear the near plane.
    const geometry = this.scope.track(new IcosahedronGeometry(10, 3));
    const material = this.scope.track(createBackdropMaterial());
    this.object = new Mesh(geometry, material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -2;
    this.object.matrixAutoUpdate = false;
    this.scope.onDispose(() => this.object.removeFromParent());
  }

  dispose(): void {
    this.scope.dispose();
  }
}
