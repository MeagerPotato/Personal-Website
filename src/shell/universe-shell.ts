// Everything the page needs in universe mode that is NOT the engine itself: boot the engine, fall
// back to plain if it does not come up, keep the canvas alive across pages with the router, and
// show each page's content in the panel.

import { site } from '../config/site';
import { routes } from '../site/routes';
import type { Universe } from '../universe/api';
import { startPanel, type Panel } from './panel';
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

/**
 * The content is already in the DOM and the base CSS is the plain layout, so falling back is
 * just flipping attributes. Nothing is lost and nothing needs to reload.
 */
function fallBackToPlain(reason: string): void {
  root.dataset.mode = 'plain';
  root.dataset.modeReason = 'engine-failed';
  delete root.dataset.engine;
  delete root.dataset.quality;
  // With no canvas to protect there is nothing to gain from soft navigation: links are links.
  router?.dispose();
  router = undefined;
  panel?.dispose();
  panel = undefined;
  console.warn(`[universe] falling back to plain mode: ${reason}`);
}

export async function start(): Promise<void> {
  const mount = document.getElementById('universe-host');
  if (!mount) return;

  root.dataset.engine = 'booting';
  // Before the engine chunk even arrives, so that the very first click is already a soft one.
  router = startRouter({
    navItems: site.nav,
    onNavigate: ({ url }) => panel?.sync(url.pathname),
  });
  panel = startPanel({
    homePath: routes.home(),
    onLeave: () => router?.leave(routes.home()),
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
    const created = await createUniverse({
      mount,
      overlay: document.getElementById('universe-overlay') ?? undefined,
      manifest,
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

    universe.on('ready', () => {
      if (settled) return;
      settled = true;
      stopWatchdog();
      root.dataset.engine = 'ready';
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
