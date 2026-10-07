import type { JourneyResult } from './fly';
import type { GalaxyReport } from './measure';
import { describe as describeRow, describeTwin, statsOf } from './report';
import { describeFlight } from './stress';

// THE GATE: what `npm run journeys` has to measure for the run to pass. It used to be words in
// AGENTS.md and docs/PLAN.md that someone held the tables up against by eye, so a slower autopilot
// or a bigger galaxy could merge unnoticed. Now measure() holds every galaxy to it and prints each
// breach in words, and journeys.measure.ts fails the run on any (and with it CI's journeys job,
// .github/workflows/journeys.yml).

/**
 * What one galaxy must show; every limit is optional, and limits on journeys that were never
 * flown cannot be met: a galaxy held to any limit must be built and its sample must not be empty.
 * Whatever it says, and with the gate off too (JOURNEYS "gate": false), a stress flight
 * (MeasureOptions.stress) or a journey stopped at its fastest (MeasureOptions.stop) that fails is
 * always a breach when they ran: none failing is the gate for a change to the autopilot, the
 * approach, Stop, the guard or the snapshot, and nothing here loosens that. The same goes for a
 * journey flown again with hyperspace taken (MeasureOptions.hyper): a twin that flew differently
 * is a breach, whatever the gate says, because hyperspace is the same flight or it is a bug.
 */
export interface GalaxyGate {
  /** How many journeys may fail (not docked in time, a shell touched or tunnelled, a graze). */
  failures?: number;
  /** The 90th percentile of every journey, s. */
  p90Sec?: number;
  /** The slowest journey, s. */
  maxSec?: number;
  /** The share of journeys (0 to 1) that may take longer than 5 s, the "about 5 s" of PLAN §9. */
  over5sShare?: number;
}

const LIMITS = ['failures', 'p90Sec', 'maxSec', 'over5sShare'] as const;
type Limit = (typeof LIMITS)[number];
const isLimit = (key: string): key is Limit => (LIMITS as readonly string[]).includes(key);

/** Per galaxy: "real", a number of systems ("6"), and "*" for every galaxy not named. */
export type Gate = Readonly<Record<string, GalaxyGate>>;

/**
 * The real galaxy is what visitors fly, so it is held to docs/PLAN.md §9's bar for four systems
 * ("p90 about 4 s and the slowest about 6 s"), with a margin for the start conditions: the
 * slowest journey moves by half a second from one seed to another. The grown galaxies are a
 * future already over "about 5 s" (PLAN §9), so only their failures are gated; their times are
 * reported for the polish pass.
 */
export const DEFAULT_GATE: Gate = {
  real: { failures: 0, p90Sec: 4.2, maxSec: 6.5, over5sShare: 0.015 },
  '*': { failures: 0 },
};

/** The limits for one galaxy: its own entry, else "*", else none. */
export function gateFor(gate: Gate, galaxy: 'real' | number): GalaxyGate {
  return gate[String(galaxy)] ?? gate['*'] ?? {};
}

const percent = (share: number): string => `${Number((share * 100).toFixed(2))}%`;
const seconds = (value: number): string => `${value.toFixed(2)} s`;

/** The gate in words, for the tables. */
export function describeGate(gate: GalaxyGate): string {
  const words = [
    gate.failures === undefined
      ? null
      : `${gate.failures} failure${gate.failures === 1 ? '' : 's'}`,
    gate.p90Sec === undefined ? null : `p90 <= ${gate.p90Sec} s`,
    gate.maxSec === undefined ? null : `slowest <= ${gate.maxSec} s`,
    gate.over5sShare === undefined ? null : `at most ${percent(gate.over5sShare)} over 5 s`,
  ].filter((word) => word !== null);
  return words.length === 0 ? 'no limits' : words.join(', ');
}

/** The first few journeys of a list, for a breach: which ones to go and look at. */
function some<T>(items: readonly T[], describe: (item: T) => string, count = 3): string {
  const shown = items.slice(0, count).map(describe).join('; ');
  return items.length > count ? `${shown}; and ${items.length - count} more` : shown;
}

const failedJourney = (row: JourneyResult): string => `${row.failure}: ${describeRow(row)}`;

/**
 * Every way `report` misses `gate`, in words; empty when it passes. With the gate off, pass `{}`:
 * no limits, and stress flights and Stop are still held to 0 failures.
 */
export function breachesOf(
  report: Pick<GalaxyReport, 'error' | 'rows' | 'stops' | 'stress'> &
    Partial<Pick<GalaxyReport, 'twins'>>,
  gate: GalaxyGate,
): string[] {
  // A galaxy that was never flown (it cannot be built, or its sample is empty) has shown nothing,
  // so no limit on it is known to be met.
  const limited = LIMITS.some((limit) => gate[limit] !== undefined);
  if (report.error !== null)
    return limited ? [`could not be built, so no journey was flown: ${report.error}`] : [];

  const breaches: string[] = [];
  if (limited && report.rows.length === 0) {
    breaches.push('no journey was flown (the sample is empty), so no limit is known to be met');
  }
  const all = statsOf(report.rows);
  const failed = report.rows.filter((row) => row.failure !== null);
  if (gate.failures !== undefined && failed.length > gate.failures) {
    breaches.push(
      `${failed.length} of ${all.n} journeys failed, the gate allows ${gate.failures}: ` +
        some(failed, failedJourney),
    );
  }
  if (gate.p90Sec !== undefined && all.p90 > gate.p90Sec) {
    breaches.push(`p90 is ${seconds(all.p90)}, over the gate's ${gate.p90Sec} s`);
  }
  if (gate.maxSec !== undefined && all.max > gate.maxSec && all.worst !== null) {
    breaches.push(
      `the slowest journey takes ${seconds(all.max)}, over the gate's ${gate.maxSec} s: ` +
        describeRow(all.worst),
    );
  }
  if (gate.over5sShare !== undefined && all.n > 0) {
    // As the tables count it (report.ts, "<=5 s"): a journey that never docked is over too.
    const over = report.rows.filter((row) => !(row.docked && row.seconds <= 5));
    if (over.length / all.n > gate.over5sShare) {
      breaches.push(
        `${over.length} of ${all.n} journeys (${percent(over.length / all.n)}) take over 5 s, ` +
          `the gate allows ${percent(gate.over5sShare)}: ` +
          some(
            over.sort((a, b) => b.seconds - a.seconds),
            (row) => `${row.from} -> ${row.to} ${seconds(row.seconds)}`,
          ),
      );
    }
  }

  const twins = (report.twins ?? []).filter((row) => row.failure !== null);
  if (twins.length > 0) {
    breaches.push(
      `${twins.length} of ${report.twins?.length ?? 0} journeys flown again with hyperspace taken ` +
        `failed, the gate allows none: ${some(twins, describeTwin)}`,
    );
  }
  const stops = report.stops.filter((row) => row.failure !== null);
  if (stops.length > 0) {
    breaches.push(
      `${stops.length} of ${report.stops.length} journeys stopped at their fastest ` +
        `failed (a shell touched, a graze, a jump that outlived its journey), the gate allows ` +
        `none: ${some(stops, failedJourney)}`,
    );
  }
  const stressed = report.stress.filter((flight) => flight.result.failure !== null);
  if (stressed.length > 0) {
    breaches.push(
      `${stressed.length} of ${report.stress.length} stress flights failed, the gate allows none: ` +
        some(
          stressed,
          (flight) => `${flight.mode} ${flight.result.failure}: ${describeFlight(flight)}`,
        ),
    );
  }
  return breaches;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The gate from JOURNEYS: false (or null) to switch it off, which leaves only the stress and Stop
 * rule, or limits per galaxy, which REPLACE the default gate whole (a galaxy with no entry and no
 * "*" is held to nothing but that rule). Keys are checked, as everywhere in JOURNEYS: a typo must
 * not pass.
 */
export function parseGate(raw: unknown): Gate | null {
  if (raw === false || raw === null) return null;
  const shape =
    'give it { "real": { "p90Sec": 4.2 }, "6": { "failures": 0 }, "*": {...} } or false';
  if (!isRecord(raw)) throw new Error(`JOURNEYS: "gate": ${shape}`);
  const gate: Record<string, GalaxyGate> = {};
  for (const [galaxy, limits] of Object.entries(raw)) {
    if (galaxy !== 'real' && galaxy !== '*' && !/^\d+$/.test(galaxy)) {
      throw new Error(
        `JOURNEYS: gate for "${galaxy}": a galaxy is "real", a number of systems, or "*" for the rest`,
      );
    }
    if (!isRecord(limits)) throw new Error(`JOURNEYS: gate for "${galaxy}": ${shape}`);
    const parsed: GalaxyGate = {};
    for (const [key, value] of Object.entries(limits)) {
      if (!isLimit(key)) {
        throw new Error(`JOURNEYS: unknown gate limit "${key}" (known: ${LIMITS.join(', ')})`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`JOURNEYS: gate for "${galaxy}": ${key} must be a number, 0 or more`);
      }
      parsed[key] = value;
    }
    gate[galaxy] = parsed;
  }
  return gate;
}
