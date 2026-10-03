// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showAnchor } from './cards';
import { FISHAI, showPage } from './page-fixtures';

/** Every scroll into view from now on: which element, and how. */
function watchScrolls(): Array<{ element: unknown; how: unknown }> {
  const scrolls: Array<{ element: unknown; how: unknown }> = [];
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
    this: Element,
    how?: boolean | ScrollIntoViewOptions,
  ) {
    scrolls.push({ element: this, how });
  });
  return scrolls;
}

beforeEach(() => showPage(FISHAI));
afterEach(() => vi.restoreAllMocks());

describe('showAnchor', () => {
  it('brings the part that the fragment names to the top of what scrolls', () => {
    const scrolls = watchScrolls();
    showAnchor('the-bots');
    expect(scrolls).toEqual([
      { element: document.getElementById('the-bots'), how: { block: 'start' } },
    ]);
  });

  it('moves nothing for an id that names no place in the content', () => {
    const scrolls = watchScrolls();
    showAnchor(null);
    showAnchor('main');
    showAnchor('nowhere');
    expect(scrolls).toEqual([]);
  });

  it('leaves the focus on the link that was pressed, and writes nothing in the page', () => {
    watchScrolls();
    const link = document.querySelector<HTMLElement>('#the-bots > a');
    link?.focus();
    const before = document.body.innerHTML;

    showAnchor('the-bots');
    expect(document.activeElement).toBe(link);
    expect(document.body.innerHTML).toBe(before);
  });
});
