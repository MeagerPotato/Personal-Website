import { VALLEY_U_S, type JourneyKind, type JourneyResult } from './fly';

// Numbers for people: per kind of journey, how long they take, the worst one and why.

export interface Stats {
  n: number;
  median: number;
  p90: number;
  max: number;
  mean: number;
  /** Share of journeys that docked within 5 s. */
  within5: number;
  peakSpeed: number;
  /** The hardest the ship's velocity changed in one step, over every journey, u/s² (JourneyResult.peakAccel). */
  peakAccel: number;
  /** Share of journeys with a speed valley (JourneyResult.valleys), and with one 150 u/s deep. */
  withValley: number;
  withDeepValley: number;
  longestU: number;
  failures: number;
  /** Closest to a passing body's surface, and to any shell, over the whole of every step, u. */
  closestGapU: number;
  shellClearU: number;
  /** The same, until the ship is on its ring (JourneyResult.settledSec). */
  settledMedian: number;
  settledMax: number;
  worst: JourneyResult | null;
}

const quantile = (sorted: readonly number[], q: number): number =>
  sorted.length === 0
    ? NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] ?? NaN);

export function statsOf(rows: readonly JourneyResult[]): Stats {
  const seconds = rows.map((row) => row.seconds).sort((a, b) => a - b);
  const settled = rows
    .map((row) => (row.docked && Number.isFinite(row.settledSec) ? row.settledSec : Infinity))
    .sort((a, b) => a - b);
  let worst: JourneyResult | null = null;
  for (const row of rows) if (worst === null || row.seconds > worst.seconds) worst = row;
  return {
    n: rows.length,
    median: quantile(seconds, 0.5),
    p90: quantile(seconds, 0.9),
    max: seconds.at(-1) ?? NaN,
    mean: seconds.reduce((sum, value) => sum + value, 0) / (seconds.length || 1),
    within5: rows.filter((row) => row.docked && row.seconds <= 5).length / (rows.length || 1),
    peakSpeed: rows.reduce((top, row) => Math.max(top, row.peakSpeed), 0),
    peakAccel: rows.reduce((top, row) => Math.max(top, row.peakAccel), 0),
    withValley: rows.filter((row) => row.valleys > 0).length / (rows.length || 1),
    withDeepValley: rows.filter((row) => row.deepestValley >= 150).length / (rows.length || 1),
    longestU: rows.reduce((top, row) => Math.max(top, row.straightU), 0),
    failures: rows.filter((row) => row.failure !== null).length,
    closestGapU: rows.reduce((least, row) => Math.min(least, row.closestGapU), Infinity),
    shellClearU: rows.reduce((least, row) => Math.min(least, row.shellClearU), Infinity),
    settledMedian: quantile(settled, 0.5),
    settledMax: settled.at(-1) ?? NaN,
    worst,
  };
}

const f1 = (value: number): string => (Number.isFinite(value) ? value.toFixed(1) : '-');
const pad = (text: string, width: number): string => text.padStart(width);

export function phasesOf(row: JourneyResult): string {
  return (
    `take-off ${f1(row.takeoffSec)} + cruise ${f1(row.cruiseSec)} + ` +
    `approach ${f1(row.approachSec)} + capture ${f1(row.captureSec)} s`
  );
}

export function describe(row: JourneyResult): string {
  const plan =
    row.profile === '-' ? row.how : `${row.profile} profile, plan ${row.planU.toFixed(0)} u`;
  return (
    `${row.from} -> ${row.to}  ${row.seconds.toFixed(2)} s  ` +
    `(straight ${row.straightU.toFixed(0)} u, ${plan}, peak ${row.peakSpeed.toFixed(0)} u/s)`
  );
}

const KINDS: readonly JourneyKind[] = ['between', 'within', 'spawn'];

/**
 * Journeys stopped at their fastest moment (fly.ts, stopAtPeak): how fast they were going, how
 * far they slid, how close they came to anything, and whether anything was touched; and, when
 * the visitor who stopped them had taken hyperspace, how many were in it and whether it ended.
 */
export function stopTable(rows: readonly JourneyResult[], coastSec: number): string {
  const stops = rows.flatMap((row) => (row.stop ? [{ row, stop: row.stop }] : []));
  if (stops.length === 0) return 'stopped at full speed: no journey flew on the autopilot';
  const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b);
  const speed = sorted(stops.map(({ stop }) => stop.atSpeed));
  const drop = sorted(stops.map(({ stop }) => stop.dropU));
  const dropSec = sorted(stops.map(({ stop }) => stop.dropSec));
  const slide = sorted(stops.map(({ stop }) => stop.slideU));
  const touches = stops.filter(({ stop }) => stop.shellTouches > 0).length;
  const grazes = stops.filter(({ row }) => row.failure === 'graze').length;
  let nearest = stops[0];
  let furthest = stops[0];
  for (const entry of stops) {
    if (nearest && entry.stop.closestGapU < nearest.stop.closestGapU) nearest = entry;
    if (furthest && entry.stop.slideU > furthest.stop.slideU) furthest = entry;
  }
  const lines = [
    `stopped at full speed (between systems, watched ${coastSec} s after Stop): ${stops.length} journeys`,
    `  speed at Stop   median ${f1(quantile(speed, 0.5))}  max ${f1(speed.at(-1) ?? NaN)} u/s`,
    `  back to the pilot's top speed within  median ${f1(quantile(drop, 0.5))}  max ${f1(drop.at(-1) ?? NaN)} u, ` +
      `max ${(dropSec.at(-1) ?? NaN).toFixed(2)} s`,
    `  slid  median ${f1(quantile(slide, 0.5))}  p90 ${f1(quantile(slide, 0.9))}  max ${f1(slide.at(-1) ?? NaN)} u`,
    `  closest to a surface ${nearest ? nearest.stop.closestGapU.toFixed(1) : '-'} u` +
      `${nearest ? ` (${nearest.stop.closestBody}, ${nearest.row.from} -> ${nearest.row.to})` : ''}`,
    `  shell touches ${touches}, grazes ${grazes}`,
  ];
  // A visitor who takes hyperspace whenever it is offered (JOURNEYS "hyper": true) was in it.
  const inHyper = stops.filter(({ row }) => row.interrupt?.inHyper === true).length;
  if (inHyper > 0) {
    const strayed = stops.filter(({ row }) => row.hyper.strayed).length;
    lines.push(
      `  hyperspace, taken whenever offered: winding up or in it on ${inHyper} of them when Stop ` +
        `was pressed; it outlived its journey on ${strayed}`,
    );
  }
  if (furthest) {
    lines.push(
      `  slid furthest: ${furthest.row.from} -> ${furthest.row.to}, stopped at ${furthest.stop.atSpeed.toFixed(0)} u/s, ` +
        `${furthest.stop.slideU.toFixed(0)} u, ${furthest.stop.endSpeed.toFixed(1)} u/s at the end`,
    );
  }
  return lines.join('\n');
}

/**
 * What went wrong with a journey flown again with the jump taken (fly.ts, flyTwins), in words.
 * Hyperspace is the same flight: a twin that is not, or a jump that outlived its journey, is
 * said as that; anything else is the journey's own failure, which its first flight has too.
 */
export function describeTwin(row: JourneyResult): string {
  if (row.hyper.differs) return `hyperspace changed the flight: ${row.from} to ${row.to}`;
  if (row.hyper.strayed) return `hyperspace outlived its journey: ${row.from} to ${row.to}`;
  return `${row.failure}: ${describe(row)}`;
}

/**
 * HYPERSPACE (sim/hyper.ts): every journey again, flown by a visitor who takes the jump the
 * moment it is offered (fly.ts, flyTwins), per kind: how many of the journeys the autopilot flies
 * were offered one, how many went into it, for how long, and how long before docking they were
 * out of it again. `leastSec`: a jump shorter than this is counted (tuning.hyper.minTunnelSec:
 * pressed at once, none should be). (In this harness a "tunnel" is a ship gone through a body,
 * so the simulation's tunnel is "in it" here.)
 */
export function hyperTable(twins: readonly JourneyResult[], leastSec: number): string {
  const sorted = (values: number[]): number[] =>
    values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const f2 = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '-');
  const failed = twins.filter((row) => row.failure !== null);
  const differ = twins.filter((row) => row.hyper.differs).length;
  const lines = [
    `hyperspace (every journey again, the jump taken the moment it is offered: ${twins.length} twins, ` +
      `${differ} flew differently):`,
    '         autopilot  offered   jumped  | s in it: min  median    p90    max  ' +
      `under ${leastSec} s  | out of it, s before docking: min  median    p90`,
  ];
  const all: Array<[string, readonly JourneyResult[]]> = [
    ...KINDS.map((kind): [string, JourneyResult[]] => [
      kind,
      twins.filter((row) => row.kind === kind),
    ]),
    ['all', twins],
  ];
  for (const [label, group] of all) {
    if (group.length === 0) continue;
    const flown = group.filter((row) => row.how === 'travel');
    const offered = flown.filter((row) => Number.isFinite(row.hyper.offeredSec));
    const jumped = flown.filter((row) => row.hyper.inSec > 0);
    const inSec = sorted(jumped.map((row) => row.hyper.inSec));
    const out = sorted(jumped.map((row) => row.hyper.outBeforeDockSec));
    lines.push(
      `${label.padEnd(8)}${pad(String(flown.length), 10)}${pad(String(offered.length), 9)}` +
        `${pad(String(jumped.length), 9)}  |${pad(f2(inSec[0] ?? NaN), 14)}` +
        `${pad(f2(quantile(inSec, 0.5)), 8)}${pad(f2(quantile(inSec, 0.9)), 7)}` +
        `${pad(f2(inSec.at(-1) ?? NaN), 7)}` +
        `${pad(String(inSec.filter((value) => value < leastSec - 1e-9).length), `under ${leastSec} s`.length + 2)}` +
        `  |${pad(f2(out[0] ?? NaN), 33)}${pad(f2(quantile(out, 0.5)), 8)}${pad(f2(quantile(out, 0.9)), 7)}`,
    );
  }
  for (const row of failed.slice(0, 8)) lines.push(`FAIL ${describeTwin(row)}`);
  if (failed.length > 8) lines.push(`... and ${failed.length - 8} more failures`);
  return lines.join('\n');
}

/** The table for one galaxy under one variant. */
export function table(rows: readonly JourneyResult[]): string {
  const lines = [
    '           n  median    p90    max   mean  <=5 s  peak u/s  u/s²  valleys  longest u  fail  closest u  shell u  | on ring: median    max',
  ];
  const all: Array<[string, readonly JourneyResult[]]> = [
    ...KINDS.map((kind): [string, JourneyResult[]] => [
      kind,
      rows.filter((row) => row.kind === kind),
    ]),
    ['all', rows],
  ];
  for (const [label, group] of all) {
    if (group.length === 0) continue;
    const s = statsOf(group);
    lines.push(
      `${label.padEnd(8)}${pad(String(s.n), 5)}${pad(f1(s.median), 8)}${pad(f1(s.p90), 7)}` +
        `${pad(f1(s.max), 7)}${pad(f1(s.mean), 7)}${pad(`${Math.round(s.within5 * 100)}%`, 7)}` +
        `${pad(s.peakSpeed.toFixed(0), 10)}${pad(s.peakAccel.toFixed(0), 6)}` +
        `${pad(`${Math.round(s.withValley * 100)}/${Math.round(s.withDeepValley * 100)}%`, 9)}` +
        `${pad(s.longestU.toFixed(0), 11)}${pad(String(s.failures), 6)}` +
        `${pad(f1(s.closestGapU), 11)}${pad(f1(s.shellClearU), 9)}` +
        `  |${pad(f1(s.settledMedian), 16)}${pad(f1(s.settledMax), 7)}`,
    );
  }
  for (const kind of KINDS) {
    const worst = statsOf(rows.filter((row) => row.kind === kind)).worst;
    if (worst) lines.push(`worst ${kind}: ${describe(worst)}\n    ${phasesOf(worst)}`);
  }
  lines.push(
    `(valleys: share of journeys whose speed dipped by ${VALLEY_U_S} u/s or more and came back, / by 150 or more)`,
  );
  const failed = rows.filter((row) => row.failure !== null);
  for (const row of failed.slice(0, 8)) {
    lines.push(
      `FAIL ${row.failure}: ${describe(row)}; closest ${row.closestGapU.toFixed(1)} u ` +
        `to ${row.closestBody}, ${row.shellTouches} shell step(s)`,
    );
  }
  if (failed.length > 8) lines.push(`... and ${failed.length - 8} more failures`);
  const timedOut = rows.filter((row) => row.approachTimedOut).length;
  if (timedOut > 0)
    lines.push(`${timedOut} approach(es) ran out of time and were captured where they were`);
  return lines.join('\n');
}
