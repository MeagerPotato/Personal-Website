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
import type { WorldRecipe } from '../design/worlds';
import type { OrbitSubject } from '../camera/OrbitCam';
import type { ManifestBody, ManifestSystem, UniverseManifest } from '../manifest';
import { familyReaches } from '../sim/families';
import { displayScales, type MapBodies, type MapScaleParams } from '../sim/mapView';
import { TAU, smoothstep } from '../sim/math';
import { bodyPositions, createOrbitTable, type OrbitTable } from '../sim/orbits';
import { createRng } from '../sim/rng';
import { lookOf } from './looks';
import { PlanetMesh } from './PlanetMesh';

/** How the galaxy is drawn on the star map (`tuning.map`). */
export interface MapLookParams extends MapScaleParams {
  /** How much of the sun's shading the map takes out of lit surfaces, 0 to 1. */
  readonly flatness: number;
  /** The stars dim to this share of themselves on the map. */
  readonly starOpacity: number;
  /** No body looks smaller than this on the map (radius, CSS px), by kind. */
  readonly minRadiusPx: Readonly<Record<ManifestBody['kind'], number>>;
  /** The ship is a marker on the map: never smaller than this (half its length, CSS px). */
  readonly shipRadiusPx: number;
}

/** What the galaxy needs to know of the star map, each frame (ui/StarMap.ts). */
export interface MapState {
  /** How much of the picture is the map's: 0 flying, 1 on the map. */
  readonly weight: number;
  /** World units covered by one CSS px on the map. */
  readonly unitsPerPx: number;
}

export interface GalaxyOptions {
  manifest: UniverseManifest;
  /** The orbits the simulation already follows, so that both agree. Built here when not given. */
  orbits?: OrbitTable;
  assets: AssetStore;
  jobs: JobQueue;
  /** Whoever the level of detail follows: the ship. */
  viewer: { readonly position: Readonly<Vector3> };
  reducedMotion: boolean;
  /** The star map, when there is one: on it, bodies are drawn big enough to see (sim/mapView.ts). */
  map?: MapState;
  /** Worlds of their own, by body id. design/worlds.ts when not given (a test gives its own). */
  worlds?: Readonly<Partial<Record<string, WorldRecipe>>>;
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
  /**
   * Rows of the bodies whose path it is. Bodies that share a path share its line (the relays ride
   * the Contact satellite's ring): a see-through line drawn over itself comes out darker than every
   * other path in the sky.
   */
  of: number[];
  /** Row of the body it circles, or -1 for a circle around its system's centre. */
  around: number;
  centerX: number;
  centerZ: number;
}

/** What is the same for everything in one system: its colour family's ring glow and orbit lines. */
interface SystemLook {
  system: ManifestSystem;
  ring: Material;
  line: Material;
}

/** Where the light falls from, for everything lit by it: a sun, or the distant key light. */
interface SunLight {
  /** Row of the sun in the orbit table; -1 for the key light, which never moves. */
  row: number;
  /**
   * Where the light is THIS frame. The very object `surface` reads as its uSunPosition: moving
   * the light moves it for every surface it shines on, with nothing to copy.
   */
  position: Vector3;
  /** The one lit material of everything this light shines on. */
  surface: ToonMaterial;
  /** How far its family reaches from it (u): a ship inside that is in its light. 0: the key light. */
  reach: number;
}

/** How far out the ship's light is put, in the direction it falls from (u): far enough to be parallel. */
const LIGHT_DISTANCE = 10000;

/**
 * THE WORLD, built from /universe.json: every system, sun, planet, moon, station and satellite,
 * and the thin circles they travel on. Nothing here decides where anything IS: each frame it asks
 * sim/orbits.ts for the positions at the exact time of that frame and puts the views there.
 *
 * One lit material per SUN, because a material carries its light, and a sun may move (a sun of a
 * binary circles its partner): each frame its light goes where it is. A body is lit by the first
 * sun up its chain of parents (a moon by its planet's sun); the home system has no sun and keeps
 * the distant key light. How a body LOOKS is world/looks.ts.
 */
export class Galaxy implements System {
  readonly object = new Group();
  readonly orbits: OrbitTable;

  /** Where every body is THIS frame, by row of the orbit table: [x0, z0, x1, z1, ...]. Read only. */
  readonly positions: Float64Array;

  /**
   * How big every body is DRAWN this frame, as a factor on its true size, by row: 1 while flying,
   * and on the star map whatever makes it visible, or 0 for one the map has no room for
   * (sim/mapView.ts). Whoever measures a body on screen must measure with these. Read only.
   */
  readonly displayScale: Float64Array;

  /** The biggest any body is drawn this frame (radius, world units): the ship's marker rides above it. */
  displayReach = 0;

  private readonly scope = new Scope();
  private readonly views: BodyView[] = [];
  private readonly lines: OrbitLine[] = [];
  private readonly systems = new Map<string, SystemLook>();
  /** Every sun's light, and the key light for whatever has no sun. */
  private readonly suns: SunLight[] = [];
  private readonly sunById = new Map<string, SunLight>();
  private readonly key: SunLight;
  private readonly byId: ReadonlyMap<string, ManifestBody>;
  /** Scratch for lightAt. */
  private readonly toward = new Vector3();
  private readonly sum = new Vector3();
  private readonly mapBodies: MapBodies & { readonly minRadiusPx: Float64Array };
  /** What kind of body each row is: its smallest size on the map goes by that. */
  private readonly kinds: ManifestBody['kind'][];

  constructor(private readonly options: GalaxyOptions) {
    const { manifest } = options;
    this.object.name = 'galaxy';
    this.orbits = options.orbits ?? createOrbitTable(manifest.systems, manifest.bodies);
    this.positions = new Float64Array(this.orbits.count * 2);
    bodyPositions(this.orbits, 0, this.positions);
    this.displayScale = new Float64Array(this.orbits.count).fill(1);
    const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
    this.byId = byId;
    this.kinds = this.orbits.ids.map((id) => byId.get(id)?.kind ?? 'moon');
    this.mapBodies = {
      count: this.orbits.count,
      parent: this.orbits.parent,
      orbitRadius: this.orbits.radius,
      radius: this.orbits.ids.map((id) => byId.get(id)?.radius ?? 0),
      minRadiusPx: new Float64Array(this.orbits.count),
    };

    const sunMaterial = this.scope.track(
      createGlowMaterial({ intensity: 1, bloom: tuning.world.sunBloom }),
    );
    const circle = this.scope.track(unitCircle(tuning.world.orbitLineSegments));

    for (const system of manifest.systems) {
      const theme = tokens.color.system[system.theme];
      this.systems.set(system.id, {
        system,
        ring: this.scope.track(
          createGlowMaterial({ intensity: 1, bloom: tuning.world.ringBloom, tint: theme.light }),
        ),
        line: this.scope.track(
          createLineMaterial({ color: theme.shade, opacity: tuning.world.orbitLineOpacity }),
        ),
      });
    }

    // The lights. A sun's reach is its family's (sim/families.ts, the same reckoning the autopilot
    // goes round families by), without the autopilot's keep-out: where its planets end.
    // (A toon material starts out lit by the key light: that one only has to be kept.)
    const keySurface = this.scope.track(createToonMaterial({ vertexColors: true }));
    this.key = {
      row: -1,
      position: keySurface.uniforms.uSunPosition.value,
      surface: keySurface,
      reach: 0,
    };
    const rings = Float64Array.from(this.orbits.ids, (id) => byId.get(id)?.dockRadius ?? 0);
    const reaches = familyReaches(this.orbits, rings, 0, new Float64Array(this.orbits.count));
    this.orbits.ids.forEach((id, row) => {
      if (byId.get(id)?.kind !== 'sun') return;
      const light: SunLight = {
        row,
        position: new Vector3(),
        surface: this.scope.track(createToonMaterial({ vertexColors: true })),
        reach: reaches[row] ?? 0,
      };
      light.surface.uniforms.uSunPosition.value = light.position;
      this.suns.push(light);
      this.sunById.set(id, light);
    });
    this.placeLights();

    // Nearest first, so that what the visitor looks at is generated first.
    const { viewer } = options;
    const byDistance = [...manifest.bodies].sort(
      (a, b) => this.distanceTo(a.id, viewer.position) - this.distanceTo(b.id, viewer.position),
    );
    for (const body of byDistance) {
      const look = this.systems.get(body.system);
      if (!look) continue;
      this.views.push(this.createView(body, look, sunMaterial));
    }
    // One line for each path, named after the first body on it in the manifest. A path is its
    // circle: the body it goes round (or its system's centre) and its radius.
    const paths = new Map<string, OrbitLine>();
    for (const body of manifest.bodies) {
      const look = this.systems.get(body.system);
      if (!look || !body.orbit) continue;
      const path = `${body.parent ?? `centre of ${body.system}`} at ${body.orbit.radius}`;
      const shared = paths.get(path);
      if (shared) {
        shared.of.push(this.orbits.indexOf(body.id));
        continue;
      }
      const line = this.createLine(body, look, circle);
      paths.set(path, line);
      this.lines.push(line);
    }
    this.scope.onDispose(() => this.object.removeFromParent());
    this.place(0, 0);
  }

  frameUpdate(frame: Frame): void {
    // The exact time of this frame, which lies between the last two simulation steps.
    const t = frame.simTime - (1 - frame.alpha) / tuning.loop.stepHz;
    bodyPositions(this.orbits, Math.max(0, t), this.positions);
    const { map } = this.options;
    if (map) {
      // Read every frame the map shows, so that the dev panel's sliders work on it live.
      if (map.weight > 0) {
        const sizes = tuning.map.minRadiusPx;
        this.kinds.forEach((kind, row) => (this.mapBodies.minRadiusPx[row] = sizes[kind]));
      }
      displayScales(this.mapBodies, map.unitsPerPx, map.weight, tuning.map, this.displayScale);
    }
    this.placeLights();
    this.place(frame.dt, this.options.reducedMotion ? 0 : tuning.world.spinRadPerSec * frame.dt);
  }

  /**
   * Where the ship's light comes from at `position`: the sun whose family it is in, fading over
   * to the distant key light in the space between them, so that its shading never pops.
   *
   * It blends DIRECTIONS, never places. Each sun pulls toward itself with weight `w (R/d)²`: `w`
   * is 1 inside `shipLightFullRadii` of its family's reach R and fades to 0 by
   * `shipLightFadeRadii`, and `(R/d)²` lets the nearer sun lead where two families meet. The key
   * light takes whatever share the suns leave (`1 - w` of the strongest), and up to
   * `shipLightTiebreak` more, as a second sun's pull comes up to the first one's. So:
   * - inside one family, the light falls from its sun and nowhere else, wherever no other sun
   *   pulls. In a binary one does, near the gap: the other sun's pull reaches across it, so a
   *   ship on the ring of an outer planet is lit from off its own sun, toward the other one and
   *   the key light (on Robotics' ring, the worst, by up to 57 degrees). tests/ship-light.test.ts
   *   pins every ring's lean, and docs/PLAN.md §5.4 has the ways out, for the design round;
   * - between two suns that pull equally from opposite sides, their directions cancel and the key
   *   light, from above the plane, is what is left: the light swings over the top from one to the
   *   other, where a nearest-sun rule would flip it round in a single frame (a binary's gap), and
   *   a blend of the two places would put the light on the ship itself;
   * - far from every sun, it is the key light.
   * The answer is a point far out in that direction (LIGHT_DISTANCE): the shader aims at a point.
   */
  lightAt(position: Readonly<Vector3>, out: Vector3): Vector3 {
    const {
      shipLightFullRadii: full,
      shipLightFadeRadii: fade,
      shipLightTiebreak: tiebreak,
    } = tuning.world;
    const { toward, sum } = this;
    sum.set(0, 0, 0);
    let strongest = 0;
    let first = 0;
    let second = 0;
    for (const light of this.suns) {
      const d = toward.subVectors(light.position, position).length();
      if (!(d > 0) || !(light.reach > 0)) continue;
      const w = 1 - smoothstep(full, fade, d / light.reach);
      if (!(w > 0)) continue;
      const pull = w * (light.reach / d) ** 2;
      sum.addScaledVector(toward, pull / d);
      strongest = Math.max(strongest, w);
      if (pull > first) {
        second = first;
        first = pull;
      } else if (pull > second) {
        second = pull;
      }
    }
    const key = 1 - strongest + (first > 0 ? tiebreak * Math.min(1, second / first) : 0);
    if (key > 0) {
      toward.subVectors(KEY_LIGHT_POSITION, position);
      sum.addScaledVector(toward, key / toward.length());
    }
    // (Nothing is left only at the key light itself, where no ship ever is.)
    if (!(sum.lengthSq() > 0)) return out.copy(KEY_LIGHT_POSITION);
    return out.copy(position).addScaledVector(sum.normalize(), LIGHT_DISTANCE);
  }

  /**
   * A body as a camera subject: where it is this frame (a LIVE position: it moves with the body),
   * its docking ring, and where its light comes from (live too: a sun of a binary moves). Null
   * for an unknown id.
   */
  subject(id: string): OrbitSubject | null {
    const view = this.views.find((candidate) => candidate.body.id === id);
    if (!view) return null;
    return {
      position: view.node.position,
      ringRadius: view.body.dockRadius,
      light: view.body.kind === 'sun' ? null : this.lightOf(view.body).position,
    };
  }

  dispose(): void {
    for (const view of this.views.splice(0)) view.planet?.dispose();
    this.scope.dispose();
  }

  /** What lights `body`: the first sun up its chain of parents, or, with none, the key light. */
  private lightOf(body: ManifestBody): SunLight {
    for (let at: ManifestBody | undefined = body; at; at = this.byId.get(at.parent ?? '')) {
      if (at.kind === 'sun') return this.sunById.get(at.id) ?? this.key;
    }
    return this.key;
  }

  /** Each sun's light to where the sun is this frame (the surfaces it lights read the same object). */
  private placeLights(): void {
    const { positions } = this;
    for (const light of this.suns) {
      light.position.set(positions[light.row * 2] ?? 0, 0, positions[light.row * 2 + 1] ?? 0);
    }
  }

  private distanceTo(bodyId: string, point: Readonly<Vector3>): number {
    const i = this.orbits.indexOf(bodyId);
    return Math.hypot(
      (this.positions[i * 2] ?? 0) - point.x,
      (this.positions[i * 2 + 1] ?? 0) - point.z,
    );
  }

  private place(dt: number, spin: number): void {
    const { positions, displayScale } = this;
    const viewer = this.options.viewer.position;
    let reach = 0;
    for (const view of this.views) {
      const x = positions[view.index * 2] ?? 0;
      const z = positions[view.index * 2 + 1] ?? 0;
      const scale = displayScale[view.index] ?? 1;
      view.node.position.set(x, 0, z);
      view.node.scale.setScalar(scale);
      // (A scale of nothing at all is a matrix that cannot be undone, which three complains of.)
      view.node.visible = scale > 1e-4;
      reach = Math.max(reach, view.body.radius * scale);
      if (view.spinning) view.spinning.rotation.y += spin;
      view.planet?.update(Math.hypot(x - viewer.x, z - viewer.z) / view.body.radius, dt);
    }
    this.displayReach = reach;
    for (const orbit of this.lines) {
      const x = orbit.around < 0 ? orbit.centerX : (positions[orbit.around * 2] ?? 0);
      const z = orbit.around < 0 ? orbit.centerZ : (positions[orbit.around * 2 + 1] ?? 0);
      orbit.line.position.set(x, 0, z);
      // The path of a body that the map has no room for would only be a smudge round its parent:
      // it shows while any body on it does.
      let shown = false;
      for (const row of orbit.of) shown ||= (displayScale[row] ?? 1) > 1e-4;
      orbit.line.visible = shown;
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

    // A sun is light itself; everything else is lit by its own sun, or by the key light.
    const material = body.kind === 'sun' ? sunMaterial : this.lightOf(body).surface;
    const shape = lookOf(body, look.system.theme, this.options.worlds);
    let object: Object3D;
    if (shape.model !== null) {
      const handle = assets.acquire(shape.model, material);
      this.scope.onDispose(() => handle.release());
      handle.object.scale.setScalar(body.radius);
      object = handle.object;
    } else {
      view.planet = new PlanetMesh({
        radius: body.radius,
        seed: body.seed,
        bands: shape.bands,
        look: shape.look,
        detail: shape.detail,
        nearDetail: shape.nearDetail,
        material,
        jobs,
      });
      object = view.planet.mesh;
    }
    node.add(object);
    // The satellite holds its pose; everything else turns on its own axis.
    view.spinning = body.kind === 'satellite' ? null : object;
    // Each world starts turned its own way, or every planet would show the same face.
    if (body.kind !== 'station' && body.kind !== 'satellite') {
      object.rotation.y = createRng(`${body.seed}/turn`)() * TAU;
    }

    if (shape.rings) {
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
      of: [this.orbits.indexOf(body.id)],
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
