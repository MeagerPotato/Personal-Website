// The cards of the page that is showing (src/components/Card.astro), as universe mode handles
// them. A page's fragment says which part of it the visitor is at (`/about/#rockets`): the
// router keeps the fragment (router.ts, `anchor` and `onAnchor`), and this file shows the part.
//
// Where a page is one column that scrolls (the side panel, the phone's sheet) showing a part
// is scrolling to it, and that is all this file does so far.

import { readingTarget } from './navigation';

/**
 * The router's `onAnchor` listener: bring the part of the page that `id` names to the top of
 * what scrolls. Nothing moves for an id that names no place in the content (none at all, or
 * <main> itself: navigation.ts, `readingTarget`).
 *
 * The scroll is the scroller's own kind (the panel jumps, as it does for a fragment the browser
 * follows itself), and the focus stays where it is: on the link that was pressed, which for a
 * card's title is inside the part it names.
 */
export function showAnchor(id: string | null, doc: Document = document): void {
  readingTarget(doc, id)?.scrollIntoView({ block: 'start' });
}
