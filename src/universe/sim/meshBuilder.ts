/**
 * Builds low-poly, flat-shaded meshes as plain arrays: triangles with one normal and one colour
 * each, which is exactly what the toon shader wants (design/shaders/toonFlat.ts). Pure maths, no
 * three.js, so a generated model can be checked in a unit test: is it the right size, do its faces
 * point outwards, does it use the colours it was given?
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

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  /** Degenerate triangles (a cone's tip, a zero-width band) are skipped, not emitted as NaN. */
  triangle(a: Point, b: Point, c: Point, color: Rgb): this {
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

    for (const point of [a, b, c]) {
      this.positions.push(point[0], point[1], point[2]);
      this.normals.push(nx / length, ny / length, nz / length);
      this.colors.push(color[0], color[1], color[2]);
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

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      triangleCount: this.triangleCount,
    };
  }
}
