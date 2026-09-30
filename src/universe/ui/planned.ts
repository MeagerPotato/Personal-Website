/**
 * "Planned" after the name of planned work, wherever the engine names a body (its label, the dock
 * prompt): seen as a small note after the name, heard as part of it. The ", " before the note is
 * for a screen reader only (`<block>__sep`, hidden by CSS), so the name it reads is "Sports
 * Analysis, Planned", and the note is `<block>__note`. The web layer says the same in its own
 * words (shell/destinations.ts, for the announcer): it cannot import the engine.
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
