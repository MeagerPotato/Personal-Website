import { pullOf } from '../../src/universe/sim/assist';
import { speedOf } from '../../src/universe/sim/flight';
import { createRng } from '../../src/universe/sim/rng';
import {
  fly,
  sampleOf,
  type Galaxy,
  type Interrupt,
  type JourneyKind,
  type JourneyResult,
  type JourneySpec,
  type SimTuning,
  type TapInput,
} from './fly';

// A VISITOR WHO CHANGES THEIR MIND: journeys flown again and again, with one thing done to each
// flight at a different moment, the way a visitor could do it:
//
//   redirect   point at another body, every 0.1 s of the flight and just before it arrives
//   stop       press Stop, every 0.25 s, at its fastest, and 1 to 20 steps before it arrives
//   reach      point at a body the ship is racing past (within reach: the approach takes it from
//              cruise speed), every 0.1 s that there is one
//   stopDock   press Stop, then E at the first body the prompt offers, at the same moments as stop
//   tap        take the controls back instead of pressing Stop: the brake, an arrow or the throttle
//              held for 4 to 8 steps and let go, at the same moments as stop
//   reachBack  point at a body the ship is racing past, then a third of a second later back at
//              where it was going, every 0.25 s that there is one
//   chain      point at 4 to 8 bodies one after another, 0.03 to 0.43 s apart (sometimes back at
//              where the journey began), every 0.25 s; it must dock at the last
//   rebuild    the engine is rebuilt from its snapshot (a lost WebGL context), at the same moments
//              as stop; the journey must still arrive, and the table says how much later
//
// Every flight must end docked where it was sent (or at rest, after a Stop or a tap) without
// touching a shell or passing closer than half a cushion to anything it was not going to: a
// failure is a failure, and the gate for a change to the autopilot, the approach, Stop or the
// snapshot is none. By default the journeys are between systems; `kinds` adds journeys within one
// and from the spawn point.

export const STRESS_MODES = [
  'redirect',
  'stop',
  'reach',
  'stopDock',
  'tap',
  'reachBack',
  'chain',
  'rebuild',
] as const;
export type StressMode = (typeof STRESS_MODES)[number];

export interface StressOptions {
  /** How many journeys of each kind (a seeded sample) to fly this way, per galaxy. */
  journeys: number;
  modes: StressMode[];
  /** Which journeys: between systems, within one, from the spawn point. */
  kinds: JourneyKind[];
  /** How long to watch a stopped ship, or one taken back by a tap, s. */
  coastSec: number;
}

export const STRESS_DEFAULTS: StressOptions = {
  journeys: 60,
  modes: [...STRESS_MODES],
  kinds: ['between'],
  coastSec: 10,
};

/** Steps before the autopilot's last step at which to Stop or redirect: "just before it arrives". */
const BEFORE_ARRIVAL = [1, 2, 3, 6, 12, 20];
const TAP_INPUTS: readonly TapInput[] = ['brake', 'turn', 'thrust'];
/** A tap holds its control this many steps, or up to TAP_MORE more (seeded): 67 to 133 ms. */
const TAP_STEPS = 4;
const TAP_MORE = 4;
/** reachBack: steps between pointing at the body raced past and pointing back. */
const BACK_STEPS = 20;
/** chain: this many bodies, or up to CHAIN_MORE more, each 2 to 2 + CHAIN_GAP steps after the last. */
const CHAIN = 4;
const CHAIN_MORE = 4;
const CHAIN_GAP = 24;

export interface StressFlight {
  mode: StressMode;
  /** The journey as asked for, and what was done to it. */
  spec: JourneySpec;
  interrupt: Interrupt;
  result: JourneyResult;
  /** How long the same journey takes when nothing is done to it, s. */
  undisturbedSec: number;
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
  const chosen = options.kinds.flatMap((kind) =>
    sampleOf(
      specs.filter((spec) => spec.kind === kind),
      options.journeys,
      // (Between systems keeps the seed it always had: the same sample as before `kinds`.)
      `${seed}|${galaxy.name}|stress${kind === 'between' ? '' : `|${kind}`}`,
    ),
  );
  const ids = galaxy.manifest.bodies.map((body) => body.id);
  const flights: StressFlight[] = [];
  const dt = 1 / sim.stepHz;
  for (const spec of chosen) {
    // The journey once, undisturbed: when it flies on the autopilot, how fast, and past what.
    const moments: Moment[] = [];
    const plain = fly(galaxy, spec, sim, limitSec, ({ t, state, world, mode }) => {
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
    const stopMoments = [...new Set([...every(0.25), peak.t, ...beforeArrival])].sort(
      (a, b) => a - b,
    );
    const rng = createRng(`${seed}|${galaxy.name}|${spec.from ?? 'spawn'}|${spec.to}|stress`);
    const add = (mode: StressMode, interrupt: Interrupt): void => {
      flights.push({
        mode,
        spec,
        interrupt,
        result: fly(galaxy, spec, sim, limitSec, undefined, interrupt),
        undisturbedSec: plain.seconds,
      });
    };
    /** Moments at which a body other than the journey's own is within reach, `apart` s apart. */
    const reachable = (apart: number): Moment[] => {
      const out: Moment[] = [];
      let next = 0;
      for (const moment of flying) {
        if (moment.reach === null || moment.t < next - dt / 2) continue;
        next = moment.t + apart;
        out.push(moment);
      }
      return out;
    };
    for (const mode of options.modes) {
      if (mode === 'redirect') {
        for (const atSec of [...every(0.1), ...beforeArrival]) {
          let to = spec.to;
          while (to === spec.to) to = ids[Math.floor(rng() * ids.length)] ?? spec.to;
          add(mode, { kind: 'redirect', atSec, to });
        }
      } else if (mode === 'reach') {
        for (const { t, reach } of reachable(0.1)) {
          add(mode, { kind: 'redirect', atSec: t, to: reach ?? spec.to });
        }
      } else if (mode === 'reachBack') {
        for (const { t, reach } of reachable(0.25)) {
          add(mode, {
            kind: 'redirect',
            atSec: t,
            to: reach ?? spec.to,
            then: [{ afterSec: BACK_STEPS * dt, to: spec.to }],
          });
        }
      } else if (mode === 'chain') {
        for (const atSec of every(0.25)) {
          const bodies: string[] = [];
          const count = CHAIN + Math.floor(rng() * (CHAIN_MORE + 1));
          while (bodies.length < count) {
            const previous = bodies.at(-1) ?? spec.to;
            // Now and then back where the journey began: a visitor who thought better of it.
            const to =
              spec.from !== null && rng() < 0.2
                ? spec.from
                : (ids[Math.floor(rng() * ids.length)] ?? spec.to);
            if (to !== previous) bodies.push(to);
          }
          const gap = (): number => (2 + Math.floor(rng() * (CHAIN_GAP + 1))) * dt;
          add(mode, {
            kind: 'redirect',
            atSec,
            to: bodies[0] ?? spec.to,
            then: bodies.slice(1).map((to) => ({ afterSec: gap(), to })),
          });
        }
      } else if (mode === 'tap') {
        for (const atSec of stopMoments) {
          for (const input of TAP_INPUTS) {
            const steps = TAP_STEPS + Math.floor(rng() * (TAP_MORE + 1));
            add(mode, { kind: 'tap', atSec, input, steps, coastSec: options.coastSec });
          }
        }
      } else if (mode === 'rebuild') {
        for (const atSec of stopMoments) add(mode, { kind: 'rebuild', atSec });
      } else {
        const thenDock = mode === 'stopDock';
        for (const atSec of stopMoments) {
          add(mode, { kind: 'stop', atSec, coastSec: options.coastSec, thenDock });
        }
      }
    }
  }
  return flights;
}

const f1 = (value: number): string => (Number.isFinite(value) ? value.toFixed(1) : '-');
const f2 = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '-');
const quantile = (values: number[], q: number): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length === 0
    ? NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] ?? NaN);
};
const least = (values: number[]): number => values.reduce((a, b) => Math.min(a, b), Infinity);
const most = (values: number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

function describeFlight(flight: StressFlight): string {
  const { result, interrupt } = flight;
  const done = result.interrupt;
  const within = done?.how === 'approach' ? ' (within reach)' : '';
  const what =
    interrupt.kind === 'redirect'
      ? interrupt.then
        ? `sent to ${[interrupt.to, ...interrupt.then.map(({ to }) => to)].join(', then ')}${within}`
        : `sent to ${interrupt.to}${within}`
      : interrupt.kind === 'tap'
        ? `${interrupt.input} held ${interrupt.steps} steps`
        : interrupt.kind === 'rebuild'
          ? 'rebuilt'
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
  const kinds = [...new Set(flights.map((flight) => flight.spec.kind))].join(', ');
  const lines: string[] = [
    `stress (${new Set(flights.map((flight) => flight.spec)).size} journeys: ${kinds}; ${flights.length} flights):`,
    '             n  fail  shell graze tunnel timeout  at u/s  | docked after: median    max  | peak accel u/s²  closest u  shell u',
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
    // Every body, the one it was going to included, to its shell, over the whole of every step.
    const shell = group.map((flight) => flight.result.shellClearU);
    lines.push(
      `${mode.padEnd(10)}${String(group.length).padStart(5)}${String(failed.length).padStart(6)}` +
        `${String(count('shell')).padStart(7)}${String(count('graze')).padStart(6)}` +
        `${String(count('tunnel')).padStart(7)}${String(count('timeout')).padStart(8)}` +
        `${f1(most(group.map((flight) => flight.result.interrupt?.atSpeed ?? 0))).padStart(8)}` +
        `  |${f1(quantile(dockSec, 0.5)).padStart(22)}${f1(quantile(dockSec, 1)).padStart(7)}` +
        `  |${Math.round(quantile(accel, 1)).toString().padStart(16)}${f1(least(closest)).padStart(11)}` +
        `${f2(least(shell)).padStart(9)}`,
    );
    if (mode === 'stop' || mode === 'stopDock' || mode === 'tap') {
      const stops = group.flatMap((flight) => (flight.result.stop ? [flight.result.stop] : []));
      const slide = stops.map((stop) => stop.slideU);
      const docked = group.filter((flight) => flight.result.interrupt?.to != null).length;
      lines.push(
        `            slid after ${mode === 'tap' ? 'the tap' : 'Stop'}: median ${f1(quantile(slide, 0.5))}  p90 ${f1(quantile(slide, 0.9))}  max ${f1(quantile(slide, 1))} u` +
          (mode === 'stopDock' ? `; E docked ${docked} of ${group.length}` : ''),
      );
    }
    if (mode === 'rebuild') {
      const later = group.map((flight) =>
        flight.result.docked ? flight.result.seconds - flight.undisturbedSec : NaN,
      );
      lines.push(
        `            docked later than undisturbed: median ${f2(quantile(later, 0.5))}  p90 ${f2(quantile(later, 0.9))}  max ${f2(quantile(later, 1))} s`,
      );
    }
    for (const flight of failed.slice(0, 4)) {
      lines.push(`    FAIL ${flight.result.failure}: ${describeFlight(flight)}`);
    }
    if (failed.length > 4) lines.push(`    ... and ${failed.length - 4} more`);
  }
  return lines.join('\n');
}
