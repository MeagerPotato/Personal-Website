import { describe, expect, it } from 'vitest';
import {
  flyTwins,
  planJourneys,
  simTuning,
  type HyperOutcome,
  type JourneyResult,
} from '../scripts/journeys/fly';
import { buildGalaxy, grow, readRealInput } from '../scripts/journeys/galaxies';
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
import type { ShipState } from '../src/universe/sim/types';

// The journey harness's own rules (scripts/journeys): the gate `npm run journeys` holds every
// galaxy to, and the grown galaxies it measures. The journeys themselves are flown by the harness,
// not here (thousands of them: minutes); one small real run below proves the wiring.

/** A journey nobody was offered a jump on (and so never in one). */
const NO_JUMP: HyperOutcome = {
  offeredSec: NaN,
  inAtSec: NaN,
  inSec: 0,
  outBeforeDockSec: NaN,
  strayed: false,
  differs: false,
};

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
    hyper: NO_JUMP,
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

  it('holds the twins of hyperspace to 0 failures too, whatever the gate says', () => {
    // A journey flown again with the jump taken is the same flight, or it is a bug.
    const differs = journey(3, { failure: 'hyper', hyper: { ...NO_JUMP, differs: true } });
    const strayed = journey(4, {
      to: 'project/fishai',
      failure: 'hyper',
      hyper: { ...NO_JUMP, strayed: true },
    });
    const twins = [journey(1), differs, journey(2), strayed];
    expect(breachesOf({ ...measured(), twins }, {})).toEqual([
      '2 of 4 journeys flown again with hyperspace taken failed, the gate allows none: ' +
        'hyperspace changed the flight: page/about to system/code; ' +
        'hyperspace outlived its journey: page/about to project/fishai',
    ]);
    // They are no journeys of the galaxy's own: its limits do not count them.
    expect(
      breachesOf({ ...measured(), twins }, { failures: 0, p90Sec: 9, maxSec: 10 }),
    ).toHaveLength(1);
    // Twins that flew as their journeys did, and a run where nobody pressed, say nothing.
    expect(breachesOf({ ...measured(), twins: [journey(1), journey(2)] }, {})).toEqual([]);
    expect(breachesOf({ ...measured(), twins: [] }, {})).toEqual([]);
    expect(breachesOf(measured(), {})).toEqual([]);
  });

  it('breaches a galaxy that could not be built, when it is held to any limit', () => {
    const error = 'system "code" reaches 402 u, past the 380 u limit';
    expect(breachesOf(measured({ error, rows: [] }), { failures: 0 })).toEqual([
      `could not be built, so no journey was flown: ${error}`,
    ]);
    // Held to nothing (a galaxy with no entry and no "*", or the gate off): nothing to miss.
    expect(breachesOf(measured({ error, rows: [] }), {})).toEqual([]);
  });

  it('breaches a galaxy with no journeys, when it is held to any limit', () => {
    // No rows: the p90 and the slowest are NaN, which no comparison catches.
    for (const gate of [{ failures: 0 }, { p90Sec: 4.2 }, { maxSec: 6.5 }, { over5sShare: 0 }]) {
      expect(breachesOf(measured({ rows: [] }), gate)).toEqual([
        'no journey was flown (the sample is empty), so no limit is known to be met',
      ]);
    }
    expect(breachesOf(measured({ rows: [] }), {})).toEqual([]);
  });
});

describe('the gate from JOURNEYS', () => {
  const gateOf = (gate: unknown) => optionsFromEnv({ JOURNEYS: JSON.stringify({ gate }) }).options;

  it('replaces the default gate whole, or with false switches it off', () => {
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

describe('hyperspace from JOURNEYS', () => {
  const hyperOf = (hyper: unknown) =>
    optionsFromEnv({ JOURNEYS: JSON.stringify({ hyper }) }).options.hyper;

  it('is "real" unless said otherwise: the real galaxy is flown twice, the grown ones once', () => {
    expect(optionsFromEnv({}).options.hyper).toBeUndefined(); // so measure() uses "real"
    expect(hyperOf('real')).toBe('real');
    expect(hyperOf(true)).toBe(true);
    expect(hyperOf(false)).toBe(false);
  });

  it('refuses anything else instead of pressing nothing', () => {
    for (const typo of ['yes', 1, null, {}, 'all']) {
      expect(() => hyperOf(typo)).toThrow(/"hyper" is true, false or "real"/);
    }
  });
});

describe('the twins of hyperspace', () => {
  const galaxy = { name: 'real', manifest: buildGalaxy(readRealInput()) };
  const sim = simTuning();
  // The first journey between two systems of the real galaxy: long enough for a jump.
  const [spec] = planJourneys(
    galaxy,
    { between: 1, within: 0, spawn: false, starts: 1 },
    'the twins of hyperspace',
  );
  if (spec === undefined) throw new Error('the real galaxy has no journey between systems');

  it('fly the same flight with the jump taken: offered, in it, out before docking, bit for bit', () => {
    const { plain, twin } = flyTwins(galaxy, spec, sim);
    expect(plain.failure).toBeNull();
    expect(twin.failure).toBeNull();
    expect(twin.hyper.differs).toBe(false);
    expect(twin.hyper.strayed).toBe(false);
    expect(twin.seconds).toBe(plain.seconds);
    // Both were offered the jump at the same moment; only the twin pressed.
    expect(plain.hyper.offeredSec).toBeGreaterThanOrEqual(0);
    expect(twin.hyper.offeredSec).toBe(plain.hyper.offeredSec);
    expect(plain.hyper.inSec).toBe(0);
    expect(Number.isNaN(plain.hyper.inAtSec)).toBe(true);
    // Never sooner than the wind-up, for at least the shortest jump, and out before the ring.
    expect(twin.hyper.inAtSec).toBeGreaterThanOrEqual(
      twin.hyper.offeredSec + sim.hyper.windupSec - 1e-9,
    );
    expect(twin.hyper.inSec).toBeGreaterThanOrEqual(sim.hyper.minTunnelSec);
    expect(twin.hyper.outBeforeDockSec).toBeGreaterThan(0);
    expect(twin.hyper.inAtSec + twin.hyper.inSec + twin.hyper.outBeforeDockSec).toBeCloseTo(
      twin.seconds,
      6,
    );
  });

  it('catch a twin that flew differently: a planted difference of a billionth of a unit', () => {
    let step = 0;
    const { plain, twin } = flyTwins(galaxy, spec, sim, 60, undefined, (view) => {
      step += 1;
      // What a jump that pushed the ship, however little, would do.
      if (step === 40) (view.state as ShipState).x += 1e-9;
    });
    expect(step).toBeGreaterThan(40);
    expect(plain.failure).toBeNull();
    expect(twin.hyper.differs).toBe(true);
    expect(twin.failure).toBe('hyper');
    // And the gate says so in words.
    expect(breachesOf({ ...measured({ rows: [plain] }), twins: [twin] }, {})).toEqual([
      `1 of 1 journeys flown again with hyperspace taken failed, the gate allows none: ` +
        `hyperspace changed the flight: ${spec.from} to ${spec.to}`,
    ]);
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

  it('breaches a gated galaxy whose sample is empty', () => {
    const [report] = measure({
      galaxies: ['real'],
      sample: { ...small, between: 0 },
      gate: { real: { failures: 0, p90Sec: 4.2 } },
      log: quiet,
    });
    expect(report?.rows).toEqual([]);
    expect(report?.breaches).toEqual([
      'no journey was flown (the sample is empty), so no limit is known to be met',
    ]);
  });

  it('flies the real galaxy a second time with hyperspace taken, and says how the jumps went', () => {
    const lines: string[] = [];
    const [report] = measure({
      galaxies: ['real'],
      sample: small,
      log: (text) => lines.push(text),
    });
    expect(report?.rows).toHaveLength(2);
    expect(report?.twins).toHaveLength(2);
    expect(report?.twins.map((twin) => twin.failure)).toEqual([null, null]);
    expect(report?.twins.map((twin) => twin.seconds)).toEqual(
      report?.rows.map((row) => row.seconds),
    );
    expect(report?.breaches).toEqual([]);
    expect(lines.join('\n')).toMatch(
      /hyperspace \(every journey again, the jump taken the moment it is offered: 2 twins, 0 flew differently\)/,
    );

    // Told not to, nobody presses: no twins, and no table of them.
    const quietly: string[] = [];
    const [once] = measure({
      galaxies: ['real'],
      sample: small,
      hyper: false,
      log: (text) => quietly.push(text),
    });
    expect(once?.twins).toEqual([]);
    expect(once?.rows.map((row) => row.seconds)).toEqual(report?.rows.map((row) => row.seconds));
    expect(quietly.join('\n')).not.toMatch(/hyperspace \(every journey again/);
  });

  it('with the gate off, holds no limits but still says how Stop did', () => {
    // (A failing Stop cannot be flown on purpose; breachesOf's own tests hold `{}` to that rule.)
    const lines: string[] = [];
    const [off] = measure({
      galaxies: ['real'],
      sample: small,
      gate: null,
      stop: { coastSec: 2 },
      log: (text) => lines.push(text),
    });
    expect(off?.gate).toBeNull();
    expect(off?.rows).toHaveLength(2);
    expect(off?.stops.length).toBeGreaterThan(0);
    expect(off?.breaches).toEqual([]);
    expect(lines.join('\n')).toMatch(
      /== the gate: off \("gate": false\), but stress flights and Stop/,
    );
    expect(lines.join('\n')).toMatch(/real \(\d systems\)\s+off: passed/);
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

  it('fills the lowest orders the real galaxy leaves free, beside the system placed by hand', () => {
    // Today's galaxy holds slots 1, 3 and 5 (Research went from 2 to 5 on 2026-10-03, placed by
    // hand in that slot's room): the grown ones fill 2 and 4, then 6 and 7. Each new system
    // stands on its slot's centre and may be full size there: the hand-placed one keeps clear of
    // every slot but its own (data/layout.ts, handPlace), so both galaxies build.
    const today = readRealInput();
    const held = new Set(today.systems.map((system) => system.order));
    const free: number[] = [];
    for (let order = 1; free.length < 4; order += 1) if (!held.has(order)) free.push(order);
    const added = (count: number): Array<number | undefined> =>
      grow(today, count)
        .systems.filter((system) => !today.systems.includes(system))
        .map((system) => system.order);
    expect(added(6)).toEqual(free.slice(0, 2));
    expect(added(8)).toEqual(free);
    for (const count of [6, 8]) {
      const manifest = buildGalaxy(grow(today, count));
      expect(manifest.systems).toHaveLength(count);
      // Nothing of the real galaxy moved to make room for them.
      const before = buildGalaxy(today);
      for (const system of before.systems) {
        expect(manifest.systems.find((entry) => entry.id === system.id)?.position).toEqual(
          system.position,
        );
      }
    }
  });

  it('lays a system placed by hand out with the rest under another slot formula', () => {
    // A formula is the whole layout: the place its file gives a system was chosen for the
    // honeycomb, and means nothing on a spiral.
    const today = readRealInput();
    const spiral = buildGalaxy(today, { slotExponent: 0.5 });
    const honeycomb = buildGalaxy(today);
    const byHand = today.systems.filter(
      (system) => system.order !== undefined && system.position !== 'auto',
    );
    expect(byHand.length).toBeGreaterThan(0);
    for (const system of byHand) {
      const at = (manifest: typeof spiral) =>
        manifest.systems.find((entry) => entry.id === system.id)?.position;
      expect(at(honeycomb)).toEqual(system.position);
      const [x, z] = at(spiral) ?? [NaN, NaN];
      // On the old spiral slot k sits 1000 u * sqrt(k) out, nudged by up to 100 u.
      expect(Math.abs(Math.hypot(x, z) - 1000 * Math.sqrt(system.order ?? NaN))).toBeLessThan(101);
    }
  });
});
