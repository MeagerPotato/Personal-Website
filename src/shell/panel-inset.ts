// How much of the viewport the info panel covers, so that the engine can put what matters in the
// middle of what is LEFT (universe/camera/CameraRig.ts). The panel is a column on the right on
// wide screens and a sheet rising from the bottom on narrow ones (src/styles/global.css).

export interface PanelInset {
  /** CSS pixels covered, measured from the right edge and from the bottom edge. */
  right: number;
  bottom: number;
}

/** The same breakpoint as the stylesheet's bottom sheet. */
const NARROW = '(max-width: 47.99rem)';

export interface PanelBox {
  /** Layout position and size, which a slide-in transform does not change. */
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

/** Pure: the inset for a panel box in a viewport. */
export function panelInset(
  panel: PanelBox,
  open: boolean,
  narrow: boolean,
  viewport: { width: number; height: number },
): PanelInset {
  if (!open || panel.offsetWidth === 0 || panel.offsetHeight === 0) return { right: 0, bottom: 0 };
  return narrow
    ? { right: 0, bottom: Math.max(0, viewport.height - panel.offsetTop) }
    : { right: Math.max(0, viewport.width - panel.offsetLeft), bottom: 0 };
}

/**
 * The same inset for the stylesheet, as two custom properties on <html>: the engine's own DOM (the
 * dock prompt) keeps to the free part of the viewport too, or a bottom sheet would cover it.
 * `null` takes them away again.
 */
export function mirrorInset(
  root: { style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'> },
  inset: PanelInset | null,
): void {
  for (const side of ['right', 'bottom'] as const) {
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
  const view = doc.defaultView;
  if (!panel || !view) return () => undefined;

  const root = doc.documentElement;
  const narrow = view.matchMedia(NARROW);
  let last: PanelInset | null = null;

  const report = (): void => {
    const inset = panelInset(panel, root.dataset.panel === 'open', narrow.matches, {
      width: view.innerWidth,
      height: view.innerHeight,
    });
    if (last && last.right === inset.right && last.bottom === inset.bottom) return;
    const first = last === null;
    last = inset;
    onChange(inset, first);
  };

  const attributes = new MutationObserver(report);
  attributes.observe(root, { attributes: true, attributeFilter: ['data-panel'] });
  const size = new ResizeObserver(report);
  size.observe(panel);
  view.addEventListener('resize', report);
  report();

  return () => {
    attributes.disconnect();
    size.disconnect();
    view.removeEventListener('resize', report);
  };
}
