import { describe, expect, it } from 'vitest';
import type { UniverseEvents } from '../universe/api';
import { readDestinations } from './destinations';
import { startFollowing, type FollowOptions } from './follow';

const DESTINATIONS = readDestinations({
  bodies: [
    { id: 'page/about', href: '/about/' },
    { id: 'system/code', href: '/systems/code/' },
    { id: 'project/fishai', href: '/projects/fishai/' },
  ],
  alsoAt: { '/projects/': 'system/code' },
});

type Listener<K extends keyof UniverseEvents> = (payload: UniverseEvents[K]) => void;

/** Both sides as recorders: what was asked of the ship, and what was asked of the router. */
function harness(path = '/') {
  const listeners = new Map<string, Set<Listener<never>>>();
  const log: string[] = [];
  let pathname = path;
  const routerState = { busy: false };

  const universe: FollowOptions['universe'] = {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener as Listener<never>);
      return () => set.delete(listener as Listener<never>);
    },
    goTo: (id) => {
      log.push(`goTo ${id}`);
      return Promise.resolve('arrived');
    },
    undock: () => void log.push('undock'),
  };
  const router: FollowOptions['router'] = {
    get busy() {
      return routerState.busy;
    },
    navigate: (href) => {
      log.push(`navigate ${href}`);
      return Promise.resolve();
    },
    leave: (href) => void log.push(`leave ${href}`),
    prefetch: (href) => void log.push(`prefetch ${href}`),
    cancel: () => void log.push('cancel'),
  };
  const following = startFollowing({
    universe,
    router,
    destinations: DESTINATIONS,
    homeHref: '/',
    pathname: () => pathname,
  });

  return {
    log,
    following,
    routerState,
    emit<K extends keyof UniverseEvents>(event: K, payload: UniverseEvents[K]): void {
      for (const listener of listeners.get(event) ?? []) (listener as Listener<K>)(payload);
    },
    /** The router shows another page, and says so. */
    show(next: string): void {
      pathname = next;
      following.routeChanged(next);
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describe('the ship follows the route', () => {
  it('sets out for the body a page belongs to', () => {
    const h = harness();
    h.show('/projects/fishai/');
    expect(h.log).toEqual(['goTo project/fishai']);
  });

  it('shows a listed page from the body it is listed at', () => {
    const h = harness();
    h.show('/projects/');
    expect(h.log).toEqual(['goTo system/code']);
  });

  it('lets go for a page that belongs to no body: the open sky', () => {
    const h = harness('/about/');
    h.show('/');
    expect(h.log).toEqual(['undock']);
  });
});

describe('the route follows the ship', () => {
  it('opens the page of the body the ship docked at', () => {
    const h = harness();
    h.emit('docked', { id: 'project/fishai' });
    expect(h.log).toEqual(['navigate /projects/fishai/']);
  });

  it('does nothing when that page, or a page shown from that body, is already showing', () => {
    const own = harness('/projects/fishai/');
    own.emit('docked', { id: 'project/fishai' });
    expect(own.log).toEqual([]);

    const listed = harness('/projects/');
    listed.emit('docked', { id: 'system/code' });
    expect(listed.log).toEqual([]);
  });

  it('goes round the loop exactly once: docked, page, goTo (which the ship already did)', () => {
    const h = harness();
    h.emit('docked', { id: 'page/about' });
    h.show('/about/');
    h.emit('docked', { id: 'page/about' }); // what a rebuilt engine says when it comes back
    expect(h.log).toEqual(['navigate /about/', 'goTo page/about']);
  });

  it('does not answer a dock while the visitor is waiting for another page', () => {
    // Close, pressed as the ship arrives: Back is under way, the URL says "/" already, the page
    // that shows is still About, and the ship docks at About because nobody has told it yet.
    const h = harness('/');
    h.routerState.busy = true;
    h.emit('docked', { id: 'page/about' });
    expect(h.log).toEqual([]);

    // The sky shows: now the ship hears of it, and lets go.
    h.routerState.busy = false;
    h.show('/');
    expect(h.log).toEqual(['undock']);
  });

  it('leaves the page when the PILOT leaves the orbit', () => {
    const h = harness('/about/');
    h.emit('undocked', { id: 'page/about', by: 'pilot', halting: false });
    expect(h.log).toEqual(['leave /']);
  });

  it('does not call the ship back from wherever the pilot went: the route went home BECAUSE it left', () => {
    const h = harness('/about/');
    // The pilot pointed at another planet: the ship has left, and is on its way there.
    h.emit('undocked', { id: 'page/about', by: 'pilot', halting: false });
    h.show('/');
    expect(h.log).toEqual(['leave /']);

    // Only that once. Going home by a link still lets go of whatever the ship is doing.
    h.show('/about/');
    h.show('/');
    expect(h.log.slice(1)).toEqual(['goTo page/about', 'undock']);
  });

  it('ignores a dock that ended because somebody asked: that was the route, and it knows', () => {
    const h = harness('/about/');
    h.show('/projects/fishai/');
    h.emit('undocked', { id: 'page/about', by: 'asked', halting: false });
    expect(h.log).toEqual(['goTo project/fishai']);
  });

  it('ignores a pilot who gives up an approach that no page was opened for', () => {
    const h = harness('/');
    h.emit('undocked', { id: 'page/about', by: 'pilot', halting: false });
    expect(h.log).toEqual([]);
  });

  it('calls a page off when the pilot left again before it arrived', () => {
    const h = harness();
    h.emit('docked', { id: 'page/about' });
    h.emit('undocked', { id: 'page/about', by: 'pilot', halting: false });
    expect(h.log).toEqual(['navigate /about/', 'cancel']);

    // Only once, and only for THAT page: after it has arrived, leaving is leaving.
    h.emit('docked', { id: 'page/about' });
    h.show('/about/');
    h.emit('undocked', { id: 'page/about', by: 'pilot', halting: false });
    expect(h.log.slice(2)).toEqual(['navigate /about/', 'goTo page/about', 'leave /']);
  });

  it('fetches the page of a body as soon as the ship is within reach of it', () => {
    const h = harness();
    h.emit('soi', { id: 'project/fishai' });
    h.emit('soi', { id: null });
    h.emit('soi', { id: 'project/unlisted' });
    expect(h.log).toEqual(['prefetch /projects/fishai/']);
  });

  it('stops listening when told to', () => {
    const h = harness();
    expect(h.listening()).toBe(3);
    h.following.dispose();
    expect(h.listening()).toBe(0);
  });
});
