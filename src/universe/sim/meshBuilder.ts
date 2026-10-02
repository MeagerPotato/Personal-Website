/**
 * Builds low-poly meshes as plain arrays: triangles with one colour each and a normal on every
 * corner, which is exactly what the toon shader wants (design/shaders/toonFlat.ts). Pure maths, no
 * three.js, so a generated model can be checked in a unit test: is it the right size, do its faces
 * point outwards, does it use the colours it was given?
 *
 * ROUND WHERE IT IS ROUND ("Deep light", docs/DESIGN.md): the faces of one curved surface (a
 * lathe's sides, a dome, a ball) share their normals where they meet, so light falls across them
 * as across the curve they stand for; faces that meet at a real edge (a box, a fin, a cog's
 * tooth: `CREASE_DEG`) keep their own, and the edge stays crisp. `roundNormals` decides which.
 *
 * Conventions: +Y up, +Z forward, 1 unit = 1 u (docs/PLAN.md §5.6). Triangles are wound
 * counter-clockwise seen from OUTSIDE; the normal follows from the winding. Colours are linear RGB.
 */

export type Point = readonly [x: number, y: number, z: number];
export type Rgb = readonly [r: number, g: number, b: number];

export interface MeshData {
  /** Non-indexed: three numbers per vertex, three vertices per triangle. */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  triangleCount: number;
  /**
   * Only where a triangle has more than one colour (sim/planet.ts): eight numbers a vertex, a
   * SIDE and then an OVER, each a colour and, fourth, where the vertex stands on its line: the
   * side's colour replaces the triangle's where that is above a half, and the over's then
   * replaces both where its own is. Each outline is a straight line through the triangle, which
   * a pixel shader can draw (design/shaders/toonFlat.ts).
   */
  sides?: Float32Array;
  /**
   * Only where one of those lines is BENT: four numbers a vertex, the side's two and then the
   * over's. First, how far along its line the vertex stands (0 where the line enters the
   * triangle, 1 where it leaves); second, the bend, the same on all three: the line is drawn
   * where `k + bend * t * (1 - t)` passes a half, an arc and not a chord, so an outline is a
   * curve inside a facet too.
   */
  bends?: Float32Array;
}

/** A colour, and where each of a triangle's three corners stands on its line. */
export interface Side {
  readonly c: Rgb;
  readonly k: ArrayLike<number>;
  /** A bent line (`MeshData.bends`): how far along it each corner stands, and the bend. */
  readonly t?: ArrayLike<number>;
  readonly bend?: number;
}

/** What a triangle may say beyond its corners and its colour. */
export interface Facet {
  /** A normal for each corner (nine numbers) instead of the triangle's own: a curved surface. */
  readonly n?: ArrayLike<number>;
  /** A second colour, and a third laid over both (see `MeshData.sides`). */
  readonly side?: Side;
  readonly over?: Side;
}

/**
 * Faces that meet at less than this many degrees are one round surface, and share their normals
 * there; at more, it is an edge and stays one. An eight-sided post is round (45 degrees a side),
 * a hexagonal one is not; a box, a fin and a cog's tooth never are.
 */
export const CREASE_DEG = 50;

/**
 * Round the normals of a triangle soup (`positions`: nine numbers a triangle) in place: every
 * corner takes the mean of the normals of the faces that meet at that point and lie within
 * `CREASE_DEG` of its own face, each weighed by the angle of its corner there (so that the two
 * triangles of a quad count as the one face they are). `given(i)`: triangle i already has its
 * normals and is left alone.
 */
export function roundNormals(
  positions: ArrayLike<number>,
  normals: { [index: number]: number },
  given?: (triangle: number) => boolean,
): void {
  const count = positions.length / 9;
  const face = new Float32Array(count * 3);
  const angle = new Float32Array(count * 3);
  const at = new Map<string, number[]>();
  const p = (i: number): number => positions[i] ?? 0;
  for (let t = 0; t < count; t += 1) {
    if (given?.(t)) continue;
    const o = t * 9;
    const nx =
      (p(o + 4) - p(o + 1)) * (p(o + 8) - p(o + 2)) - (p(o + 5) - p(o + 2)) * (p(o + 7) - p(o + 1));
    const ny =
      (p(o + 5) - p(o + 2)) * (p(o + 6) - p(o)) - (p(o + 3) - p(o)) * (p(o + 8) - p(o + 2));
    const nz =
      (p(o + 3) - p(o)) * (p(o + 7) - p(o + 1)) - (p(o + 4) - p(o + 1)) * (p(o + 6) - p(o));
    const length = Math.hypot(nx, ny, nz) || 1;
    face[t * 3] = nx / length;
    face[t * 3 + 1] = ny / length;
    face[t * 3 + 2] = nz / length;
    for (let c = 0; c < 3; c += 1) {
      const a = o + c * 3;
      const b = o + ((c + 1) % 3) * 3;
      const d = o + ((c + 2) % 3) * 3;
      const ex = p(b) - p(a);
      const ey = p(b + 1) - p(a + 1);
      const ez = p(b + 2) - p(a + 2);
      const fx = p(d) - p(a);
      const fy = p(d + 1) - p(a + 1);
      const fz = p(d + 2) - p(a + 2);
      const cos =
        (ex * fx + ey * fy + ez * fz) / (Math.hypot(ex, ey, ez) * Math.hypot(fx, fy, fz) || 1);
      angle[t * 3 + c] = Math.acos(Math.max(-1, Math.min(1, cos)));
      const key = `${Math.round(p(a) * 1e4)},${Math.round(p(a + 1) * 1e4)},${Math.round(p(a + 2) * 1e4)}`;
      const list = at.get(key);
      if (list) list.push(t * 3 + c);
      else at.set(key, [t * 3 + c]);
    }
  }
  const crease = Math.cos((CREASE_DEG * Math.PI) / 180);
  for (const list of at.values()) {
    for (const corner of list) {
      const t = (corner - (corner % 3)) / 3;
      const fx = face[t * 3] ?? 0;
      const fy = face[t * 3 + 1] ?? 0;
      const fz = face[t * 3 + 2] ?? 0;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const other of list) {
        const u = (other - (other % 3)) / 3;
        const gx = face[u * 3] ?? 0;
        const gy = face[u * 3 + 1] ?? 0;
        const gz = face[u * 3 + 2] ?? 0;
        if (u !== t && fx * gx + fy * gy + fz * gz < crease) continue;
        const weight = angle[other] ?? 0;
        x += gx * weight;
        y += gy * weight;
        z += gz * weight;
      }
      const length = Math.hypot(x, y, z);
      // A sliver with no angle to speak of keeps its face's.
      const whole = length > 1e-9;
      normals[corner * 3] = whole ? x / length : fx;
      normals[corner * 3 + 1] = whole ? y / length : fy;
      normals[corner * 3 + 2] = whole ? z / length : fz;
    }
  }
}

/** One ring of a body of revolution around the Z axis. */
export interface Ring {
  z: number;
  radius: number;
}

/**
 * A finished model: its mesh, and its SOCKETS, the named points other things attach to (the engine
 * flame, later a docking port). A glTF model says the same with named empty nodes.
 */
export interface ModelData {
  mesh: MeshData;
  sockets: Readonly<Record<string, Point>>;
}

const EPSILON = 1e-9;

const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const unit = (a: Point): Point => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};

export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  /** By triangle: eight numbers a vertex where it has more colours than one (`MeshData.sides`). */
  private readonly sides = new Map<number, number[]>();
  /** By triangle: four numbers a vertex where a line is bent (`MeshData.bends`). */
  private readonly bends = new Map<number, number[]>();
  /** The triangles that came with normals of their own. */
  private readonly given = new Set<number>();

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  /** Degenerate triangles (a cone's tip, a zero-width band) are skipped, not emitted as NaN. */
  triangle(a: Point, b: Point, c: Point, color: Rgb, facet?: Facet): this {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < EPSILON) return this;

    const index = this.triangleCount;
    for (const point of [a, b, c]) {
      this.positions.push(point[0], point[1], point[2]);
      this.normals.push(nx / length, ny / length, nz / length);
      this.colors.push(color[0], color[1], color[2]);
    }
    if (facet?.n) {
      for (let i = 0; i < 9; i += 1) this.normals[index * 9 + i] = facet.n[i] ?? 0;
      this.given.add(index);
    }
    if (facet?.side) {
      const { side, over } = facet;
      this.sides.set(
        index,
        [0, 1, 2].flatMap((i) => [
          ...side.c,
          side.k[i] ?? 0,
          ...(over ? [...over.c, over.k[i] ?? 0] : [0, 0, 0, 0]),
        ]),
      );
      if (side.bend || over?.bend)
        this.bends.set(
          index,
          [0, 1, 2].flatMap((i) => [
            side.t?.[i] ?? 0,
            side.bend ?? 0,
            over?.t?.[i] ?? 0,
            over?.bend ?? 0,
          ]),
        );
    }
    return this;
  }

  /** A flat four-sided face, corners counter-clockwise seen from outside. */
  quad(a: Point, b: Point, c: Point, d: Point, color: Rgb): this {
    return this.triangle(a, b, c, color).triangle(a, c, d, color);
  }

  /**
   * A body of revolution around Z: a band of `sides` flat faces between each pair of rings.
   * The rings are a PATH, and the surface faces to the left of the direction of travel: walk from
   * the back (low z) to the front for the outside of a body; two rings at the same z make a flat
   * step (wider = facing back, narrower = facing forward); walk backwards for the INSIDE of a
   * tube, such as a nozzle. `colors[i]` paints the band between ring i and ring i + 1.
   */
  lathe(rings: readonly Ring[], sides: number, colors: readonly Rgb[], phase = 0): this {
    const at = (ring: Ring, index: number): Point => {
      const angle = phase + (index / sides) * Math.PI * 2;
      return [ring.radius * Math.cos(angle), ring.radius * Math.sin(angle), ring.z];
    };
    for (let band = 0; band + 1 < rings.length; band += 1) {
      const back = rings[band];
      const front = rings[band + 1];
      const color = colors[band] ?? colors[colors.length - 1];
      if (!back || !front || !color) continue;
      // One winding is right for every band: it faces outwards while z rises, a step that
      // widens faces back (the underside of a body), and a step that narrows faces forward.
      for (let side = 0; side < sides; side += 1) {
        this.quad(at(back, side), at(back, side + 1), at(front, side + 1), at(front, side), color);
      }
    }
    return this;
  }

  /** A flat disc (a fan of `sides` triangles) facing along `facing`: +1 is +Z, -1 is -Z. */
  cap(z: number, radius: number, sides: number, facing: 1 | -1, color: Rgb, phase = 0): this {
    const center: Point = [0, 0, z];
    for (let side = 0; side < sides; side += 1) {
      const a0 = phase + (side / sides) * Math.PI * 2;
      const a1 = phase + ((side + 1) / sides) * Math.PI * 2;
      const p0: Point = [radius * Math.cos(a0), radius * Math.sin(a0), z];
      const p1: Point = [radius * Math.cos(a1), radius * Math.sin(a1), z];
      if (facing === 1) this.triangle(center, p0, p1, color);
      else this.triangle(center, p1, p0, color);
    }
    return this;
  }

  /** A flat disc facing along any `normal` (it need not be unit length). Windows, pads, lids. */
  disc(center: Point, normal: Point, radius: number, sides: number, color: Rgb, phase = 0): this {
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length < EPSILON) return this;
    const n: Point = [normal[0] / length, normal[1] / length, normal[2] / length];
    // Any vector that is not parallel to the normal gives a first in-plane axis.
    const seed: Point = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = unit(cross(seed, n));
    const v = cross(n, u);
    const at = (index: number): Point => {
      const angle = phase + (index / sides) * Math.PI * 2;
      const c = radius * Math.cos(angle);
      const s = radius * Math.sin(angle);
      return [
        center[0] + c * u[0] + s * v[0],
        center[1] + c * u[1] + s * v[1],
        center[2] + c * u[2] + s * v[2],
      ];
    };
    for (let side = 0; side < sides; side += 1) {
      this.triangle(center, at(side), at(side + 1), color);
    }
    return this;
  }

  /**
   * A thin plate: a convex outline drawn in the plane through the Z axis at `angle` around it
   * (points are [distance from the axis, z]), given thickness on both sides. Fins, mostly.
   */
  plate(
    outline: ReadonlyArray<readonly [radial: number, z: number]>,
    angle: number,
    thickness: number,
    color: Rgb,
  ): this {
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    // The plate's own normal: perpendicular to both the radial direction and Z.
    const sideX = -radialY * (thickness / 2);
    const sideY = radialX * (thickness / 2);
    const left = outline.map(([r, z]): Point => [r * radialX + sideX, r * radialY + sideY, z]);
    const right = outline.map(([r, z]): Point => [r * radialX - sideX, r * radialY - sideY, z]);

    // Which way round is the outline? The signed area tells, so either order works.
    let area = 0;
    outline.forEach(([r, z], index) => {
      const next = outline[(index + 1) % outline.length];
      if (next) area += r * next[1] - next[0] * z;
    });
    const flip = area < 0;

    const first = left[0];
    const firstRight = right[0];
    for (let index = 1; index + 1 < outline.length; index += 1) {
      const l1 = left[index];
      const l2 = left[index + 1];
      const r1 = right[index];
      const r2 = right[index + 1];
      if (!first || !firstRight || !l1 || !l2 || !r1 || !r2) continue;
      if (flip) this.triangle(first, l1, l2, color).triangle(firstRight, r2, r1, color);
      else this.triangle(first, l2, l1, color).triangle(firstRight, r1, r2, color);
    }
    // The rim that joins the two faces.
    for (let index = 0; index < outline.length; index += 1) {
      const next = (index + 1) % outline.length;
      const l1 = left[index];
      const l2 = left[next];
      const r1 = right[index];
      const r2 = right[next];
      if (!l1 || !l2 || !r1 || !r2) continue;
      if (flip) this.quad(l1, r1, r2, l2, color);
      else this.quad(l1, l2, r2, r1, color);
    }
    return this;
  }

  /** An axis-aligned box: `size` is its full extent along x, y and z. */
  box(center: Point, size: Point, color: Rgb): this {
    const [cx, cy, cz] = center;
    const hx = size[0] / 2;
    const hy = size[1] / 2;
    const hz = size[2] / 2;
    const at = (sx: number, sy: number, sz: number): Point => [
      cx + sx * hx,
      cy + sy * hy,
      cz + sz * hz,
    ];
    return this.quad(at(1, -1, -1), at(1, 1, -1), at(1, 1, 1), at(1, -1, 1), color) // +x
      .quad(at(-1, -1, 1), at(-1, 1, 1), at(-1, 1, -1), at(-1, -1, -1), color) // -x
      .quad(at(-1, 1, -1), at(-1, 1, 1), at(1, 1, 1), at(1, 1, -1), color) // +y
      .quad(at(-1, -1, 1), at(-1, -1, -1), at(1, -1, -1), at(1, -1, 1), color) // -y
      .quad(at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1), color) // +z
      .quad(at(1, -1, -1), at(-1, -1, -1), at(-1, 1, -1), at(1, 1, -1), color); // -z
  }

  /**
   * Turn EVERYTHING built so far about the X axis (radians; positive turns +Y toward +Z). The
   * lathe works around Z; `rotateX(-Math.PI / 2)` stands such a shape upright, its axis along +Y.
   */
  rotateX(angle: number): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const values of [this.positions, this.normals]) {
      for (let i = 0; i < values.length; i += 3) {
        const y = values[i + 1] ?? 0;
        const z = values[i + 2] ?? 0;
        values[i + 1] = y * cos - z * sin;
        values[i + 2] = y * sin + z * cos;
      }
    }
    return this;
  }

  /**
   * `round`: share the normals of faces that are one curved surface (`roundNormals`). A caller
   * that only wants the corners (sim/world/kit.ts, whose glue rounds a whole body at once) says no.
   */
  build(round = true): MeshData {
    const normals = new Float32Array(this.normals);
    if (round) roundNormals(this.positions, normals, (triangle) => this.given.has(triangle));
    const mesh: MeshData = {
      positions: new Float32Array(this.positions),
      normals,
      colors: new Float32Array(this.colors),
      triangleCount: this.triangleCount,
    };
    if (this.sides.size > 0) {
      mesh.sides = new Float32Array(this.triangleCount * 24);
      for (const [triangle, side] of this.sides) mesh.sides.set(side, triangle * 24);
    }
    if (this.bends.size > 0) {
      mesh.bends = new Float32Array(this.triangleCount * 12);
      for (const [triangle, bend] of this.bends) mesh.bends.set(bend, triangle * 12);
    }
    return mesh;
  }
}
