/**
 * HOW FAR EACH WORLD'S SOLID REACHES, in radii of its body, by manifest id: its declared reach.
 * An emblem world stands out past its radius in the plane the ship flies in (a sign on a mast, a
 * ring, the fins of a rocket), and the collision field takes `radius x reach`, rounded up to the
 * hundredth, as the body's surface (the manifest's `solidRadius`, data/build.ts), so the ship
 * cannot fly into what is drawn. The docking ring and the assist's rings stay where they are
 * (`dockRadius`). A body that a recipe in design/worlds.ts takes off its rows has no reach of
 * theirs.
 *
 * Measured, not guessed: tests/world-reach.test.ts clips every solid triangle (ghosts are a
 * blueprint, not solid) to the lane |y| < 0.3 radii (on a small body, the ship's own band of 1 u
 * if that is wider), far and near, at rest and at every moment of every motion (each frame at
 * 120 Hz, and the instant before each period ends), planned work at its maquette's scale, and
 * requires each value here to be the worst of that rounded UP to the hundredth (never below 1). A
 * change to a world's rows that moves its reach fails there, and the new number comes from it.
 * So does a planned project that is built (its maquette grows to full size) and, in data/build.ts,
 * a body whose kind or size content changes: the room under its ring is its own.
 *
 * One world reaches further in that lane than its docking ring leaves room for (the cushion must
 * fit under the ring: (dockRadius - cushion depth) / radius) and is declared AT that cap: Model
 * Rocketry's fins cross the lane obliquely (1.53 radii at its edges, 1.33 within 1 u of the
 * ship's plane). Where the ship flies (1 u either side of its plane) they reach nowhere near its
 * nose, which the shell keeps at the declared surface at the closest; the test checks that
 * instead and names it, so a change that brings it inside its cap, or takes another out, is seen.
 */
export const REACH: Readonly<Record<string, number>> = {
  'page/about': 1.57,
  'page/resume': 1.12,
  'page/contact': 2,
  'link/github': 1.72,
  'link/linkedin': 1.4,
  'link/devpost': 1.48,
  'system/hardware': 1.57,
  'system/software': 1.69,
  'system/research': 1.67,
  'system/hackathons': 1.68,
  'project/robotics': 1.4,
  'project/canadian-fish-demo': 1.39,
  'project/fishai': 1.8,
  'project/days2meet': 1.19,
  'project/hackgt-13': 1.36,
  'project/hackathons-at-berkeley': 1.4,
  'project/cal-hacks-13': 1.19,
  'project/fish-online': 1.09,
  'project/sports-analysis': 1.09,
  'project/kalshi': 1,
  'project/corgi': 1.08,
  'project/model-rocketry': 1.4,
  'project/cyberpatriot': 1,
  'project/fish-onboarding': 1.14,
};
