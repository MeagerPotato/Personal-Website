import type GUI from 'lil-gui';

/** A slider needs ends. Three times the starting value either way is room enough to explore. */
function rangeFor(value: number): [min: number, max: number] {
  const span = Math.max(Math.abs(value) * 3, 1);
  return [value < 0 ? -span : 0, span];
}

/**
 * DEV ONLY. A control for everything in `target`, a block of design/tuning.ts: sliders for
 * numbers (and for the numbers inside arrays), checkboxes for booleans, closed folders for nested
 * blocks. Writes straight into `target`, then calls `onChange`.
 */
export function addControls(
  folder: GUI,
  target: Record<string, unknown>,
  onChange: () => void,
): void {
  for (const [key, value] of Object.entries(target)) {
    if (typeof value === 'number') {
      folder.add(target, key, ...rangeFor(value)).onChange(onChange);
    } else if (typeof value === 'boolean') {
      folder.add(target, key).onChange(onChange);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item !== 'number') return;
        folder
          .add(value as unknown as Record<string, number>, String(index), ...rangeFor(item))
          .name(`${key}[${index}]`)
          .onChange(onChange);
      });
    } else if (value !== null && typeof value === 'object') {
      const child = folder.addFolder(key);
      child.close();
      addControls(child, value as Record<string, unknown>, onChange);
    }
  }
}

/** Log `text` and put it on the clipboard, ready to paste into design/tuning.ts. */
export function copyText(text: string): void {
  console.info(text);
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}
