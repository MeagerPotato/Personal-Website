import type { JourneyKind, JourneyResult } from './fly';

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
  longestU: number;
  failures: number;
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
    longestU: rows.reduce((top, row) => Math.max(top, row.straightU), 0),
    failures: rows.filter((row) => row.failure !== null).length,
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

/** The table for one galaxy under one variant. */
export function table(rows: readonly JourneyResult[]): string {
  const lines = [
    '           n  median    p90    max   mean  <=5 s  peak u/s  longest u  fail  | on ring: median    max',
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
        `${pad(s.peakSpeed.toFixed(0), 10)}${pad(s.longestU.toFixed(0), 11)}${pad(String(s.failures), 6)}` +
        `  |${pad(f1(s.settledMedian), 16)}${pad(f1(s.settledMax), 7)}`,
    );
  }
  for (const kind of KINDS) {
    const worst = statsOf(rows.filter((row) => row.kind === kind)).worst;
    if (worst) lines.push(`worst ${kind}: ${describe(worst)}\n    ${phasesOf(worst)}`);
  }
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
