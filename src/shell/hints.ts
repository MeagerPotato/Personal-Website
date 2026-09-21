// HOW TO FLY, said once. A visitor who lands in the universe with the panel closed sees a ship and
// a sky and nothing that says what to do. The card (layouts/Base.astro, `.flight-hint`) says it:
// keys on a desktop, thumbs on a phone (the stylesheet picks by pointer), and that planets can be
// pointed at. It goes once the visitor has shown that they know: they steered (`firstinput`), they
// set out for somewhere from open sky, or they pressed "Got it". After that it never comes back.
//
// A journey that began with a LINK does not count: that visitor is reading a page (the stylesheet
// hides the card while the panel is open), and has learned nothing about flying yet.

import type { Universe } from '../universe/api';

export interface HintsOptions {
  /** The card. It ships `hidden`: no script, plain mode or a returning visitor never see it. */
  element: HTMLElement;
  universe: Pick<Universe, 'on'>;
  /** localStorage, behind a function: asking for it can throw (private mode, blocked cookies). */
  storage(): Storage;
  /** Is the info panel closed right now? Then a journey that starts was begun in the world. */
  panelClosed(): boolean;
  /** The card stays this long after the visitor has got it, so that it does not vanish mid-read. */
  lingerMs?: number;
}

const KEY = 'hints';
const SEEN = 'seen';

/** Returns the function that stops it (and hides the card without remembering anything). */
export function startHints(options: HintsOptions): () => void {
  const { element, universe } = options;
  try {
    if (options.storage().getItem(KEY) === SEEN) return () => undefined;
  } catch {
    // No storage: the card shows on every visit, which is better than never.
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const dismiss = element.querySelector<HTMLElement>('[data-flight-hint-dismiss]');

  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const off of listeners.splice(0)) off();
    dismiss?.removeEventListener('click', finish);
    element.hidden = true;
  };
  function finish(): void {
    stop();
    try {
      options.storage().setItem(KEY, SEEN);
    } catch {
      // It will show again next time. Fine.
    }
  }
  const gotIt = (): void => {
    timer ??= setTimeout(finish, options.lingerMs ?? 4000);
  };

  const listeners = [
    universe.on('firstinput', gotIt),
    universe.on('statechange', ({ mode }) => {
      if ((mode === 'autopilot' || mode === 'approach') && options.panelClosed()) gotIt();
    }),
  ];
  dismiss?.addEventListener('click', finish);
  element.hidden = false;
  return stop;
}
