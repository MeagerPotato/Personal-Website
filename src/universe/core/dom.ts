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

// What the engine's own pictures are made with (ui/FlightDeck.ts, ui/MiniMap.ts): elements that
// carry a class and data attributes and nothing else, since every colour is the stylesheet's.

const SVG = 'http://www.w3.org/2000/svg';

/** A new HTML element with this class (or none), as the last child of `parent`. */
export function html(
  tag: 'span' | 'b' | 'small' | 'i',
  className: string,
  parent: Element,
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.append(node);
  return node;
}

/** A new SVG element with this class (or none), as the last child of `parent`. */
export function svg(tag: string, className: string, parent: Element): SVGElement {
  const node = document.createElementNS(SVG, tag);
  if (className) node.setAttribute('class', className);
  parent.append(node);
  return node;
}

/** Set or take away an attribute that only says yes or no, and only if that changes anything. */
export function flag(node: Element, name: string, on: boolean): void {
  if (node.hasAttribute(name) !== on) node.toggleAttribute(name, on);
}

/** Write an attribute, unless it says exactly that already: a picture at rest writes nothing. */
export function put(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
