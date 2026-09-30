import type { BodyKind } from '../../data/types';
import { tuning } from '../../design/tuning';
import { normalOf, type Tri } from './kit';
import { absentAtRest, type MotionRow } from './motion';
import { BODY_PIVOT, FLAG, toPivot, type Build, type Pivot } from './rows';

/**
 * THE GLUE: what the engine does with a body once its rows have built it, as numbers (stage 2
 * writes them into three.js buffers). Two ideas:
 *
 *   1. A body sitting still is at most TWO draw calls. `turn`: the lit surface and everything
 *      attached to the ground, which turns with the planet. `hold`: the same material, never
 *      turning (rings, anything level or tilted: FLAG.hold). A ghost part (planned work still to
 *      come) keeps its triangles in those groups, as a blueprint fill, and adds ONE line pass for
 *      its edges. Unlit and glowing parts are not meshes of their own: every vertex carries an
 *      `unlit` value (0 lit, 1 flat, 2 glow) that the toon shader reads, so a lamp rides in the
 *      same buffer as the wall it hangs on. On the low tier `hold` merges into `turn` and nothing
 *      turns: one call a body, plus one for the edges of a planned one.
 *   2. Motion is a close-up privilege. Far away, on the low tier and under reduced motion, every
 *      part sits merged in its still; a part named in the motion table becomes a mesh of its own
 *      (a MOVER, drawn about its pivot) only when asked to move.
 *
 * A port of the concept set's prototype (glue.mjs); the pivots and the normals are new (the
 * engine's geometry needs normals, and a mover needs a frame of its own).
 */

/** The kinds of body whose ground turns on its axis (world/Galaxy.ts spins them slowly). */
const TURNS: ReadonlySet<BodyKind> = new Set<BodyKind>(['planet', 'moon', 'home']);

/** A group's buffers: non-indexed, three vertices a triangle (sim/meshBuilder.ts's MeshData, plus `unlit`). */
export interface Packed {
  readonly positions: Float32Array;
  /** One normal a triangle, on each of its vertices: flat shading. */
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  /** 0 lit, 1 flat, 2 glow, on each vertex. */
  readonly unlit: Float32Array;
  readonly triangleCount: number;
}

/** A part that moves, as a mesh of its own in its pivot's frame. */
export interface Mover {
  /** The part's name, or '*' for the whole body (every part without a row of its own). */
  readonly name: string;
  /** Where to put the mesh: its origin and its axes, in the body's frame. */
  readonly pivot: Pivot;
  readonly mesh: Packed;
}

export interface Assembly {
  /** Turns with the planet (for a body that turns; otherwise empty). */
  readonly turn: Packed;
  /** Never turns. */
  readonly hold: Packed;
  /** The moving parts: the whole body first, if it moves, then each part with a row of its own. */
  readonly movers: readonly Mover[];
  /** The ghost parts' edges, as line-segment positions (two vertices a segment). */
  readonly edges: Float32Array;
}

export interface AssembleOptions {
  readonly kind: BodyKind;
  /** It never turns (BodyRecipe.still). */
  readonly still?: boolean;
  /** Include the close-up parts (the build must have been given them). */
  readonly near?: boolean;
  /** Give the moving parts meshes of their own, so that the motion table can drive them. */
  readonly moving?: boolean;
  /** The low quality tier: one group, nothing turns. */
  readonly low?: boolean;
  /** The body's rows of the motion table (design/worlds/motion.ts). */
  readonly motion?: readonly MotionRow[];
}

/**
 * Split a build into its draw groups and pack each one. Everything is in the body's frame at
 * radius 1 (scale it by the body's radius), except each mover, which is in its pivot's frame.
 */
export function assemble(
  build: Build,
  { kind, still = false, near = false, moving = false, low = false, motion = [] }: AssembleOptions,
): Assembly {
  const movers = new Set(moving ? motion.map((row) => row[0]) : []);
  // The whole body moves as one (the Kalshi coin rocks); a part with a row of its own (its crane)
  // still gets its own mesh, which the caller hangs inside the whole one.
  const whole = movers.has('*');
  // Drawn still, a part whose still is empty (the flame, the confetti) is not drawn at all.
  const absent = moving ? new Set<string>() : absentAtRest(motion);
  const turns = TURNS.has(kind) && !still && !low;
  const turn: Tri[] = [];
  const hold: Tri[] = [];
  const move: Tri[] = [];
  const own = new Map<string, { pivot: Pivot; tris: Tri[] }>();
  const ghosts: Tri[] = [];

  for (const t of build.ground) (whole ? move : turns ? turn : hold).push(t);
  for (const part of build.parts) {
    if (part.tier === 'near' && !near) continue;
    if (part.flags & FLAG.ghost) ghosts.push(...part.tris);
    if (absent.has(part.name)) continue;
    if (movers.has(part.name)) {
      own.set(part.name, {
        pivot: part.pivot,
        tris: part.tris.map((t) => ({
          ...t,
          p: [0, 1, 2].flatMap((i) =>
            toPivot([t.p[i * 3] ?? 0, t.p[i * 3 + 1] ?? 0, t.p[i * 3 + 2] ?? 0], part.pivot),
          ),
        })),
      });
    } else if (whole) move.push(...part.tris);
    else (!turns || part.flags & FLAG.hold ? hold : turn).push(...part.tris);
  }
  // Low tier: nothing turned, so everything is in `hold`, and it is drawn as the one group.
  return {
    turn: pack(low ? hold : turn),
    hold: pack(low ? [] : hold),
    movers: [
      ...(whole ? [{ name: '*', pivot: BODY_PIVOT, mesh: pack(move) }] : []),
      ...[...own].map(([name, { pivot, tris }]) => ({ name, pivot, mesh: pack(tris) })),
    ],
    edges: wire(ghosts),
  };
}

/** Draw calls: the groups with anything in them, the edge pass, and one a mover. */
export function callsOf({ turn, hold, movers, edges }: Assembly): number {
  return (
    (turn.triangleCount > 0 ? 1 : 0) +
    (hold.triangleCount > 0 ? 1 : 0) +
    (edges.length > 0 ? 1 : 0) +
    movers.length
  );
}

/** Triangle records as buffers. */
export function pack(tris: readonly Tri[]): Packed {
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  const colors = new Float32Array(tris.length * 9);
  const unlit = new Float32Array(tris.length * 3);
  tris.forEach((t, i) => {
    positions.set(t.p, i * 9);
    const n = normalOf(t);
    for (let v = 0; v < 3; v += 1) {
      normals.set(n, i * 9 + v * 3);
      colors.set(t.c, i * 9 + v * 3);
      unlit[i * 3 + v] = t.g;
    }
  });
  return { positions, normals, colors, unlit, triangleCount: tris.length };
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

/**
 * The detail of a body's ground (sim/planet.ts: 20 * (detail + 1)^2 facets) for its kind, as the
 * worlds' budget was drawn up (vocabulary.md, 10.4): a planet 8 and 14 up close, a moon 3, a sun
 * 4, and planned work a maquette that does not sharpen up close (6 for a planet, 3 for a moon).
 * A station, a satellite and a relay are hulls, which have no detail.
 */
export function groundDetail(kind: BodyKind, planned: boolean, near: boolean): number {
  const { world } = tuning;
  switch (kind) {
    case 'sun':
      return world.detailSun;
    case 'moon':
      return planned ? world.detailMaquetteMoon : world.detailMoon;
    case 'planet':
    case 'home':
      return planned ? world.detailMaquettePlanet : near ? world.detailNear : world.detailPlanet;
    default:
      return 0;
  }
}
