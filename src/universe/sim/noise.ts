import { createRng } from './rng';

/**
 * Seeded 3D simplex noise (after Stefan Gustavson's public-domain reference implementation) and
 * the fractal sum built on it. Terrain is sampled ON the sphere, in 3D, so a planet has no seam
 * and no pinched poles. Pure: the permutation table is shuffled by the seeded PRNG, so a planet
 * is the same planet on every visit.
 */

export type Noise3 = (x: number, y: number, z: number) => number;

const F3 = 1 / 3;
const G3 = 1 / 6;

// The 12 edge midpoints of a cube: the gradient directions of 3D simplex noise.
const GRAD = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
];

/** Returns noise in about [-1, 1], smooth, with features roughly one unit across. */
export function createNoise3(seed: string | number): Noise3 {
  const rng = createRng(seed);
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = table[i] ?? 0;
    table[i] = table[j] ?? 0;
    table[j] = swap;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) {
    perm[i] = table[i & 255] ?? 0;
    permMod12[i] = (perm[i] ?? 0) % 12;
  }

  const corner = (gi: number, x: number, y: number, z: number): number => {
    const t = 0.6 - x * x - y * y - z * z;
    if (t < 0) return 0;
    const g = gi * 3;
    const t2 = t * t;
    return t2 * t2 * ((GRAD[g] ?? 0) * x + (GRAD[g + 1] ?? 0) * y + (GRAD[g + 2] ?? 0) * z);
  };

  return (xin, yin, zin) => {
    // Skew the input space to find which simplex cell we are in.
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    // Which of the six tetrahedra of the cell: offsets of the second and third corners.
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    let i2 = 0;
    let j2 = 0;
    let k2 = 0;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        i2 = 1;
        j2 = 1;
      } else if (x0 >= z0) {
        i1 = 1;
        i2 = 1;
        k2 = 1;
      } else {
        k1 = 1;
        i2 = 1;
        k2 = 1;
      }
    } else if (y0 < z0) {
      k1 = 1;
      j2 = 1;
      k2 = 1;
    } else if (x0 < z0) {
      j1 = 1;
      j2 = 1;
      k2 = 1;
    } else {
      j1 = 1;
      i2 = 1;
      j2 = 1;
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const at = (di: number, dj: number, dk: number): number =>
      permMod12[ii + di + (perm[jj + dj + (perm[kk + dk] ?? 0)] ?? 0)] ?? 0;

    // The sum is scaled to stay within [-1, 1].
    return (
      32 *
      (corner(at(0, 0, 0), x0, y0, z0) +
        corner(at(i1, j1, k1), x1, y1, z1) +
        corner(at(i2, j2, k2), x2, y2, z2) +
        corner(at(1, 1, 1), x3, y3, z3))
    );
  };
}

/**
 * Fractal Brownian motion: `octaves` layers of noise, each twice as fine and half as strong as
 * the one before. Normalised, so the result stays in about [-1, 1] whatever the octave count.
 */
export function fbm(noise: Noise3, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    // Each octave is pushed aside, so that they never all cross zero at the origin together.
    const shift = octave * 17.31;
    sum += amplitude * noise(x * frequency + shift, y * frequency - shift, z * frequency + shift);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total > 0 ? sum / total : 0;
}
