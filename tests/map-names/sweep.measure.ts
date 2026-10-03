// @vitest-environment happy-dom
import { afterAll, expect, it } from 'vitest';
import { spread, turnOf, watch, type Look, type Seen, type Window } from './harness';

// THE STAR MAP'S NAMES OVER WHOLE TURNS (tests/map-names/harness.ts says how they are watched).
// Slow on purpose (some 70 minutes of map at 60 frames a second, a look), so it is NOT part of
// `npm test`, which looks at samples (checks.ts):
//
//   npm run map-names
//
// runs every look in two to three minutes on a laptop, prints what the names did, and holds each
// look to the rules below: the run fails on a breach, and says which. CI runs it too
// (.github/workflows/map-names.yml, not a required check) on every pull request that touches the
// names, the map, the content or this harness. docs/PLAN.md §5.4 quotes its numbers.

interface Sweep {
  readonly name: string;
  readonly look: Look;
  /** A whole turn of its galaxy, or windows spread over it: [how many, seconds each]. */
  readonly windows: 'turn' | readonly [number, number];
  /** What it is held to: changes a minute at most, and whether every system must be named. */
  readonly most: number;
  readonly named?: boolean;
  /** Changes within a second of the same name's last one, at most (none if not said)... */
  readonly twice?: number;
  /** ...and within three frames (none if not said). */
  readonly flickers?: number;
  /** Fingers on the map: names at the edges of a moving view come and go within frames. */
  readonly moving?: boolean;
  /** Bodies whose name must be there nearly whenever their disc is in view: the most unnamed. */
  readonly bodies?: Readonly<Record<string, number>>;
}

const SWEEPS: readonly Sweep[] = [
  {
    name: 'at rest, 360x740, at the fit',
    look: { size: '360x740' },
    windows: 'turn',
    most: 1,
    named: true,
  },
  {
    name: 'at rest, 412x839, at the fit',
    look: { size: '412x839' },
    windows: 'turn',
    most: 1.5,
    named: true,
  },
  {
    name: 'at rest, 1280x800, at the fit',
    look: { size: '1280x800' },
    windows: 'turn',
    most: 12,
    named: true,
    twice: 3,
  },
  {
    name: 'at rest, 360x740, zoomed in once',
    look: { size: '360x740', zoomIns: 1 },
    windows: 'turn',
    most: 4,
    named: true,
    twice: 2,
  },
  {
    name: 'at rest, 1280x800, zoomed in once',
    look: { size: '1280x800', zoomIns: 1 },
    windows: 'turn',
    most: 16,
    twice: 4,
  },
  {
    name: 'at rest, 360x740, zoomed in twice',
    look: { size: '360x740', zoomIns: 2 },
    windows: 'turn',
    most: 8,
    twice: 3,
  },
  {
    name: 'at rest, 412x839, zoomed in twice',
    look: { size: '412x839', zoomIns: 2 },
    windows: 'turn',
    most: 10,
    twice: 3,
  },
  {
    name: 'at rest, 1280x800, zoomed in twice',
    look: { size: '1280x800', zoomIns: 2 },
    windows: 'turn',
    most: 20,
    twice: 4,
  },
  // Until 2026-10-03 Research's sun lay half past the bottom edge of this view, its name above it
  // with less than a keep to spare: what the rule on its name was written for. Where Research
  // stands now (docs/PLAN.md §5.4) all of it is in this view, and the rule holds as it did.
  {
    name: 'at rest, 360x740, zoomed in three times',
    look: { size: '360x740', zoomIns: 3 },
    windows: 'turn',
    most: 9,
    twice: 3,
    bodies: { Research: 0.02 },
  },
  {
    name: 'at rest, 1280x800, zoomed in three times',
    look: { size: '1280x800', zoomIns: 3 },
    windows: 'turn',
    most: 20,
    twice: 6,
  },
  // Until 2026-10-03 the home planet lay half past the bottom edge of this view; in the galaxy of
  // six as it grows now (its fifth and sixth systems in slots 2 and 4) it is near the middle.
  {
    name: 'six systems, 1280x800, zoomed in four times',
    look: { size: '1280x800', galaxy: 6, zoomIns: 4 },
    windows: 'turn',
    most: 20,
    twice: 4,
    bodies: { 'About Me': 0.02 },
  },
  {
    name: 'opened with the blend, 360x740',
    look: { size: '360x740', open: 'blend' },
    windows: [24, 8],
    most: 1,
    named: true,
  },
  {
    name: 'opened with the blend, 412x839',
    look: { size: '412x839', open: 'blend' },
    windows: [24, 8],
    most: 1,
    named: true,
  },
  {
    name: 'opened with the blend, 1280x800',
    look: { size: '1280x800', open: 'blend' },
    windows: [24, 8],
    most: 8,
    named: true,
  },
  {
    name: 'beside a page, 360x740 (the sheet at 60%)',
    look: { size: '360x740', inset: { bottom: 444 } },
    windows: [8, 60],
    most: 1,
  },
  {
    name: 'beside a page, 1280x800 (the side panel)',
    look: { size: '1280x800', inset: { right: 480 } },
    windows: [8, 60],
    most: 12,
    named: true,
  },
  // One flicker in the eight minutes: GitHub's name moves aside for Contact's, and three frames
  // later Resume's, drifting onto About Me's, must take that place, its only other one.
  {
    name: 'dragged down, 1280x800, zoomed in twice',
    look: { size: '1280x800', zoomIns: 2, pan: [['ArrowDown', 4]] },
    windows: [8, 60],
    most: 24,
    twice: 2,
    flickers: 1,
  },
  {
    name: 'dragged left, 412x839, zoomed in twice',
    look: { size: '412x839', zoomIns: 2, pan: [['ArrowLeft', 4]] },
    windows: [8, 60],
    most: 4,
  },
  {
    name: 'fingers, 360x740, at the fit',
    look: { size: '360x740', fingers: true },
    windows: [4, 50],
    most: 300,
    moving: true,
  },
  {
    name: 'fingers, 412x839, at the fit',
    look: { size: '412x839', fingers: true },
    windows: [4, 50],
    most: 300,
    moving: true,
  },
  {
    name: 'fingers, 360x740, zoomed in once',
    look: { size: '360x740', zoomIns: 1, fingers: true },
    windows: [4, 50],
    most: 340,
    moving: true,
  },
  {
    name: 'fingers, 412x839, zoomed in three times',
    look: { size: '412x839', zoomIns: 3, fingers: true },
    windows: [4, 50],
    most: 270,
    moving: true,
  },
  {
    name: 'six systems, 360x740, at the fit',
    look: { size: '360x740', galaxy: 6 },
    windows: 'turn',
    most: 1,
    named: true,
  },
  {
    name: 'eight systems, 412x839, at the fit',
    look: { size: '412x839', galaxy: 8 },
    windows: 'turn',
    most: 1,
    named: true,
  },
  {
    name: 'eight systems, 1280x800, at the fit',
    look: { size: '1280x800', galaxy: 8 },
    windows: 'turn',
    most: 4,
    named: true,
  },
  {
    name: 'eight systems, 412x839, zoomed in once',
    look: { size: '412x839', galaxy: 8, zoomIns: 1 },
    windows: 'turn',
    most: 2,
    named: true,
  },
  // Nine systems' names do not fit a 360 px phone's first view of eight systems; zoomed in once,
  // the last has room only in some ways of placing them all (the search finds one most of the time).
  {
    name: 'eight systems, 360x740, zoomed in once',
    look: { size: '360x740', galaxy: 8, zoomIns: 1 },
    windows: 'turn',
    most: 2,
  },
];

const lines: string[] = [];

function windowsOf(sweep: Sweep): Window[] {
  const galaxy = sweep.look.galaxy ?? 'real';
  if (sweep.windows === 'turn') return [{ from: 0, seconds: turnOf(galaxy) }];
  const [count, seconds] = sweep.windows;
  return spread(count, seconds, galaxy);
}

function percent(shares: Readonly<Record<string, number>>): string {
  const entries = Object.entries(shares);
  if (entries.length === 0) return 'none';
  return entries.map(([title, share]) => `${title} ${(share * 100).toFixed(1)}%`).join(', ');
}

function report(sweep: Sweep, seen: Seen, ms: number): string {
  const blend = seen.blend
    ? `; the blend: ${seen.blend.changes} changes, ${seen.blend.quick} within 70 ms of the last` +
      `, missing as it arrived: ${seen.blend.missingOnArrival.join(', ') || 'none'}`
    : '';
  return [
    `${sweep.name} (${Math.round(seen.seconds)} s in ${(ms / 1000).toFixed(1)} s):`,
    `  ${seen.perMinute} changes a minute, ${seen.twice.length} within a second of the last, ` +
      `${seen.flickers.length} within three frames; ${seen.shown} names on average`,
    `  systems unnamed while in view: ${percent(seen.unnamed)}` +
      (sweep.bodies
        ? `; ${Object.keys(sweep.bodies)
            .map((title) => `${title} ${((seen.bodiesUnnamed[title] ?? 0) * 100).toFixed(1)}%`)
            .join(', ')} while its disc is`
        : ''),
    `  tags per look on a sun or home: ${seen.onLandmarks} (a planet's or a moon's: ` +
      `${seen.othersOnLandmarks}); on any body: ${seen.onBodies}; reading as a neighbour's: ` +
      `${seen.crossed}; a moon's name over a planet's with room: ` +
      `${(seen.moonsOverPlanets * 100).toFixed(1)}% of moments${blend}`,
  ].join('\n');
}

for (const sweep of SWEEPS) {
  it(sweep.name, () => {
    const started = performance.now();
    const seen = watch(sweep.look, windowsOf(sweep));
    const line = report(sweep, seen, performance.now() - started);
    lines.push(line);
    console.log(line);
    expect.soft(seen.othersOnLandmarks, "a planet's or a moon's tag on a sun").toBe(0);
    expect.soft(seen.perMinute, 'changes a minute').toBeLessThanOrEqual(sweep.most);
    if (!sweep.moving) {
      expect
        .soft(seen.flickers.length, seen.flickers.slice(0, 3).join('; '))
        .toBeLessThanOrEqual(sweep.flickers ?? 0);
      expect
        .soft(seen.twice.length, seen.twice.slice(0, 3).join('; '))
        .toBeLessThanOrEqual(sweep.twice ?? 0);
    }
    if (sweep.named) expect.soft(seen.unnamed, 'a system with no name').toEqual({});
    for (const [title, most] of Object.entries(sweep.bodies ?? {})) {
      expect.soft(seen.bodiesUnnamed[title] ?? 0, `${title} unnamed`).toBeLessThanOrEqual(most);
    }
    if (seen.blend) {
      expect.soft(seen.blend.missingOnArrival, 'a system missing as the map arrived').toEqual([]);
    }
  });
}

afterAll(() => {
  console.log(`\nThe star map's names, whole turns and samples:\n\n${lines.join('\n\n')}\n`);
});
