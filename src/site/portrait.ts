import type { BodyKind, ManifestBody } from '../universe/data/types';
import { tokens } from '../universe/design/tokens';
import { tuning } from '../universe/design/tuning';
import { worlds } from '../universe/design/worlds';
import { BODIES } from '../universe/design/worlds/bodies';
import { hexToLinear } from '../universe/sim/color';
import type { Rgb } from '../universe/sim/meshBuilder';
import { assemble, fineOf, groundDetail, type Packed } from '../universe/sim/world/glue';
import type { GroundLooks } from '../universe/sim/world/ground';
import { make } from '../universe/sim/world/rows';
import { routes } from './routes';

// A PORTRAIT of a body: its emblem world (design/worlds/), drawn once at build time as a small
// picture for the pages, so that a project's station on a route line, and a page's planet where
// it has no cover, show the world the universe shows and not a toy ball of its biome's colours.
//
// The same build as the galaxy's everyday mesh (sim/world/rows.ts `make` at the everyday detail,
// then glue.ts `assemble` as the low tier does it: everything still, nothing turning), lit as design/shaders/toonFlat.ts lights
// it: three bands by how a pixel faces the light, the shade side the colour times the shadow
// tint (never black), a flat or glowing part its own colour, a facet's other colours where its
// lines say, and planned work's ghost parts outlined in their family's lines. No air, no corona, no lamps (a portrait is by day). Orthographic, from a little
// above and to one side, so that a ring or a part on top reads.
//
// Pure: same body in, same pixels out. src/pages/worlds/[file].ts encodes them as WebP.

export interface PortraitOf {
  /** Manifest id: `project/<id>`, `system/<id>` or `page/<id>`. */
  readonly id: string;
  readonly kind: BodyKind;
  readonly planned: boolean;
  /** The manifest's seed (a ground that names none is grown from it). */
  readonly seed: string;
}

export interface Portrait {
  readonly width: number;
  readonly height: number;
  /** sRGB, straight alpha, four bytes a pixel, top row first. */
  readonly data: Uint8ClampedArray;
}

/** How the camera looks at the body: turned this far round it, and down at it, in degrees. */
export const PORTRAIT_VIEW = { yawDeg: -32, pitchDeg: 22 } as const;
/** Where the light comes from, seen from the camera: upper left, a little in front. */
const LIGHT: readonly [number, number, number] = normalize([-0.55, 0.62, 0.56]);
/** Samples a side of each pixel (so 16 a pixel): the edges of a small picture stay smooth. */
const SUPER = 4;
/** The body fills this share of the picture's side. */
const FILL = 0.94;

const LOOKS: GroundLooks = { planet: tuning.planet, terrain: tuning.terrain, sun: tuning.look.sun };

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const unit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function toSrgb(c: number): number {
  const v = unit(c);
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
}

/**
 * Does this body have a world of its own to draw? It does when the galaxy draws it from emblem
 * rows (design/worlds/): world/looks.ts `lookOf` lets a recipe in design/worlds.ts win over the
 * rows, so a body with one is not drawn here either. A body without falls back to its ball.
 */
export const hasPortrait = (id: string): boolean =>
  worlds[id] === undefined && BODIES[id] !== undefined;

/** A project's picture on the pages, or null when it has no world to draw (it keeps its ball). */
export const pictureOf = (projectId: string, size: number): string | null =>
  hasPortrait(`project/${projectId}`) ? routes.worldPicture(projectId, size) : null;

/** What a portrait needs to know of a body of the galaxy. */
export const subjectOf = (body: ManifestBody): PortraitOf => ({
  id: body.id,
  kind: body.kind,
  planned: body.planned === true,
  seed: body.seed,
});

/** The packed triangles of a body's everyday build, still, and its ghosts' edge lines. */
function buildOf(body: PortraitOf): {
  packs: readonly Packed[];
  lines: readonly Float32Array[];
  lineColor: Rgb | null;
} {
  const recipe = hasPortrait(body.id) ? BODIES[body.id] : undefined;
  if (!recipe) throw new Error(`portrait: ${body.id} has no world (design/worlds/)`);
  const build = make(body.id, recipe, {
    detail: groundDetail(body.kind, body.planned, false, tuning.world),
    seed: body.seed,
    looks: LOOKS,
    fine: fineOf(false, false, tuning.world.round),
  });
  const { turn, hold, edges } = assemble(build, { kind: body.kind, still: true, low: true });
  return { packs: [turn, hold], lines: [edges.turn, edges.hold], lineColor: edges.color };
}

/**
 * Draw a body's portrait, `size` pixels square, the body centred on a transparent ground.
 */
export function portraitOf(body: PortraitOf, size: number): Portrait {
  const { packs, lines, lineColor } = buildOf(body);
  const yaw = (PORTRAIT_VIEW.yawDeg * Math.PI) / 180;
  const pitch = (PORTRAIT_VIEW.pitchDeg * Math.PI) / 180;
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  // World to view: turn round +Y by the yaw, then tip the top toward the camera by the pitch.
  // View space: +X right, +Y up, +Z toward the camera.
  const view = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = cy * x + sy * z;
    const z1 = -sy * x + cy * z;
    return [x1, cp * y - sp * z1, sp * y + cp * z1];
  };

  // How big the body looks: the smallest circle round what it shows from here (round its
  // outline's box, as near as matters), so a sign on top or a ring does not shrink the globe more
  // than it must, and every part stays inside the circle a station draws round it.
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const pack of packs) {
    const p = pack.positions;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y] = view(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  let reach = 0;
  for (const pack of packs) {
    const p = pack.positions;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y] = view(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0);
      reach = Math.max(reach, Math.hypot(x - midX, y - midY));
    }
  }
  const n = size * SUPER;
  const scale = (n * FILL) / 2 / (reach || 1);
  const depth = new Float32Array(n * n).fill(-Infinity);
  const colour = new Float32Array(n * n * 3);
  const covered = new Uint8Array(n * n);

  const shade = hexToLinear(tokens.color.shading.shadow);
  const [low, high] = tuning.shading.bandEdges;
  const mid = tuning.shading.midLevel;
  const band = (facing: number): number => (facing < low ? 0 : facing < high ? mid : 1);

  for (const pack of packs) {
    const { positions: p, normals: nm, colors: c, sides, bends, unlit, decal } = pack;
    for (let t = 0; t < pack.triangleCount; t += 1) {
      const v0 = t * 3;
      // A lamp is only lit at night: a portrait is by day.
      if ((unlit[v0] ?? 0) > 2.5 && (unlit[v0] ?? 0) < 3.5) continue;
      const sx: number[] = [];
      const sy2: number[] = [];
      const sz: number[] = [];
      const nx: number[] = [];
      const ny: number[] = [];
      const nz: number[] = [];
      for (let k = 0; k < 3; k += 1) {
        const i = (v0 + k) * 3;
        const [x, y, z] = view(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0);
        sx.push(n / 2 + (x - midX) * scale);
        sy2.push(n / 2 - (y - midY) * scale);
        sz.push(z);
        const [a, b, d] = view(nm[i] ?? 0, nm[i + 1] ?? 0, nm[i + 2] ?? 0);
        nx.push(a);
        ny.push(b);
        nz.push(d);
      }
      const [x0 = 0, x1 = 0, x2 = 0] = sx;
      const [y0 = 0, y1 = 0, y2 = 0] = sy2;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) continue;
      // The flat values are the last corner's, as WebGL's provoking vertex.
      const last = v0 + 2;
      // A decal hugs the ground it is painted on: pulled toward the camera, as the shader does.
      const pull = (decal[last] ?? 0) > 0 ? reach * 2e-3 : 0;
      const lit = (unlit[last] ?? 0) < 0.5;
      const base = [c[last * 3] ?? 0, c[last * 3 + 1] ?? 0, c[last * 3 + 2] ?? 0];
      const side = sides ? [0, 1, 2].map((j) => sides[last * 8 + j] ?? 0) : null;
      const over = sides ? [4, 5, 6].map((j) => sides[last * 8 + j] ?? 0) : null;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(n - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(n - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const qx = px + 0.5;
          const qy = py + 0.5;
          const w0 = ((x1 - qx) * (y2 - qy) - (x2 - qx) * (y1 - qy)) / area;
          const w1 = ((x2 - qx) * (y0 - qy) - (x0 - qx) * (y2 - qy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * (sz[0] ?? 0) + w1 * (sz[1] ?? 0) + w2 * (sz[2] ?? 0) + pull;
          const at = py * n + px;
          if (z <= (depth[at] ?? -Infinity)) continue;
          depth[at] = z;
          covered[at] = 1;
          const lerp = (arr: ArrayLike<number>, stride: number, offset: number): number =>
            w0 * (arr[v0 * stride + offset] ?? 0) +
            w1 * (arr[(v0 + 1) * stride + offset] ?? 0) +
            w2 * (arr[(v0 + 2) * stride + offset] ?? 0);
          let r = base[0] ?? 0;
          let g = base[1] ?? 0;
          let b = base[2] ?? 0;
          if (sides && side && over) {
            const arc = (o: number): number => {
              if (!bends) return 0;
              const along = unit(lerp(bends, 4, o));
              return (bends[last * 4 + o + 1] ?? 0) * along * (1 - along);
            };
            if (lerp(sides, 8, 3) + arc(0) > 0.5) [r, g, b] = side as [number, number, number];
            if (lerp(sides, 8, 7) + arc(2) > 0.5) [r, g, b] = over as [number, number, number];
          }
          if (lit) {
            const fx = w0 * (nx[0] ?? 0) + w1 * (nx[1] ?? 0) + w2 * (nx[2] ?? 0);
            const fy = w0 * (ny[0] ?? 0) + w1 * (ny[1] ?? 0) + w2 * (ny[2] ?? 0);
            const fz = w0 * (nz[0] ?? 0) + w1 * (nz[1] ?? 0) + w2 * (nz[2] ?? 0);
            const len = Math.hypot(fx, fy, fz) || 1;
            const level = band((fx * LIGHT[0] + fy * LIGHT[1] + fz * LIGHT[2]) / len);
            r *= (shade[0] ?? 1) + (1 - (shade[0] ?? 1)) * level;
            g *= (shade[1] ?? 1) + (1 - (shade[1] ?? 1)) * level;
            b *= (shade[2] ?? 1) + (1 - (shade[2] ?? 1)) * level;
          }
          colour[at * 3] = r;
          colour[at * 3 + 1] = g;
          colour[at * 3 + 2] = b;
        }
      }
    }
  }

  // The ghosts' lines, over what they outline, about a pixel wide (the engine draws them one
  // pixel wide, unlit, in the family's base): stamped along each segment, depth tested a little
  // in front so that a line on a face shows and one behind the body does not.
  if (lineColor) {
    const radius = SUPER * 0.55;
    const lift = reach * 8e-3;
    for (const segments of lines) {
      for (let i = 0; i + 5 < segments.length; i += 6) {
        const a = view(segments[i] ?? 0, segments[i + 1] ?? 0, segments[i + 2] ?? 0);
        const c = view(segments[i + 3] ?? 0, segments[i + 4] ?? 0, segments[i + 5] ?? 0);
        const ax = n / 2 + (a[0] - midX) * scale;
        const ay = n / 2 - (a[1] - midY) * scale;
        const cx = n / 2 + (c[0] - midX) * scale;
        const cy2 = n / 2 - (c[1] - midY) * scale;
        const steps = Math.max(1, Math.ceil(Math.hypot(cx - ax, cy2 - ay) * 2));
        for (let k = 0; k <= steps; k += 1) {
          const f = k / steps;
          const qx = ax + (cx - ax) * f;
          const qy = ay + (cy2 - ay) * f;
          const z = a[2] + (c[2] - a[2]) * f + lift;
          const r = Math.ceil(radius);
          for (let py = Math.floor(qy) - r; py <= Math.floor(qy) + r; py += 1) {
            for (let px = Math.floor(qx) - r; px <= Math.floor(qx) + r; px += 1) {
              if (px < 0 || py < 0 || px >= n || py >= n) continue;
              if (Math.hypot(px + 0.5 - qx, py + 0.5 - qy) > radius) continue;
              const at = py * n + px;
              if (covered[at] && z < (depth[at] ?? -Infinity)) continue;
              covered[at] = 1;
              colour[at * 3] = lineColor[0];
              colour[at * 3 + 1] = lineColor[1];
              colour[at * 3 + 2] = lineColor[2];
            }
          }
        }
      }
    }
  }

  // Down to the picture's size: the mean of each block of samples, in linear light, with its
  // coverage as alpha (straight, not premultiplied).
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      for (let j = 0; j < SUPER; j += 1) {
        for (let i = 0; i < SUPER; i += 1) {
          const at = (y * SUPER + j) * n + x * SUPER + i;
          if (!covered[at]) continue;
          r += colour[at * 3] ?? 0;
          g += colour[at * 3 + 1] ?? 0;
          b += colour[at * 3 + 2] ?? 0;
          k += 1;
        }
      }
      const o = (y * size + x) * 4;
      if (k === 0) continue;
      data[o] = toSrgb(r / k);
      data[o + 1] = toSrgb(g / k);
      data[o + 2] = toSrgb(b / k);
      data[o + 3] = Math.round((255 * k) / (SUPER * SUPER));
    }
  }
  return { width: size, height: size, data };
}
