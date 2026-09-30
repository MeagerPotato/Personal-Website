/**
 * Where the focus goes when an app changes screens. A single-page app draws the next screen
 * without loading a page, so the browser leaves the focus where it was, often on a link or a
 * button that has just gone, and a screen reader says nothing at all. So whatever changes the
 * screen (the router, a gate's next step) asks with focusNextTitle(), and the next screen title
 * to be drawn takes the focus: the screen's one <h1> (sites/AGENTS.md invariant 9), which a
 * screen reader then reads out, and from which the next Tab goes on. A title drawn late (a screen
 * still fetching its code, or opening its record) takes it when it comes; a title replaced while
 * it has the focus hands it to the next one.
 *
 * Framework-free: each app's <Title> (ui/common.tsx) calls titleShown and titleLeaving.
 */

let asked = false;

/** The next title drawn takes the focus. */
export function focusNextTitle(): void {
  asked = true;
}

/**
 * A title is in the document. It takes the focus if that was asked for, unless the screen has
 * already put the focus inside itself on purpose (a new record's name field, the search box).
 */
export function titleShown(title: HTMLElement): void {
  if (!asked) return;
  asked = false;
  const { activeElement, body } = title.ownerDocument;
  const screen = title.closest('main');
  if (activeElement && activeElement !== body && screen?.contains(activeElement)) return;
  title.focus({ preventScroll: true });
}

/** A title is leaving the document: if it has the focus, the next title drawn takes it. */
export function titleLeaving(title: HTMLElement): void {
  if (title.ownerDocument.activeElement === title) asked = true;
}
