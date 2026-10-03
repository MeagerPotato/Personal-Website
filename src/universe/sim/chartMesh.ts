/**
 * THE CHART'S PARTS AS MESHES. Where the picture goes straight to the canvas, the star map's
 * ground is drawn part by part, each only where it is (design/shaders/chart.ts says why): the
 * two discs of every district on a polygon round them, its dashed ring on a strip along it.
 * These are those polygons and strips, and the spacing of the dot grid under them.
 *
 * A part's edge is one pixel soft, and a pixel is as many world units as the map's zoom says,
 * so a mesh cannot simply be "the disc": every vertex lies ON its part's own edge and carries
 * the way it steps OUT from there for each world unit of room asked for (`pads`). The shader
 * asks for a few pixels of room, which it turns into world units at the zoom of the frame.
 * Whatever it asks, the mesh then holds every point within that room of the part: a polygon's
 * corners stand further out than its circle by the secant of half a side, so that its flat
 * sides touch the circle and never cut it, and a strip's inner corners stand ON their circle,
 * so that its inner sides run inside it.
 *
 * Pure: plain arrays, no three.js. Every triangle faces up (+y), as the chart's plane does.
 */

/** A district as the meshes need it: where its system is and how far it reaches (u). */
export interface ChartDisc {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface ChartPartMesh {
  /** x, y, z of every vertex (y is 0: the mesh lies flat), on its part's own edge. */
  readonly positions: Float32Array;
  /**
   * Three numbers a vertex: the x and z of its step for one world unit of room, and the most
   * units it may step (`PAD_FREE`: as many as asked). A strip's inner corners step toward the
   * middle of their ring and stop there: past it the strip would turn inside out and lie over
   * itself, and paint laid twice is darker paint.
   */
  readonly pads: Float32Array;
  /** The district each vertex belongs to: its row in the list the mesh was made from. */
  readonly owners: Uint16Array;
  readonly indices: Uint16Array;
}

/** A vertex that may step as far as it is asked to (a number a 32-bit float holds exactly). */
export const PAD_FREE = 2 ** 30;

/** Sides of the polygon round a district's discs: 0.6% more area than the circle it holds. */
export const DISC_SIDES = 24;
/**
 * Sides of the strip along a ring. The strip is a few pixels wide plus what its flat sides add:
 * the radius times (secant of half a side - 1), 0.12% at 64 sides, so two pixels on a ring that
 * fills a laptop's screen.
 */
export const RING_SIDES = 64;

const TURN = Math.PI * 2;

/**
 * One polygon a district, round a circle of `scale` times its reach (the outer of its two
 * discs): `sides` corners, a fan of `sides - 2` triangles from the first.
 */
export function discMesh(
  discs: readonly ChartDisc[],
  scale: number,
  sides = DISC_SIDES,
): ChartPartMesh {
  const positions = new Float32Array(discs.length * sides * 3);
  const pads = new Float32Array(discs.length * sides * 3);
  const owners = new Uint16Array(discs.length * sides);
  const indices = new Uint16Array(discs.length * (sides - 2) * 3);
  // A corner stands this much further out than the circle its sides touch.
  const out = 1 / Math.cos(Math.PI / sides);
  discs.forEach(({ x, z, radius }, d) => {
    const first = d * sides;
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * TURN;
      const dx = Math.sin(angle) * out;
      const dz = Math.cos(angle) * out;
      const vertex = first + side;
      positions[vertex * 3] = x + dx * radius * scale;
      positions[vertex * 3 + 2] = z + dz * radius * scale;
      pads[vertex * 3] = dx;
      pads[vertex * 3 + 1] = dz;
      pads[vertex * 3 + 2] = PAD_FREE;
      owners[vertex] = d;
    }
    for (let side = 1; side < sides - 1; side += 1) {
      const at = (d * (sides - 2) + side - 1) * 3;
      indices[at] = first;
      indices[at + 1] = first + side;
      indices[at + 2] = first + side + 1;
    }
  });
  return { positions, pads, owners, indices };
}

/**
 * One closed strip a district, along the circle of its reach: `sides` pairs of corners, an
 * inner one that steps IN for a pixel of room and an outer one that steps out, and two
 * triangles between each pair and the next.
 */
export function ringMesh(discs: readonly ChartDisc[], sides = RING_SIDES): ChartPartMesh {
  const positions = new Float32Array(discs.length * sides * 2 * 3);
  const pads = new Float32Array(discs.length * sides * 2 * 3);
  const owners = new Uint16Array(discs.length * sides * 2);
  const indices = new Uint16Array(discs.length * sides * 6);
  const out = 1 / Math.cos(Math.PI / sides);
  discs.forEach(({ x, z, radius }, d) => {
    const first = d * sides * 2;
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * TURN;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      const inner = first + side * 2;
      const outer = inner + 1;
      positions[inner * 3] = x + dx * radius;
      positions[inner * 3 + 2] = z + dz * radius;
      pads[inner * 3] = -dx;
      pads[inner * 3 + 1] = -dz;
      pads[inner * 3 + 2] = radius;
      positions[outer * 3] = x + dx * out * radius;
      positions[outer * 3 + 2] = z + dz * out * radius;
      pads[outer * 3] = dx * out;
      pads[outer * 3 + 1] = dz * out;
      pads[outer * 3 + 2] = PAD_FREE;
      owners[inner] = d;
      owners[outer] = d;

      const next = first + ((side + 1) % sides) * 2;
      const at = (d * sides + side) * 6;
      indices[at] = inner;
      indices[at + 1] = outer;
      indices[at + 2] = next;
      indices[at + 3] = next;
      indices[at + 4] = outer;
      indices[at + 5] = next + 1;
    }
  });
  return { positions, pads, owners, indices };
}

/**
 * The dot grid's spacing in world units, for a map on which a pixel is `unitsPerPx` units: as
 * near `spacingPx` pixels as 1, 2 or 5 times a power of ten comes (between 0.57 and 1.43 times
 * it). So a dot stays where it is while the map zooms, and only every second (or fifth) one
 * comes or goes.
 */
export function gridCell(unitsPerPx: number, spacingPx: number): number {
  const spacing = unitsPerPx * spacingPx;
  if (!(spacing > 0) || !Number.isFinite(spacing)) return 1;
  const decade = 10 ** Math.floor(Math.log10(spacing));
  const m = spacing / decade;
  return decade * (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10);
}
