// THE ROUTE AND THE SHIP FOLLOW EACH OTHER. A visitor can get to a page two ways: by a link (the
// route changes, and the ship must follow it to the body that page belongs to) or by flying (the
// ship docks, and the route must follow it to that body's page). Either side may lead, and both
// are idempotent (universe/api.ts), so following is a matter of telling each what the other did
// and never of waiting for an answer: nothing here can deadlock, and nothing here keeps state
// about where the ship is.
//
//   route  -> ship    a page with a body: goTo(body). Any other page: undock(), unless the route
//                     only went there BECAUSE the ship left (below): the pilot may have left
//                     for somewhere else (a planet they pointed at), and must not be called back.
//   ship   -> route   docked: open that body's page, unless the page showing is already shown
//                     from it, or the router is busy (below). Left by the PILOT: leave the page
//                     (the router goes home). Left because somebody ASKED: that was us, and the
//                     route already knows.
//
// WHILE THE ROUTER IS BUSY the visitor has asked for a page that is not on screen yet, and the
// ship does not know: it hears of a route when the page shows. If it docks in that gap, that is
// old news. Opening its page would take the navigation over (the latest one wins), and the page
// the visitor asked for would never come: press Close just as the ship arrives, and the page
// closed and came straight back. Whatever shows next tells the ship where to be.
//
// docs/PLAN.md §5.3: the URL is the committed destination, never the ship's position.

import type { Universe } from '../universe/api';
import type { Destinations } from './destinations';
import type { Router } from './router';

export interface FollowOptions {
  universe: Pick<Universe, 'on' | 'goTo' | 'undock'>;
  router: Pick<Router, 'busy' | 'navigate' | 'leave' | 'prefetch' | 'cancel'>;
  destinations: Destinations;
  /** Where leaving a page goes: the open sky. */
  homeHref: string;
  /** The path of the page that is showing. */
  pathname(): string;
}

export interface Following {
  /** The router has put another page on screen (a link, Back, a page opened from orbit). */
  routeChanged(pathname: string): void;
  dispose(): void;
}

export function startFollowing(options: FollowOptions): Following {
  const { universe, router, destinations } = options;
  /** The body whose page the router has been asked for and has not shown yet. */
  let opening: string | null = null;
  /** The router is on its way home because the PILOT left: the ship led, it has nothing to hear. */
  let shipLed = false;

  const showsFrom = (id: string): boolean => destinations.idFor(options.pathname()) === id;

  const stops = [
    // Within reach of a body is as good a hint as a pointer resting on a link.
    universe.on('soi', ({ id }) => {
      const href = id === null ? null : destinations.hrefOf(id);
      if (href !== null) router.prefetch(href);
    }),

    universe.on('docked', ({ id }) => {
      if (router.busy || showsFrom(id)) return;
      const href = destinations.hrefOf(id);
      if (href === null) return;
      opening = id;
      void router.navigate(href);
    }),

    universe.on('undocked', ({ id, by }) => {
      if (by !== 'pilot') return;
      if (opening === id) {
        // Gone again before the page arrived: it must not arrive now and call the ship back.
        opening = null;
        router.cancel();
      } else if (showsFrom(id)) {
        shipLed = true;
        router.leave(options.homeHref);
      }
    }),
  ];

  return {
    routeChanged(pathname) {
      opening = null;
      const led = shipLed && pathname === options.homeHref;
      shipLed = false;
      const id = destinations.idFor(pathname);
      if (id !== null) void universe.goTo(id);
      else if (!led) universe.undock();
    },
    dispose() {
      for (const stop of stops) stop();
    },
  };
}
