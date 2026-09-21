/**
 * Seeded randomness. Everything procedural in the universe (star positions, planet terrain, the
 * galaxy layout) draws from here and NEVER from Math.random, so the same content always builds
 * the same world. Seed each entity from its own id: adding a project then changes nobody else's
 * random draws (docs/PLAN.md §5.4).
 *
 * xmur3 turns a string into a well-mixed 32-bit seed; mulberry32 is a tiny, fast PRNG with good
 * statistical quality for visual work. Pure: no imports, no globals.
 */

/** Hash a string to an unsigned 32-bit integer (xmur3). */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export type Rng = () => number;

/** Deterministic generator of floats in [0, 1) (mulberry32). */
export function createRng(seed: string | number): Rng {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick from weighted options. Weights need not sum to 1. */
export function pickWeighted<T>(rng: Rng, options: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, weight] of options) total += weight;
  let roll = rng() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  const last = options[options.length - 1];
  if (!last) throw new Error('pickWeighted: no options');
  return last[0];
}
