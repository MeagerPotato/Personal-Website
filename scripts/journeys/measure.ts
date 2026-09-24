import { readFileSync } from 'node:fs';
import type { ManifestSystem } from '../../src/universe/data/types';
import {
  fly,
  planJourneys,
  simTuning,
  stopAtPeak,
  type Galaxy,
  type JourneyResult,
  type Sample,
  type StepView,
  type TuningOverrides,
} from './fly';
import { buildGalaxy, grow, readRealInput, type LayoutOverrides } from './galaxies';
import { describe as describeRow, phasesOf, statsOf, stopTable, table } from './report';
import {
  STRESS_DEFAULTS,
  STRESS_MODES,
  stress,
  stressTable,
  type StressFlight,
  type StressOptions,
} from './stress';

// The harness as a function: galaxies x variants in, every journey out. journeys.measure.ts runs
// it from the JOURNEYS environment variable; a proposal can import `measure` in its own
// *.measure.ts beside it and pass a slot formula as code.

/** 'real' is src/content as the build reads it; a number is that many systems, home included. */
export type GalaxySpec = 'real' | number;

/** One way of setting things up: layout overrides for the build, tuning overrides for the flight. */
export interface Variant extends LayoutOverrides {
  name: string;
  tuning?: TuningOverrides;
}

export interface MeasureOptions {
  galaxies: GalaxySpec[];
  variants: Variant[];
  sample: Omit<Sample, 'starts'> & { starts: number | { real: number; grown: number } };
  /** A journey that has not docked after this long (s) is a failure. */
  limitSec: number;
  /** Seeds every start condition. */
  seed: string;
  /** Build with draft projects, as `npm run dev` does (production leaves them out). */
  includeDrafts: boolean;
  /** Print every journey, not just the tables. */
  rows: boolean;
  /**
   * Print the journeys from `from` to `to` ('spawn' for the spawn point) as they fly, every
   * `everySec`: where, how fast, what the dock and the autopilot are doing, what was flown.
   */
  trace: { from: string; to: string; everySec?: number } | null;
  /**
   * STOP MID-JOURNEY as well: every journey between systems is flown a second time and stopped at
   * its fastest moment (Stop, Navigator.stop), then watched for `coastSec`: how far the ship
   * slides, how close it comes to anything, whether it touches a shell. Null: not done.
   */
  stop: { coastSec: number } | null;
  /**
   * A VISITOR WHO CHANGES THEIR MIND (stress.ts): a sample of journeys between systems, each flown
   * again and again with a redirect, a Stop, a body within reach asked for at speed, or a Stop and
   * then E, at every moment of the flight. Null: not done.
   */
  stress: StressOptions | null;
  log: (text: string) => void;
}

export const DEFAULTS: MeasureOptions = {
  galaxies: ['real', 4, 6, 8],
  variants: [{ name: 'baseline' }],
  // The real galaxy has few pairs, so each is flown from 6 different moments; bigger ones once.
  sample: { between: 'all', within: 'all', spawn: true, starts: { real: 6, grown: 1 } },
  limitSec: 60,
  seed: 'journeys',
  includeDrafts: false,
  rows: false,
  trace: null,
  stop: null,
  stress: null,
  log: (text) => console.log(text),
};

export interface GalaxyReport {
  variant: string;
  galaxy: string;
  systems: Array<Pick<ManifestSystem, 'id' | 'position' | 'radius'>>;
  /** Why the galaxy could not be built (a tripwire in data/build.ts), if it could not. */
  error: string | null;
  rows: JourneyResult[];
  /** The journeys between systems again, stopped at their fastest (MeasureOptions.stop). */
  stops: JourneyResult[];
  /** The stress test's flights (MeasureOptions.stress). */
  stress: StressFlight[];
  wallSec: number;
}

function describeSystems(systems: readonly ManifestSystem[]): string {
  let farthest = 0;
  for (const a of systems) {
    for (const b of systems) {
      farthest = Math.max(
        farthest,
        Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]),
      );
    }
  }
  const list = systems
    .map(
      (system) =>
        `${system.id} (${system.position[0].toFixed(0)}, ${system.position[1].toFixed(0)}) r${system.radius.toFixed(0)}`,
    )
    .join(' | ');
  return `${list}\nfarthest centres ${farthest.toFixed(0)} u`;
}

/** A `watch` for fly(): one line every `everySec` of the journey, and one at the end. */
export function tracer(
  to: string,
  everySec: number,
  log: (text: string) => void,
): (view: StepView) => void {
  let next = 0;
  return ({ t, state, world, flown, mode }) => {
    const i = world.orbits.indexOf(to);
    const dx = state.x - (world.field.positions[i * 2] ?? 0);
    const dz = state.z - (world.field.positions[i * 2 + 1] ?? 0);
    const last = mode === 'docked';
    if (t + 1e-9 < next && !last) return;
    next += everySec;
    const { path, index, speeds, ceiling } = world.cruise;
    const runs = Math.atan2(
      (path.x[index + 1] ?? 0) - (path.x[index] ?? 0),
      (path.z[index + 1] ?? 0) - (path.z[index] ?? 0),
    );
    const off = Math.abs(((state.heading - runs + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    const cruise =
      world.dock.phase === 'cruise'
        ? ` plan ${path.length.toFixed(0)} u eta ${world.cruise.etaSec.toFixed(1)} s` +
          ` | at ${(path.s[index] ?? 0).toFixed(0)} u wants ${(speeds[index] ?? 0).toFixed(0)}` +
          ` ceiling ${Math.min(99999, ceiling[index] ?? 0).toFixed(0)} nose off ${((off * 180) / Math.PI).toFixed(0)} deg`
        : '';
    log(
      `  ${t.toFixed(2).padStart(6)} s  ${mode.padEnd(9)} ${world.dock.phase.padEnd(8)} ` +
        `at (${state.x.toFixed(0)}, ${state.z.toFixed(0)}) ${Math.hypot(state.vx, state.vz).toFixed(1).padStart(6)} u/s  ` +
        `to go ${Math.hypot(dx, dz).toFixed(1).padStart(7)} u (ring ${(world.field.ringRadius[i] ?? 0).toFixed(1)})  ` +
        `thrust ${flown.thrust.toFixed(2)} turn ${flown.turn.toFixed(2)} brake ${flown.brake.toFixed(2)}` +
        `${world.touched >= 0 ? ` SHELL ${world.orbits.ids[world.touched] ?? ''}` : ''}${cruise}`,
    );
  };
}

export function measure(overrides: Partial<MeasureOptions> = {}): GalaxyReport[] {
  const options: MeasureOptions = { ...DEFAULTS, ...overrides };
  const { log } = options;
  const real = readRealInput(options.includeDrafts);
  const reports: GalaxyReport[] = [];

  for (const variant of options.variants) {
    const sim = simTuning(variant.tuning);
    for (const spec of options.galaxies) {
      const key = spec === 'real' ? 'real' : `grown-${spec}`;
      const began = performance.now();
      let name = spec === 'real' ? 'real' : `${spec} systems`;
      const report: GalaxyReport = {
        variant: variant.name,
        galaxy: name,
        systems: [],
        error: null,
        rows: [],
        stops: [],
        stress: [],
        wallSec: 0,
      };
      reports.push(report);
      let galaxy: Galaxy;
      try {
        const input = spec === 'real' ? real : grow(real, spec);
        galaxy = { name: key, manifest: buildGalaxy(input, variant) };
      } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
        log(`\n== ${variant.name} / ${name}: CANNOT BUILD\n${report.error}`);
        continue;
      }
      const { systems, bodies } = galaxy.manifest;
      if (spec === 'real') name = `real (${systems.length} systems)`;
      report.galaxy = name;
      report.systems = systems.map(({ id, position, radius }) => ({ id, position, radius }));

      const { starts } = options.sample;
      const sample: Sample = {
        ...options.sample,
        starts: typeof starts === 'number' ? starts : spec === 'real' ? starts.real : starts.grown,
      };
      const journeys = planJourneys(galaxy, sample, options.seed);
      for (const journey of journeys) {
        const traced =
          options.trace !== null &&
          (journey.from ?? 'spawn') === options.trace.from &&
          journey.to === options.trace.to;
        if (traced) log(`\ntrace ${variant.name} / ${name}: ${JSON.stringify(journey)}`);
        const row = fly(
          galaxy,
          journey,
          sim,
          options.limitSec,
          traced ? tracer(journey.to, options.trace?.everySec ?? 0.25, log) : undefined,
        );
        report.rows.push(row);
        if (options.rows)
          log(
            `  ${row.kind.padEnd(7)} ${describeRow(row)}  [${phasesOf(row)}]${row.failure ? ` FAIL ${row.failure}` : ''}`,
          );
        if (options.stop !== null && journey.kind === 'between') {
          const stopped = stopAtPeak(galaxy, journey, sim, options.stop.coastSec, options.limitSec);
          if (stopped !== null) report.stops.push(stopped);
        }
      }
      if (options.stress !== null) {
        report.stress = stress(
          galaxy,
          journeys,
          sim,
          options.stress,
          options.seed,
          options.limitSec,
        );
      }
      report.wallSec = (performance.now() - began) / 1000;
      log(
        `\n== ${variant.name} / ${name}: ${bodies.length} bodies, ${report.rows.length} journeys ` +
          `(${report.wallSec.toFixed(0)} s to simulate)\n${describeSystems(systems)}\n${table(report.rows)}`,
      );
      if (options.stop !== null) log(stopTable(report.stops, options.stop.coastSec));
      if (options.stress !== null) log(stressTable(report.stress));
    }
  }

  const labelOf = (report: GalaxyReport): string => `${report.variant} / ${report.galaxy}`;
  const width = Math.max(16, ...reports.map((report) => labelOf(report).length)) + 2;
  log('\n== summary: seconds from asking to docked');
  log(
    `${'variant / galaxy'.padEnd(width)} journeys  median    p90    max  fail  ` +
      '| between: n  median    max  worst',
  );
  for (const report of reports) {
    const label = labelOf(report).padEnd(width);
    if (report.error !== null) {
      log(`${label}  cannot build`);
      continue;
    }
    const all = statsOf(report.rows);
    const between = statsOf(report.rows.filter((row) => row.kind === 'between'));
    log(
      `${label}${String(all.n).padStart(9)}${all.median.toFixed(1).padStart(8)}${all.p90.toFixed(1).padStart(7)}` +
        `${all.max.toFixed(1).padStart(7)}${String(all.failures).padStart(6)}  |${String(between.n).padStart(10)}` +
        `${between.median.toFixed(1).padStart(8)}${between.max.toFixed(1).padStart(7)}  ` +
        `${between.worst ? `${between.worst.from} -> ${between.worst.to}` : '-'}`,
    );
  }
  if (options.stress !== null) {
    log(
      '\n== stress: flights that touched a shell, grazed, tunnelled or never docked (0 is the gate)',
    );
    for (const report of reports) {
      if (report.error !== null) continue;
      const failed = report.stress.filter((flight) => flight.result.failure !== null).length;
      log(
        `${labelOf(report).padEnd(width)}${String(report.stress.length).padStart(9)} flights  ${failed} failed`,
      );
    }
  }
  return reports;
}

// --- options from the environment -----------------------------------------------------------------

const VARIANT_KEYS = ['name', 'layout', 'slotExponent', 'positions', 'tuning'] as const;
const OPTION_KEYS = [
  'galaxies',
  'variants',
  'sample',
  'limitSec',
  'seed',
  'includeDrafts',
  'rows',
  'trace',
  'stop',
  'stress',
  'out',
] as const;

export interface EnvOptions {
  options: Partial<MeasureOptions>;
  /** Where to write every journey as JSON, if anywhere. */
  out: string | null;
}

/**
 * JOURNEYS is JSON, or the path of a JSON file: the options above, plus `out`. A single variant
 * may be written at the top level (`layout`, `slotExponent`, `positions`, `tuning`, `name`)
 * instead of in `variants`. JOURNEYS_OUT also sets `out`.
 */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): EnvOptions {
  const text = env.JOURNEYS?.trim() ?? '';
  const raw: Record<string, unknown> =
    text === ''
      ? {}
      : (JSON.parse(text.startsWith('{') ? text : readFileSync(text, 'utf8')) as Record<
          string,
          unknown
        >);

  const known = new Set<string>([...VARIANT_KEYS, ...OPTION_KEYS]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key))
      throw new Error(`JOURNEYS: unknown option "${key}" (known: ${[...known].join(', ')})`);
  }
  const options: Partial<MeasureOptions> = {};
  if (raw.galaxies !== undefined) options.galaxies = raw.galaxies as GalaxySpec[];
  if (raw.limitSec !== undefined) options.limitSec = Number(raw.limitSec);
  if (raw.seed !== undefined) options.seed = String(raw.seed);
  if (raw.includeDrafts !== undefined) options.includeDrafts = raw.includeDrafts === true;
  if (raw.rows !== undefined) options.rows = raw.rows === true;
  if (raw.trace !== undefined) options.trace = raw.trace as MeasureOptions['trace'];
  if (raw.stop !== undefined) {
    options.stop =
      raw.stop === true
        ? { coastSec: 10 }
        : raw.stop === false || raw.stop === null
          ? null
          : { coastSec: 10, ...(raw.stop as Partial<{ coastSec: number }>) };
  }
  if (raw.stress !== undefined) {
    const given = raw.stress === true ? {} : (raw.stress as Partial<StressOptions> | null | false);
    options.stress = given === false || given === null ? null : { ...STRESS_DEFAULTS, ...given };
    for (const mode of options.stress?.modes ?? []) {
      if (!(STRESS_MODES as readonly string[]).includes(mode)) {
        throw new Error(
          `JOURNEYS: unknown stress mode "${mode}" (known: ${STRESS_MODES.join(', ')})`,
        );
      }
    }
  }
  if (raw.sample !== undefined) {
    options.sample = { ...DEFAULTS.sample, ...(raw.sample as Partial<MeasureOptions['sample']>) };
  }

  const inline = VARIANT_KEYS.filter((key) => raw[key] !== undefined);
  if (raw.variants !== undefined && inline.length > 0) {
    throw new Error('JOURNEYS: give either "variants" or one variant at the top level, not both');
  }
  if (raw.variants !== undefined) options.variants = raw.variants as Variant[];
  else if (inline.length > 0) {
    const variant: Variant = { name: 'custom' };
    Object.assign(variant, Object.fromEntries(inline.map((key) => [key, raw[key]])));
    options.variants = [variant];
  }
  for (const variant of options.variants ?? []) {
    for (const key of Object.keys(variant)) {
      if (!(VARIANT_KEYS as readonly string[]).includes(key)) {
        throw new Error(
          `JOURNEYS: unknown variant option "${key}" (known: ${VARIANT_KEYS.join(', ')})`,
        );
      }
    }
  }
  const out = env.JOURNEYS_OUT ?? (typeof raw.out === 'string' ? raw.out : null);
  return { options, out: out === '' ? null : out };
}
