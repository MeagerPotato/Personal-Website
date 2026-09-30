import type { BodyRecipe } from '../../sim/world/rows';
import { HACKATHONS } from './hackathons';
import { HOME } from './home';
import { PROJECTS } from './projects';
import { RESEARCH } from './research';

/**
 * EVERY EMBLEM WORLD, by manifest id: the far rows of each body (its ground and the parts that
 * tell its story at a glance), one file per system. The close-up parts are near.ts and the
 * motions motion.ts, both in the second chunk. A key must name a body of the real galaxy
 * (tests/worlds.test.ts), and a body with no key here stays a generated planet.
 */
export const BODIES: Readonly<Record<string, BodyRecipe>> = {
  ...HOME,
  ...PROJECTS,
  ...RESEARCH,
  ...HACKATHONS,
};
