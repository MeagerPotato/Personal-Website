import { Matrix4, type PerspectiveCamera } from 'three';
import type { System, Viewport } from '../core/Engine';
import { createScreenMap, projectBodies, type ScreenMap } from '../sim/screen';

export interface BodiesOnScreenOptions {
  camera: PerspectiveCamera;
  /** Where every body is THIS frame, by row of the orbit table: [x0, z0, x1, z1, ...]. */
  positions: ArrayLike<number>;
  /** How big every body is, by row. */
  radii: ArrayLike<number>;
  /** How big every body is DRAWN this frame, as a factor on that, by row (world/Galaxy.ts). */
  scales?: ArrayLike<number>;
  count: number;
}

/**
 * Where every body is on screen, worked out once a frame for whoever asks (ui/Picker.ts, and the
 * labels). Add it AFTER the camera rig and the galaxy, so that the map is of the picture that is
 * about to be drawn; between frames it is the map of the picture the visitor is looking at, which
 * is the one a click is about.
 */
export class BodiesOnScreen implements System {
  readonly map: ScreenMap;

  private readonly viewProjection = new Matrix4();
  private readonly point = createScreenMap(1);
  private readonly pointXZ = new Float64Array(2);
  private readonly noRadius = new Float64Array(1);
  private width = 1;
  private height = 1;

  constructor(private readonly options: BodiesOnScreenOptions) {
    this.map = createScreenMap(options.count);
  }

  frameUpdate(): void {
    const { camera, positions, radii, scales, count } = this.options;
    // The rig has just moved the camera; the renderer would only work this out when it draws.
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    projectBodies(
      this.viewProjection.elements,
      camera.projectionMatrix.elements[5] ?? 1,
      this.width,
      this.height,
      positions,
      radii,
      count,
      this.map,
      scales,
    );
  }

  /**
   * Where a point of the flight plane (the ship, say) is in the picture of this frame, CSS px into
   * `out`; false if it is not in front of the camera. Ask after this system's frameUpdate.
   */
  pointAt(x: number, z: number, out: { x: number; y: number }): boolean {
    const { camera } = this.options;
    this.pointXZ[0] = x;
    this.pointXZ[1] = z;
    projectBodies(
      this.viewProjection.elements,
      camera.projectionMatrix.elements[5] ?? 1,
      this.width,
      this.height,
      this.pointXZ,
      this.noRadius,
      1,
      this.point,
    );
    if (!((this.point.depth[0] ?? 0) > 0)) return false;
    out.x = this.point.x[0] ?? 0;
    out.y = this.point.y[0] ?? 0;
    return true;
  }

  resize(viewport: Viewport): void {
    this.width = viewport.width;
    this.height = viewport.height;
  }

  dispose(): void {
    // Owns nothing.
  }
}
