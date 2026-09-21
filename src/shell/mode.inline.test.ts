import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tests the script EXACTLY as shipped (the same bytes Head.astro inlines), by running it against
// fake globals. The precedence under test is docs/PLAN.md §5.2.
const source = readFileSync(new URL('./mode.inline.js', import.meta.url), 'utf8');

interface Scenario {
  search?: string;
  webgl2?: boolean;
  reducedMotion?: boolean;
  plainOnly?: boolean;
  session?: Record<string, string>;
  local?: Record<string, string>;
  storageThrows?: boolean;
  noMatchMedia?: boolean;
}

function run(scenario: Scenario = {}) {
  const attributes = new Map<string, string>();
  if (scenario.plainOnly) attributes.set('data-plain-only', '');

  const makeStore = (seed: Record<string, string> = {}) => {
    const data = new Map(Object.entries(seed));
    return {
      data,
      getItem: (key: string) => {
        if (scenario.storageThrows) throw new Error('blocked');
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (scenario.storageThrows) throw new Error('blocked');
        data.set(key, value);
      },
      removeItem: (key: string) => {
        if (scenario.storageThrows) throw new Error('blocked');
        data.delete(key);
      },
    };
  };
  const sessionStorage = makeStore(scenario.session);
  const localStorage = makeStore(scenario.local);

  const window: Record<string, unknown> = { sessionStorage, localStorage };
  if (scenario.webgl2 !== false) window.WebGL2RenderingContext = function () {};
  if (!scenario.noMatchMedia) {
    window.matchMedia = () => ({ matches: scenario.reducedMotion === true });
  }

  const document = {
    documentElement: {
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
  };
  const location = { search: scenario.search ?? '' };

  new Function('window', 'document', 'location', source)(window, document, location);

  return {
    mode: attributes.get('data-mode'),
    reason: attributes.get('data-mode-reason'),
    motion: attributes.get('data-motion'),
    session: sessionStorage.data,
    local: localStorage.data,
  };
}

describe('mode.inline.js', () => {
  it('defaults to universe on a capable browser', () => {
    expect(run()).toMatchObject({ mode: 'universe', reason: 'default', motion: 'full' });
  });

  it('falls back to plain without WebGL2', () => {
    expect(run({ webgl2: false })).toMatchObject({ mode: 'plain', reason: 'no-webgl2' });
  });

  it('?plain wins for this session only', () => {
    const result = run({ search: '?plain' });
    expect(result).toMatchObject({ mode: 'plain', reason: 'query' });
    expect(result.session.get('mode')).toBe('plain');
    expect(result.local.has('mode')).toBe(false);
  });

  it('stays plain on later pages of the same session', () => {
    expect(run({ session: { mode: 'plain' } })).toMatchObject({ mode: 'plain', reason: 'session' });
  });

  it('?universe persists and clears the session flag', () => {
    const result = run({ search: '?utm=x&universe', session: { mode: 'plain' } });
    expect(result).toMatchObject({ mode: 'universe', reason: 'query' });
    expect(result.session.has('mode')).toBe(false);
    expect(result.local.get('mode')).toBe('universe');
  });

  it('does not mistake other parameters for mode switches', () => {
    expect(run({ search: '?plainly=1&multiverse=2' })).toMatchObject({ reason: 'default' });
  });

  it('honours a saved preference, in either direction', () => {
    expect(run({ local: { mode: 'plain' } })).toMatchObject({ mode: 'plain', reason: 'saved' });
    expect(run({ local: { mode: 'universe' }, reducedMotion: true })).toMatchObject({
      mode: 'universe',
      reason: 'saved',
      motion: 'reduced',
    });
  });

  it('ignores a corrupted saved preference', () => {
    expect(run({ local: { mode: 'banana' } })).toMatchObject({
      mode: 'universe',
      reason: 'default',
    });
  });

  it('starts plain under prefers-reduced-motion, as an invitation rather than a wall', () => {
    expect(run({ reducedMotion: true })).toMatchObject({
      mode: 'plain',
      reason: 'reduced-motion',
      motion: 'reduced',
    });
    expect(run({ reducedMotion: true, search: '?universe' })).toMatchObject({
      mode: 'universe',
      motion: 'reduced',
    });
  });

  it('plain-only pages (the 404) beat everything', () => {
    expect(
      run({ plainOnly: true, search: '?universe', local: { mode: 'universe' } }),
    ).toMatchObject({
      mode: 'plain',
      reason: 'page',
    });
  });

  it('no WebGL2 beats an explicit ?universe', () => {
    expect(run({ webgl2: false, search: '?universe' })).toMatchObject({ reason: 'no-webgl2' });
  });

  it('survives blocked storage and a missing matchMedia', () => {
    expect(run({ storageThrows: true, search: '?plain' })).toMatchObject({ mode: 'plain' });
    expect(run({ storageThrows: true, noMatchMedia: true })).toMatchObject({
      mode: 'universe',
      motion: 'full',
    });
  });

  it('stays small and ES5, because it blocks first paint and must parse everywhere', () => {
    expect(source.length).toBeLessThan(2600);
    expect(source).not.toMatch(/=>|\bconst\b|\blet\b|`/);
  });
});
