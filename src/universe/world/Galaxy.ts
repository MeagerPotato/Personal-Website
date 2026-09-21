import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineLoop,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import type { AssetStore } from '../core/AssetStore';
import type { Frame, System } from '../core/Engine';
import type { JobQueue } from '../core/jobs';
import { Scope } from '../core/scope';
import {
  KEY_LIGHT_POSITION,
  createGlowMaterial,
  createLineMaterial,
  createToonMaterial,
  type ToonMaterial,
} from '../design/materials';
import { tokens } from '../design/tokens';
import { tuning } from '../design/tuning';
import type { OrbitSubject } from '../camera/OrbitCam';
import type { ManifestBody, ManifestSystem, UniverseManifest } from '../manifest';
import { TAU, smoothstep } from '../sim/math';
import { bodyPositions, createOrbitTable, type OrbitTable } from '../sim/orbits';
import { createRng } from '../sim/rng';
import { biomeBands, sunBands, sunLook } from './looks';
import { PlanetMesh } from './PlanetMesh';

export interface GalaxyOptions {
  manifest: UniverseManifest;
  /** The orbits the simulation already follows, so that both agree. Built here when not given. */
  orbits?: OrbitTable;
  assets: AssetStore;
  jobs: JobQueue;
  /** Whoever the level of detail follows: the ship. */
  viewer: { readonly position: Readonly<Vector3> };
  reducedMotion: boolean;
}

interface BodyView {
  body: ManifestBody;
  /** Row in the orbit table. */
  index: number;
  node: Group;
  /** The part that turns on its own axis, if any. */
  spinning: Object3D | null;
  planet: PlanetMesh | null;
}

interface OrbitLine {
  line: LineLoop;
  /** Row of the body it circles, or -1 for a circle around its system's centre. */
  around: number;
  centerX: number;
  centerZ: number;
}

interface SystemLook {
  system: ManifestSystem;
  hasSun: boolean;
  sunPosition: Vector3;
  surface: ToonMaterial;
  ring: Material;
  line: Material;
}

/**
 * THE WORLD, built from /universe.json: every system, sun, planet, moon, station and satellite,
 * and the thin circles they travel on. Nothing here decides where anything IS: each frame it asks
 * sim/orbits.ts for the positions at the exact time of that frame and puts the views there.
 *
 * One lit material per system, because a material carries its sun. The home system has no sun
 * and keeps the distant key light.
 */
export class Galaxy implements System {
  readonly object = new Group();
  readonly orbits: OrbitTable;

  private readonly scope = new Scope();
  private readonly positions: Float64Array;
  private readonly views: BodyView[] = [];
  private readonly lines: OrbitLine[] = [];
  private readonly systems = new Map<string, SystemLook>();

  constructor(private readonly options: GalaxyOptions) {
    const { manifest } = options;
    this.object.name = 'galaxy';
    this.orbits = options.orbits ?? createOrbitTable(manifest.systems, manifest.bodies);
    this.positions = new Float64Array(this.orbits.count * 2);
    bodyPositions(this.orbits, 0, this.positions);

    const sunMaterial = this.scope.track(
      createGlowMaterial({ intensity: 1, bloom: tuning.world.sunBloom }),
    );
    const circle = this.scope.track(unitCircle(tuning.world.orbitLineSegments));

    for (const system of manifest.systems) {
      const center = manifest.bodies.find((body) => body.id === system.center);
      const theme = tokens.color.system[system.theme];
      const look: SystemLook = {
        system,
        hasSun: center?.kind === 'sun',
        sunPosition: new Vector3(system.position[0], 0, system.position[1]),
        surface: this.scope.track(createToonMaterial({ vertexColors: true })),
        ring: this.scope.track(
          createGlowMaterial({ intensity: 1, bloom: tuning.world.ringBloom, tint: theme.light }),
        ),
        line: this.scope.track(
          createLineMaterial({ color: theme.shade, opacity: tuning.world.orbitLineOpacity }),
        ),
      };
      if (look.hasSun) look.surface.uniforms.uSunPosition.value.copy(look.sunPosition);
      this.systems.set(system.id, look);
    }

    // Nearest first, so that what the visitor looks at is generated first.
    const { viewer } = options;
    const byDistance = [...manifest.bodies].sort(
      (a, b) => this.distanceTo(a.id, viewer.position) - this.distanceTo(b.id, viewer.position),
    );
    for (const body of byDistance) {
      const look = this.systems.get(body.system);
      if (!look) continue;
      this.views.push(this.createView(body, look, sunMaterial));
      if (body.orbit) this.lines.push(this.createLine(body, look, circle));
    }
    this.scope.onDispose(() => this.object.removeFromParent());
    this.place(0, 0);
  }

  frameUpdate(frame: Frame): void {
    // The exact time of this frame, which lies between the last two simulation steps.
    const t = frame.simTime - (1 - frame.alpha) / tuning.loop.stepHz;
    bodyPositions(this.orbits, Math.max(0, t), this.positions);
    this.place(frame.dt, this.options.reducedMotion ? 0 : tuning.world.spinRadPerSec * frame.dt);
  }

  /**
   * Where the light comes from at `position`: the sun of the system it is in, fading over to the
   * distant key light in the space between systems, so that the ship's shading never pops.
   */
  lightAt(position: Readonly<Vector3>, out: Vector3): Vector3 {
    let weight = 0;
    let sun: Vector3 | null = null;
    for (const look of this.systems.values()) {
      if (!look.hasSun) continue;
      const radii = look.sunPosition.distanceTo(position) / look.system.radius;
      const w =
        1 - smoothstep(tuning.world.shipLightFullRadii, tuning.world.shipLightFadeRadii, radii);
      if (w > weight) {
        weight = w;
        sun = look.sunPosition;
      }
    }
    out.copy(KEY_LIGHT_POSITION);
    return sun ? out.lerp(sun, weight) : out;
  }

  /**
   * A body as a camera subject: where it is this frame (a LIVE position: it moves with the body),
   * its docking ring, and where its light comes from. Null for an unknown id.
   */
  subject(id: string): OrbitSubject | null {
    const view = this.views.find((candidate) => candidate.body.id === id);
    const look = view && this.systems.get(view.body.system);
    if (!view || !look) return null;
    const isLight = view.body.kind === 'sun';
    return {
      position: view.node.position,
      ringRadius: view.body.dockRadius,
      light: isLight ? null : look.hasSun ? look.sunPosition : KEY_LIGHT_POSITION,
    };
  }

  dispose(): void {
    for (const view of this.views.splice(0)) view.planet?.dispose();
    this.scope.dispose();
  }

  private distanceTo(bodyId: string, point: Readonly<Vector3>): number {
    const i = this.orbits.indexOf(bodyId);
    return Math.hypot(
      (this.positions[i * 2] ?? 0) - point.x,
      (this.positions[i * 2 + 1] ?? 0) - point.z,
    );
  }

  private place(dt: number, spin: number): void {
    const { positions } = this;
    const viewer = this.options.viewer.position;
    for (const view of this.views) {
      const x = positions[view.index * 2] ?? 0;
      const z = positions[view.index * 2 + 1] ?? 0;
      view.node.position.set(x, 0, z);
      if (view.spinning) view.spinning.rotation.y += spin;
      view.planet?.update(Math.hypot(x - viewer.x, z - viewer.z) / view.body.radius, dt);
    }
    for (const orbit of this.lines) {
      const x = orbit.around < 0 ? orbit.centerX : (positions[orbit.around * 2] ?? 0);
      const z = orbit.around < 0 ? orbit.centerZ : (positions[orbit.around * 2 + 1] ?? 0);
      orbit.line.position.set(x, 0, z);
    }
  }

  private createView(body: ManifestBody, look: SystemLook, sunMaterial: Material): BodyView {
    const { assets, jobs } = this.options;
    const node = new Group();
    node.name = body.id;
    this.object.add(node);
    const view: BodyView = {
      body,
      index: this.orbits.indexOf(body.id),
      node,
      spinning: null,
      planet: null,
    };

    if (body.kind === 'station' || body.kind === 'satellite') {
      const handle = assets.acquire(body.kind, look.surface);
      this.scope.onDispose(() => handle.release());
      handle.object.scale.setScalar(body.radius);
      node.add(handle.object);
      if (body.kind === 'station') view.spinning = handle.object;
      return view;
    }

    const isSun = body.kind === 'sun';
    const isMoon = body.kind === 'moon';
    const { detailSun, detailMoon, detailPlanet, detailNear } = tuning.world;
    view.planet = new PlanetMesh({
      radius: body.radius,
      seed: body.seed,
      bands: isSun ? sunBands(look.system.theme) : biomeBands(body.biome ?? 'terra'),
      look: isSun ? sunLook() : tuning.planet,
      detail: isSun ? detailSun : isMoon ? detailMoon : detailPlanet,
      nearDetail: isSun || isMoon ? null : detailNear,
      material: isSun ? sunMaterial : look.surface,
      jobs,
    });
    node.add(view.planet.mesh);
    view.spinning = view.planet.mesh;
    // Each world starts turned its own way, or every planet would show the same face.
    view.planet.mesh.rotation.y = createRng(`${body.seed}/turn`)() * TAU;

    if (body.rings) {
      const ring = assets.acquire('planetRing', look.ring);
      this.scope.onDispose(() => ring.release());
      ring.object.scale.setScalar(body.radius * tuning.world.ringInnerRadii);
      const tilt = createRng(`${body.seed}/ring`);
      const lean = (tuning.world.ringTiltDeg * Math.PI) / 180;
      ring.object.rotation.set(lean * (tilt() * 2 - 1), 0, lean * (tilt() < 0.5 ? -1 : 1));
      node.add(ring.object);
    }
    return view;
  }

  private createLine(body: ManifestBody, look: SystemLook, circle: BufferGeometry): OrbitLine {
    const line = new LineLoop(circle, look.line);
    line.scale.setScalar(body.orbit?.radius ?? 1);
    line.name = `${body.id}:orbit`;
    this.object.add(line);
    return {
      line,
      around: body.parent === null ? -1 : this.orbits.indexOf(body.parent),
      centerX: look.system.position[0],
      centerZ: look.system.position[1],
    };
  }
}

function unitCircle(segments: number): BufferGeometry {
  const points = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * TAU;
    points[i * 3] = Math.sin(angle);
    points[i * 3 + 2] = Math.cos(angle);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(points, 3));
  return geometry;
}
