/**
 * Light, dark, or whatever the system says: a choice for this device only (it is not synced;
 * a phone and a laptop may well want different ones). Read before the first paint by main.tsx.
 */
export type ThemeChoice = 'auto' | 'day' | 'night';

const KEY = 'journal:theme';

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'day' || value === 'night' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
  if (choice === 'auto') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = choice;
}
