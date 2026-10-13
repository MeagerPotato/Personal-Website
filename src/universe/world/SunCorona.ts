import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
} from 'three';
import type { Frame, System } from '../core/Engine';
import { Scope } from '../core/scope';
import { createCoronaMaterial, sunTones, type CoronaMaterial } from '../design/materials';
import type { ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';

/** A sun, as its corona needs to know it. */
export interface CoronaSun {
  /** Its row in `positions` and `scales`. */
  readonly row: number;
  readonly family: ThemeKey;
  /** Its ball's radius (u). */
  readonly radius: number;
  /** Its own number (sim/sunSurface.ts, `sunSeed`): how its rays and loops lie. */
  readonly seed: number;
  /**
   * A living sun has everything; a plain one (the Hardware sun, a ball of gears) only the halo
   * steps and the glow, which leave its gears alone.
   */
  readonly living: boolean;
}

export interface SunCoronaOptions {
  readonly suns: readonly CoronaSun[];
  /** Where every body is this frame, [x0, z0, x1, z1, ...] (world/Galaxy.ts). Read, never kept. */
  readonly positions: ArrayLike<number>;
  /** How big each body is drawn this frame, as a factor on its size (the star map's). */
  readonly scales: ArrayLike<number>;
  /** The low quality tier: fewer rays, no prominences, no glint. */
  readonly low: boolean;
  /** Nothing breathes: the rays and the loops hold the frame of time zero. */
  readonly reducedMotion: boolean;
}

/** The corners of a quad, two triangles: the shader puts it round its sun. */
const CORNERS = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
const TRIANGLES = [0, 1, 2, 2, 1, 3];
/** The attributes of a sun's tones, in the order of its ladder (sim/sunSurface.ts). */
const TONES = ['aShade', 'aBase', 'aLight', 'aHot'] as const;
/** A quad's layer, as the shader reads it (design/shaders/corona.ts). */
const LAYER = { plain: 0, light: 1, lens: 2 } as const;

/**
 * THE CORONAS: the light round every sun, one draw call of instanced quads (two a living sun:
 * its light behind what it wears, its lens in front of its ball; one a plain sun). Add it AFTER
 * the galaxy: each frame it reads where the suns are and how big they are drawn. Nothing here is
 * state: a corona is its sun's seed, the tokens, the tuning and the time, so a rebuilt engine
 * draws the same.
 */
export class SunCorona implements System {
  readonly object: Mesh<InstancedBufferGeometry, CoronaMaterial>;
  private readonly scope = new Scope();
  private readonly centers: InstancedBufferAttribute;
  /** The sun of each quad. */
  private readonly quads: CoronaSun[] = [];

  constructor(private readonly options: SunCoronaOptions) {
    const layers: number[] = [];
    for (const sun of options.suns) {
      this.quads.push(sun);
      layers.push(sun.living ? LAYER.light : LAYER.plain);
      if (sun.living) {
        this.quads.push(sun);
        layers.push(LAYER.lens);
      }
    }
    const count = this.quads.length;
    // The first four tones of each sun's ladder (shade, base, light, hot), in DISPLAY space,
    // where the shader lays its parts over each other as paint.
    const tones = TONES.map(() => new Float32Array(count * 3));
    this.quads.forEach(({ family }, i) => {
      const ladder = sunTones(family);
      tones.forEach((values, tone) => {
        const { x, y, z } = ladder[tone] ?? ladder[0] ?? { x: 0, y: 0, z: 0 };
        new Color(x, y, z).convertLinearToSRGB().toArray(values, i * 3);
      });
    });
    const suns = new Float32Array(count * 2);
    this.quads.forEach(({ seed }, i) => suns.set([seed, layers[i] ?? 0], i * 2));

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(CORNERS, 3));
    geometry.setIndex(TRIANGLES);
    this.centers = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.centers.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCenter', this.centers);
    TONES.forEach((name, i) => {
      geometry.setAttribute(name, new InstancedBufferAttribute(tones[i] ?? new Float32Array(), 3));
    });
    geometry.setAttribute('aSun', new InstancedBufferAttribute(suns, 2));
    geometry.instanceCount = count;

    const material = this.scope.track(createCoronaMaterial({ low: options.low }));
    this.object = new Mesh(this.scope.track(geometry), material);
    this.object.name = 'coronas';
    // The quads are wherever their suns are, which the mesh's own bounds know nothing of.
    this.object.frustumCulled = false;
    // After the stars, which it veils; before every other see-through thing (the orbit lines,
    // the dust, a flame), which are drawn over it.
    this.object.renderOrder = -0.5;
    this.scope.onDispose(() => this.object.removeFromParent());
    this.place();
  }

  /** The star map is a calm thing (0 = flying, 1 = on the map): only the halo's steps are left. */
  setCalm(calm: number): void {
    this.object.material.uniforms.uCalm.value = calm;
  }

  frameUpdate(frame: Frame): void {
    this.place();
    // The exact simulation time of this frame, as the galaxy places its bodies by.
    const time = frame.simTime - (1 - frame.alpha) / tuning.loop.stepHz;
    this.object.material.uniforms.uTime.value = this.options.reducedMotion ? 0 : Math.max(0, time);
  }

  dispose(): void {
    this.scope.dispose();
  }

  private place(): void {
    const { positions, scales } = this.options;
    const centers = this.centers.array;
    this.quads.forEach(({ row, radius }, i) => {
      centers[i * 4] = positions[row * 2] ?? 0;
      centers[i * 4 + 1] = 0;
      centers[i * 4 + 2] = positions[row * 2 + 1] ?? 0;
      centers[i * 4 + 3] = radius * (scales[row] ?? 1);
    });
    this.centers.needsUpdate = true;
  }
}
