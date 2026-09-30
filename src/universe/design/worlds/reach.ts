/**
 * HOW FAR EACH WORLD'S SOLID REACHES, in radii of its body, by manifest id: its declared reach.
 * An emblem world stands out past its radius in the plane the ship flies in (a sign on a mast, a
 * ring, the fins of a rocket), and the collision field takes `radius x reach` as the body's
 * surface (the manifest's `solidRadius`, data/build.ts), so the ship cannot fly into what is
 * drawn. The docking ring and the assist's rings stay where they are (`dockRadius`).
 *
 * Measured, not guessed: tests/world-reach.test.ts clips every solid triangle (ghosts are a
 * blueprint, not solid) to the lane |y| < 0.3 radii, far and near, at rest and at every moment of
 * every motion, planned work at its maquette's scale, and requires each value here to be the
 * worst of that rounded UP to the hundredth (never below 1). A change to a world's rows that moves
 * its reach fails there, and the new number comes from it.
 *
 * Two worlds reach further in that lane than their docking ring leaves room for (the cushion must
 * fit under the ring: (dockRadius - cushion depth) / radius) and are declared AT that cap: Model
 * Rocketry's fins cross the lane obliquely (1.53 radii at its edges, 1.33 within 1 u of the
 * ship's plane), and FishAI's Athena bead stands on its loop at 1.82, 0.06 u past its cap of 1.8.
 * Where the ship flies (1 u either side of its plane) neither reaches the shell, which keeps the
 * ship's centre `cushion.shellGap` outside the declared surface; the test checks that instead
 * and lists the two, so a change that brings either inside its cap, or takes another out, is seen.
 */
export const REACH: Readonly<Record<string, number>> = {
  'page/about': 1.57,
  'page/resume': 1.12,
  'page/contact': 1.99,
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
