import type { BodyRecipe } from '../../sim/world/rows';
import { cyberpatriot } from './islands/cyberpatriot';
import { canadianFish } from './islands/canadian-fish-demo';
import { fishai } from './islands/fishai';
import { fishOnboarding } from './islands/fish-onboarding';
import { days2meet } from './islands/days2meet';
import { hackgt } from './islands/hackgt-13';
import { berkeley } from './islands/hackathons-at-berkeley';
import { calHacks } from './islands/cal-hacks-13';
import { fishOnline } from './islands/fish-online';
import { sportsAnalysis } from './islands/sports-analysis';
import { kalshi } from './islands/kalshi';
import { corgi } from './islands/corgi';
import { robotics } from './islands/robotics';

export { ROBOT_AT, FIELD_Y } from './islands/robotics';

/**
 * THE PROJECT WORLDS AS ISLANDS (2026-11-16: Allen asked for "a complete design/visual refresh
 * for the entire galaxy", "extremely visually stunning", taking from his voxel turtle-island
 * reference, then "take a deeper look at the design and animation of the artifact"). Each
 * project is a floating island built with the kit (isles.ts), one file each in islands/, with
 * its story on top and the life of a place round it. Keyed by manifest id, as
 * design/worlds/bodies.ts reads them.
 *
 * DESIGN SURFACE: the rows are free to change; their part names are what the motion table and
 * the tests refer to.
 */
export const ISLANDS: Readonly<Record<string, BodyRecipe>> = {
  'project/robotics': { rows: robotics },
  'project/cyberpatriot': { rows: cyberpatriot },
  'project/canadian-fish-demo': { rows: canadianFish },
  'project/fishai': { rows: fishai },
  'project/fish-onboarding': { rows: fishOnboarding },
  'project/days2meet': { rows: days2meet },
  'project/hackgt-13': { rows: hackgt },
  'project/hackathons-at-berkeley': { rows: berkeley },
  'project/cal-hacks-13': { rows: calHacks },
  'project/fish-online': { rows: fishOnline },
  'project/sports-analysis': { rows: sportsAnalysis },
  'project/kalshi': { rows: kalshi },
  'project/corgi': { rows: corgi },
};
