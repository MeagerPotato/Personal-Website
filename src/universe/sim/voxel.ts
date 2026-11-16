/**
 * THE VOXEL LOOK (docs/DESIGN.md, "Voxel worlds"): any triangle mesh made of small cubes.
 *
 * Every world is still built as it always was (sim/planet.ts, sim/world): a ground and its parts,
 * in triangles, with their colours and flags. This turns that mesh into cubes on a grid of
 * `cell` units: each cube takes the colour of the surface that passes through it, the inside is
 * filled, and only the faces that look out at empty space are kept. Each kept corner carries how
 * much of the space round it is filled (`shade`: ambient occlusion, as the classic voxel games
 * do it), which the toon shader multiplies in: an open face is exactly its colour, an inside
 * corner a little darker. Nothing shines.
 *
 * Pure (no three.js, no DOM, no clock) and a GENERATOR, so a big world is spread over frames
 * (core/jobs.ts). The output is the same shape as the input (`Packed`), plus `shade`.
 */

/** What goes in: a non-indexed mesh, as the world builders make it (sim/world/glue.ts, `Packed`). */
export interface VoxelInput {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  /** Eight numbers a vertex (a side, then an over: rgb and where the vertex stands on its line). */
  readonly sides?: Float32Array | undefined;
  /** 0 lit, 1 flat, 2 glow, 3 a lamp, above 4 a sun's surface. */
  readonly unlit?: Float32Array | Uint8Array | undefined;
  /** 1 on a decal (a grid painted on the ground): it wins the cube it passes through. */
  readonly decal?: Uint8Array | undefined;
  readonly triangleCount: number;
}

/** What comes out: cubes' outer faces, two triangles each. */
export interface VoxelMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly sides: Float32Array;
  readonly bends: Float32Array;
  readonly unlit: Float32Array;
  readonly decal: Uint8Array;
  /** How open each corner is, 0 to 255 (255: nothing round it). */
  readonly shade: Uint8Array;
  /**
   * Four numbers a vertex, for a bevel drawn by the shader: where the corner is on its face, in
   * cubes along the face's two axes, then 0, then 1 (or all four 0: no bevel).
   */
  readonly cell?: Float32Array;
  readonly triangleCount: number;
}

export interface VoxelOptions {
  /** The size of a cube, in the mesh's own units. */
  readonly cell: number;
  /** No grid is wider than this many cubes along any axis: the cube grows instead. */
  readonly maxCells?: number;
  /** How dark the darkest corner is (0: black, 1: no occlusion at all). */
  readonly occlusion?: number;
  /** Triangles rasterised between two pauses. */
  readonly slice?: number;
  /** Carry where each corner is on its face (`VoxelMesh.cell`), for the shader's bevel. */
  readonly bevel?: boolean;
}

/** A corner's openness for 0..3 filled neighbours, as a share of the darkest (classic voxel AO). */
const AO_STEPS = [1, 0.62, 0.3, 0] as const;

/** A colour key: rgb packed into 3 x 10 bits, never 0 (0 is "empty"). */
const EMPTY = 0;
const INSIDE = 1;

interface Grid {
  readonly cell: number;
  readonly origin: readonly [number, number, number];
  readonly n: readonly [number, number, number];
}

function gridOf(input: VoxelInput, options: VoxelOptions): Grid {
  const p = input.positions;
  let min0 = Infinity;
  let min1 = Infinity;
  let min2 = Infinity;
  let max0 = -Infinity;
  let max1 = -Infinity;
  let max2 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] ?? 0;
    const y = p[i + 1] ?? 0;
    const z = p[i + 2] ?? 0;
    if (x < min0) min0 = x;
    if (y < min1) min1 = y;
    if (z < min2) min2 = z;
    if (x > max0) max0 = x;
    if (y > max1) max1 = y;
    if (z > max2) max2 = z;
  }
  if (!Number.isFinite(min0)) return { cell: options.cell, origin: [0, 0, 0], n: [1, 1, 1] };
  const most = options.maxCells ?? 192;
  const extent = Math.max(max0 - min0, max1 - min1, max2 - min2);
  const cell = Math.max(options.cell, extent / (most - 4));
  // One empty cube all round, so that the outside is connected.
  const origin: [number, number, number] = [
    min0 - cell * 1.5,
    min1 - cell * 1.5,
    min2 - cell * 1.5,
  ];
  const n: [number, number, number] = [
    Math.ceil((max0 - min0) / cell) + 4,
    Math.ceil((max1 - min1) / cell) + 4,
    Math.ceil((max2 - min2) / cell) + 4,
  ];
  return { cell, origin, n };
}

/**
 * Turn a mesh into cubes. The result's `triangleCount` is 0 for an empty mesh. Deterministic: the
 * same mesh and options give the same cubes, bit for bit.
 */
export function* voxelize(input: VoxelInput, options: VoxelOptions): Generator<void, VoxelMesh> {
  const grid = gridOf(input, options);
  const { cell, origin } = grid;
  const [nx, ny, nz] = grid.n;
  const total = nx * ny * nz;
  // Per cube: 0 empty, 1 filled inside, else a colour index + 2.
  const fill = new Uint16Array(total);
  const palette: number[] = [];
  const paletteOf = new Map<string, number>();
  const colorIndex = (r: number, g: number, b: number, unlit: number): number => {
    const key = `${r.toFixed(5)},${g.toFixed(5)},${b.toFixed(5)},${unlit}`;
    let at = paletteOf.get(key);
    // A colour index is 16 bits: past that many colours (never seen), the last one is reused.
    if (at === undefined && palette.length / 4 >= 65000) return palette.length / 4 + 1;
    if (at === undefined) {
      at = palette.length / 4;
      palette.push(r, g, b, unlit);
      paletteOf.set(key, at);
    }
    return at + 2;
  };
  const decalCell = new Uint8Array(total);

  const p = input.positions;
  const c = input.colors;
  const sides = input.sides;
  const slice = options.slice ?? 400;
  const step = cell * 0.4;
  const index = (x: number, y: number, z: number): number => (z * ny + y) * nx + x;

  for (let t = 0; t < input.triangleCount; t += 1) {
    const v = t * 9;
    const ax = p[v] ?? 0;
    const ay = p[v + 1] ?? 0;
    const az = p[v + 2] ?? 0;
    const bx = p[v + 3] ?? 0;
    const by = p[v + 4] ?? 0;
    const bz = p[v + 5] ?? 0;
    const cx = p[v + 6] ?? 0;
    const cy = p[v + 7] ?? 0;
    const cz = p[v + 8] ?? 0;
    const longest = Math.max(
      Math.hypot(bx - ax, by - ay, bz - az),
      Math.hypot(cx - bx, cy - by, cz - bz),
      Math.hypot(ax - cx, ay - cy, az - cz),
    );
    const steps = Math.max(1, Math.ceil(longest / step));
    const unlit = input.unlit?.[t * 3] ?? 0;
    // A decal and a lamp (a lit window, 3) stand a hair off the ground and win its cube.
    const isDecal = (input.decal?.[t * 3] ?? 0) > 0 || (unlit > 2.5 && unlit < 3.5);
    const base: [number, number, number] = [c[v] ?? 0, c[v + 1] ?? 0, c[v + 2] ?? 0];
    // A triangle with lines through it: its other colours and where each corner stands.
    const s = t * 24;
    const sideK = sides ? [sides[s + 3] ?? 0, sides[s + 11] ?? 0, sides[s + 19] ?? 0] : null;
    const overK = sides ? [sides[s + 7] ?? 0, sides[s + 15] ?? 0, sides[s + 23] ?? 0] : null;
    const hasSide = sideK !== null && (sideK[0] !== 0 || sideK[1] !== 0 || sideK[2] !== 0);
    const hasOver = overK !== null && (overK[0] !== 0 || overK[1] !== 0 || overK[2] !== 0);
    const plain = colorIndex(base[0], base[1], base[2], unlit);
    const sideIndex =
      hasSide && sides
        ? colorIndex(sides[s] ?? 0, sides[s + 1] ?? 0, sides[s + 2] ?? 0, unlit)
        : plain;
    const overIndex =
      hasOver && sides
        ? colorIndex(sides[s + 4] ?? 0, sides[s + 5] ?? 0, sides[s + 6] ?? 0, unlit)
        : plain;

    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps - i; j += 1) {
        const u = i / steps;
        const w = j / steps;
        const a = 1 - u - w;
        const x = Math.floor((ax * a + bx * u + cx * w - origin[0]) / cell);
        const y = Math.floor((ay * a + by * u + cy * w - origin[1]) / cell);
        const z = Math.floor((az * a + bz * u + cz * w - origin[2]) / cell);
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        const at = index(x, y, z);
        if (fill[at] !== EMPTY && !(isDecal && decalCell[at] === 0)) continue;
        let colour = plain;
        if (
          hasOver &&
          overK &&
          a * (overK[0] ?? 0) + u * (overK[1] ?? 0) + w * (overK[2] ?? 0) > 0.5
        )
          colour = overIndex;
        else if (
          hasSide &&
          sideK &&
          a * (sideK[0] ?? 0) + u * (sideK[1] ?? 0) + w * (sideK[2] ?? 0) > 0.5
        )
          colour = sideIndex;
        fill[at] = colour;
        if (isDecal) decalCell[at] = 1;
      }
    }
    if ((t + 1) % slice === 0) yield;
  }
  yield;

  // The outside: every empty cube a walk from the grid's corner reaches. The rest is inside.
  const outside = new Uint8Array(total);
  // A ring: the walk's front is never more than a few planes of the grid.
  const ring = Math.min(total, Math.max(4096, nx * ny * 8, ny * nz * 8, nx * nz * 8));
  const queue = new Int32Array(ring);
  let head = 0;
  let tail = 0;
  outside[0] = 1;
  queue[tail++ % ring] = 0;
  const plane = nx * ny;
  while (head < tail) {
    const at = queue[head++ % ring] ?? 0;
    const x = at % nx;
    const y = Math.floor(at / nx) % ny;
    const z = Math.floor(at / plane);
    const visit = (next: number): void => {
      if (outside[next] === 0 && fill[next] === EMPTY) {
        outside[next] = 1;
        queue[tail++ % ring] = next;
      }
    };
    if (x > 0) visit(at - 1);
    if (x < nx - 1) visit(at + 1);
    if (y > 0) visit(at - nx);
    if (y < ny - 1) visit(at + nx);
    if (z > 0) visit(at - plane);
    if (z < nz - 1) visit(at + plane);
  }
  for (let at = 0; at < total; at += 1)
    if (fill[at] === EMPTY && outside[at] === 0) fill[at] = INSIDE;
  yield;

  // The faces that look out, with each corner's occlusion.
  const solid = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz
      ? 0
      : fill[index(x, y, z)] !== EMPTY
        ? 1
        : 0;
  const darkest = options.occlusion ?? 0.55;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const unlitOut: number[] = [];
  const shade: number[] = [];
  const cells: number[] = [];
  const bevel = options.bevel === true;
  const cube = [0, 0, 0];
  const corner = [0, 0, 0];
  const out = [0, 0, 0];

  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const value = fill[index(x, y, z)] ?? EMPTY;
        if (value < 2) continue;
        const k = (value - 2) * 4;
        const r = palette[k] ?? 0;
        const g = palette[k + 1] ?? 0;
        const b = palette[k + 2] ?? 0;
        const unlit = palette[k + 3] ?? 0;
        cube[0] = x;
        cube[1] = y;
        cube[2] = z;
        for (let d = 0; d < 3; d += 1) {
          for (const sign of [1, -1]) {
            out[0] = x;
            out[1] = y;
            out[2] = z;
            out[d] = (out[d] ?? 0) + sign;
            if (solid(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)) continue;
            const u = (d + 1) % 3;
            const w = (d + 2) % 3;
            const order = sign > 0 ? QUAD_POS : QUAD_NEG;
            const ao: number[] = [];
            const at: number[][] = [];
            const grid: number[] = [];
            for (const [cu, cw] of order) {
              corner[0] = cube[0] ?? 0;
              corner[1] = cube[1] ?? 0;
              corner[2] = cube[2] ?? 0;
              corner[d] = (corner[d] ?? 0) + (sign > 0 ? 1 : 0);
              corner[u] = (corner[u] ?? 0) + cu;
              corner[w] = (corner[w] ?? 0) + cw;
              at.push([
                origin[0] + (corner[0] ?? 0) * cell,
                origin[1] + (corner[1] ?? 0) * cell,
                origin[2] + (corner[2] ?? 0) * cell,
              ]);
              const du = cu ? 1 : -1;
              const dw = cw ? 1 : -1;
              const q1 = [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
              q1[u] = (q1[u] ?? 0) + du;
              const q2 = [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
              q2[w] = (q2[w] ?? 0) + dw;
              const q3 = [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
              q3[u] = (q3[u] ?? 0) + du;
              q3[w] = (q3[w] ?? 0) + dw;
              const s1 = solid(q1[0] ?? 0, q1[1] ?? 0, q1[2] ?? 0);
              const s2 = solid(q2[0] ?? 0, q2[1] ?? 0, q2[2] ?? 0);
              const s3 = solid(q3[0] ?? 0, q3[1] ?? 0, q3[2] ?? 0);
              const filled = s1 && s2 ? 3 : s1 + s2 + s3;
              const open = unlit > 0.5 ? 1 : 1 - (1 - darkest) * (1 - (AO_STEPS[filled] ?? 1));
              ao.push(Math.round(open * 255));
              grid.push(corner[u] ?? 0, corner[w] ?? 0);
            }
            // Split the quad along the diagonal that keeps occlusion from creasing.
            const tris =
              (ao[0] ?? 0) + (ao[2] ?? 0) < (ao[1] ?? 0) + (ao[3] ?? 0)
                ? [1, 2, 3, 1, 3, 0]
                : [0, 1, 2, 0, 2, 3];
            for (const i of tris) {
              const pos = at[i] ?? [0, 0, 0];
              positions.push(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
              normals.push(d === 0 ? sign : 0, d === 1 ? sign : 0, d === 2 ? sign : 0);
              colors.push(r, g, b);
              unlitOut.push(unlit);
              shade.push(ao[i] ?? 255);
              if (bevel) cells.push(grid[i * 2] ?? 0, grid[i * 2 + 1] ?? 0, 0, unlit > 0.5 ? 0 : 1);
            }
          }
        }
      }
    }
    if (z % 8 === 7) yield;
  }

  const count = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    sides: new Float32Array(count * 8),
    bends: new Float32Array(count * 4),
    unlit: new Float32Array(unlitOut),
    decal: new Uint8Array(count),
    shade: new Uint8Array(shade),
    ...(bevel ? { cell: new Float32Array(cells) } : {}),
    triangleCount: count / 3,
  };
}

/** A face's four corners as steps along its two other axes, counter-clockwise seen from outside. */
const QUAD_POS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;
const QUAD_NEG = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
] as const;

/** Run a generator to its end (for a small model built in one go). */
export function finishNow<T>(run: Generator<void, T>): T {
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
  }
}
