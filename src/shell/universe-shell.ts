// Everything the page needs in universe mode that is NOT the engine itself: boot the engine, fall
// back to plain if it does not come up, keep the canvas alive across pages with the router, show
// each page's content over the world (panel.ts; as cards round the body on a wide screen,
// cards.ts), and keep the route and the ship in step (follow.ts).

import { site } from '../config/site';
import { routes } from '../site/routes';
import type { Universe } from '../universe/api';
import { say, startAnnouncer } from './announcer';
import { startCards, type Cards } from './cards';
import { readDestinations, type Destinations } from './destinations';
import { startFollowing, type Following } from './follow';
import { startHints } from './hints';
import { startPanel, type Panel } from './panel';
import { mirrorInset, watchPanelInset, type InsetWatch } from './panel-inset';
import { keepSnapshot, recallSnapshot } from './pose-memory';
import { asTier, recallTier, rememberTier } from './quality-memory';
import { startRouter, type Router } from './router';
import { startFrameWatchdog } from './watchdog';

/**
 * No first frame after this much FRAME time (see watchdog.ts) => give up and go plain. The clock
 * starts before the engine chunk downloads, so it also covers a stalled network.
 */
const WATCHDOG_MS = 8000;

const root = document.documentElement;

let router: Router | undefined;
let panel: Panel | undefined;
let cards: Cards | undefined;
let inset: InsetWatch | undefined;
let stopKeeping: (() => void) | undefined;
let following: Following | undefined;
let stopHints: (() => void) | undefined;
let stopAnnouncer: (() => void) | undefined;

/**
 * The content is already in the DOM and the base CSS is the plain layout, so falling back is
 * just flipping attributes. Nothing is lost and nothing needs to reload.
 */
function fallBackToPlain(reason: string): void {
  root.dataset.mode = 'plain';
  root.dataset.modeReason = 'engine-failed';
  delete root.dataset.engine;
  delete root.dataset.quality;
  delete root.dataset.map;
  delete root.dataset.sky;
  // With no canvas to protect there is nothing to gain from soft navigation: links are links.
  router?.dispose();
  router = undefined;
  panel?.dispose();
  panel = undefined;
  cards?.dispose();
  cards = undefined;
  inset?.stop();
  inset = undefined;
  stopKeeping?.();
  stopKeeping = undefined;
  following?.dispose();
  following = undefined;
  stopHints?.();
  stopHints = undefined;
  stopAnnouncer?.();
  stopAnnouncer = undefined;
  mirrorInset(root, null);
  console.warn(`[universe] falling back to plain mode: ${reason}`);
}

export async function start(): Promise<void> {
  const mount = document.getElementById('universe-host');
  if (!mount) return;

  root.dataset.engine = 'booting';
  // Before the engine chunk even arrives, so that the very first click is already a soft one.
  router = startRouter({
    navItems: site.nav,
    onNavigate: ({ url }) => {
      panel?.sync(url.pathname);
      // After the panel: whether there are cards to lay out depends on whether it is open.
      cards?.sync({ cut: true });
      following?.routeChanged(url.pathname);
    },
    // The page stays and the reader moves within it: nothing for the panel or the ship to do.
    onAnchor: (id) => cards?.show(id),
  });
  panel = startPanel({
    homePath: routes.home(),
    onLeave: () => router?.leave(routes.home()),
    // An open card closes before the page does.
    onEscape: () => cards?.escape() ?? false,
  });
  // Which body each page belongs to: known once the galaxy's manifest has arrived.
  let destinations: Destinations | undefined;
  const status = document.querySelector<HTMLElement>('[data-announcer]');
  // Beside the router and the panel, before the engine chunk arrives: the cards are the page's
  // content, and they open and close while the world is still loading.
  cards = startCards({
    router,
    panelOpen: () => root.dataset.panel === 'open',
    bodyOf: (pathname) => destinations?.idFor(pathname) ?? null,
    announce: (text) => {
      if (status) say(status, text);
    },
    refreshInset: () => inset?.refresh(),
  });
  let universe: Universe | undefined;
  let settled = false;

  const fail = (reason: string): void => {
    if (settled) return;
    settled = true;
    stopWatchdog();
    universe?.dispose();
    fallBackToPlain(reason);
  };

  const stopWatchdog = startFrameWatchdog(WATCHDOG_MS, () =>
    fail(`no first frame after ${WATCHDOG_MS} ms of rendering`),
  );

  try {
    // The galaxy's data and the engine's code, side by side. Either one failing means plain mode.
    const [{ createUniverse }, manifest] = await Promise.all([
      import('../universe/api'),
      fetch(routes.universeManifest()).then((response): Promise<unknown> => {
        if (!response.ok) throw new Error(`universe manifest: HTTP ${response.status}`);
        return response.json();
      }),
    ]);
    const flags = new URLSearchParams(location.search);
    const known = (destinations = readDestinations(manifest));
    const created = await createUniverse({
      mount,
      overlay: document.getElementById('universe-overlay') ?? undefined,
      manifest,
      // The page that is open NOW, which may not be the one this started on: the engine chunk
      // takes a moment to arrive, and the router was already taking clicks.
      start: {
        at: known.idFor(location.pathname),
        snapshot: recallSnapshot(() => sessionStorage),
      },
      reducedMotion: root.dataset.motion === 'reduced',
      quality: asTier(flags.get('q')),
      qualityCeiling: recallTier(() => localStorage, Date.now()),
      debug: { perf: flags.has('perf'), tweak: flags.has('tweak') },
    });

    // The watchdog may have fired while the engine chunk was still downloading.
    if (settled) {
      created.dispose();
      return;
    }
    universe = created;
    if (router) {
      following = startFollowing({
        universe: created,
        router,
        destinations: known,
        homeHref: routes.home(),
        pathname: () => location.pathname,
      });
    }
    const hint = document.querySelector<HTMLElement>('[data-flight-hint]');
    if (hint) {
      stopHints = startHints({
        element: hint,
        universe: created,
        storage: () => localStorage,
        panelClosed: () => root.dataset.panel === 'closed',
      });
    }
    if (status) {
      stopAnnouncer = startAnnouncer({
        element: status,
        universe: created,
        titleOf: known.titleOf,
      });
    }
    stopKeeping = keepSnapshot(
      () => created.snapshot(),
      () => sessionStorage,
    );
    // The page's content covers part of the view: the engine frames things in what is left, and
    // the stylesheet keeps the engine's own DOM there.
    inset = watchPanelInset((covered, first) => {
      created.setPanelInset(covered, { cut: first });
      mirrorInset(root, covered);
    });
    // And where it is a deck of cards, the engine draws to them and turns to the open one.
    cards?.attach(created);

    universe.on('ready', () => {
      if (settled) return;
      settled = true;
      stopWatchdog();
      root.dataset.engine = 'ready';
    });
    // The star map is the engine's own (M, its button, the wheel); the page only needs to know,
    // for the stylesheet: what belongs to flying (the how-to-fly card) steps aside.
    universe.on('map', ({ open }) => {
      if (open) root.dataset.map = 'open';
      else delete root.dataset.map;
    });
    // For the tests and the stylesheet: `baking`, then `ready` (or `off`: navy and stars only).
    universe.on('sky', ({ state }) => {
      root.dataset.sky = state;
    });
    universe.on('quality', ({ tier, demoted }) => {
      root.dataset.quality = tier;
      if (demoted) rememberTier(() => localStorage, tier, Date.now());
    });
    // `fatal` can arrive long after `ready` (a lost WebGL context), so it bypasses `settled`.
    universe.on('fatal', ({ reason }) => {
      settled = true;
      stopWatchdog();
      universe?.dispose();
      fallBackToPlain(reason);
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
