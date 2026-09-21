// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniverseEvents } from '../universe/api';
import { startHints, type HintsOptions } from './hints';

type Listener<K extends keyof UniverseEvents> = (payload: UniverseEvents[K]) => void;

function harness({ seen = false, brokenStorage = false } = {}) {
  document.body.innerHTML =
    '<aside data-flight-hint hidden><p>How to fly</p>' +
    '<button type="button" data-flight-hint-dismiss>Got it</button></aside>';
  const element = document.querySelector('aside') as HTMLElement;
  const listeners = new Map<string, Set<Listener<never>>>();
  const store = new Map<string, string>(seen ? [['hints', 'seen']] : []);
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  } as Storage;
  const state = { panelClosed: true };
  const universe: HintsOptions['universe'] = {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener as Listener<never>);
      return () => set.delete(listener as Listener<never>);
    },
  };
  const stop = startHints({
    element,
    universe,
    storage: () => {
      if (brokenStorage) throw new Error('no storage here');
      return storage;
    },
    panelClosed: () => state.panelClosed,
    lingerMs: 4000,
  });
  return {
    element,
    store,
    state,
    stop,
    emit<K extends keyof UniverseEvents>(event: K, payload: UniverseEvents[K]): void {
      for (const listener of listeners.get(event) ?? []) (listener as Listener<K>)(payload);
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('flight hints', () => {
  it('shows the card to someone who has not seen it, and keeps it while they only look', () => {
    const h = harness();
    expect(h.element.hidden).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(h.element.hidden).toBe(false);
    expect(h.store.has('hints')).toBe(false);
  });

  it('never shows it again to someone who has', () => {
    const h = harness({ seen: true });
    expect(h.element.hidden).toBe(true);
    expect(h.listening()).toBe(0);
  });

  it('goes a little after the first steering, and remembers', () => {
    const h = harness();
    h.emit('firstinput', undefined);
    vi.advanceTimersByTime(3900);
    expect(h.element.hidden).toBe(false);
    vi.advanceTimersByTime(200);
    expect(h.element.hidden).toBe(true);
    expect(h.store.get('hints')).toBe('seen');
    expect(h.listening()).toBe(0);
  });

  it('goes at once for "Got it"', () => {
    const h = harness();
    h.element.querySelector('button')?.click();
    expect(h.element.hidden).toBe(true);
    expect(h.store.get('hints')).toBe('seen');
  });

  it('counts a journey begun in the world, but not one begun by a link', () => {
    const link = harness();
    link.state.panelClosed = false; // the page of the link is open
    link.emit('statechange', { mode: 'autopilot', target: 'system/code' });
    link.emit('statechange', { mode: 'docked', target: 'system/code' });
    vi.advanceTimersByTime(10_000);
    expect(link.element.hidden).toBe(false);

    const pointed = harness();
    pointed.emit('statechange', { mode: 'autopilot', target: 'system/code' });
    vi.advanceTimersByTime(4100);
    expect(pointed.element.hidden).toBe(true);
    expect(pointed.store.get('hints')).toBe('seen');

    const pressedE = harness();
    pressedE.emit('statechange', { mode: 'approach', target: 'page/about' });
    vi.advanceTimersByTime(4100);
    expect(pressedE.element.hidden).toBe(true);
  });

  it('works without storage: the card shows, and goes, and nothing throws', () => {
    const h = harness({ brokenStorage: true });
    expect(h.element.hidden).toBe(false);
    h.element.querySelector('button')?.click();
    expect(h.element.hidden).toBe(true);
  });

  it('stops without remembering when told to (the engine failed, the page goes plain)', () => {
    const h = harness();
    h.emit('firstinput', undefined);
    h.stop();
    vi.advanceTimersByTime(10_000);
    expect(h.element.hidden).toBe(true);
    expect(h.store.has('hints')).toBe(false);
    expect(h.listening()).toBe(0);
  });
});
