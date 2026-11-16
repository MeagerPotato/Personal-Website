import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  type Color,
  type Material,
  type Object3D,
} from 'three';
import { geometryFrom } from '../core/geometry';
import type { JobQueue } from '../core/jobs';
import { Scope } from '../core/scope';
import type { BodyKind } from '../data/types';
import { createEdgeMaterial, createToonMaterial, type ToonMaterial } from '../design/materials';
import { tokens, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { groundHeight } from '../sim/planet';
import { voxelize } from '../sim/voxel';
import { windowLamps } from '../sim/windows';
import {
  assembling,
  fineOf,
  groundDetail,
  turnsOf,
  type Assembly,
  type GroundDetails,
  type Group as DrawGroup,
  type Packed,
} from '../sim/world/glue';
import { groundLook, type GroundSpec } from '../sim/world/ground';
import { driveValue, type MotionRow } from '../sim/world/motion';
import { colorOf } from '../sim/world/palette';
import {
  makeBody,
  rowsOf,
  type BodyRecipe,
  type Build,
  type PartRow,
  type Pivot,
} from '../sim/world/rows';

/** What the close-up chunk brings (design/worlds/closeup.ts), by manifest id. */
export interface CloseUpRows {
  readonly NEAR: Readonly<Partial<Record<string, readonly PartRow[]>>>;
  readonly MOTION: Readonly<Partial<Record<string, readonly MotionRow[]>>>;
}

/** Where a world finds its close-up rows: the chunk once it has arrived, and a way to ask for it. */
export interface CloseUpSource {
  /** The rows, or null while the chunk has not arrived (or could not be loaded). */
  readonly rows: CloseUpRows | null;
  /** Ask for the chunk. Asking again changes nothing. */
  request(): void;
}

/**
 * An assembly in cubes (sim/voxel.ts): its turning and held groups and each mover, on one grid
 * size, so that what moves is made of the same cubes as what stands. The rows are modelled at
 * radius 1, so a cube is `1 / cells` whatever the body's size.
 */
function* inCubes(assembly: Assembly, cells: number, bevel: boolean): Generator<void, Assembly> {
  const { maxCells, occlusion, jitter } = tuning.world.voxel;
  const options = { cell: 1 / cells, maxCells, occlusion, jitter, bevel };
  const cubes = function* (packed: Packed): Generator<void, Packed> {
    return packed.triangleCount === 0 ? packed : yield* voxelize(packed, options);
  };
  const turn = yield* cubes(assembly.turn);
  const hold = yield* cubes(assembly.hold);
  const movers: Assembly['movers'][number][] = [];
  for (const mover of assembly.movers) movers.push({ ...mover, mesh: yield* cubes(mover.mesh) });
  return { ...assembly, turn, hold, movers };
}

/** Cubes to the radius of a tier's build (`tuning.world.voxel`): the map's own variant has none. */
const cellsOf = (tier: Exclude<TierName, 'map'>, low: boolean): number => {
  const voxel = tuning.world.voxel;
  if (tier === 'small') return voxel.smallCellsPerRadius;
  if (low) return voxel.lowCellsPerRadius;
  return tier === 'near' ? voxel.nearCellsPerRadius : voxel.cellsPerRadius;
};

/** A ground's detail by kind: the tuning's, with a sun's coarser ball on the low tier. */
const detailsOf = (low: boolean): GroundDetails =>
  low ? { ...tuning.world, detailSun: tuning.look.sun.detailLow } : tuning.world;

/**
 * The detail of the ground that is cut into cubes (high and medium tiers): finer than the one
 * drawn as it is (`detailsOf`, the worlds' budget), so that a coast or a band follows the
 * shape and not the facets once the cubes are small (`tuning.world.voxel.sourceScale`). Only
 * the cubes reach the GPU, so the finer ground costs time while it is built and nothing after.
 * Not for coarse cubes (`coarse`: the small build) nor the star map's variant, which is flat.
 */
const cubeDetailsOf = (low: boolean, coarse: boolean): GroundDetails => {
  const base = detailsOf(low);
  if (low || coarse) return base;
  const k = tuning.world.voxel.sourceScale;
  const scale = (detail: number): number => Math.round(detail * k);
  return {
    detailPlanet: scale(base.detailPlanet),
    detailNear: scale(base.detailNear),
    detailMoon: scale(base.detailMoon),
    detailSun: scale(base.detailSun),
    detailMaquettePlanet: scale(base.detailMaquettePlanet),
    detailMaquetteMoon: scale(base.detailMaquetteMoon),
  };
};

/** The close-up chunk. Its only import, and a dynamic one: the chunk is a file of its own. */
const loadCloseUp = (): Promise<CloseUpRows> => import('../design/worlds/closeup');

/**
 * The close-up chunk as a `CloseUpSource`: loaded once, the first time anyone asks (a world the
 * ship came near, or the galaxy at idle, once every world is built). Should it fail to
 * arrive (the network, a deploy that replaced it), the worlds stay at their everyday build,
 * which is the whole world at rest: nothing is lost but the close-up.
 */
export class CloseUpLoader implements CloseUpSource {
  rows: CloseUpRows | null = null;
  private asked = false;
  private gone = false;

  constructor(private readonly load: () => Promise<CloseUpRows> = loadCloseUp) {}

  request(): void {
    if (this.asked || this.gone) return;
    this.asked = true;
    this.load().then(
      (rows) => {
        if (!this.gone) this.rows = rows;
      },
      (error: unknown) => {
        console.warn('[worlds] the close-up rows could not be loaded; staying at every day', error);
      },
    );
  }

  /** Whatever arrives after this is dropped. */
  dispose(): void {
    this.gone = true;
    this.rows = null;
  }
}

export interface BodyMeshOptions {
  /** The body's manifest id: its rows, close-up rows and motions are found by it. */
  readonly id: string;
  readonly kind: BodyKind;
  /** Planned work: a maquette, drawn at `tuning.world.plannedScale` of its finished size. */
  readonly planned: boolean;
  /** Its class radius (u): the rows are modelled at radius 1. */
  readonly radius: number;
  /** For a ground whose rows name no seed of their own. */
  readonly seed: string;
  readonly recipe: BodyRecipe;
  /** The one lit material of everything its sun lights: the toon shader, with the per-vertex flags. */
  readonly material: ToonMaterial;
  readonly jobs: JobQueue;
  /** The low quality tier: one group, and nothing of it turns or moves. */
  readonly low: boolean;
  /** Nothing moves: up close, every part is drawn at its still. */
  readonly reducedMotion: boolean;
  readonly closeUp: CloseUpSource;
  /**
   * The lines of the parts still to come in a family (a planned world's blueprint), one material
   * per family that the caller owns and shares (world/Galaxy.ts). Without it, the body makes its
   * own.
   */
  readonly edges?: (family: ThemeKey) => Material;
  /**
   * Another material like `material`, in the same light, for a part whose brightness swells (it
   * needs one of its own). The body owns what it is handed, and frees it. Without it, a plain
   * toon material in `material`'s light: right for every world but one with air.
   */
  readonly another?: () => ToonMaterial;
  /**
   * Lit windows on its night side, up close (sim/windows.ts): for a world with air whose ground
   * is generated (`material` must be the AIR variant, which knows a lamp from a light).
   */
  readonly lamps?: boolean;
  /**
   * How far the viewer is when it is made, in its radii: within `farFirstRadii` its everyday
   * build comes first, else its small one. Far off when left out.
   */
  readonly distanceRadii?: number;
}

/** A part that moves, drawn: the object its rows drive, and a glowing part's own brightness. */
interface MoverView {
  readonly rows: readonly MotionRow[];
  readonly moving: Object3D;
  readonly tint: Color | null;
}

/** One level of detail as drawn: what it put in the scene, and what moves. */
interface TierView {
  readonly scope: Scope;
  /** Its meshes, lines and movers' pivots: shown together, or not at all. */
  readonly objects: readonly Object3D[];
  readonly movers: readonly MoverView[];
  /** How far its turning and held meshes reach from the centre, in radii of the rows. */
  readonly reach: number;
}

/**
 * The four builds of a world: SMALL, the everyday rows in coarse cubes, for a world seen small
 * (far off, and on the star map), which every world has from the first and keeps; FAR, the
 * everyday build, made when the ship comes within `farEnterRadii` (or the star map draws the body
 * big) and freed after `farLingerSec` past `farExitRadii`; NEAR, up close (the fine ground, the
 * close-up parts and the movers); and the star map's own variant of its rows, which only a body
 * whose rows ask for one has (About Me's Circle Line, bolder and simpler).
 */
type TierName = 'small' | 'far' | 'near' | 'map';
const TIER_NAMES: readonly TierName[] = ['small', 'far', 'near', 'map'];

/**
 * A BODY DRAWN FROM ITS ROWS, an emblem world (sim/world; design/worlds): its ground and its
 * parts, as the glue groups them (sim/world/glue.ts) into a TURNING group, which spins with the
 * planet (`turning`, which world/Galaxy.ts spins), a HELD group, which never does, and the edge
 * lines of the parts still to come (a planned world's blueprint), each riding what it outlines.
 *
 * Like world/PlanetMesh.ts: every build is a job (core/jobs.ts, a slice per frame). The body is
 * invisible until its small build exists, the coarse cubes it is drawn in while it is seen small
 * (a dot in the sky, or on the star map: 14 px across, where the everyday cubes were 12,000
 * triangles a world on the low tier); within `farEnterRadii` the everyday build is made and
 * swapped in, and freed again after `farLingerSec` outside `farExitRadii`, so that the galaxy
 * holds few worlds in full at a time. Within `nearEnterRadii` of the viewer the close-up build
 * (the fine ground, the close-up rows of design/worlds/near.ts and the parts that move) is made
 * the same way and swapped in, and it is freed after `nearLingerSec` outside `nearExitRadii`. The
 * close-up rows and the motion table are a chunk of their own (design/worlds/closeup.ts), which
 * the galaxy loads the first time any world wants it.
 *
 * Up close a part the motion table names is a MOVER, a mesh of its own at its pivot, driven every
 * frame by `drive` at the exact time of the frame: motion is a pure function of simulation time,
 * so a rebuilt engine shows the same picture, and nothing of it is a snapshot field. Under
 * reduced motion and on the low tier the close-up is the still (every part at rest, no movers);
 * on the low tier it is one group, which never turns. The star map shows the still too: the map's
 * own variant where the rows have one, else the small build, or the everyday one where the map
 * draws the body bigger than `smallBelowPx` in radius; never the close-up.
 *
 * Whoever creates one disposes it: every geometry and material it made goes with it.
 */
export class BodyMesh {
  /** The body at its size: the rows are modelled at radius 1. */
  readonly object = new Group();
  /** What turns with the planet's slow spin, or null when nothing of this body turns. */
  readonly turning: Group | null;

  private readonly scope = new Scope();
  private readonly tiers: Record<TierName, TierView | null> = {
    small: null,
    far: null,
    near: null,
    map: null,
  };
  private building: { readonly tier: TierName; readonly cancel: () => void } | null = null;
  private readonly edges: Material | null;
  /** The size of the rows' radius 1, as a share of the body's radius (planned work is smaller). */
  readonly share: number;
  /** Does it look any different up close? Unknown until the close-up rows have arrived. */
  private closer: boolean | null = null;
  /** How long the viewer has been past the exit of the close-up, and of the everyday build (s). */
  private awaySec = 0;
  private farAwaySec = 0;
  /** How far the everyday build reaches, once it has been made (radii of the rows; 0 before). */
  private farReach = 0;
  private disposed = false;

  constructor(private readonly options: BodyMeshOptions) {
    const { kind, planned, radius, recipe, low } = options;
    this.object.name = 'world';
    this.share = planned ? tuning.world.plannedScale : 1;
    this.object.scale.setScalar(radius * this.share);
    this.turning = turnsOf(kind, { still: recipe.still ?? false, low }) ? new Group() : null;
    if (this.turning) {
      this.turning.name = 'turning';
      this.object.add(this.turning);
    }
    // The lines of the parts still to come, in the family the body will wear.
    const family = recipe.ghost;
    this.edges = family
      ? (options.edges?.(family) ??
        this.scope.track(createEdgeMaterial({ color: tokens.color.system[family].base })))
      : null;
    this.scope.onDispose(() => this.object.removeFromParent());
    // The first build is what the viewer sees first: a world big on the screen never shows its
    // coarse cubes on the way to its everyday ones, and every other world is up in a moment.
    const at = options.distanceRadii ?? Infinity;
    this.build(at < tuning.world.farFirstRadii ? 'far' : 'small');
  }

  /**
   * How far the body is drawn from its centre, in its radii (1 until it is built): the small
   * build's reach, or the everyday build's once it has been made, whichever is further, so that
   * it never shrinks when the everyday build is freed.
   */
  get reach(): number {
    return Math.max(1, Math.max(this.tiers.small?.reach ?? 1, this.farReach) * this.share);
  }

  /** Is anything drawn yet? (The small build or the everyday one, whichever came first.) */
  get built(): boolean {
    return this.tiers.small !== null || this.tiers.far !== null;
  }

  /**
   * Once a frame. `distanceRadii`: how far the viewer is from the centre, in radii of this body;
   * `time`: the exact simulation time of this frame (s); `onMap`: the star map is what is shown;
   * `mapRadiusPx`: how big the map draws the body, its radius in CSS px, once it has opened all
   * the way (`mapSettled`; while it opens or closes, a world in its everyday cubes stays in them).
   */
  update(
    distanceRadii: number,
    dt: number,
    time: number,
    onMap = false,
    mapRadiusPx = 0,
    mapSettled = true,
  ): void {
    if (this.disposed) return;
    const { nearEnterRadii, nearExitRadii, nearLingerSec } = tuning.world;
    const { farEnterRadii, farExitRadii, farLingerSec, farFirstRadii } = tuning.world;
    const { tiers } = this;
    // One job at a time: the close-up waits for the everyday build, and a world builds the small
    // build or the everyday one when it first wants it (it made one of them at once).
    const bigOnMap = onMap && mapSettled && mapRadiusPx > tuning.world.voxel.smallBelowPx;
    const everyday = distanceRadii < farEnterRadii || bigOnMap;
    if (everyday) {
      this.farAwaySec = 0;
      // A world that fills the view (the ship cut to its ring: a link under reduced motion, a
      // page loaded) goes before every build waiting, its small one too if it was waiting.
      const urgent = distanceRadii < farFirstRadii;
      if (urgent && this.building?.tier === 'small' && !tiers.far) {
        this.building.cancel();
        this.building = null;
      }
      if (!tiers.far && !this.building) this.build('far', undefined, urgent);
    } else if (!tiers.small && !this.building) {
      this.build('small');
    } else if (distanceRadii > farExitRadii && tiers.far && tiers.small) {
      this.farAwaySec += dt;
      if (this.farAwaySec > farLingerSec) this.free('far');
    }
    // The map draws it small: its small build, which a world built near by has not made yet.
    if (onMap && !bigOnMap && !tiers.small && !this.building) this.build('small');
    if (distanceRadii < nearEnterRadii) {
      this.awaySec = 0;
      if (!tiers.near && !this.building && tiers.far && this.closer !== false) {
        const { closeUp } = this.options;
        const rows = closeUp.rows;
        if (rows === null) closeUp.request();
        else {
          this.closer = this.looksCloser(rows);
          // What the ship is at, before the worlds round it.
          if (this.closer) this.build('near', rows, true);
        }
      }
    } else if (distanceRadii > nearExitRadii && tiers.near) {
      this.awaySec += dt;
      if (this.awaySec > nearLingerSec) this.free('near');
    }
    const variant = typeof this.options.recipe.rows === 'function';
    if (onMap && variant && !tiers.map && !this.building && this.built) this.build('map');

    // On the map, the still: its own variant, or its cubes until that exists (or when there is
    // none), and never the close-up, whose parts move and some of which are not in the still at
    // all. Everywhere, the finest build that exists of those it may show.
    let shown: TierName | null = null;
    if (this.built) {
      const cubes: TierName = (bigOnMap || !mapSettled ? tiers.far : !tiers.small)
        ? 'far'
        : 'small';
      if (onMap) shown = tiers.map ? 'map' : cubes;
      else shown = tiers.near ? 'near' : tiers.far ? 'far' : 'small';
    }
    for (const name of TIER_NAMES) {
      const view = tiers[name];
      if (view) for (const object of view.objects) object.visible = name === shown;
    }
    if (shown === 'near') for (const mover of tiers.near?.movers ?? []) animate(mover, time);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.building?.cancel();
    this.building = null;
    this.scope.dispose();
  }

  /** Does the close-up add anything: its own rows, a finer ground, or (moving) parts that move? */
  private looksCloser(rows: CloseUpRows): boolean {
    const { id, kind, planned, low, reducedMotion } = this.options;
    const detail = (near: boolean): number => groundDetail(kind, planned, near, detailsOf(low));
    const moves = !low && !reducedMotion && (rows.MOTION[id]?.length ?? 0) > 0;
    // The close-up is finer cubes (tuning.world.voxel), except on the low tier.
    return (rows.NEAR[id]?.length ?? 0) > 0 || detail(true) !== detail(false) || moves || !low;
  }

  /** Build a tier as a job: the rows, then the groups, a slice at a time. */
  private build(tier: TierName, rows?: CloseUpRows, first = false): void {
    const { id, kind, planned, seed, recipe, low, reducedMotion, jobs } = this.options;
    const near = tier === 'near';
    const small = tier === 'small';
    const lamps = near && this.options.lamps === true;
    const motion = (near && rows?.MOTION[id]) || [];
    const closeUpRows = (near && rows?.NEAR[id]) || [];
    const job = (function* (): Generator<void, Assembly> {
      const made = yield* makeBody(id, recipe, {
        detail: groundDetail(kind, planned, near, cubeDetailsOf(low, small || tier === 'map')),
        looks: { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun },
        seed,
        map: tier === 'map',
        near: closeUpRows,
        fine: fineOf(near, low || small, tuning.world.round),
      });
      const build = lamps ? withLamps(made, recipe, seed) : made;
      yield;
      const assembly = yield* assembling(build, {
        kind,
        still: recipe.still ?? false,
        near,
        moving: near && !reducedMotion,
        low,
        motion,
      });
      // The star map's own variant stays as it is drawn: the map is flat (docs/DESIGN.md).
      if (tier === 'map') return assembly;
      return yield* inCubes(assembly, cellsOf(tier, low), near && !low);
    })();
    const cancel = jobs.add(
      job,
      (assembly) => {
        this.building = null;
        if (this.disposed) return;
        const view = this.draw(tier, assembly, motion);
        this.tiers[tier] = view;
        if (tier === 'far') this.farReach = Math.max(this.farReach, view.reach);
      },
      first,
    );
    this.building = { tier, cancel };
  }

  private free(tier: TierName): void {
    const view = this.tiers[tier];
    if (!view) return;
    this.tiers[tier] = null;
    view.scope.dispose();
  }

  /** Put a tier's groups, edges and movers in the scene, hidden until `update` shows it. */
  private draw(tier: TierName, assembly: Assembly, motion: readonly MotionRow[]): TierView {
    const { material } = this.options;
    const scope = this.scope.child();
    const objects: Object3D[] = [];
    const nodeOf = (group: DrawGroup): Object3D =>
      group === 'turn' ? (this.turning ?? this.object) : this.object;
    const place = (object: Object3D, parent: Object3D): void => {
      object.visible = false;
      parent.add(object);
      objects.push(object);
      scope.onDispose(() => object.removeFromParent());
    };
    const mesh = (packed: Packed, name: string, own: Material = material): Mesh => {
      const made = new Mesh(scope.track(geometryFrom(packed)), own);
      made.name = name;
      return made;
    };
    const lines = (positions: Float32Array, name: string): LineSegments | null => {
      if (positions.length === 0 || !this.edges) return null;
      const geometry = scope.track(new BufferGeometry());
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();
      const made = new LineSegments(geometry, this.edges);
      made.name = name;
      return made;
    };

    for (const group of ['turn', 'hold'] as const) {
      const packed = assembly[group];
      if (packed.triangleCount > 0) place(mesh(packed, `${tier}:${group}`), nodeOf(group));
      const edges = lines(assembly.edges[group], `${tier}:${group}:edges`);
      if (edges) place(edges, nodeOf(group));
    }

    // A mover hangs from the group its part is drawn in, or, when the whole body moves (the
    // Kalshi coin), from the whole body's moving mesh, which is first in the list.
    const movers: MoverView[] = [];
    let whole: Object3D | null = null;
    for (const mover of assembly.movers) {
      const rows = motion.filter(([part]) => part === mover.name);
      // A part whose brightness swells has a material of its own, lit by the same light.
      const own = rows.some((row) => row[1] === 'glow')
        ? scope.track(this.options.another?.() ?? createToonMaterial({ vertexColors: true }))
        : null;
      if (own) own.uniforms.uSunPosition.value = material.uniforms.uSunPosition.value;
      const moving = mesh(mover.mesh, `${tier}:mover:${mover.name}`, own ?? material);
      const edges = lines(mover.edges, `${tier}:mover:${mover.name}:edges`);
      if (edges) moving.add(edges);
      const pivot = new Group();
      pivot.name = `${tier}:pivot:${mover.name}`;
      pivot.matrixAutoUpdate = false;
      pivot.matrix.copy(matrixOf(mover.pivot));
      pivot.matrixWorldNeedsUpdate = true;
      pivot.add(moving);
      place(pivot, mover.name !== '*' && whole ? whole : nodeOf(mover.group));
      if (mover.name === '*') whole = moving;
      movers.push({ rows, moving, tint: own ? own.uniforms.uTint.value : null });
    }
    return {
      scope,
      objects,
      movers,
      reach: Math.max(reachOf(assembly.turn), reachOf(assembly.hold)),
    };
  }
}

/**
 * A build with the lamps of its night side (sim/windows.ts): on its generated ground, where the
 * land meets the sea. A body whose ground is a hull has none.
 */
function withLamps(build: Build, recipe: BodyRecipe, seed: string): Build {
  const [ground] = rowsOf(recipe, { map: false });
  if (Array.isArray(ground)) return build;
  const spec = ground as GroundSpec;
  const { look } = groundLook(spec, {
    planet: tuning.planet,
    terrain: tuning.terrain,
    sun: tuning.look.sun,
  });
  const own = spec.seed ?? seed;
  const lamps = windowLamps(
    build.ground,
    groundHeight(own, look),
    own,
    tuning.look.air.windows,
    colorOf('lamp.window'),
  );
  return { ...build, parts: [...build.parts, lamps] };
}

/** A pivot (rows.ts) as a matrix: its axes are the columns, its origin the translation. */
function matrixOf({ origin, basis }: Pivot): Matrix4 {
  // The basis is written row by row, as Matrix4.set takes it.
  const [r0, r1, r2] = basis;
  // prettier-ignore
  return new Matrix4().set(
    r0[0], r0[1], r0[2], origin[0],
    r1[0], r1[1], r1[2], origin[1],
    r2[0], r2[1], r2[2], origin[2],
    0, 0, 0, 1,
  );
}

/** How far any vertex of a group lies from the centre. */
function reachOf({ positions }: Packed): number {
  let most = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    most = Math.max(most, x * x + y * y + z * z);
  }
  return Math.sqrt(most);
}

/** Below this, a part is not drawn at all: a matrix of no size cannot be undone, which three minds. */
const NOTHING = 1e-4;

/**
 * Set a mover where its rows say it is at `time`, as the concept set's driver did (T, R, S). Every
 * frame, so nothing is made here.
 */
function animate({ rows, moving, tint }: MoverView, time: number): void {
  for (const row of rows) {
    const target = row[1];
    const axis = row[2];
    const value = driveValue(row, time);
    if (target === 'glow') tint?.setScalar(value);
    else if (target === 'scale') {
      if (axis === 'x' || axis === 'y' || axis === 'z') moving.scale[axis] = value;
      else moving.scale.setScalar(value);
    } else if (axis === 'x' || axis === 'y' || axis === 'z') {
      if (target === 'rot') moving.rotation[axis] = value;
      else moving.position[axis] = value;
    }
  }
  const { scale } = moving;
  moving.visible = Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) > NOTHING;
  if (!moving.visible) scale.setScalar(1);
}
