import type { ScreenBox } from '../sim/declutter';

/**
 * Where an element is on the page right now (CSS px), written into `out`; null if it is not
 * displayed. READS LAYOUT: call it where layout is clean (early in a frame), and for few elements.
 */
export function boxOf(element: Element, out: ScreenBox): ScreenBox | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  out.left = rect.left;
  out.top = rect.top;
  out.width = rect.width;
  out.height = rect.height;
  return out;
}
