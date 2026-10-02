/**
 * THE SKY'S NOISE: gradient noise on an integer lattice, hashed with pcg3d, and the two sums
 * built on it. It is the noise the look pass was designed with ("Deep light", docs/DESIGN.md):
 * the baked sky's shader evaluates the very same function on the GPU (integer hashing gives the
 * same lattice on every driver), and this is its twin on the CPU, for the tests that hold the
 * sky to its gates. NOTHING THE ENGINE SHIPS IMPORTS IT: the planets and the suns use the seeded
 * simplex noise that is already in the bundle (sim/noise.ts). This one has no seed, a caller
 * moves its domain instead.
 *
 * Pure, and bit for bit the recipe's (tested against its values).
 */

// The 12 edge midpoints of a cube, as the recipe orders them.
// prettier-ignore
const GRAD = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1,
  1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
];

/** pcg3d, its first output: three integers to one well-mixed unsigned 32-bit integer. */
function hash(x: number, y: number, z: number): number {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  return (x + Math.imul(y, z)) >>> 0;
}

/** The gradient at a lattice corner, against the offset from it. */
function grad(ix: number, iy: number, iz: number, fx: number, fy: number, fz: number): number {
  const g = (hash(ix + 4096, iy + 4096, iz + 4096) % 12) * 3;
  return (GRAD[g] ?? 0) * fx + (GRAD[g + 1] ?? 0) * fy + (GRAD[g + 2] ?? 0) * fz;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise in about [-1, 1], features one unit across, quintic fade. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fade(fx);
  const uy = fade(fy);
  const uz = fade(fz);
  const a = grad(ix, iy, iz, fx, fy, fz);
  const b = grad(ix + 1, iy, iz, fx - 1, fy, fz);
  const c = grad(ix, iy + 1, iz, fx, fy - 1, fz);
  const d = grad(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz);
  const e = grad(ix, iy, iz + 1, fx, fy, fz - 1);
  const f = grad(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1);
  const g = grad(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1);
  const h = grad(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  const ef = e + (f - e) * ux;
  const gh = g + (h - g) * ux;
  const near = ab + (cd - ab) * uy;
  return (near + (ef + (gh - ef) * uy - near) * uz) * 1.15;
}

/**
 * A fractal sum in about 0 to 1, centred on 0.5: `octaves` layers, each about twice as fine and
 * half as strong, and each turned about the Y axis so that no lattice shows. `offset` moves the
 * whole domain: two sums with different offsets have nothing in common.
 */
export function fbm3(x: number, y: number, z: number, octaves: number, offset = 0): number {
  let qx = x + offset * 7.31;
  let qy = y + offset * 3.17;
  let qz = z + offset * 5.59;
  let amplitude = 0.5;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * noise3(qx, qy, qz);
    total += amplitude;
    const nx = (0.8 * qx - 0.6 * qz + 11.3) * 2.03;
    const nz = (0.6 * qx + 0.8 * qz - 7.1) * 2.03;
    qy = qy * 2.03 + 3.7;
    qx = nx;
    qz = nz;
    amplitude *= 0.5;
  }
  return 0.5 + (0.5 * sum) / total;
}
