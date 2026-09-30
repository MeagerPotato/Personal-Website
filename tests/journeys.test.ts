import { describe, expect, it } from 'vitest';
import type { JourneyResult } from '../scripts/journeys/fly';
import { buildGalaxy, grow } from '../scripts/journeys/galaxies';
import {
  DEFAULT_GATE,
  breachesOf,
  describeGate,
  gateFor,
  parseGate,
  type GalaxyGate,
} from '../scripts/journeys/gate';
import { measure, optionsFromEnv, type GalaxyReport } from '../scripts/journeys/measure';
import type { StressFlight } from '../scripts/journeys/stress';
import type { ProjectInput, UniverseInput } from '../src/universe/data/types';

// The journey harness's own rules (scripts/journeys): the gate `npm run journeys` holds every
// galaxy to, and the grown galaxies it measures. The journeys themselves are flown by the harness,
// not here (thousands of them: minutes); one small real run below proves the wiring.

/** A journey that docked after `seconds`, with nothing wrong on the way unless `over` says so. */
function journey(seconds: number, over: Partial<JourneyResult> = {}): JourneyResult {
  return {
    kind: 'between',
    from: 'page/about',
    to: 'system/code',
    fromSystem: 'home',
    toSystem: 'code',
    askedAt: 0,
    straightU: 600,
    seconds,
    docked: true,
    settledSec: seconds,
    how: 'travel',
    profile: 'far',
    planU: 610,
    planEtaSec: seconds,
    peakSpeed: 500,
    takeoffSec: 0.5,
    cruiseSec: seconds - 0.5,
    approachSec: 0,
    captureSec: 0,
    firstThrustSec: 0,
    closestGapU: 12,
    closestBody: '-',
    shellClearU: 6,
    shellTouches: 0,
    approachTimedOut: false,
    valleys: 0,
    deepestValley: 0,
    peakAccel: 400,
    failure: null,
    stop: null,
    interrupt: null,
    ...over,
  };
}

/** Ten journeys taking 1, 2, ... 10 s: p90 9 s, the slowest 10 s, five over 5 s. */
const TEN = Array.from({ length: 10 }, (_, k) => journey(k + 1));

type Measured = Pick<GalaxyReport, 'error' | 'rows' | 'stops' | 'stress'>;
const measured = (over: Partial<Measured> = {}): Measured => ({
  error: null,
  rows: TEN,
  stops: [],
  stress: [],
  ...over,
});

describe('the default gate', () => {
  it('holds the real galaxy to PLAN §9 with a margin, and the grown ones to no failures', () => {
    expect(gateFor(DEFAULT_GATE, 'real')).toEqual({
      failures: 0,
      p90Sec: 4.2,
      maxSec: 6.5,
      over5sShare: 0.015,
    });
    expect(gateFor(DEFAULT_GATE, 6)).toEqual({ failures: 0 });
    expect(describeGate(gateFor(DEFAULT_GATE, 'real'))).toBe(
      '0 failures, p90 <= 4.2 s, slowest <= 6.5 s, at most 1.5% over 5 s',
    );
  });

  it('finds a galaxy by its own name first, then "*", else holds it to nothing', () => {
    const gate = { real: { p90Sec: 4 }, '8': { failures: 2 }, '*': { failures: 0 } };
    expect(gateFor(gate, 'real')).toEqual({ p90Sec: 4 });
    expect(gateFor(gate, 8)).toEqual({ failures: 2 });
    expect(gateFor(gate, 4)).toEqual({ failures: 0 });
    expect(gateFor({ real: {} }, 6)).toEqual({});
    expect(describeGate({})).toBe('no limits');
  });
});

describe('breachesOf', () => {
  it('passes a galaxy that meets every limit, a limit met exactly included', () => {
    const gate: GalaxyGate = { failures: 0, p90Sec: 9, maxSec: 10, over5sShare: 0.5 };
    expect(breachesOf(measured(), gate)).toEqual([]);
  });

  it('says in words which limit a galaxy missed, by how much, and where to look', () => {
    const gate: GalaxyGate = { p90Sec: 8.5, maxSec: 9.5, over5sShare: 0.2 };
    expect(breachesOf(measured(), gate)).toEqual([
      "p90 is 9.00 s, over the gate's 8.5 s",
      expect.stringMatching(
        /^the slowest journey takes 10\.00 s, over the gate's 9\.5 s: page\/about -> system\/code {2}10\.00 s/,
      ),
      '5 of 10 journeys (50%) take over 5 s, the gate allows 20%: ' +
        'page/about -> system/code 10.00 s; page/about -> system/code 9.00 s; ' +
        'page/about -> system/code 8.00 s; and 2 more',
    ]);
  });

  it('counts failed journeys against the failures allowed, and a timeout as over 5 s', () => {
    const rows = [...TEN.slice(0, 9), journey(60, { docked: false, failure: 'timeout' })];
    const [breach, ...rest] = breachesOf(measured({ rows }), { failures: 0 });
    expect(rest).toEqual([]);
    expect(breach).toMatch(/^1 of 10 journeys failed, the gate allows 0: timeout: page\/about ->/);
    expect(breachesOf(measured({ rows }), { failures: 1 })).toEqual([]);
    expect(breachesOf(measured({ rows }), { over5sShare: 0.4 })[0]).toMatch(
      /^5 of 10 journeys \(50%\) take over 5 s/,
    );
  });

  it('holds stress flights and Stop to 0 failures, whatever the gate says', () => {
    const flight: StressFlight = {
      mode: 'tap',
      spec: {
        kind: 'between',
        from: 'page/about',
        to: 'system/code',
        startSec: 0,
        angle: 0,
        spin: 1,
        dwellSec: 0.5,
      },
      interrupt: { kind: 'tap', atSec: 1.5, input: 'brake', steps: 4, coastSec: 10 },
      result: journey(3, { failure: 'shell' }),
      undisturbedSec: 3,
    };
    const stopped = journey(3, { failure: 'graze' });
    const breaches = breachesOf(
      measured({
        stops: [journey(3), stopped],
        stress: [flight, { ...flight, result: journey(3) }],
      }),
      {},
    );
    expect(breaches).toEqual([
      expect.stringMatching(
        /^1 of 2 journeys stopped at their fastest touched a shell or grazed, the gate allows none: graze: page\/about ->/,
      ),
      expect.stringMatching(
        /^1 of 2 stress flights failed, the gate allows none: tap shell: page\/about -> system\/code @0\.00 s: brake held 4 steps/,
      ),
    ]);
  });

  it('breaches a galaxy that could not be built, since none of it was measured', () => {
    const error = 'system "code" reaches 402 u, past the 380 u limit';
    expect(breachesOf(measured({ error, rows: [] }), {})).toEqual([
      `could not be built, so no journey was flown: ${error}`,
    ]);
  });
});

describe('the gate from JOURNEYS', () => {
  const gateOf = (gate: unknown) => optionsFromEnv({ JOURNEYS: JSON.stringify({ gate }) }).options;

  it('replaces the default gate whole, or with false measures only', () => {
    expect(gateOf({ real: { p90Sec: 1 } }).gate).toEqual({ real: { p90Sec: 1 } });
    expect(gateOf(false).gate).toBeNull();
    expect(optionsFromEnv({}).options.gate).toBeUndefined(); // so measure() uses DEFAULT_GATE
  });

  it('refuses a typo instead of gating nothing', () => {
    expect(() => gateOf({ real: { p90: 1 } })).toThrow(/unknown gate limit "p90"/);
    expect(() => gateOf({ grown: {} })).toThrow(/a galaxy is "real", a number of systems, or "\*"/);
    expect(() => gateOf({ real: { maxSec: -1 } })).toThrow(/maxSec must be a number, 0 or more/);
    expect(() => gateOf({ real: 4.2 })).toThrow(/gate for "real"/);
    expect(() => parseGate([])).toThrow(/"gate"/);
  });
});

describe('measure', () => {
  // Two journeys of the real galaxy: a real run in a fraction of a second.
  const small = { between: 2, within: 0, spawn: false, starts: 1 } as const;
  const quiet = (): void => undefined;

  it('reports each galaxy against its gate, and every breach in words', () => {
    const [report] = measure({
      galaxies: ['real'],
      sample: small,
      gate: { real: { failures: 0, p90Sec: 0.5 } },
      log: quiet,
    });
    expect(report?.gate).toEqual({ failures: 0, p90Sec: 0.5 });
    // No journey docks in under 1.5 s (docs/PLAN.md §5.5).
    expect(report?.breaches).toEqual([
      expect.stringMatching(/^p90 is \d+\.\d\d s, over the gate's 0\.5 s$/),
    ]);
  });

  it('measures only, with no gate', () => {
    const [report] = measure({ galaxies: ['real'], sample: small, gate: null, log: quiet });
    expect(report?.gate).toBeNull();
    expect(report?.breaches).toEqual([]);
    expect(report?.rows).toHaveLength(2);
  });
});

describe('grow', () => {
  const project = (id: string, over: Partial<ProjectInput>): ProjectInput => ({
    id,
    title: id,
    href: `/projects/${id}/`,
    date: '2025-01',
    size: 'm',
    biome: 'terra',
    rings: false,
    decorMoons: 0,
    flagship: false,
    related: [],
    draft: false,
    ...over,
  });
  // A real system with a synthetic one's id, and real projects with a synthetic system's id
  // ("robotics") and a synthetic planet's ("berkeley-club", which has two synthetic moons).
  const real: UniverseInput = {
    systems: [
      {
        id: 'rocketry',
        name: 'Rocketry',
        href: '/systems/rocketry/',
        theme: 'coral',
        order: 1,
        position: 'auto',
      },
    ],
    projects: [
      project('robotics', { system: 'rocketry' }),
      project('berkeley-club', { system: 'rocketry' }),
    ],
    pages: [{ id: 'about', title: 'About', href: '/about/', dock: 'home' }],
    includeDrafts: false,
  };

  it('skips a synthetic system only for a real system of its id', () => {
    const grown = grow(real, 5);
    expect(grown.systems.map(({ id, order }) => [id, order])).toEqual([
      ['rocketry', 1],
      ['berkeley', 2],
      ['robotics', 3],
      ['writing', 4],
    ]);
  });

  it('skips a synthetic project only for a real project of its id, with its moons', () => {
    const ids = grow(real, 5).projects.map((entry) => entry.id);
    expect(ids.filter((id) => id === 'berkeley-club')).toHaveLength(1);
    expect(ids).not.toContain('berkeley-club-site');
    expect(ids).not.toContain('berkeley-club-launch');
    expect(ids).toContain('berkeley-coursework');
    expect(ids).toContain('robotics-rover-arm');
    expect(grow(real, 5).projects.find((entry) => entry.id === 'berkeley-club')?.system).toBe(
      'rocketry',
    );
  });

  it('builds: a system and a project may share an id', () => {
    const manifest = buildGalaxy(grow(real, 5));
    const ids = manifest.bodies.map((body) => body.id);
    expect(ids).toContain('system/robotics');
    expect(ids).toContain('project/robotics');
  });
});
