import { describe, expect, it } from 'vitest';
import { FLIGHT, transition, type AppEvent, type AppState } from './appMachine';

function run(events: readonly AppEvent[], from: AppState = FLIGHT): AppState {
  return events.reduce((state, event) => transition(state, event) ?? state, from);
}

describe('app state machine', () => {
  it('flies to a body, approaches it, docks, and leaves', () => {
    expect(run([{ type: 'travel', to: 'project/fishai' }])).toEqual({
      mode: 'autopilot',
      target: 'project/fishai',
    });
    expect(
      run([
        { type: 'travel', to: 'project/fishai' },
        { type: 'approach', to: 'project/fishai' },
      ]),
    ).toEqual({ mode: 'approach', target: 'project/fishai' });
    const docked = run([
      { type: 'travel', to: 'project/fishai' },
      { type: 'approach', to: 'project/fishai' },
      { type: 'capture' },
    ]);
    expect(docked).toEqual({ mode: 'docked', target: 'project/fishai' });
    expect(transition(docked, { type: 'release' })).toBe(FLIGHT);
  });

  it('docks straight from flight when the body is within reach (press E)', () => {
    expect(run([{ type: 'approach', to: 'page/about' }, { type: 'capture' }])).toEqual({
      mode: 'docked',
      target: 'page/about',
    });
  });

  it('can be released from anything but free flight', () => {
    expect(transition(FLIGHT, { type: 'release' })).toBeNull();
    for (const mode of ['autopilot', 'approach', 'docked'] as const) {
      expect(transition({ mode, target: 'x' }, { type: 'release' })).toBe(FLIGHT);
    }
  });

  it('changes its mind: a new destination replaces the old one, from any state', () => {
    for (const mode of ['autopilot', 'approach', 'docked'] as const) {
      expect(transition({ mode, target: 'a' }, { type: 'travel', to: 'b' })).toEqual({
        mode: 'autopilot',
        target: 'b',
      });
    }
  });

  it('says nothing when asked for where it already is, or is already going', () => {
    expect(transition({ mode: 'docked', target: 'a' }, { type: 'travel', to: 'a' })).toBeNull();
    expect(transition({ mode: 'docked', target: 'a' }, { type: 'approach', to: 'a' })).toBeNull();
    expect(transition({ mode: 'docked', target: 'a' }, { type: 'place', at: 'a' })).toBeNull();
    expect(transition({ mode: 'autopilot', target: 'a' }, { type: 'travel', to: 'a' })).toBeNull();
    expect(transition({ mode: 'approach', target: 'a' }, { type: 'approach', to: 'a' })).toBeNull();
    // Within reach already: a second request to travel there does not go back a stage.
    expect(transition({ mode: 'approach', target: 'a' }, { type: 'travel', to: 'a' })).toBeNull();
  });

  it('only captures out of an approach', () => {
    expect(transition(FLIGHT, { type: 'capture' })).toBeNull();
    expect(transition({ mode: 'autopilot', target: 'a' }, { type: 'capture' })).toBeNull();
    expect(transition({ mode: 'docked', target: 'a' }, { type: 'capture' })).toBeNull();
  });

  it('can be placed in orbit from anywhere: a page opened on a planet never passes through flight', () => {
    expect(transition(FLIGHT, { type: 'place', at: 'a' })).toEqual({ mode: 'docked', target: 'a' });
    expect(transition({ mode: 'docked', target: 'b' }, { type: 'place', at: 'a' })).toEqual({
      mode: 'docked',
      target: 'a',
    });
  });

  it('has a target exactly when it is not in free flight', () => {
    const events: AppEvent[] = [
      { type: 'travel', to: 'a' },
      { type: 'approach', to: 'a' },
      { type: 'capture' },
      { type: 'place', at: 'b' },
      { type: 'release' },
      { type: 'approach', to: 'c' },
      { type: 'release' },
    ];
    let state = FLIGHT;
    for (const event of events) {
      state = transition(state, event) ?? state;
      expect(state.target === null).toBe(state.mode === 'flight');
    }
  });
});
