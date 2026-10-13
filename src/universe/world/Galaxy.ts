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
  createEdgeMaterial,
  createGlowMaterial,
  createLineMaterial,
  createToonMaterial,
  type ToonMaterial,
} from '../design/materials';
import { tokens, type AirKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import type { WorldRecipe } from '../design/worlds';
import type { OrbitSubject } from '../camera/OrbitCam';
import {
  familiesOf,
  type ManifestBody,
  type ManifestSystem,
  type UniverseManifest,
} from '../manifest';
import { familyReaches } from '../sim/families';
import { landmarkPoint, type Landmark } from '../sim/landmarks';
import { displayScales, type MapBodies, type MapScaleParams } from '../sim/mapView';
import { TAU, smoothstep } from '../sim/math';
import { bodyPositions, createOrbitTable, type OrbitTable } from '../sim/orbits';
import { createRng } from '../sim/rng';
import { lightClaims, turnToward, type LitBodies } from '../sim/shipLight';
import type { BodyRecipe } from '../sim/world/rows';
import { BodyMesh, CloseUpLoader, type CloseUpRows } from './BodyMesh';
import { airOf, lookOf, type AirTable } from './looks';
import type { AirWorldView } from './AirShells';
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
  /** The low quality tier: an emblem world is one group that never turns, and nothing of it moves. */
  low?: boolean;
  /** The star map, when there is one: on it, bodies are drawn big enough to see (sim/mapView.ts). */
  map?: MapState;
  /** Worlds of their own, by body id. design/worlds.ts when not given (a test gives its own). */
  worlds?: Readonly<Partial<Record<string, WorldRecipe>>>;
  /** Emblem worlds, their rows by body id. design/worlds/bodies.ts when not given. */
  bodies?: Readonly<Partial<Record<string, BodyRecipe>>>;
  /** How the close-up rows and the motion table arrive: their chunk's import(), unless a test says. */
  closeUp?: () => Promise<CloseUpRows>;
  /** Which worlds have air, by body id. `tuning.look.air.worlds` when not given (a test gives its own). */
  air?: AirTable;
}

interface BodyView {
  body: ManifestBody;
  /** Row in the orbit table. */
  index: number;
  node: Group;
  /** The part that turns on its own axis, if any. */
  spinning: Object3D | null;
  planet: PlanetMesh | null;
  /** An emblem world, drawn from its rows. */
  world: BodyMesh | null;
  /** A body that is no emblem world, as drawn: its generated mesh, or its model. */
  surface: Object3D | null;
  /**
   * Row of the body it keeps facing away from, or -1: a relay's arrow and the Contact satellite's
   * trail point away from home, toward the edge of the map.
   */
  outward: number;
  /** Its turn when its own +X points away from that body (radians): where it points out along. */
  outwardYaw: number;
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

/**
 * What is the same for everything of one colour FAMILY (manifest.ts, `familiesOf`): the glow of a
 * ringed planet's ring and the thin lines of the orbits. Keyed by family and not by system, so a
 * binary whose suns wear two families draws each sun's planets in their own.
 */
interface FamilyLook {
  ring: Material;
  line: Material;
  /**
   * The path of a binary's sun round the pair's centre: fainter than a planet's, since it runs
   * through the rings of the planets it passes and is not one of them.
   */
  track: Material;
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
 * the distant key light. The ship, near a body, is lit by that body's light too (lightAt). How a
 * body LOOKS is world/looks.ts.
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
  /** The same views by their body's id: asked every frame (a deck's leaders), so no search. */
  private readonly viewById = new Map<string, BodyView>();
  private readonly lines: OrbitLine[] = [];
  private readonly systems = new Map<string, ManifestSystem>();
  /** Every body's colour family, by id, and each family's look, made once a body wears it. */
  private readonly families: ReadonlyMap<string, ThemeKey>;
  private readonly looks = new Map<ThemeKey, FamilyLook>();
  /** The close-up rows and the motion table of the emblem worlds: a chunk of their own. */
  private readonly closeUp: CloseUpLoader;
  /** The lines of planned work's parts still to come, one material per family they will wear. */
  private readonly edges = new Map<ThemeKey, Material>();
  private worldCount = 0;
  /** A sun's own material (its ball is a living surface), by family, made once a sun wears it. */
  private readonly sunSurfaces = new Map<ThemeKey, ToonMaterial>();
  /** The worlds that have air (world/looks.ts, `airOf`), as their shells and clouds know them. */
  private readonly airs: AirWorldView[] = [];
  /** Every sun's light, and the key light for whatever has no sun. */
  private readonly suns: SunLight[] = [];
  private readonly sunById = new Map<string, SunLight>();
  private readonly key: SunLight;
  /** The key light and then every sun: what `lit.light` counts in. */
  private readonly lights: SunLight[];
  /** The bodies as the ship's light sees them, near one (sim/shipLight.ts). */
  private readonly lit: LitBodies;
  private readonly byId: ReadonlyMap<string, ManifestBody>;
  /** Scratch for lightAt. */
  private readonly toward = new Vector3();
  private readonly sum = new Vector3();
  private readonly near = new Vector3();
  private readonly claims: Float64Array;
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
      // A body's whole solid extent (an emblem world's rings and signs with it), the very radius
      // the names and the pointer measure (sim/surroundings.ts): the smallest size on the map is
      // the size of everything that is drawn, so a sun with a long reach is no bigger than one
      // that is all ball.
      radius: this.orbits.ids.map((id) => solidOf(byId.get(id))),
      minRadiusPx: new Float64Array(this.orbits.count),
    };

    const sunMaterial = this.scope.track(
      createGlowMaterial({ intensity: 1, bloom: tuning.world.sunBloom }),
    );
    const circle = this.scope.track(unitCircle(tuning.world.orbitLineSegments));
    for (const system of manifest.systems) this.systems.set(system.id, system);
    this.families = familiesOf(manifest);
    this.closeUp = new CloseUpLoader(options.closeUp);
    this.scope.onDispose(() => this.closeUp.dispose());

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
    // Near a body, the ship takes that body's own light (lightAt): which one, for every body.
    this.lights = [this.key, ...this.suns];
    this.lit = {
      count: this.orbits.count,
      positions: this.positions,
      ringRadius: rings,
      docks: Uint8Array.from(this.orbits.ids, (id) => (byId.get(id)?.docks === false ? 0 : 1)),
      light: Int32Array.from(this.orbits.ids, (id) => {
        const body = byId.get(id);
        return body ? this.lights.indexOf(this.lightOf(body)) : -1;
      }),
    };
    this.claims = new Float64Array(this.lights.length);

    // Nearest first, so that what the visitor looks at is generated first.
    const { viewer } = options;
    const byDistance = [...manifest.bodies].sort(
      (a, b) => this.distanceTo(a.id, viewer.position) - this.distanceTo(b.id, viewer.position),
    );
    for (const body of byDistance) {
      const family = this.families.get(body.id);
      if (!this.systems.has(body.system) || family === undefined) continue;
      const view = this.createView(body, family, sunMaterial);
      this.views.push(view);
      this.viewById.set(body.id, view);
    }
    // One line for each path, named after the first body on it in the manifest. A path is its
    // circle: the body it goes round (or its system's centre) and its radius. It wears the
    // family of that first body: bodies that share a path are of one family (the relays and the
    // Contact satellite are home's), except the two suns of a binary whose families reach exactly
    // as far, whose one circle wears the primary's.
    const paths = new Map<string, OrbitLine>();
    for (const body of manifest.bodies) {
      const system = this.systems.get(body.system);
      const family = this.families.get(body.id);
      if (!system || family === undefined || !body.orbit) continue;
      const path = `${body.parent ?? `centre of ${body.system}`} at ${body.orbit.radius}`;
      const shared = paths.get(path);
      if (shared) {
        shared.of.push(this.orbits.indexOf(body.id));
        continue;
      }
      const look = this.lookOf(family);
      const line = this.createLine(
        body,
        system,
        body.kind === 'sun' ? look.track : look.line,
        circle,
      );
      paths.set(path, line);
      this.lines.push(line);
    }
    this.scope.onDispose(() => this.object.removeFromParent());
    this.place(0, 0, 0);
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
    const spin = this.options.reducedMotion ? 0 : tuning.world.spinRadPerSec * frame.dt;
    this.place(frame.dt, spin, Math.max(0, t));
    // The close-up rows load once every everyday build is done (the queue is idle), unless a
    // world the ship came near asked for them first.
    if (this.worldCount > 0 && this.options.jobs.pending === 0) this.closeUp.request();
  }

  /**
   * Where the ship's light comes from at `position`. Near a body, that body's own light (lightOf:
   * its sun, or the key light round home), so that a ship on a planet's ring is lit exactly as
   * the planet is, and the orbit camera, which frames the two together, shows one light. Away
   * from every body, the sun whose family it is in, fading over to the distant key light in the
   * space between families, so that its shading never pops.
   *
   * NEAR A BODY, its light claims the ship (sim/shipLight.ts): fully on its docking ring and
   * inside it, letting go by `shipLightClaimRadii` ring radii, a little past the orbit assist's
   * sphere. The light turns from the blend below toward the claiming one, by that claim and by
   * ANGLE (sim/shipLight.ts, turnToward: blending the two directions as vectors would crowd most
   * of a wide turn into the middle of the way), so a ship arriving or leaving turns with its
   * distance and never pops, and a docked ship, carried on the ring, is lit by its body's light
   * alone. Were two bodies of two lights ever that close (none are: the nearest, Days2Meet and
   * Robotics across the Projects binary's gap, keep at least 9.6 u between the circles where they
   * let go, when both face the gap at once), the two would share by how firmly each claims. A
   * body nothing docks at (a relay) claims nothing. Inside a family with one sun this changes
   * nothing at all: there the blend already is that sun's light.
   *
   * AWAY FROM BODIES, the blend. It blends DIRECTIONS, never places. Each sun pulls toward itself
   * with weight `w (R/d)²`: `w` is 1 inside `shipLightFullRadii` of its family's reach R and fades
   * to 0 by `shipLightFadeRadii`, and `(R/d)²` lets the nearer sun lead where two families meet.
   * The key light takes whatever share the suns leave (`1 - w` of the strongest), and up to
   * `shipLightTiebreak` more, as a second sun's pull comes up to the first one's. So:
   * - inside one family, the light falls from its sun and nowhere else, wherever no other sun
   *   pulls. In a binary one does, near the gap: the other sun's pull reaches across it, so a
   *   ship flying free among the outer planets is lit from off its own sun, toward the other one
   *   and the key light (in Projects, up to 57 degrees among Hardware's; on their rings their own
   *   light has taken over, and tests/ship-light.test.ts pins what is left where each lets go);
   * - between two suns that pull equally from opposite sides, their directions cancel and the key
   *   light, from above the plane, is what is left: the light swings over the top from one to the
   *   other, where a nearest-sun rule would flip it round in a single frame (a binary's gap), and
   *   a blend of the two places would put the light on the ship itself;
   * - far from every sun, it is the key light.
   * The answer is a point far out in that direction (LIGHT_DISTANCE): the shader aims at a point.
   */
  lightAt(position: Readonly<Vector3>, out: Vector3): Vector3 {
    const { toward, sum, near, lights, claims } = this;
    // (Nothing is left of the blend only at the key light itself, where no ship ever is.)
    if (!this.blendAt(position, sum)) return out.copy(KEY_LIGHT_POSITION);
    const reach = tuning.world.shipLightClaimRadii;
    const firmest = lightClaims(this.lit, position.x, position.z, reach, claims);
    if (firmest > 0) {
      // Where the claiming light falls from (two, were there two, by how firmly each claims)...
      near.set(0, 0, 0);
      for (let i = 0; i < lights.length; i += 1) {
        const claim = claims[i] ?? 0;
        const light = lights[i];
        if (!(claim > 0) || !light) continue;
        near.addScaledVector(toward.subVectors(light.position, position).normalize(), claim);
      }
      // ...and the blend turned toward it by `firmest` of the angle between them. (Two lights
      // claiming as firmly from opposite sides would cancel out: then the blend stands.)
      if (near.lengthSq() > 1e-12) turnToward(sum, near.normalize(), firmest, sum);
    }
    return out.copy(position).addScaledVector(sum, LIGHT_DISTANCE);
  }

  /** The blend of lightAt, away from bodies, as a unit direction in `dir`. False at the key light. */
  private blendAt(position: Readonly<Vector3>, dir: Vector3): boolean {
    const {
      shipLightFullRadii: full,
      shipLightFadeRadii: fade,
      shipLightTiebreak: tiebreak,
    } = tuning.world;
    const { toward } = this;
    dir.set(0, 0, 0);
    let strongest = 0;
    let first = 0;
    let second = 0;
    for (const light of this.suns) {
      const d = toward.subVectors(light.position, position).length();
      if (!(d > 0) || !(light.reach > 0)) continue;
      const w = 1 - smoothstep(full, fade, d / light.reach);
      if (!(w > 0)) continue;
      const pull = w * (light.reach / d) ** 2;
      dir.addScaledVector(toward, pull / d);
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
      dir.addScaledVector(toward, key / toward.length());
    }
    if (!(dir.lengthSq() > 0)) return false;
    dir.normalize();
    return true;
  }

  /**
   * A body as a camera subject: where it is this frame (a LIVE position: it moves with the body),
   * its docking ring, and where its light comes from (live too: a sun of a binary moves). Null
   * for an unknown id.
   */
  subject(id: string): OrbitSubject | null {
    const view = this.viewById.get(id);
    if (!view) return null;
    return {
      position: view.node.position,
      ringRadius: view.body.dockRadius,
      light: view.body.kind === 'sun' ? null : this.lightOf(view.body).position,
    };
  }

  /**
   * Where a landmark of body `id` is in the world THIS frame (sim/landmarks.ts), into `out`.
   * False for an unknown id. The point is taken through the transform of whatever carries it, as
   * that is drawn: the part of the body that turns (or, for a landmark that holds still, and for
   * a body nothing of which turns, the body itself). So the body's own turn, the size the star
   * map draws it at and a planned world's smaller scale are all in it, with nothing to keep in
   * step. Ask after this system's frameUpdate: it has put the body where it is by then.
   */
  landmark(id: string, mark: Landmark, out: Vector3): boolean {
    const view = this.viewById.get(id);
    if (!view) return false;
    const { world, surface, node, body } = view;
    let carrier: Object3D = node;
    // An emblem world's rows and a model are made at radius 1 and scaled; a generated planet's
    // mesh, and the body's own node, are in units.
    let unit = body.radius;
    if (world) {
      carrier = (mark.hold ? null : world.turning) ?? world.object;
      unit = 1;
    } else if (surface && !mark.hold) {
      carrier = surface;
      if (!view.planet) unit = 1;
    }
    landmarkPoint(mark, unit, out);
    // The renderer works the matrices out when it draws, which is after anyone asks.
    carrier.updateWorldMatrix(true, false);
    out.applyMatrix4(carrier.matrixWorld);
    return true;
  }

  /**
   * The radius of body `id`'s GROUND as it is drawn, u: its radius, or less for planned work's
   * maquette (0 for an unknown id). Whoever draws to the body's EDGE on screen measures with it:
   * a body's reach in the simulation is its solid, out to its rings and signs.
   */
  ground(id: string): number {
    const view = this.viewById.get(id);
    return view ? view.body.radius * (view.world?.share ?? 1) : 0;
  }

  dispose(): void {
    for (const view of this.views.splice(0)) {
      view.planet?.dispose();
      view.world?.dispose();
    }
    this.viewById.clear();
    this.scope.dispose();
  }

  /** The ring glow and orbit lines of a colour family, made the first time a body wears it. */
  private lookOf(family: ThemeKey): FamilyLook {
    let look = this.looks.get(family);
    if (!look) {
      const colors = tokens.color.system[family];
      look = {
        ring: this.scope.track(
          createGlowMaterial({ intensity: 1, bloom: tuning.world.ringBloom, tint: colors.light }),
        ),
        line: this.scope.track(
          createLineMaterial({ color: colors.shade, opacity: tuning.world.orbitLineOpacity }),
        ),
        track: this.scope.track(
          createLineMaterial({ color: colors.shade, opacity: tuning.world.sunTrackOpacity }),
        ),
      };
      this.looks.set(family, look);
    }
    return look;
  }

  /** The material of a sun of a family: the toon shader's SUN variant, lit by the key light. */
  private sunSurfaceOf(family: ThemeKey): ToonMaterial {
    let surface = this.sunSurfaces.get(family);
    if (!surface) {
      surface = this.scope.track(createToonMaterial({ vertexColors: true, sun: family }));
      this.sunSurfaces.set(family, surface);
    }
    return surface;
  }

  /**
   * The worlds that have air, for whoever draws their shells and clouds (world/AirShells.ts):
   * each with its light as a LIVE position (a sun of a binary moves).
   */
  get airWorlds(): readonly AirWorldView[] {
    return this.airs;
  }

  /**
   * The lit material of a body: its light's, which everything that light shines on shares; or,
   * for a world with air, one of its own in that light (the toon shader's AIR variant: a
   * material carries its world's air and its centre). `center`: the world's own position, the
   * very vector that moves with it.
   */
  private surfaceOf(body: ManifestBody, air: AirKey | undefined, center: Vector3): ToonMaterial {
    if (air === undefined) return this.lightOf(body).surface;
    return this.scope.track(this.airSurface(body, air, center));
  }

  /** A material of a world with air, in its light. Whoever asks owns it. */
  private airSurface(body: ManifestBody, air: AirKey, center: Vector3): ToonMaterial {
    const surface = createToonMaterial({ vertexColors: true, air: { key: air, center } });
    // The very object its light's own material reads: the light moves for both at once.
    surface.uniforms.uSunPosition.value = this.lightOf(body).position;
    return surface;
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

  /**
   * Every view where its body is (and as big as the map draws it), turned `spin` further, and an
   * emblem world as it is at `time`, the exact simulation time of this frame.
   */
  private place(dt: number, spin: number, time: number): void {
    const { positions, displayScale } = this;
    const viewer = this.options.viewer.position;
    const onMap = (this.options.map?.weight ?? 0) >= 0.5;
    let reach = 0;
    for (const view of this.views) {
      const x = positions[view.index * 2] ?? 0;
      const z = positions[view.index * 2 + 1] ?? 0;
      const scale = displayScale[view.index] ?? 1;
      view.node.position.set(x, 0, z);
      view.node.scale.setScalar(scale);
      // (A scale of nothing at all is a matrix that cannot be undone, which three complains of.)
      view.node.visible = scale > 1e-4;
      // An emblem world is drawn out past its radius (its rings, its signs): so far it reaches.
      reach = Math.max(reach, view.body.radius * (view.world?.reach ?? 1) * scale);
      if (view.spinning) view.spinning.rotation.y += spin;
      const distance = Math.hypot(x - viewer.x, z - viewer.z) / view.body.radius;
      view.planet?.update(distance, dt);
      if (view.world) {
        // A relay keeps its arrow pointing away from what it circles, the satellite its trail:
        // its yaw follows its bearing on the ring (design/worlds/home.ts says which way each
        // points: `outwardYaw`).
        if (view.outward >= 0) {
          const dx = x - (positions[view.outward * 2] ?? 0);
          const dz = z - (positions[view.outward * 2 + 1] ?? 0);
          view.world.object.rotation.y = Math.atan2(-dz, dx) + view.outwardYaw;
        }
        view.world.update(distance, dt, time, onMap);
      }
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

  /** The blueprint lines of a family, made the first time a body asks for them. */
  private edgesOf(family: ThemeKey): Material {
    let material = this.edges.get(family);
    if (!material) {
      material = this.scope.track(createEdgeMaterial({ color: tokens.color.system[family].base }));
      this.edges.set(family, material);
    }
    return material;
  }

  private createView(body: ManifestBody, family: ThemeKey, sunMaterial: Material): BodyView {
    const { assets, jobs, reducedMotion } = this.options;
    const node = new Group();
    node.name = body.id;
    this.object.add(node);
    const index = this.orbits.indexOf(body.id);
    const view: BodyView = {
      body,
      index,
      node,
      spinning: null,
      planet: null,
      world: null,
      surface: null,
      outward: -1,
      outwardYaw: 0,
    };

    const shape = lookOf(body, family, this.options.worlds, this.options.bodies);
    // Its air, if it has any (world/looks.ts): a material of its own, a shell, clouds, lamps.
    const air = airOf(body, shape.model === null && !shape.world, this.options.air);
    if (air) {
      this.airs.push({
        id: body.id,
        row: index,
        radius: body.radius,
        air: air.air,
        light: this.lightOf(body).position,
        cloud: air.cloud,
      });
    }
    if (shape.world) {
      // An emblem world. A SUN'S is drawn with a toon material of its own, lit by the distant
      // key light, not with the glow material of a generated sun: its ball is flagged to glow
      // (sim/world/ground.ts) and its signs are flat, so neither takes any light, and the ball
      // blooms as a sun always has (the toon shader's glow is the glow material's); and a part a
      // sun's rows might one day leave lit is shaded by the far key light, as anything in space
      // is, where its family's material would light it from the sun's centre, from inside. Its
      // own, because its ball is a living surface in its family's tones (sunSurfaceOf).
      // Everything else is lit by its own sun, or by the key light; a world with air by a
      // material of its own in that light, and with lamps on its night side if it has them.
      const world = new BodyMesh({
        id: body.id,
        kind: body.kind,
        planned: body.planned === true,
        radius: body.radius,
        seed: body.seed,
        recipe: shape.world,
        material:
          body.kind === 'sun'
            ? this.sunSurfaceOf(family)
            : this.surfaceOf(body, air?.air, node.position),
        ...(air ? { another: () => this.airSurface(body, air.air, node.position) } : {}),
        lamps: air?.windows === true,
        jobs,
        low: this.options.low ?? false,
        reducedMotion,
        closeUp: this.closeUp,
        edges: (family) => this.edgesOf(family),
      });
      view.world = world;
      this.worldCount += 1;
      node.add(world.object);
      // What turns is what the glue says turns (sim/world/glue.ts, `turnsOf`): the ground of a
      // planet, a moon or home, and what stands on it. A sun's ball, the station, the satellite
      // and a relay hold still (their signs read one way round), as does everything on the low
      // tier. The held group (a Circle Line whose stops point at real bearings, a planned world's
      // ring) never turns, and starts unturned.
      view.spinning = world.turning;
      if (world.turning) world.turning.rotation.y = createRng(`${body.seed}/turn`)() * TAU;
      // A relay faces away from what it circles, whatever it is (home, today): its arrow points
      // along its own +X. So does the Contact satellite, whose letter flies out along its +Z, a
      // quarter turn further on.
      if (body.kind === 'link' || body.kind === 'satellite') {
        view.outward = this.orbits.parent[index] ?? -1;
        view.outwardYaw = body.kind === 'satellite' ? Math.PI / 2 : 0;
      }
      // A rocket that flies its orbit nose first: its +X along the way it is going, which is a
      // quarter turn on from pointing away from what it circles (as the satellite's +Z points out).
      if (shape.world.faces === 'prograde') {
        view.outward = this.orbits.parent[index] ?? -1;
        view.outwardYaw = Math.PI / 2;
      }
      return view;
    }

    // A sun is light itself; everything else is lit by its own sun, or by the key light.
    const material =
      body.kind === 'sun' ? sunMaterial : this.surfaceOf(body, air?.air, node.position);
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
    view.surface = object;
    // The satellite holds its pose; everything else turns on its own axis.
    view.spinning = body.kind === 'satellite' ? null : object;
    // Each world starts turned its own way, or every planet would show the same face.
    if (body.kind !== 'station' && body.kind !== 'satellite') {
      object.rotation.y = createRng(`${body.seed}/turn`)() * TAU;
    }

    if (shape.rings) {
      const ring = assets.acquire('planetRing', this.lookOf(family).ring);
      this.scope.onDispose(() => ring.release());
      ring.object.scale.setScalar(body.radius * tuning.world.ringInnerRadii);
      const tilt = createRng(`${body.seed}/ring`);
      const lean = (tuning.world.ringTiltDeg * Math.PI) / 180;
      ring.object.rotation.set(lean * (tilt() * 2 - 1), 0, lean * (tilt() < 0.5 ? -1 : 1));
      node.add(ring.object);
    }
    return view;
  }

  private createLine(
    body: ManifestBody,
    system: ManifestSystem,
    material: Material,
    circle: BufferGeometry,
  ): OrbitLine {
    const line = new LineLoop(circle, material);
    line.scale.setScalar(body.orbit?.radius ?? 1);
    line.name = `${body.id}:orbit`;
    this.object.add(line);
    return {
      line,
      of: [this.orbits.indexOf(body.id)],
      around: body.parent === null ? -1 : this.orbits.indexOf(body.parent),
      centerX: system.position[0],
      centerZ: system.position[1],
    };
  }
}

/** How far out a body is solid: its ball, or as far as its emblem world is drawn (the manifest). */
function solidOf(body: ManifestBody | undefined): number {
  return body?.solidRadius ?? body?.radius ?? 0;
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
