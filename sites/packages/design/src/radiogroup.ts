/**
 * Radio groups drawn as buttons (the mood beans, the colour swatches, segmented controls), made
 * to behave like the browser's own radios, as WAI-ARIA's radio group pattern has it: the group is
 * one stop in the tab order, on its checked radio (on its first while none is checked), and the
 * arrow keys move to the next or previous radio and check it, round from the last to the first.
 *
 *   <button role="radio" aria-checked={…} tabIndex={radioTabIndex(index, checked)}
 *           onClick={…} onKeyDown={onRadioKeyDown}>
 */

/** A radio's tabIndex: 0 for the group's one stop, -1 for the rest. `checked` is -1 for none. */
export function radioTabIndex(index: number, checked: number): 0 | -1 {
  return index === Math.max(checked, 0) ? 0 : -1;
}

const STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Where an arrow key goes from the radio at `index` of `count`; null for any other key. */
export function radioStep(key: string, index: number, count: number): number | null {
  const step = STEPS[key];
  if (step === undefined || index < 0 || count < 2) return null;
  return (index + step + count) % count;
}

/** The part of a key press this reads: React's keyboard events and the DOM's both have it. */
export interface RadioKeyEvent {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
}

/**
 * A radio's onKeyDown. An arrow key moves the focus to the radio it names and clicks it, so that
 * each radio's own onClick says what checking it means.
 */
export function onRadioKeyDown(event: RadioKeyEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const radio = event.currentTarget;
  if (!(radio instanceof HTMLElement)) return;
  const group = radio.closest('[role="radiogroup"]');
  const radios = [...(group?.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)') ?? [])];
  const next = radioStep(event.key, radios.indexOf(radio), radios.length);
  const target = next === null ? undefined : radios[next];
  if (!target) return;
  event.preventDefault();
  target.focus();
  // A mood clicked while it is checked is unchecked: an arrow only ever checks.
  if (target.getAttribute('aria-checked') !== 'true') target.click();
}
