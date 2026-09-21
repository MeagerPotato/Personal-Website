import { angleOf } from './math';

export interface SpawnRule {
  /** Distance from the centre of the home planet, in units. */
  readonly distance: number;
  /** How far round the home planet the start is swung, in degrees. */
  readonly swingDeg: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  /** Radians, the universe's convention (sim/types.ts). */
  heading: number;
}

/**
 * Where a new visitor starts: `distance` from home, FACING home, on the side away from the
 * nearest other system and swung round a little. Straight behind home that system's sun would be
 * hidden by the planet; swung round, the first view is home with a sun glinting beside it, which
 * says "there is more out there" without a word.
 *
 * A rule instead of a coordinate, because the galaxy's layout is generated from content: adding
 * a system must not leave the visitor staring into empty space.
 */
export function spawnPoint(
  home: readonly [x: number, z: number],
  neighbour: readonly [x: number, z: number] | null,
  rule: SpawnRule,
): SpawnPoint {
  // Direction from home to the neighbour; with no neighbour, any direction will do.
  const toward = neighbour ? angleOf(neighbour[0] - home[0], neighbour[1] - home[1]) : 0;
  const away = toward + Math.PI + (rule.swingDeg * Math.PI) / 180;
  const x = home[0] + rule.distance * Math.sin(away);
  const z = home[1] + rule.distance * Math.cos(away);
  return { x, z, heading: angleOf(home[0] - x, home[1] - z) };
}
