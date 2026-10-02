import type { BodyKind } from '../../data/types';
import type { Rgb } from '../meshBuilder';
import { finish } from '../planet';
import { normalOf, type Tri } from './kit';
import { absentAtRest, type MotionRow } from './motion';
import { colorOf } from './palette';
import { BODY_PIVOT, FLAG, toPivot, type Build, type Pivot } from './rows';

/**
 * THE GLUE: what the engine does with a body once its rows have built it, as numbers (stage 2
 * writes them into three.js buffers). Three ideas:
 *
 *   1. A body sitting still is at most TWO draw calls. `turn`: the lit surface and everything
 *      attached to the ground, which turns with the planet. `hold`: the same material, never
 *      turning (rings, anything level or tilted: FLAG.hold). Unlit and glowing parts are not
 *      meshes of their own: every vertex carries an `unlit` value (0 lit, 1 flat, 2 glow) that
 *      the toon shader reads, so a lamp rides in the same buffer as the wall it hangs on. On the
 *      low tier nothing turns and nothing moves: everything is in `hold`, one call a body.
 *   2. A GHOST part (FLAG.ghost: planned work still to come) is a blueprint (vocabulary.md,
 *      section 6): its triangles stay in their group as a navy fill (`color.space.700`, whatever
 *      the rows painted them), and its feature edges are drawn as lines in its family's base
 *      (`BodyRecipe.ghost`). The lines ride with the triangles they outline: `edges.turn`,
 *      `edges.hold`, or a mover's own `edges`, so a line never slides off its part. Each set is
 *      one line-segment call.
 *   3. Motion is a close-up privilege. Far away, on the low tier and under reduced motion, every
 *      part sits merged in its still; a part named in the motion table becomes a mesh of its own
 *      (a MOVER, drawn about its pivot) only when asked to move, and it says which group it rides
 *      with (`group`), by the same rule as the still: a mover never turns when its part would not.
 *
 * A DECAL part (FLAG.decal: a grid or a number painted on the ground) is lifted off the ground in
 * its own rows by a few thousandths of a radius, which is plenty up close; far away (the star
 * map) the depth buffer is coarser than that lift, so the flag is kept on every vertex (`decal`)
 * for the shader to pull those vertices a hair toward the camera, in the same draw call.
 *
 * A port of the concept set's prototype (glue.mjs); the pivots, the normals, the groups of the
 * movers and the per-group edges are new (the engine's geometry needs normals, and a mover needs
 * a frame of its own).
 */

/**
 * The kinds of body whose ground turns with the planet's slow spin. A policy of the worlds:
 * world/Galaxy.ts spins every generated body but the satellite; a world of its own turns only
 * when it is a planet, a moon or home. A sun's ball, the station, the satellite and a relay hold
 * still (their props read one way round: a relay's arrow points away from home, a sun's brackets
 * and the Circle Line's stops at the bearings they name), and so does a body whose recipe says
 * `still`. Galaxy spins what `turnsOf` says turns, and nothing else of a world.
 */
const TURNS: ReadonlySet<BodyKind> = new Set<BodyKind>(['planet', 'moon', 'home']);

/** What a ghost part's triangles are packed in: the navy of a blueprint. */
const BLUEPRINT: Rgb = colorOf('space.700');

/**
 * A group's buffers: non-indexed, three vertices a triangle (sim/meshBuilder.ts's MeshData, plus
 * two flags on every vertex).
 */
export interface Packed {
  readonly positions: Float32Array;
  /** One normal a triangle, on each of its vertices: flat shading. */
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  /** 0 lit, 1 flat, 2 glow, on each vertex. */
  readonly unlit: Float32Array;
  /** 1 on each vertex of a decal part (FLAG.decal), else 0: for a depth offset. */
  readonly decal: Uint8Array;
  readonly triangleCount: number;
}

/** Which group a thing rides with: the one that turns with the planet, or the one that holds. */
export type Group = 'turn' | 'hold';

/** A part that moves, as a mesh of its own in its pivot's frame. */
export interface Mover {
  /** The part's name, or '*' for the whole body (every part without a row of its own). */
  readonly name: string;
  /**
   * What it hangs from. 'turn': the frame that turns with the planet; 'hold': the body's own.
   * When the whole body moves ('*' first in the list), every other mover hangs inside it and
   * has its group.
   */
  readonly group: Group;
  /** Where to put the mesh: its origin and its axes, in the frame of what it hangs from. */
  readonly pivot: Pivot;
  readonly mesh: Packed;
  /** Its ghost edges (for the whole body: every ghost edge it carries), in its pivot's frame. */
  readonly edges: Float32Array;
}

/**
 * The edge lines of the ghost parts, by what they ride, as line-segment positions (two vertices a
 * segment). Each non-empty set is one line-segment draw call.
 */
export interface Edges {
  /** Outlining ghosts in `turn`, in the body's frame. */
  readonly turn: Float32Array;
  /** Outlining ghosts in `hold`, in the body's frame. */
  readonly hold: Float32Array;
  /** The colour of every edge line of the body, a mover's too: its ghost family's base, or null. */
  readonly color: Rgb | null;
}

export interface Assembly {
  /** Turns with the planet (for a body that turns, and never on the low tier; otherwise empty). */
  readonly turn: Packed;
  /** Never turns. */
  readonly hold: Packed;
  /**
   * The moving parts: the whole body first, if it moves, then each part with a row of its own.
   * Never on the low tier.
   */
  readonly movers: readonly Mover[];
  readonly edges: Edges;
}

export interface AssembleOptions {
  readonly kind: BodyKind;
  /** It never turns (BodyRecipe.still). */
  readonly still?: boolean;
  /** Include the close-up parts (the build must have been given them). */
  readonly near?: boolean;
  /** Give the moving parts meshes of their own, so that the motion table can drive them. */
  readonly moving?: boolean;
  /** The low quality tier: nothing turns and nothing moves, so everything is in `hold`. */
  readonly low?: boolean;
  /** The body's rows of the motion table (design/worlds/motion.ts). */
  readonly motion?: readonly MotionRow[];
}

/** A triangle on its way into a group: with its part's decal flag. */
export type Face = Tri & { readonly decal?: boolean };

/** Where triangles go, and which of them are ghosts (whose edges are drawn). */
interface Sink {
  readonly faces: Face[];
  readonly ghosts: Face[];
}
const sink = (): Sink => ({ faces: [], ghosts: [] });
const put = (into: Sink, faces: readonly Face[], ghost: boolean): void => {
  into.faces.push(...faces);
  if (ghost) into.ghosts.push(...faces);
};

/**
 * Does a body's ground turn with the planet's slow spin? Its kind must (TURNS), and it must not be
 * still (BodyRecipe.still) or on the low tier, where nothing turns. world/BodyMesh.ts asks this
 * too, before its body is built, to know whether it has a turning group to spin.
 */
export function turnsOf(
  kind: BodyKind,
  { still = false, low = false }: { readonly still?: boolean; readonly low?: boolean } = {},
): boolean {
  return TURNS.has(kind) && !still && !low;
}

/**
 * Split a build into its draw groups and pack each one. Everything is in the body's frame at
 * radius 1 (scale it by the body's radius), except each mover, which is in its pivot's frame.
 */
export const assemble = (build: Build, options: AssembleOptions): Assembly =>
  finish(assembling(build, options));

/**
 * `assemble`, as a generator that pauses after each group it packs, so that core/jobs.ts can
 * spread a close-up body (thousands of triangles, a few milliseconds) over frames.
 */
export function* assembling(
  build: Build,
  { kind, still = false, near = false, moving = false, low = false, motion = [] }: AssembleOptions,
): Generator<void, Assembly> {
  // The low tier draws the still, and nothing of it turns or moves.
  const live = moving && !low;
  const own = new Set(live ? motion.map((row) => row[0]) : []);
  // The whole body moves as one (the Kalshi coin rocks); a part with a row of its own (its crane)
  // still gets its own mesh, which the caller hangs inside the whole one.
  const whole = own.has('*');
  const turns = turnsOf(kind, { still, low });
  // A whole body that also turned would carry its held parts round with it.
  if (whole && turns) throw new Error(`${build.id}: a body that moves as a whole must be still`);
  // Drawn still, a part whose still is empty (the flame, the confetti) is not drawn at all.
  const absent = live ? new Set<string>() : absentAtRest(motion);
  const groupOf = (flags: number): Group => (turns && !(flags & FLAG.hold) ? 'turn' : 'hold');
  const groups: Readonly<Record<Group, Sink>> = { turn: sink(), hold: sink() };
  const body = sink();
  const movers = new Map<string, { group: Group; pivot: Pivot; into: Sink }>();

  put(whole ? body : groups[groupOf(0)], build.ground, false);
  for (const part of build.parts) {
    if (part.tier === 'near' && !near) continue;
    if (absent.has(part.name)) continue;
    const ghost = (part.flags & FLAG.ghost) !== 0;
    const decal = (part.flags & FLAG.decal) !== 0;
    const faces = part.tris.map((t): Face => ({ ...t, c: ghost ? BLUEPRINT : t.c, decal }));
    if (own.has(part.name)) {
      const into = sink();
      put(
        into,
        faces.map((t) => ({
          ...t,
          p: [0, 1, 2].flatMap((i) =>
            toPivot([t.p[i * 3] ?? 0, t.p[i * 3 + 1] ?? 0, t.p[i * 3 + 2] ?? 0], part.pivot),
          ),
        })),
        ghost,
      );
      movers.set(part.name, { group: groupOf(whole ? 0 : part.flags), pivot: part.pivot, into });
    } else put(whole ? body : groups[groupOf(part.flags)], faces, ghost);
  }
  yield;
  const turn = pack(groups.turn.faces);
  yield;
  const hold = pack(groups.hold.faces);
  yield;
  const moved: Mover[] = [];
  if (whole) {
    moved.push({
      name: '*',
      group: groupOf(0),
      pivot: BODY_PIVOT,
      mesh: pack(body.faces),
      edges: wire(body.ghosts),
    });
    yield;
  }
  for (const [name, { group, pivot, into }] of movers) {
    moved.push({ name, group, pivot, mesh: pack(into.faces), edges: wire(into.ghosts) });
    yield;
  }
  return {
    turn,
    hold,
    movers: moved,
    edges: {
      turn: wire(groups.turn.ghosts),
      hold: wire(groups.hold.ghosts),
      color: build.ghost ? colorOf(`${build.ghost}.base`) : null,
    },
  };
}

/** Draw calls: the groups with anything in them, each set of edges, and a mover (with its edges). */
export function callsOf({ turn, hold, movers, edges }: Assembly): number {
  const any = (n: number): number => (n > 0 ? 1 : 0);
  return (
    any(turn.triangleCount) +
    any(hold.triangleCount) +
    any(edges.turn.length) +
    any(edges.hold.length) +
    movers.reduce((sum, mover) => sum + 1 + any(mover.edges.length), 0)
  );
}

/** Triangle records as buffers. */
export function pack(tris: readonly Face[]): Packed {
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  const colors = new Float32Array(tris.length * 9);
  const unlit = new Float32Array(tris.length * 3);
  const decal = new Uint8Array(tris.length * 3);
  tris.forEach((t, i) => {
    positions.set(t.p, i * 9);
    const n = normalOf(t);
    for (let v = 0; v < 3; v += 1) {
      normals.set(n, i * 9 + v * 3);
      colors.set(t.c, i * 9 + v * 3);
      unlit[i * 3 + v] = t.g;
      decal[i * 3 + v] = t.decal ? 1 : 0;
    }
  });
  return { positions, normals, colors, unlit, decal, triangleCount: tris.length };
}

/**
 * The edge lines of ghost parts: the feature edges of the meshes they already are (a boundary,
 * or a fold sharper than about 8 degrees), each once, as line-segment positions. No second model.
 */
export function wire(tris: readonly Tri[]): Float32Array {
  const edges = new Map<
    string,
    { a: number[]; c: number[]; normals: ReturnType<typeof normalOf>[] }
  >();
  const key = (p: readonly number[]): string => p.map((v) => Math.round(v * 1e3)).join();
  for (const t of tris) {
    const n = normalOf(t);
    for (let i = 0; i < 3; i += 1) {
      const j = (i + 1) % 3;
      const a = t.p.slice(i * 3, i * 3 + 3);
      const c = t.p.slice(j * 3, j * 3 + 3);
      const k = [key(a), key(c)].sort().join('|');
      const edge = edges.get(k);
      if (edge) edge.normals.push(n);
      else edges.set(k, { a, c, normals: [n] });
    }
  }
  const out: number[] = [];
  for (const { a, c, normals } of edges.values()) {
    const [n0, n1] = normals;
    if (!n0 || !n1 || n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0.99) out.push(...a, ...c);
  }
  return new Float32Array(out);
}

/** A ground's detail by the kind of body (design/tuning.ts, `world`): 20 * (detail + 1)^2 facets. */
export interface GroundDetails {
  readonly detailPlanet: number;
  readonly detailNear: number;
  readonly detailMoon: number;
  readonly detailSun: number;
  readonly detailMaquettePlanet: number;
  readonly detailMaquetteMoon: number;
}

/**
 * The detail of a body's ground for its kind, as the worlds' budget was drawn up (vocabulary.md,
 * 10.4): a planet 8 and 14 up close, a moon 3, a sun 9 (it was 4: its living surface needs the
 * facets), and planned work a maquette that does not sharpen up close (6 for a planet, 3 for a
 * moon). A station, a satellite and a relay are hulls, which have no detail.
 */
export function groundDetail(
  kind: BodyKind,
  planned: boolean,
  near: boolean,
  details: GroundDetails,
): number {
  switch (kind) {
    case 'sun':
      return details.detailSun;
    case 'moon':
      return planned ? details.detailMaquetteMoon : details.detailMoon;
    case 'planet':
    case 'home':
      return planned
        ? details.detailMaquettePlanet
        : near
          ? details.detailNear
          : details.detailPlanet;
    default:
      return 0;
  }
}
