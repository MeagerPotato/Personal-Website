import type { BiomeKey, ThemeKey, Tokens } from '../universe/design/tokens';
import { createRng } from '../universe/sim/rng';

// The default link-preview card (what LinkedIn, Slack or iMessage show beside a link): a small
// solar system in the site's own colours. Drawn as SVG from the design tokens, so a palette change
// restyles it for free, and with NO TEXT, so it rasterises identically on every machine (SVG text
// depends on the fonts installed; the title and description travel as meta tags anyway).
//
// Pure: same tokens in, same string out. src/pages/og/default.png.ts turns it into a PNG.

export const OG_SIZE = { width: 1200, height: 630 } as const;

const SUN = { x: 610, y: 322 };
/** Orbits are drawn as a tilted disc: wide, and FLATTENING times as tall. */
const FLATTENING = 0.4;

interface PlanetSpec {
  orbit: number;
  angleDeg: number;
  radius: number;
  biome: BiomeKey;
  ring?: ThemeKey;
  moons?: ReadonlyArray<{ angleDeg: number; distance: number; radius: number; biome: BiomeKey }>;
}

const ORBITS = [188, 318, 452, 574];
const PLANETS: readonly PlanetSpec[] = [
  { orbit: 0, angleDeg: 206, radius: 19, biome: 'dune' },
  { orbit: 1, angleDeg: 38, radius: 33, biome: 'terra' },
  {
    orbit: 2,
    angleDeg: 158,
    radius: 46,
    biome: 'tide',
    ring: 'sky',
    moons: [
      { angleDeg: 215, distance: 96, radius: 10, biome: 'frost' },
      { angleDeg: 20, distance: 118, radius: 8, biome: 'bloom' },
    ],
  },
  { orbit: 3, angleDeg: -29, radius: 25, biome: 'ember' },
];

const n = (value: number): string => String(Math.round(value * 10) / 10);
const rad = (deg: number): number => (deg * Math.PI) / 180;

function onOrbit(orbit: number, angleDeg: number): { x: number; y: number } {
  const rx = ORBITS[orbit] ?? 0;
  return {
    x: SUN.x + rx * Math.cos(rad(angleDeg)),
    y: SUN.y + rx * FLATTENING * Math.sin(rad(angleDeg)),
  };
}

/** A full circle as a path, so two of them can be combined with fill-rule="evenodd". */
const circlePath = (cx: number, cy: number, r: number): string =>
  `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

/**
 * A toy planet, the same recipe as `.planet-dot` in the stylesheet: sea, two landmasses with a
 * shoreline, a polar cap, and a tinted shadow on the side facing away from the sun.
 */
function planet(
  tokens: Tokens,
  id: string,
  at: { x: number; y: number },
  r: number,
  biome: BiomeKey,
): string {
  const c = tokens.color.biome[biome];
  // Unit vector from the planet towards the sun: the lit side.
  const dx = SUN.x - at.x;
  const dy = SUN.y - at.y;
  const length = Math.hypot(dx, dy) || 1;
  const lit = { x: (dx / length) * r * 0.34, y: (dy / length) * r * 0.34 };
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: string): string =>
    `<ellipse cx="${n(cx * r)}" cy="${n(cy * r)}" rx="${n(rx * r)}" ry="${n(ry * r)}" fill="${fill}"/>`;

  return [
    `<g transform="translate(${n(at.x)} ${n(at.y)})">`,
    `<clipPath id="${id}"><circle r="${n(r)}"/></clipPath>`,
    `<circle r="${n(r)}" fill="${c.sea}"/>`,
    `<g clip-path="url(#${id})">`,
    blob(-0.28, -0.16, 0.72, 0.58, c.shore),
    blob(-0.28, -0.16, 0.62, 0.48, c.low),
    blob(-0.3, -0.2, 0.4, 0.3, c.high),
    blob(0.42, 0.46, 0.48, 0.36, c.shore),
    blob(0.42, 0.46, 0.38, 0.26, c.low),
    blob(0.12, -0.86, 0.34, 0.18, c.peak),
    `<path d="${circlePath(0, 0, r)}${circlePath(lit.x, lit.y, r)}" fill-rule="evenodd" ` +
      `fill="${tokens.color.space[800]}" fill-opacity="0.42"/>`,
    '</g></g>',
  ].join('');
}

/** A ring around a planet: the far half is drawn before the planet, the near half after it. */
function ring(
  tokens: Tokens,
  at: { x: number; y: number },
  r: number,
  theme: ThemeKey,
  half: 'far' | 'near',
): string {
  const rx = r * 1.78;
  const ry = r * 0.52;
  const sweep = half === 'far' ? 1 : 0;
  return (
    `<path d="M${n(-rx)} 0A${n(rx)} ${n(ry)} 0 0 ${sweep} ${n(rx)} 0" fill="none" ` +
    `stroke="${tokens.color.system[theme].light}" stroke-width="${n(r * 0.17)}" ` +
    `stroke-linecap="round" transform="translate(${n(at.x)} ${n(at.y)}) rotate(-16)"/>`
  );
}

function stars(tokens: Tokens): string {
  const rng = createRng('og-card-stars');
  const tints = [tokens.color.star.white, tokens.color.star.cool, tokens.color.star.warm];
  const dots: string[] = [];
  for (let i = 0; i < 170; i += 1) {
    const x = rng() * OG_SIZE.width;
    const y = rng() * OG_SIZE.height;
    const size = 0.7 + rng() * rng() * 1.9;
    const opacity = 0.3 + rng() * 0.6;
    const tint = tints[Math.floor(rng() * tints.length)] ?? tokens.color.star.white;
    dots.push(
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(size)}" fill="${tint}" fill-opacity="${n(opacity)}"/>`,
    );
  }
  return dots.join('');
}

export function defaultOgSvg(tokens: Tokens): string {
  const { width, height } = OG_SIZE;
  const { space, system, surface } = tokens.color;
  const sun = system.butter;

  const orbits = ORBITS.map(
    (rx) =>
      `<ellipse cx="${SUN.x}" cy="${SUN.y}" rx="${rx}" ry="${n(rx * FLATTENING)}" fill="none" ` +
      `stroke="${surface.line}" stroke-width="2"/>`,
  ).join('');

  // Far-side bodies first, so that nearer ones overlap them.
  const bodies = [...PLANETS]
    .map((spec, index) => ({ spec, index, at: onOrbit(spec.orbit, spec.angleDeg) }))
    .sort((a, b) => a.at.y - b.at.y)
    .map(({ spec, index, at }) => {
      const moons = (spec.moons ?? []).map((moon, moonIndex) => {
        const moonAt = {
          x: at.x + moon.distance * Math.cos(rad(moon.angleDeg)),
          y: at.y + moon.distance * FLATTENING * Math.sin(rad(moon.angleDeg)),
        };
        return planet(tokens, `og-moon-${index}-${moonIndex}`, moonAt, moon.radius, moon.biome);
      });
      return [
        spec.ring ? ring(tokens, at, spec.radius, spec.ring, 'far') : '',
        planet(tokens, `og-planet-${index}`, at, spec.radius, spec.biome),
        spec.ring ? ring(tokens, at, spec.radius, spec.ring, 'near') : '',
        ...moons,
      ].join('');
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    `<radialGradient id="og-glow-a" cx="0.12" cy="-0.1" r="0.9"><stop offset="0" stop-color="${space[700]}"/>` +
      `<stop offset="1" stop-color="${space[700]}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="og-glow-b" cx="1" cy="1.1" r="0.7"><stop offset="0" stop-color="${space[800]}"/>` +
      `<stop offset="1" stop-color="${space[800]}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${width}" height="${height}" fill="${space[900]}"/>`,
    `<rect width="${width}" height="${height}" fill="url(#og-glow-a)"/>`,
    `<rect width="${width}" height="${height}" fill="url(#og-glow-b)"/>`,
    stars(tokens),
    orbits,
    // The sun: flat discs, no blur, like everything else here.
    `<circle cx="${SUN.x}" cy="${SUN.y}" r="86" fill="${sun.base}" fill-opacity="0.1"/>`,
    `<circle cx="${SUN.x}" cy="${SUN.y}" r="66" fill="${sun.base}" fill-opacity="0.18"/>`,
    `<circle cx="${SUN.x}" cy="${SUN.y}" r="48" fill="${sun.base}"/>`,
    `<circle cx="${SUN.x - 9}" cy="${SUN.y - 9}" r="30" fill="${sun.light}"/>`,
    bodies,
    // The wordmark's signature, as it sits beside the name on every page: three stations on a line.
    `<path d="M66 566H134" stroke="${tokens.color.ink.low}" stroke-width="3.5"/>`,
    `<circle cx="66" cy="566" r="10" fill="${system.coral.base}"/>`,
    `<circle cx="100" cy="566" r="10" fill="${system.butter.base}"/>`,
    `<circle cx="134" cy="566" r="10" fill="${system.mint.base}"/>`,
    '</svg>',
  ].join('');
}
