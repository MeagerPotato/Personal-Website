/**
 * Builds low-poly meshes as plain arrays: triangles with one colour each and a normal on every
 * corner, which is exactly what the toon shader wants (design/shaders/toonFlat.ts). Pure maths, no
 * three.js, so a generated model can be checked in a unit test: is it the right size, do its faces
 * point outwards, does it use the colours it was given?
 *
 * ROUND WHERE IT IS ROUND ("Deep light", docs/DESIGN.md): what a thing IS says how it is lit, and
 * it says so once, where it is made. A LATHE of five sides or more is a body of revolution: every
 * corner carries the normal of the true surface there, round about the axis, and along its profile
 * round where the profile bends gently and an edge where it folds (`CREASE_DEG`: a wheel's rim, a
 * seam). A lathe of three or four sides is a pyramid or a post, and everything else here (a box, a
 * plate, a disc, a quad) is flat: each face keeps its own normal, and its edges stay crisp.
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
 * A lathe's profile that turns by less than this many degrees from one band to the next is one
 * curved surface there (a dome, an ogive nose); by more, it is an edge and stays one (a cap on a
 * tube, a step, a rim).
 */
export const CREASE_DEG = 50;

/**
 * A lathe of this many sides or more is ROUND: a tube, a ball, a cone. With fewer it is the
 * polygon it says: a pyramid, a square post.
 */
export const ROUND_FROM = 5;

/**
 * A profile that ends ON the axis within this many degrees of square to it closes smoothly there
 * (the top of a dome, the pole of a ball: one normal, along the axis); a steeper one is a tip (a
 * cone's, a nose's), which each side meets with its own.
 */
export const POLE_DEG = 35;

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
   * A body of revolution around Z: a band of `sides` faces between each pair of rings, lit as the
   * round surface they stand for when there are `ROUND_FROM` of them or more (see the top of the file).
   * The rings are a PATH, and the surface faces to the left of the direction of travel: walk from
   * the back (low z) to the front for the outside of a body; two rings at the same z make a flat
   * step (wider = facing back, narrower = facing forward); walk backwards for the INSIDE of a
   * tube, such as a nozzle. `colors[i]` paints the band between ring i and ring i + 1.
   */
  lathe(rings: readonly Ring[], sides: number, colors: readonly Rgb[], phase = 0): this {
    const angleOf = (index: number): number => phase + (index / sides) * Math.PI * 2;
    const at = (ring: Ring, index: number): Point => {
      const angle = angleOf(index);
      return [ring.radius * Math.cos(angle), ring.radius * Math.sin(angle), ring.z];
    };
    const round = sides >= ROUND_FROM;
    const fold = Math.cos((CREASE_DEG * Math.PI) / 180);
    // Each band's normal in the profile's own plane, [along z, away from the axis]: it faces to
    // the left of the direction of travel.
    const flat = rings.slice(1).map((front, band): readonly [number, number] => {
      const back = rings[band] ?? front;
      const dz = front.z - back.z;
      const dr = front.radius - back.radius;
      const length = Math.hypot(dz, dr) || 1;
      return [-dr / length, dz / length];
    });
    /**
     * The normal of the true surface at a corner of a band: the band's own, turned halfway to its
     * neighbour's where the profile only bends there, and straight along the axis where a gentle
     * profile ends on it (the top of a dome). A point on the axis that is a real tip (a cone's)
     * has no angle of its own: it takes the middle of its side.
     */
    const normalAt = (band: number, end: 0 | 1, side: number, other: number): Point => {
      const own = flat[band] ?? [0, 1];
      let [nz, nr] = own;
      let angle = angleOf(side);
      if ((rings[band + end]?.radius ?? 0) < EPSILON) {
        if (Math.abs(nz) > Math.cos((POLE_DEG * Math.PI) / 180)) [nz, nr] = [Math.sign(nz), 0];
        else angle = (angle + angleOf(other)) / 2;
      } else {
        const next = flat[band + (end ? 1 : -1)];
        if (next && own[0] * next[0] + own[1] * next[1] > fold) {
          const length = Math.hypot(own[0] + next[0], own[1] + next[1]);
          [nz, nr] = [(own[0] + next[0]) / length, (own[1] + next[1]) / length];
        }
      }
      return [nr * Math.cos(angle), nr * Math.sin(angle), nz];
    };
    for (let band = 0; band + 1 < rings.length; band += 1) {
      const back = rings[band];
      const front = rings[band + 1];
      const color = colors[band] ?? colors[colors.length - 1];
      if (!back || !front || !color) continue;
      // One winding is right for every band: it faces outwards while z rises, a step that
      // widens faces back (the underside of a body), and a step that narrows faces forward.
      for (let side = 0; side < sides; side += 1) {
        const [a, b, c, d] = [
          at(back, side),
          at(back, side + 1),
          at(front, side + 1),
          at(front, side),
        ];
        if (!round) {
          this.quad(a, b, c, d, color);
          continue;
        }
        const [na, nb, nc, nd] = [
          normalAt(band, 0, side, side + 1),
          normalAt(band, 0, side + 1, side),
          normalAt(band, 1, side + 1, side),
          normalAt(band, 1, side, side + 1),
        ];
        this.triangle(a, b, c, color, { n: [...na, ...nb, ...nc] });
        this.triangle(a, c, d, color, { n: [...na, ...nc, ...nd] });
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

  build(): MeshData {
    const normals = new Float32Array(this.normals);
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
