// How much of the viewport the page's chrome covers, so that the engine can put what matters in
// the middle of what is LEFT (universe/camera/CameraRig.ts). The info panel is a column on the
// right on wide screens and a sheet rising from the bottom on a phone held upright
// (src/styles/global.css); the top bar is a row of chips over the sky, except on that same phone,
// where it is two rows of solid plates with the HUD's own row (the Map button, the dock prompt)
// hanging under it.

export interface PanelInset {
  /** CSS pixels covered, measured from the right edge and from the bottom edge. */
  right: number;
  bottom: number;
  /**
   * How far down the LINKS of the top bar reach. The engine's names over the planets must not lie
   * on them (on a phone the bar is two rows tall), nor may the star map.
   */
  top: number;
  /**
   * How much of the top is covered for the CAMERA, as the panel covers the bottom: on a phone
   * with the sheet up, the bar (a full-width tray, 90 % opaque) and the row under it, so that the
   * body the ship orbits is framed in the strip between that row and the sheet. 0 everywhere
   * else, where the bar is a few chips over a tall view. (The camera leaves it out only while it
   * frames a body: universe/camera/CameraRig.ts, `avoidsTop`.)
   */
  frameTop: number;
  /**
   * Where the footer's chip (the way out to the plain version) sits over the bottom-left corner
   * of the sky: from the left edge to `right`, from `top` down. The names keep off it, as they
   * keep off the engine's own controls. Absent while nothing of the footer shows.
   */
  foot?: { right: number; top: number };
}

/**
 * The same query as the stylesheet's bottom sheet: narrow, and tall enough to share. A phone
 * held sideways has no height to split, so it gets the side panel and a one-row bar instead.
 */
const NARROW = '(max-width: 47.99rem) and (min-height: 30.01rem)';

/**
 * The HUD's row under the bar, in rem: a gap of --space-3, then a 44 px chip (global.css,
 * .map-toggle, and the phone's .dock-prompt beside it). panel-inset.test.ts reads the stylesheet
 * and holds the two together.
 */
export const HUD_ROW_REM = 0.75 + 2.75;

export interface PanelBox {
  /** Layout position and size, which a slide-in transform does not change. */
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

/**
 * Pure: the inset for a panel box in a viewport, under a top bar whose links reach down to `top`.
 * `cover` is how far down the top is solid in the sheet layout (the bar and the row under it);
 * the camera leaves it out only while the sheet is up.
 */
export function panelInset(
  panel: PanelBox,
  open: boolean,
  narrow: boolean,
  viewport: { width: number; height: number },
  top = 0,
  cover = 0,
): PanelInset {
  if (!open || panel.offsetWidth === 0 || panel.offsetHeight === 0) {
    return { top, right: 0, bottom: 0, frameTop: 0 };
  }
  return narrow
    ? {
        top,
        right: 0,
        bottom: Math.max(0, viewport.height - panel.offsetTop),
        frameTop: Math.max(0, cover),
      }
    : { top, right: Math.max(0, viewport.width - panel.offsetLeft), bottom: 0, frameTop: 0 };
}

/**
 * Pure: the lowest edge of whatever can be pressed in the top bar. Not the bar's own box: that
 * ends in padding, a soft edge that a name may well sit on. Hidden controls have no size.
 */
export function barReach(
  controls: Iterable<{ getBoundingClientRect(): { width: number; bottom: number } }>,
): number {
  let reach = 0;
  for (const control of controls) {
    const { width, bottom } = control.getBoundingClientRect();
    if (width > 0) reach = Math.max(reach, bottom);
  }
  return Math.round(reach);
}

/**
 * Pure: the corner that the footer's visible controls take, from the left edge. Like barReach, by
 * what can be pressed, and hidden controls have no size. Undefined if nothing shows.
 */
export function footReach(
  controls: Iterable<{
    getBoundingClientRect(): { width: number; top: number; right: number };
  }>,
): { right: number; top: number } | undefined {
  let foot: { right: number; top: number } | undefined;
  for (const control of controls) {
    const { width, top, right } = control.getBoundingClientRect();
    if (width === 0) continue;
    foot = {
      right: Math.max(foot?.right ?? 0, Math.round(right)),
      top: Math.min(foot?.top ?? Infinity, Math.round(top)),
    };
  }
  return foot;
}

/**
 * The same inset for the stylesheet, as custom properties on <html>: the engine's own DOM keeps to
 * the free part of the viewport too (or a bottom sheet would cover the dock prompt), and below the
 * links of the top bar (the Map button sits right under them). `null` takes them away again.
 */
export function mirrorInset(
  root: { style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'> },
  inset: PanelInset | null,
): void {
  for (const side of ['top', 'right', 'bottom'] as const) {
    const name = `--panel-inset-${side}`;
    if (inset) root.style.setProperty(name, `${inset[side]}px`);
    else root.style.removeProperty(name);
  }
}

/**
 * Report the inset now and whenever it changes: the panel opens or closes (`data-panel` on
 * <html>), the sheet is expanded, the window is resized. `first` is true for the very first
 * report, which the camera should cut to rather than slide to. Returns the stop function.
 */
export function watchPanelInset(
  onChange: (inset: PanelInset, first: boolean) => void,
  doc: Document = document,
): () => void {
  const panel = doc.querySelector<HTMLElement>('.panel');
  const bar = doc.querySelector<HTMLElement>('.masthead');
  const controls = bar ? [...bar.querySelectorAll<HTMLElement>('a, button')] : [];
  const footer = doc.querySelector<HTMLElement>('.footer');
  const footControls = footer ? [...footer.querySelectorAll<HTMLElement>('a, button')] : [];
  const view = doc.defaultView;
  if (!panel || !view) return () => undefined;

  const root = doc.documentElement;
  const narrow = view.matchMedia(NARROW);
  let last: PanelInset | null = null;

  const report = (): void => {
    const reach = barReach(controls);
    const rem = Number.parseFloat(view.getComputedStyle(root).fontSize) || 16;
    const cover = Math.round(reach + HUD_ROW_REM * rem);
    const inset = panelInset(
      panel,
      root.dataset.panel === 'open',
      narrow.matches,
      { width: view.innerWidth, height: view.innerHeight },
      reach,
      cover,
    );
    const foot = footReach(footControls);
    if (foot) inset.foot = foot;
    if (
      last &&
      last.right === inset.right &&
      last.bottom === inset.bottom &&
      last.top === inset.top &&
      last.frameTop === inset.frameTop &&
      last.foot?.right === foot?.right &&
      last.foot?.top === foot?.top
    )
      return;
    const first = last === null;
    last = inset;
    onChange(inset, first);
  };

  const attributes = new MutationObserver(report);
  attributes.observe(root, { attributes: true, attributeFilter: ['data-panel'] });
  const size = new ResizeObserver(report);
  size.observe(panel);
  // The bar is taller where its links wrap under the wordmark, and on the page with the button.
  if (bar) size.observe(bar);
  if (footer) size.observe(footer);
  view.addEventListener('resize', report);
  report();

  return () => {
    attributes.disconnect();
    size.disconnect();
    view.removeEventListener('resize', report);
  };
}
