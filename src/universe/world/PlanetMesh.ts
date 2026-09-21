import { Mesh, type BufferGeometry, type Material } from 'three';
import { geometryFrom } from '../core/geometry';
import type { JobQueue } from '../core/jobs';
import { tuning } from '../design/tuning';
import { generatePlanet, type PlanetBands, type PlanetLook } from '../sim/planet';

export interface PlanetMeshOptions {
  radius: number;
  seed: string;
  bands: PlanetBands;
  look: PlanetLook;
  /** Detail of the everyday mesh. */
  detail: number;
  /** Detail of the close-up mesh, or null for a body that never needs one (moons, suns). */
  nearDetail: number | null;
  material: Material;
  jobs: JobQueue;
}

/**
 * One generated world and its two levels of detail. The everyday mesh is built once, a slice per
 * frame (core/jobs.ts), and the body is invisible until it exists: that is a few frames, under the
 * fade-in. When the ship comes close a finer mesh is built the same way and swapped in; when the
 * ship has been away for a while it is freed again, so GPU memory stays flat however long a
 * visitor flies around.
 */
export class PlanetMesh {
  readonly mesh: Mesh;

  private everyday: BufferGeometry | null = null;
  private closeUp: BufferGeometry | null = null;
  private cancelJob: (() => void) | null = null;
  private awaySec = 0;
  private disposed = false;

  constructor(private readonly options: PlanetMeshOptions) {
    this.mesh = new Mesh(undefined, options.material);
    this.mesh.visible = false;
    this.cancelJob = this.build(options.detail, (geometry) => {
      this.everyday = geometry;
      this.show(this.closeUp ?? geometry);
    });
  }

  /** `distanceRadii`: how far the viewer is from the centre, in radii of this body. */
  update(distanceRadii: number, dt: number): void {
    const { nearDetail } = this.options;
    if (nearDetail === null || this.disposed) return;
    const { nearEnterRadii, nearExitRadii, nearLingerSec } = tuning.world;

    if (distanceRadii < nearEnterRadii) {
      this.awaySec = 0;
      // One job at a time: the close-up waits for the everyday mesh to exist.
      if (!this.closeUp && !this.cancelJob && this.everyday) {
        this.cancelJob = this.build(nearDetail, (geometry) => {
          this.closeUp = geometry;
          this.show(geometry);
        });
      }
    } else if (distanceRadii > nearExitRadii && this.closeUp) {
      this.awaySec += dt;
      if (this.awaySec > nearLingerSec && this.everyday) {
        this.show(this.everyday);
        this.closeUp.dispose();
        this.closeUp = null;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelJob?.();
    this.cancelJob = null;
    this.everyday?.dispose();
    this.closeUp?.dispose();
    this.mesh.removeFromParent();
  }

  private build(detail: number, done: (geometry: BufferGeometry) => void): () => void {
    const { radius, seed, bands, look, jobs } = this.options;
    return jobs.add(generatePlanet({ radius, seed, detail, bands }, look), (data) => {
      this.cancelJob = null;
      if (this.disposed) return;
      done(geometryFrom(data));
    });
  }

  private show(geometry: BufferGeometry): void {
    this.mesh.geometry = geometry;
    this.mesh.visible = true;
  }
}
