import {
  BufferAttribute,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type Vector3,
} from 'three';
import type { Frame, System } from '../core/Engine';
import { Scope } from '../core/scope';
import {
  airColor,
  cloudColor,
  createAirShellMaterial,
  createCloudMaterial,
  type AirShellMaterial,
  type CloudMaterial,
} from '../design/materials';
import type { AirKey, BiomeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { cloudCut, cloudSeed } from '../sim/clouds';

/** A world with air, as its shell and its clouds need to know it. */
export interface AirWorldView {
  /** Its manifest id: where in the noise its clouds are cut from. */
  readonly id: string;
  /** Its row in `positions` and `scales`. */
  readonly row: number;
  /** Its radius (u). */
  readonly radius: number;
  readonly air: AirKey;
  /** Where its light is: READ every frame, never kept (a sun of a binary moves). */
  readonly light: Readonly<Vector3>;
  /** Its clouds, if this tier draws them: how much of its sky, and the biome whose peak colours them. */
  readonly cloud?: { readonly share: number; readonly peak: BiomeKey } | undefined;
}

export interface AirShellsOptions {
  readonly worlds: readonly AirWorldView[];
  /** Where every body is this frame, [x0, z0, x1, z1, ...] (world/Galaxy.ts). Read, never kept. */
  readonly positions: ArrayLike<number>;
  /** How big each body is drawn this frame, as a factor on its size (the star map's). */
  readonly scales: ArrayLike<number>;
  /** The low quality tier: fewer rings. */
  readonly low: boolean;
  /** The clouds hold still. */
  readonly reducedMotion: boolean;
}

/** The corners of a quad, two triangles: the shader puts it round its world. */
const CORNERS = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
const TRIANGLES = [0, 1, 2, 2, 1, 3];

/** One instanced draw: where its worlds are, and where their lights are. */
interface Draw {
  readonly worlds: readonly AirWorldView[];
  readonly centers: InstancedBufferAttribute;
  readonly lights: InstancedBufferAttribute;
}

/**
 * THE AIR of the worlds that have it ("Deep light", docs/DESIGN.md): their shells (one draw call
 * of instanced quads) and their clouds (one of instanced balls), whichever worlds there are. Add
 * it AFTER the galaxy: each frame it reads where the worlds and their lights are and how big
 * they are drawn. Nothing here is state: air is its world's name, the tokens, the tuning and the
 * time, so a rebuilt engine draws the same.
 */
export class AirShells implements System {
  readonly object = new Group();
  private readonly scope = new Scope();
  private readonly shell: AirShellMaterial;
  private readonly clouds: CloudMaterial | null = null;
  private readonly draws: Draw[] = [];

  constructor(private readonly options: AirShellsOptions) {
    const { worlds } = options;
    this.object.name = 'air';
    this.shell = this.scope.track(createAirShellMaterial({ low: options.low }));

    const quads = new InstancedBufferGeometry();
    quads.setAttribute('position', new BufferAttribute(CORNERS, 3));
    quads.setIndex(TRIANGLES);
    quads.setAttribute(
      'aAir',
      new InstancedBufferAttribute(
        Float32Array.from(worlds.flatMap(({ air }) => airColor(air).toArray())),
        3,
      ),
    );
    // After the suns' coronas and before every other see-through thing (the orbit lines, the
    // dust, a flame); the clouds first, so that the hairline lies over a cloud on the outline.
    this.add(quads, this.shell, worlds, 'shells', -0.3);

    const cloudy = worlds.filter((world) => world.cloud !== undefined);
    if (cloudy.length > 0) {
      const { cloud } = tuning.look.air;
      this.clouds = this.scope.track(createCloudMaterial({ motion: !options.reducedMotion }));
      const ball = this.scope.track(new IcosahedronGeometry(1, cloud.detail));
      const balls = new InstancedBufferGeometry();
      balls.setAttribute('position', ball.getAttribute('position'));
      balls.setAttribute(
        'aCloud',
        new InstancedBufferAttribute(
          Float32Array.from(
            cloudy.flatMap(({ air, cloud: sky }) =>
              cloudColor(air, sky?.peak ?? 'frost').toArray(),
            ),
          ),
          3,
        ),
      );
      // Its place in the noise, its threshold, and the turn it starts at (its place again: each
      // world's clouds start turned their own way).
      balls.setAttribute(
        'aSky',
        new InstancedBufferAttribute(
          Float32Array.from(
            cloudy.flatMap(({ id, cloud: sky }) => {
              const seed = cloudSeed(id);
              return [seed, cloudCut(sky?.share ?? 0, cloud), seed];
            }),
          ),
          3,
        ),
      );
      this.add(balls, this.clouds, cloudy, 'clouds', -0.4);
    }
    this.scope.onDispose(() => this.object.removeFromParent());
    this.place();
  }

  /** The star map is a flat thing (0 = flying, 1 = on the map): no air on it, and no clouds. */
  setCalm(calm: number): void {
    this.shell.uniforms.uCalm.value = calm;
    if (this.clouds) this.clouds.uniforms.uCalm.value = calm;
    this.object.visible = calm < 1;
  }

  frameUpdate(frame: Frame): void {
    this.place();
    // The exact simulation time of this frame, as the galaxy places its bodies by.
    const time = frame.simTime - (1 - frame.alpha) / tuning.loop.stepHz;
    if (this.clouds) this.clouds.uniforms.uTime.value = Math.max(0, time);
  }

  dispose(): void {
    this.scope.dispose();
  }

  private add(
    geometry: InstancedBufferGeometry,
    material: AirShellMaterial | CloudMaterial,
    worlds: readonly AirWorldView[],
    name: string,
    renderOrder: number,
  ): void {
    const centers = new InstancedBufferAttribute(new Float32Array(worlds.length * 4), 4);
    const lights = new InstancedBufferAttribute(new Float32Array(worlds.length * 3), 3);
    centers.setUsage(DynamicDrawUsage);
    lights.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCenter', centers);
    geometry.setAttribute('aLight', lights);
    geometry.instanceCount = worlds.length;
    const mesh = new Mesh(this.scope.track(geometry), material);
    mesh.name = name;
    // The instances are wherever their worlds are, which the mesh's own bounds know nothing of.
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.visible = worlds.length > 0;
    this.object.add(mesh);
    this.draws.push({ worlds, centers, lights });
  }

  private place(): void {
    const { positions, scales } = this.options;
    for (const { worlds, centers, lights } of this.draws) {
      worlds.forEach(({ row, radius, light }, i) => {
        centers.array[i * 4] = positions[row * 2] ?? 0;
        centers.array[i * 4 + 1] = 0;
        centers.array[i * 4 + 2] = positions[row * 2 + 1] ?? 0;
        centers.array[i * 4 + 3] = radius * (scales[row] ?? 1);
        lights.array[i * 3] = light.x;
        lights.array[i * 3 + 1] = light.y;
        lights.array[i * 3 + 2] = light.z;
      });
      centers.needsUpdate = true;
      lights.needsUpdate = true;
    }
  }
}
