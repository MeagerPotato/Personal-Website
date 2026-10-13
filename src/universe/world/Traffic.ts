import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
} from 'three';
import type { Frame, System, Viewport } from '../core/Engine';
import { Scope } from '../core/scope';
import { createTrafficMaterial, trafficColor, type TrafficMaterial } from '../design/materials';
import type { ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import type { OrbitTable } from '../sim/orbits';
import { placeTraffic, trafficDots, type TrafficDots } from '../sim/traffic';

export interface TrafficOptions {
  /** The orbits the galaxy draws its lines from. */
  readonly orbits: OrbitTable;
  /**
   * The family each body's orbit line wears, by row of the orbit table; none for an orbit with no
   * traffic (a relay's: nothing docks there, so nothing goes there).
   */
  readonly families: ReadonlyArray<ThemeKey | undefined>;
  /** Where every body is this frame, [x0, z0, x1, z1, ...] (world/Galaxy.ts). Read, never kept. */
  readonly positions: ArrayLike<number>;
  /** How big each body is drawn this frame (the star map's): no dots on an orbit of one it hides. */
  readonly scales: ArrayLike<number>;
  /** The dots rest where they start. */
  readonly reducedMotion: boolean;
}

/** The corners of a quad, two triangles: the shader puts it round its dot, facing the screen. */
const CORNERS = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
const TRIANGLES = [0, 1, 2, 2, 1, 3];

/**
 * TRAFFIC: two dots on every orbit line, one each way, in the line's family's light: one draw
 * call of instanced quads. Add it AFTER the galaxy: each frame it reads where the bodies are. Nothing
 * here is state: a dot is its orbit's id, the tuning and the time (sim/traffic.ts), so a rebuilt
 * engine draws the same dots where the old one had them.
 */
export class Traffic implements System {
  readonly object: Mesh<InstancedBufferGeometry, TrafficMaterial>;
  private readonly scope = new Scope();
  private readonly dots: TrafficDots;
  /** [x, size, z] a dot: the shader's `aDot` (design/shaders/traffic.ts). */
  private readonly places: InstancedBufferAttribute;

  constructor(private readonly options: TrafficOptions) {
    const { orbits, families } = options;
    this.dots = trafficDots(orbits, (row) => families[row] !== undefined, tuning.look.traffic);
    const { count } = this.dots;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const family = families[this.dots.row[i] ?? 0];
      if (family !== undefined) trafficColor(family).toArray(colors, i * 3);
    }
    const geometry = this.scope.track(new InstancedBufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(CORNERS, 3));
    geometry.setIndex(TRIANGLES);
    this.places = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.places.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aDot', this.places);
    geometry.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
    geometry.instanceCount = count;
    this.object = new Mesh(geometry, this.scope.track(createTrafficMaterial()));
    this.object.name = 'traffic';
    // The dots are wherever their orbits are, which the mesh's own bounds know nothing of.
    this.object.frustumCulled = false;
    // Over the orbit lines they ride.
    this.object.renderOrder = 1;
    this.scope.onDispose(() => this.object.removeFromParent());
    this.place(0);
  }

  frameUpdate(frame: Frame): void {
    // The exact simulation time of this frame, as the galaxy places its bodies by.
    const time = frame.simTime - (1 - frame.alpha) / tuning.loop.stepHz;
    this.place(this.options.reducedMotion ? 0 : Math.max(0, time));
  }

  resize(viewport: Viewport): void {
    const { width, height, pixelRatio } = viewport;
    this.object.material.uniforms.uView.value.set(
      width * pixelRatio,
      height * pixelRatio,
      pixelRatio,
    );
  }

  dispose(): void {
    this.scope.dispose();
  }

  private place(time: number): void {
    const { orbits, positions, scales } = this.options;
    placeTraffic(this.dots, orbits, positions, scales, time, this.places.array as Float32Array);
    this.places.needsUpdate = true;
  }
}
