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
import { driveValue, type MotionRow } from '../sim/world/motion';
import { makeBody, type BodyRecipe, type PartRow, type Pivot } from '../sim/world/rows';

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

/** A ground's detail by kind: the tuning's, with a sun's coarser ball on the low tier. */
const detailsOf = (low: boolean): GroundDetails =>
  low ? { ...tuning.world, detailSun: tuning.look.sun.detailLow } : tuning.world;

/** The close-up chunk. Its only import, and a dynamic one: the chunk is a file of its own. */
const loadCloseUp = (): Promise<CloseUpRows> => import('../design/worlds/closeup');

/**
 * The close-up chunk as a `CloseUpSource`: loaded once, the first time anyone asks (a world the
 * ship came near, or the galaxy at idle, once every everyday world is built). Should it fail to
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
 * The three builds of a world: every day (flight, and the map), up close (the fine ground, the
 * close-up parts and the movers), and the star map's own variant of its rows, which only a body
 * whose rows ask for one has (About Me's Circle Line, bolder and simpler).
 */
type TierName = 'far' | 'near' | 'map';
const TIER_NAMES: readonly TierName[] = ['far', 'near', 'map'];

/**
 * A BODY DRAWN FROM ITS ROWS, an emblem world (sim/world; design/worlds): its ground and its
 * parts, as the glue groups them (sim/world/glue.ts) into a TURNING group, which spins with the
 * planet (`turning`, which world/Galaxy.ts spins), a HELD group, which never does, and the edge
 * lines of the parts still to come (a planned world's blueprint), each riding what it outlines.
 *
 * Like world/PlanetMesh.ts: the everyday build is a job (core/jobs.ts, a slice per frame) and the
 * body is invisible until it exists; within `nearEnterRadii` of the viewer the close-up build
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
 * own variant where the rows have one, else the everyday build, never the close-up.
 *
 * Whoever creates one disposes it: every geometry and material it made goes with it.
 */
export class BodyMesh {
  /** The body at its size: the rows are modelled at radius 1. */
  readonly object = new Group();
  /** What turns with the planet's slow spin, or null when nothing of this body turns. */
  readonly turning: Group | null;

  private readonly scope = new Scope();
  private readonly tiers: Record<TierName, TierView | null> = { far: null, near: null, map: null };
  private building: { readonly tier: TierName; readonly cancel: () => void } | null = null;
  private readonly edges: Material | null;
  /** The size of the rows' radius 1, as a share of the body's radius (planned work is smaller). */
  private readonly share: number;
  /** Does it look any different up close? Unknown until the close-up rows have arrived. */
  private closer: boolean | null = null;
  private awaySec = 0;
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
    this.build('far');
  }

  /** How far the body is drawn from its centre, in its radii (1 until it is built). */
  get reach(): number {
    return Math.max(1, (this.tiers.far?.reach ?? 1) * this.share);
  }

  /** Is anything drawn yet? */
  get built(): boolean {
    return this.tiers.far !== null;
  }

  /**
   * Once a frame. `distanceRadii`: how far the viewer is from the centre, in radii of this body;
   * `time`: the exact simulation time of this frame (s); `onMap`: the star map is what is shown.
   */
  update(distanceRadii: number, dt: number, time: number, onMap = false): void {
    if (this.disposed) return;
    const { nearEnterRadii, nearExitRadii, nearLingerSec } = tuning.world;
    if (distanceRadii < nearEnterRadii) {
      this.awaySec = 0;
      // One job at a time: the close-up waits for the everyday build to exist.
      if (!this.tiers.near && !this.building && this.built && this.closer !== false) {
        const { closeUp } = this.options;
        const rows = closeUp.rows;
        if (rows === null) closeUp.request();
        else {
          this.closer = this.looksCloser(rows);
          if (this.closer) this.build('near', rows);
        }
      }
    } else if (distanceRadii > nearExitRadii && this.tiers.near) {
      this.awaySec += dt;
      if (this.awaySec > nearLingerSec) this.free('near');
    }
    const variant = typeof this.options.recipe.rows === 'function';
    if (onMap && variant && !this.tiers.map && !this.building && this.built) this.build('map');

    // On the map, the still: its own variant, or the everyday build until that exists (or when
    // there is none), and never the close-up, whose parts move and some of which are not in the
    // still at all.
    const { tiers } = this;
    let shown: TierName | null = null;
    if (this.built) shown = onMap ? (tiers.map ? 'map' : 'far') : tiers.near ? 'near' : 'far';
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
    return (rows.NEAR[id]?.length ?? 0) > 0 || detail(true) !== detail(false) || moves;
  }

  /** Build a tier as a job: the rows, then the groups, a slice at a time. */
  private build(tier: TierName, rows?: CloseUpRows): void {
    const { id, kind, planned, seed, recipe, low, reducedMotion, jobs } = this.options;
    const near = tier === 'near';
    const motion = (near && rows?.MOTION[id]) || [];
    const closeUpRows = (near && rows?.NEAR[id]) || [];
    const job = (function* (): Generator<void, Assembly> {
      const build = yield* makeBody(id, recipe, {
        detail: groundDetail(kind, planned, near, detailsOf(low)),
        looks: { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun },
        seed,
        map: tier === 'map',
        near: closeUpRows,
        fine: fineOf(near, low, tuning.world.round),
      });
      yield;
      return yield* assembling(build, {
        kind,
        still: recipe.still ?? false,
        near,
        moving: near && !reducedMotion,
        low,
        motion,
      });
    })();
    const cancel = jobs.add(job, (assembly) => {
      this.building = null;
      if (this.disposed) return;
      this.tiers[tier] = this.draw(tier, assembly, motion);
    });
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
        ? scope.track(createToonMaterial({ vertexColors: true }))
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
