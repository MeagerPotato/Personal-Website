// Where the visitor's ship was, for as long as the tab lives. The URL says which page is open and
// therefore where the ship is docked; it never says where a ship in open sky IS. So a reload, or
// a navigation the router had to hand to the browser, would put the visitor back at the spawn
// point. The shell saves the engine's snapshot when the page goes away and hands it to the next
// engine (universe/api.ts: `start.snapshot`), which checks every field before believing it.
//
// sessionStorage, not localStorage: a new visit starts at the beginning; only THIS visit resumes.

const KEY = 'universe:snapshot';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** `store` is a function because merely touching `sessionStorage` throws where storage is blocked. */
export function rememberSnapshot(store: () => Store, snapshot: unknown): void {
  if (snapshot === null || snapshot === undefined) return;
  try {
    store().setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // storage blocked or full: the next page starts at the spawn point
  }
}

export function recallSnapshot(store: () => Store): unknown {
  try {
    const stored = store().getItem(KEY);
    return stored === null ? undefined : (JSON.parse(stored) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * Save whenever the page may be about to go away. `pagehide` covers reloads and navigations;
 * phones often kill a background tab without it, so going hidden counts too. Returns the stop
 * function.
 */
export function keepSnapshot(
  take: () => unknown,
  store: () => Store,
  doc: Document = document,
): () => void {
  const view = doc.defaultView;
  const save = (): void => rememberSnapshot(store, take());
  const onHidden = (): void => {
    if (doc.visibilityState === 'hidden') save();
  };
  view?.addEventListener('pagehide', save);
  doc.addEventListener('visibilitychange', onHidden);
  return () => {
    view?.removeEventListener('pagehide', save);
    doc.removeEventListener('visibilitychange', onHidden);
  };
}
