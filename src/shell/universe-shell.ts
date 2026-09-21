// Everything the page needs in universe mode that is NOT the engine itself. In Phase 0 that is
// just "boot the engine, and fall back to plain if it does not come up". The router, panel
// controller and prefetcher join this module in Phase 2.

import type { Universe } from '../universe/api';
import { startFrameWatchdog } from './watchdog';

/**
 * No first frame after this much FRAME time (see watchdog.ts) => give up and go plain. The clock
 * starts before the engine chunk downloads, so it also covers a stalled network.
 */
const WATCHDOG_MS = 8000;

const root = document.documentElement;

/**
 * The content is already in the DOM and the base CSS is the plain layout, so falling back is
 * just flipping attributes. Nothing is lost and nothing needs to reload.
 */
function fallBackToPlain(reason: string): void {
  root.dataset.mode = 'plain';
  root.dataset.modeReason = 'engine-failed';
  delete root.dataset.engine;
  console.warn(`[universe] falling back to plain mode: ${reason}`);
}

export async function start(): Promise<void> {
  const mount = document.getElementById('universe-host');
  if (!mount) return;

  root.dataset.engine = 'booting';
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
    const { createUniverse } = await import('../universe/api');
    const created = await createUniverse({
      mount,
      reducedMotion: root.dataset.motion === 'reduced',
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
