// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { UniverseEvents } from '../universe/api';
import { startAnnouncer, type AnnouncerOptions } from './announcer';

type Listener<K extends keyof UniverseEvents> = (payload: UniverseEvents[K]) => void;

const TITLES: Record<string, string> = { 'project/fishai': 'FishAI', 'system/code': 'Code' };

function harness() {
  document.body.innerHTML = '<p role="status" data-announcer></p>';
  const element = document.querySelector('p') as HTMLElement;
  const listeners = new Map<string, Set<Listener<never>>>();
  const universe: AnnouncerOptions['universe'] = {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener as Listener<never>);
      return () => set.delete(listener as Listener<never>);
    },
  };
  const stop = startAnnouncer({ element, universe, titleOf: (id) => TITLES[id] ?? null });
  return {
    stop,
    said: () => element.textContent,
    emit<K extends keyof UniverseEvents>(event: K, payload: UniverseEvents[K]): void {
      for (const listener of listeners.get(event) ?? []) (listener as Listener<K>)(payload);
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describe('the announcer', () => {
  it('says where the ship is flying to, once, and that it got there', () => {
    const h = harness();
    expect(h.said()).toBe('');
    h.emit('statechange', { mode: 'autopilot', target: 'project/fishai' });
    expect(h.said()).toBe('Flying to FishAI.');
    // Within reach the journey becomes an approach: the same journey, not news.
    h.emit('map', { open: true });
    h.emit('statechange', { mode: 'approach', target: 'project/fishai' });
    expect(h.said()).toBe('Star map open.');
    h.emit('statechange', { mode: 'docked', target: 'project/fishai' });
    expect(h.said()).toBe('Docked at FishAI.');
  });

  it('says nothing about a ship that was PUT somewhere: the page that opens says it better', () => {
    const h = harness();
    // A deep link, a rebuild, or a journey under reduced motion: docked with no flight before it.
    h.emit('statechange', { mode: 'docked', target: 'project/fishai' });
    expect(h.said()).toBe('');
    // Nor about leaving: the page closes, and the focus goes back to where it came from.
    h.emit('statechange', { mode: 'flight', target: null });
    expect(h.said()).toBe('');
  });

  it('says when a flight ends short of where it was going, or changes its mind', () => {
    const h = harness();
    h.emit('statechange', { mode: 'approach', target: 'system/code' });
    expect(h.said()).toBe('Flying to Code.');
    h.emit('statechange', { mode: 'autopilot', target: 'project/fishai' });
    expect(h.said()).toBe('Flying to FishAI.');
    h.emit('undocked', { id: 'project/fishai', by: 'pilot', halting: true });
    h.emit('statechange', { mode: 'flight', target: null });
    expect(h.said()).toBe('Stopped.');
    // And that was the end of it: docking there later by hand is a new story.
    h.emit('statechange', { mode: 'docked', target: 'project/fishai' });
    expect(h.said()).toBe('Stopped.');
  });

  it('says that the pilot has the ship, when a key took a journey back and it flies on', () => {
    const h = harness();
    h.emit('statechange', { mode: 'autopilot', target: 'project/fishai' });
    // An arrow or the throttle: the ship is the pilot's, still moving, not stopping.
    h.emit('undocked', { id: 'project/fishai', by: 'pilot', halting: false });
    h.emit('statechange', { mode: 'flight', target: null });
    expect(h.said()).toBe('Flying by hand.');
    // The next journey let go of by a Stop is a Stop again.
    h.emit('statechange', { mode: 'autopilot', target: 'system/code' });
    h.emit('undocked', { id: 'system/code', by: 'asked', halting: true });
    h.emit('statechange', { mode: 'flight', target: null });
    expect(h.said()).toBe('Stopped.');
  });

  it('has words for a body it has never heard of', () => {
    const h = harness();
    h.emit('statechange', { mode: 'autopilot', target: 'project/unheard-of' });
    expect(h.said()).toBe('Flying.');
  });

  it('says that the star map opened and closed', () => {
    const h = harness();
    h.emit('map', { open: true });
    expect(h.said()).toBe('Star map open.');
    h.emit('map', { open: false });
    expect(h.said()).toBe('Star map closed.');
  });

  it('stops listening, and leaves nothing behind to be read out', () => {
    const h = harness();
    h.emit('map', { open: true });
    h.stop();
    expect(h.listening()).toBe(0);
    expect(h.said()).toBe('');
  });
});
