import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusNextTitle, titleLeaving, titleShown } from './focus.ts';

/**
 * Just enough of a page for focus.ts: a document that knows which element has the focus, a
 * screen (<main>) with elements in it, and a link outside it, in the app's sidebar.
 */
function page() {
  const body = {};
  const document: { body: object; activeElement: object | null } = { body, activeElement: body };
  const inScreen = new Set<object>();
  const main = { contains: (node: object) => inScreen.has(node) };
  const element = () => {
    const made = {
      ownerDocument: document,
      closest: (selector: string) => (selector === 'main' ? main : null),
      focus: vi.fn(() => {
        document.activeElement = made;
      }),
    };
    inScreen.add(made);
    return made;
  };
  return { document, element, sidebarLink: {} };
}

const asTitle = (fake: object) => fake as unknown as HTMLElement;

beforeEach(() => {
  // Spend any request a test left behind: the module keeps one between calls, as in an app.
  titleShown(asTitle(page().element()));
});

describe('the focus after a change of screen', () => {
  it('goes to the next title drawn, once, when asked', () => {
    const { element } = page();
    const first = element();
    const second = element();
    titleShown(asTitle(first));
    expect(first.focus).not.toHaveBeenCalled();

    focusNextTitle();
    titleShown(asTitle(first));
    expect(first.focus).toHaveBeenCalledWith({ preventScroll: true });
    titleShown(asTitle(second));
    expect(second.focus).not.toHaveBeenCalled();
  });

  it('leaves the link just followed, outside the screen', () => {
    const { document, element, sidebarLink } = page();
    const title = element();
    document.activeElement = sidebarLink;
    focusNextTitle();
    titleShown(asTitle(title));
    expect(document.activeElement).toBe(title);
  });

  it('stays where the new screen put it itself, and the request is spent', () => {
    const { document, element } = page();
    const field = element();
    const title = element();
    const later = element();
    document.activeElement = field;
    focusNextTitle();
    titleShown(asTitle(title));
    expect(title.focus).not.toHaveBeenCalled();
    titleShown(asTitle(later));
    expect(later.focus).not.toHaveBeenCalled();
  });

  it('passes from a title replaced while it has it to the one that replaces it', () => {
    const { document, element } = page();
    const loading = element();
    const loaded = element();
    focusNextTitle();
    titleShown(asTitle(loading));
    titleLeaving(asTitle(loading));
    // The old title is gone from the document by now, and the browser has put the focus on the
    // body; the new one takes it.
    document.activeElement = document.body;
    titleShown(asTitle(loaded));
    expect(document.activeElement).toBe(loaded);
  });

  it('is not asked for by a title that leaves without it', () => {
    const { element } = page();
    const leaving = element();
    const next = element();
    titleLeaving(asTitle(leaving));
    titleShown(asTitle(next));
    expect(next.focus).not.toHaveBeenCalled();
  });
});

// Only a <Title> (each app's ui/common.tsx) takes the focus: a screen that drew a bare <h1> would
// leave it behind, on something that has gone.
describe.each(['journal/src', 'blog/src/studio'])('the screens in %s', (app) => {
  const root = new URL(`../../../${app}/`, import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.tsx') && name !== 'ui/common.tsx');

  it('are found', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s draws its title as a <Title>', (name) => {
    expect(readFileSync(new URL(name, root), 'utf8')).not.toMatch(/<h1[\s>]/);
  });
});
