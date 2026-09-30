/**
 * "Planned" after the name of planned work, wherever the engine names a body (its label, the dock
 * prompt): seen as a small note after the name, heard as part of it, so that the name a screen
 * reader says, and a test finds, is exactly "Sports Analysis, Planned". The note is
 * `<block>__note`, and the ", " before it (`<block>__sep`) is heard, never seen. The web layer
 * says the same in its own words (shell/destinations.ts, for the announcer): it cannot import the
 * engine.
 *
 * A browser reads a name out with a space on either side of every part of it that is not inline
 * ("Sports Analysis , Planned"), so both parts stay INLINE, in the name's own line of text:
 * - the comma is only made transparent (global.css), never taken out of the flow as the usual
 *   visually hidden recipe does, and its room is the gap before the note;
 * - where the name's own box lays its children out as blocks (a label is a flex box), the name
 *   and its note go into one inline wrapper together: `plannedName`.
 * A test DOM lays nothing out, so only a real browser can tell (tests/e2e/support.ts `nameOf`
 * finds a name exactly); planned.test.ts holds the stylesheet to both rules.
 */
export function plannedNote(block: string): HTMLSpanElement {
  const note = document.createElement('span');
  note.className = `${block}__note`;
  const sep = document.createElement('span');
  sep.className = `${block}__sep`;
  sep.textContent = ', ';
  note.append(sep, 'Planned');
  return note;
}

/** A name and its planned note, together in one inline wrapper (`<block>__name`). */
export function plannedName(block: string, title: string): HTMLSpanElement {
  const name = document.createElement('span');
  name.className = `${block}__name`;
  name.append(title, plannedNote(block));
  return name;
}
