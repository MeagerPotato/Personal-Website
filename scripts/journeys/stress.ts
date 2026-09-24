import { pullOf } from '../../src/universe/sim/assist';
import { speedOf } from '../../src/universe/sim/flight';
import { createRng } from '../../src/universe/sim/rng';
import {
  fly,
  sampleOf,
  type Galaxy,
  type Interrupt,
  type JourneyResult,
  type JourneySpec,
  type SimTuning,
} from './fly';

// A VISITOR WHO CHANGES THEIR MIND: journeys between systems flown again and again, with one
// thing done to each flight at a different moment, the way a visitor could do it:
//
//   redirect  point at another body, every 0.1 s of the flight and just before it arrives
//   stop      press Stop, every 0.25 s, at its fastest, and 1 to 20 steps before it arrives
//   reach     point at a body the ship is racing past (within reach: the approach takes it from
//             cruise speed), every 0.1 s that there is one
//   stopDock  press Stop, then E at the first body the prompt offers, at the same moments as stop
//
// Every flight must end docked where it was sent (or at rest, after a plain Stop) without touching
// a shell or passing closer than half a cushion to anything: a failure is a failure, and the gate
// for a change to the autopilot, the approach or Stop is none.

export const STRESS_MODES = ['redirect', 'stop', 'reach', 'stopDock'] as const;
export type StressMode = (typeof STRESS_MODES)[number];

export interface StressOptions {
  /** How many journeys between systems (a seeded sample) to fly this way, per galaxy. */
  journeys: number;
  modes: StressMode[];
  /** How long to watch a stopped ship, s. */
  coastSec: number;
}

export const STRESS_DEFAULTS: StressOptions = {
  journeys: 60,
  modes: [...STRESS_MODES],
  coastSec: 10,
};

/** Steps before the autopilot's last step at which to Stop or redirect: "just before it arrives". */
const BEFORE_ARRIVAL = [1, 2, 3, 6, 12, 20];

export interface StressFlight {
  mode: StressMode;
  /** The journey as asked for, and what was done to it. */
  spec: JourneySpec;
  interrupt: Interrupt;
  result: JourneyResult;
}

interface Moment {
  t: number;
  mode: string;
  speed: number;
  /** The body other than the journey's own two that pulls hardest here (within reach), or null. */
  reach: string | null;
}

/** Every flight of the stress test for one galaxy, in a stable order. */
export function stress(
  galaxy: Galaxy,
  specs: readonly JourneySpec[],
  sim: SimTuning,
  options: StressOptions,
  seed: string,
  limitSec = 60,
): StressFlight[] {
  const between = sampleOf(
    specs.filter((spec) => spec.kind === 'between'),
    options.journeys,
    `${seed}|${galaxy.name}|stress`,
  );
  const ids = galaxy.manifest.bodies.map((body) => body.id);
  const flights: StressFlight[] = [];
  const dt = 1 / sim.stepHz;
  for (const spec of between) {
    // The journey once, undisturbed: when it flies on the autopilot, how fast, and past what.
    const moments: Moment[] = [];
    fly(galaxy, spec, sim, limitSec, ({ t, state, world, mode }) => {
      let reach: string | null = null;
      let strongest = 0;
      for (let j = 0; j < world.field.count; j += 1) {
        const id = world.orbits.ids[j] ?? '';
        if (id === spec.to || id === spec.from) continue;
        const pull = pullOf(world.field, j, state.x, state.z, sim.assist);
        if (pull > strongest) {
          strongest = pull;
          reach = id;
        }
      }
      moments.push({ t, mode, speed: speedOf(state), reach });
    });
    const flying = moments.filter((moment) => moment.mode === 'autopilot');
    const last = flying.at(-1);
    if (last === undefined) continue;
    let peak = flying[0] ?? last;
    for (const moment of flying) if (moment.speed > peak.speed) peak = moment;
    const every = (sec: number): number[] => {
      const out: number[] = [];
      for (let t = sec; t < last.t - dt / 2; t += sec) out.push(t);
      return out;
    };
    const beforeArrival = BEFORE_ARRIVAL.map((back) => last.t - (back - 1) * dt).filter(
      (t) => t > dt,
    );
    const rng = createRng(`${seed}|${galaxy.name}|${spec.from ?? 'spawn'}|${spec.to}|stress`);
    const add = (mode: StressMode, interrupt: Interrupt): void => {
      flights.push({
        mode,
        spec,
        interrupt,
        result: fly(galaxy, spec, sim, limitSec, undefined, interrupt),
      });
    };
    for (const mode of options.modes) {
      if (mode === 'redirect') {
        for (const atSec of [...every(0.1), ...beforeArrival]) {
          let to = spec.to;
          while (to === spec.to) to = ids[Math.floor(rng() * ids.length)] ?? spec.to;
          add(mode, { kind: 'redirect', atSec, to });
        }
      } else if (mode === 'reach') {
        let next = 0;
        for (const moment of flying) {
          if (moment.reach === null || moment.t < next - dt / 2) continue;
          next = moment.t + 0.1;
          add(mode, { kind: 'redirect', atSec: moment.t, to: moment.reach });
        }
      } else {
        const thenDock = mode === 'stopDock';
        const times = new Set([...every(0.25), peak.t, ...beforeArrival]);
        for (const atSec of [...times].sort((a, b) => a - b)) {
          add(mode, { kind: 'stop', atSec, coastSec: options.coastSec, thenDock });
        }
      }
    }
  }
  return flights;
}

const f1 = (value: number): string => (Number.isFinite(value) ? value.toFixed(1) : '-');
const quantile = (values: number[], q: number): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length === 0
    ? NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] ?? NaN);
};

function describeFlight(flight: StressFlight): string {
  const { result, interrupt } = flight;
  const done = result.interrupt;
  const what =
    interrupt.kind === 'redirect'
      ? `sent to ${interrupt.to}${done?.how === 'approach' ? ' (within reach)' : ''}`
      : interrupt.thenDock
        ? `Stop, then E${done?.to ? ` at ${done.to}` : ' (nothing offered)'}`
        : 'Stop';
  return (
    `${result.from} -> ${result.to} @${result.askedAt.toFixed(2)} s: ${what} ` +
    `${f1(done?.atSec ?? NaN)} s in, at ${f1(done?.atSpeed ?? NaN)} u/s`
  );
}

/** The stress test's numbers for one galaxy: one line per mode, and the failures. */
export function stressTable(flights: readonly StressFlight[]): string {
  const lines: string[] = [
    `stress (${new Set(flights.map((flight) => flight.spec)).size} journeys between systems, ${flights.length} flights):`,
    '            n  fail  shell graze tunnel timeout  at u/s  | docked after: median    max  | peak accel u/s²  closest u',
  ];
  for (const mode of STRESS_MODES) {
    const group = flights.filter((flight) => flight.mode === mode);
    if (group.length === 0) continue;
    const count = (failure: string): number =>
      group.filter((flight) => flight.result.failure === failure).length;
    const failed = group.filter((flight) => flight.result.failure !== null);
    const dockSec = group.map((flight) => flight.result.interrupt?.dockSec ?? NaN);
    const accel = group.map((flight) => flight.result.interrupt?.peakAccel ?? NaN);
    const closest = group.map((flight) =>
      Math.min(flight.result.closestGapU, flight.result.stop?.closestGapU ?? Infinity),
    );
    lines.push(
      `${mode.padEnd(9)}${String(group.length).padStart(5)}${String(failed.length).padStart(6)}` +
        `${String(count('shell')).padStart(7)}${String(count('graze')).padStart(6)}` +
        `${String(count('tunnel')).padStart(7)}${String(count('timeout')).padStart(8)}` +
        `${f1(Math.max(...group.map((flight) => flight.result.interrupt?.atSpeed ?? 0))).padStart(8)}` +
        `  |${f1(quantile(dockSec, 0.5)).padStart(22)}${f1(quantile(dockSec, 1)).padStart(7)}` +
        `  |${Math.round(quantile(accel, 1)).toString().padStart(16)}${f1(Math.min(...closest)).padStart(11)}`,
    );
    if (mode === 'stop' || mode === 'stopDock') {
      const stops = group.flatMap((flight) => (flight.result.stop ? [flight.result.stop] : []));
      const slide = stops.map((stop) => stop.slideU);
      const docked = group.filter((flight) => flight.result.interrupt?.to != null).length;
      lines.push(
        `           slid after Stop: median ${f1(quantile(slide, 0.5))}  p90 ${f1(quantile(slide, 0.9))}  max ${f1(quantile(slide, 1))} u` +
          (mode === 'stopDock' ? `; E docked ${docked} of ${group.length}` : ''),
      );
    }
    for (const flight of failed.slice(0, 4)) {
      lines.push(`    FAIL ${flight.result.failure}: ${describeFlight(flight)}`);
    }
    if (failed.length > 4) lines.push(`    ... and ${failed.length - 4} more`);
  }
  return lines.join('\n');
}
