import type { Rgb } from './meshBuilder';
import { createNoise3, fbm } from './noise';
import { centroidOf, cross, norm, normalOf, type Tri, type Vec3 } from './world/kit';
import { BODY_PIVOT, FLAG, type BuiltPart } from './world/rows';

/**
 * LIT WINDOWS: the lamps of a world's night side ("Deep light", docs/DESIGN.md). Small round
 * dots lying on the land near the coasts, gathered where a slow noise peaks, so that they read
 * as towns and not as a rash. They are part of the world's close-up build, in the group that
 * turns with its ground, and carry the lamp's lighting flag: the air's shader
 * (design/shaders/toonFlat.ts, AIR) draws one only where its place on the ball is in the night.
 *
 * Pure and deterministic: the same ground and seed give the same lamps, so a rebuilt engine
 * shows the same towns.
 */

/**
 * How a lamp's triangles are lit (sim/world/kit.ts, `Unlit`): flat, like 1, but shown only at
 * night, and never blooming. Only a world with air has lamps, and only its shader knows the flag.
 */
export const LAMP = 3;

/** The name of the part the lamps are. */
export const LAMPS_PART = 'lamps';

/** `tuning.look.air.windows`. */
export interface WindowLook {
  /** Lamps stand on land between these heights: 0 the sea's edge, 1 the highest peak. */
  readonly h: readonly [number, number];
  /** The frequency of the noise that gathers them into towns, on the unit ball. */
  readonly qFreq: number;
  /** At most this many: the ones the noise favours most. */
  readonly most: number;
  /** A lamp's radius, in world radii: the faintest and the brightest. */
  readonly sizeR: readonly [number, number];
  /** How far above its facet a lamp lies, in world radii. */
  readonly lift: number;
}

/** A lamp: the facet of the ground it lies on, and how much the noise favours it, 0 to 1. */
export interface Lamp {
  readonly facet: number;
  readonly rank: number;
}

/** A hexagon is round at the size of a lamp: four triangles. */
const SIDES = 6;

/**
 * Which facets of a ground carry a lamp, the most favoured first. `heightAt`: the ground's
 * height in a unit direction (sim/planet.ts, `groundHeight`). `rank` runs from 1 (the first)
 * down toward 0 (the last one kept).
 */
export function windowFacets(
  ground: readonly Tri[],
  heightAt: (dx: number, dy: number, dz: number) => number,
  seed: string,
  look: WindowLook,
): Lamp[] {
  const noise = createNoise3(`${seed}/lamps`);
  const [low, high] = look.h;
  const found: Array<{ facet: number; q: number }> = [];
  ground.forEach((tri, facet) => {
    const [x, y, z] = norm(centroidOf(tri));
    const h = heightAt(x, y, z);
    if (h < low || h > high) return;
    found.push({ facet, q: fbm(noise, x * look.qFreq, y * look.qFreq, z * look.qFreq, 3) });
  });
  // The most favoured first; the facet's number settles a tie, so the order is always the same.
  found.sort((a, b) => b.q - a.q || a.facet - b.facet);
  const kept = found.slice(0, look.most);
  return kept.map(({ facet }, i) => ({ facet, rank: 1 - i / Math.max(1, kept.length) }));
}

/**
 * The lamps of a ground as a part of its close-up build: a dot on each chosen facet, lying in
 * the facet's own plane a little above it, bigger the more the noise favours it, with the ball's
 * normal (so that night falls on it as on the ball under it).
 */
export function windowLamps(
  ground: readonly Tri[],
  heightAt: (dx: number, dy: number, dz: number) => number,
  seed: string,
  look: WindowLook,
  color: Rgb,
): BuiltPart {
  const tris: Tri[] = [];
  for (const { facet, rank } of windowFacets(ground, heightAt, seed, look)) {
    const tri = ground[facet];
    if (!tri) continue;
    const up = normalOf(tri);
    const centre = centroidOf(tri);
    const out = norm(centre);
    // Two directions in the facet's plane.
    const east = norm(cross(Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], up));
    const north = cross(up, east);
    const radius = look.sizeR[0] + (look.sizeR[1] - look.sizeR[0]) * rank;
    const rim = Array.from({ length: SIDES }, (_, i): Vec3 => {
      const angle = (i / SIDES) * Math.PI * 2;
      const [c, s] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
      return [
        centre[0] + up[0] * look.lift + east[0] * c + north[0] * s,
        centre[1] + up[1] * look.lift + east[1] * c + north[1] * s,
        centre[2] + up[2] * look.lift + east[2] * c + north[2] * s,
      ];
    });
    const [first] = rim;
    for (let i = 1; first && i + 1 < SIDES; i += 1) {
      const [b, c] = [rim[i], rim[i + 1]];
      if (!b || !c) continue;
      tris.push({ p: [...first, ...b, ...c], c: color, g: LAMP, n: [...out, ...out, ...out] });
    }
  }
  // A decal: it hugs the ground, and the shader holds it in front of it at any distance.
  return { name: LAMPS_PART, tier: 'near', flags: FLAG.decal, tris, pivot: BODY_PIVOT };
}
