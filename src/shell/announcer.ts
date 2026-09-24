// What a sighted visitor SEES the ship do, said for someone who does not (docs/PLAN.md §5.3): one
// polite live region. Few words, and only about what the visitor set going. A page that opens
// takes the focus to its heading, and that says where they are better than this could; so a cut
// (a deep link, reduced motion) says nothing here at all.

import type { Universe } from '../universe/api';

export interface AnnouncerOptions {
  /**
   * The `role="status"` element. It is in the layout from the start (layouts/Base.astro) and not
   * made here: a screen reader listens to the regions it found when the page loaded.
   */
  element: HTMLElement;
  universe: Pick<Universe, 'on'>;
  /** What a body is called, or null for one this page has never heard of. */
  titleOf(id: string): string | null;
}

/** Returns what stops it. */
export function startAnnouncer({ element, universe, titleOf }: AnnouncerOptions): () => void {
  /** Where a flight was announced to, until that flight ends one way or the other. */
  let flyingTo: string | null = null;
  /** Did the journey that just ended end in a Stop (the ship brakes to rest), or in the pilot's hands? */
  let halting = true;

  const say = (text: string): void => {
    element.textContent = text;
  };
  /** ' to FishAI', or nothing for a body this page has never heard of: 'Flying.' is still true. */
  const named = (word: string, id: string): string => {
    const title = titleOf(id);
    return title === null ? '' : ` ${word} ${title}`;
  };

  const stops = [
    // Said before the state that follows from it (api.ts): how the journey was let go of.
    universe.on('undocked', (left) => {
      halting = left.halting;
    }),
    universe.on('statechange', ({ mode, target }) => {
      if (mode === 'autopilot' || mode === 'approach') {
        // The approach is the last stretch of the same journey: it was said already.
        if (target === null || target === flyingTo) return;
        flyingTo = target;
        say(`Flying${named('to', target)}.`);
        return;
      }
      if (flyingTo !== null) {
        // Taken back with an arrow or the throttle, the ship flies on, and its pilot flies it.
        say(
          mode === 'docked' && target === flyingTo
            ? `Docked${named('at', target)}.`
            : mode === 'flight' && !halting
              ? 'Flying by hand.'
              : 'Stopped.',
        );
      }
      flyingTo = null;
      halting = true;
    }),
    universe.on('map', ({ open }) => {
      say(open ? 'Star map open.' : 'Star map closed.');
    }),
  ];

  return () => {
    for (const stop of stops) stop();
    element.textContent = '';
  };
}
