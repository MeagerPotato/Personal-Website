// The info panel. In universe mode the page's content sits in a panel over the 3D world
// (src/styles/global.css, section 2), and this file decides whether the panel shows.
//
// THE RULE: the panel's state is a function of the URL. Every page except the home page is a
// destination, and a destination's panel is open: closing it means LEAVING (the router goes
// home), so there is no such thing as a project URL with a hidden panel, and Back always does
// what it looks like it should. The home page is the open sky: its welcome text waits behind a
// button in the HUD, and that one toggle is the only state that is not in the URL.
//
// All state goes on <html> as data attributes, so CSS does the showing and a test can read it:
//   data-panel       "open" | "closed"
//   data-panel-home  present on the home page (the HUD shows the welcome button)
//   data-panel-size  "half" | "full"   (bottom sheet on narrow screens; kept for the session)

export type PanelState = 'open' | 'closed';

export interface PanelOptions {
  /** Pathname of the home page. */
  homePath: string;
  /** The visitor closed a destination's panel: go home (the router decides how). */
  onLeave(): void;
}

export interface Panel {
  readonly state: PanelState;
  /** Call once at the start and after every navigation. */
  sync(pathname: string): void;
  dispose(): void;
}

const SIZE_KEY = 'panel:size';

/** Pure: what the panel should be for a URL. `welcomeOpen` only matters on the home page. */
export function panelStateFor(
  pathname: string,
  homePath: string,
  welcomeOpen: boolean,
): PanelState {
  return pathname === homePath && !welcomeOpen ? 'closed' : 'open';
}

function readSize(): 'half' | 'full' {
  try {
    return sessionStorage.getItem(SIZE_KEY) === 'full' ? 'full' : 'half';
  } catch {
    return 'half';
  }
}

export function startPanel(options: PanelOptions, doc: Document = document): Panel {
  const root = doc.documentElement;
  const main = doc.getElementById('main');
  const toggle = doc.querySelector<HTMLElement>('[data-panel-toggle]');
  const close = doc.querySelector<HTMLElement>('[data-panel-close]');
  const size = doc.querySelector<HTMLElement>('[data-panel-resize]');
  const skipLink = doc.querySelector<HTMLElement>('.skip-link');

  let pathname = doc.location.pathname;
  let welcomeOpen = false;
  let state: PanelState = 'open';

  const isHome = (): boolean => pathname === options.homePath;

  function render(): void {
    state = panelStateFor(pathname, options.homePath, welcomeOpen);
    root.dataset.panel = state;
    if (isHome()) root.dataset.panelHome = '';
    else delete root.dataset.panelHome;
    toggle?.setAttribute('aria-expanded', String(state === 'open'));
  }

  function renderSize(value: 'half' | 'full'): void {
    root.dataset.panelSize = value;
    if (!size) return;
    // An action, named for what it does next, like the Map button's "Close map": not a toggle
    // with a pressed state, whose name would then have to stay the same. (The stylesheet gives
    // it the cream face of "on" from data-panel-size.)
    size.textContent = value === 'full' ? 'Shrink' : 'Expand';
  }

  function setWelcome(open: boolean, moveFocus: boolean): void {
    welcomeOpen = open;
    render();
    if (!moveFocus) return;
    // Opening: read from the top. Closing: back to the button that opened it.
    if (open) main?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    else toggle?.focus({ preventScroll: true });
  }

  function leave(): void {
    if (isHome()) setWelcome(false, true);
    else options.onLeave();
  }

  const onToggle = (): void => setWelcome(!welcomeOpen, true);
  const onSize = (): void => {
    const next = root.dataset.panelSize === 'full' ? 'half' : 'full';
    renderSize(next);
    try {
      sessionStorage.setItem(SIZE_KEY, next);
    } catch {
      // Private mode: the choice lasts until the next page load.
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || state !== 'open' || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    // Escape inside a field or a widget belongs to that widget.
    if (target?.closest('input, textarea, select, [contenteditable], dialog, [role="dialog"]'))
      return;
    leave();
  };
  // "Skip to content" must never jump into a panel that is not there.
  const onSkip = (): void => {
    if (state === 'closed') setWelcome(true, false);
  };

  toggle?.addEventListener('click', onToggle);
  close?.addEventListener('click', leave);
  size?.addEventListener('click', onSize);
  skipLink?.addEventListener('click', onSkip);
  doc.addEventListener('keydown', onKeyDown);

  renderSize(readSize());
  render();

  return {
    get state() {
      return state;
    },
    sync(next) {
      // Arriving anywhere starts from that page's own default: the welcome toggle does not
      // follow the visitor around.
      if (next !== pathname) welcomeOpen = false;
      pathname = next;
      render();
      // Arriving home closes the panel, and whatever had focus (the Close button, a link in the
      // text) has just become invisible. Hand focus to the control that brings the text back.
      const focused = doc.activeElement;
      const lost = !focused || focused === doc.body || focused.closest('.panel') !== null;
      if (state === 'closed' && lost) toggle?.focus({ preventScroll: true });
    },
    dispose() {
      toggle?.removeEventListener('click', onToggle);
      close?.removeEventListener('click', leave);
      size?.removeEventListener('click', onSize);
      skipLink?.removeEventListener('click', onSkip);
      doc.removeEventListener('keydown', onKeyDown);
      delete root.dataset.panel;
      delete root.dataset.panelHome;
      delete root.dataset.panelSize;
    },
  };
}
