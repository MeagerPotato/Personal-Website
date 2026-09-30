// Shared by every end-to-end test: the fixtures, the list of pages, and a few ways of asking the
// page what state it is in. The shell writes all of its state on <html> as data attributes
// (src/shell/mode.inline.js, universe-shell.ts, panel.ts), so that is what the tests read.

import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** Every page that exists in both modes. The 404 is plain only and has tests of its own. */
export const PAGES = [
  '/',
  '/about/',
  '/projects/',
  '/projects/fishai/',
  '/projects/canadian-fish-demo/',
  '/projects/fish-onboarding/',
  '/projects/days2meet/',
  // Built work without a cover (its planet stands in), and planned work (a one-line page).
  '/projects/cyberpatriot/',
  '/projects/fish-online/',
  '/projects/sports-analysis/',
  // A hackathon with a repository and a stack (and no cover).
  '/projects/hackgt-13/',
  // An event with a lane to the team that runs it: its related card carries the longest title.
  '/projects/cal-hacks-13/',
  // The two suns of the Projects binary: the binary's own page is /projects/.
  '/systems/software/',
  '/systems/hardware/',
  // Two systems of one sun: one whose work is all planned, and one with four planets.
  '/systems/research/',
  '/systems/hackathons/',
  '/resume/',
  '/contact/',
] as const;

export interface Options {
  /**
   * A first-time visitor gets the "how to fly" card, which sits over a corner of the sky. Tests
   * that are not about the card start as a visitor who has seen it.
   */
  seenHints: boolean;
}

export const test = base.extend<Options>({
  seenHints: [true, { option: true }],
  context: async ({ context, seenHints }, use) => {
    if (seenHints) {
      await context.addInitScript(() => {
        try {
          localStorage.setItem('hints', 'seen');
        } catch {
          // No storage in this page (about:blank): nothing to remember.
        }
      });
    }
    await use(context);
  },
});

export { expect };

/**
 * `?universe` chooses the mode whatever the device prefers, and `q=low` asks for the cheapest
 * renderer: these tests are about behaviour, and a CI machine draws every pixel on its CPU.
 */
export const universe = (path: string): string => `${path}?universe&q=low`;
export const plain = (path: string): string => `${path}?plain`;

/** Load a page in universe mode and wait until the 3D world has drawn its first frame. */
export async function openUniverse(page: Page, path: string): Promise<void> {
  await page.goto(universe(path));
  await engineReady(page);
}

export async function engineReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 45_000 });
}

/** The name over a body: a real button, in the group that says what pressing one does. */
export const nameOf = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Fly to' }).getByRole('button', { name, exact: true });

/**
 * What planned work is called, by a name over it and by the prompt: its title and a note that
 * says so ("Fish Online, Planned"), so that nobody flies there expecting finished work.
 */
export const plannedName = (title: string): string => `${title}, Planned`;

/**
 * Click or tap where the thing IS, the way a hand does. A name follows a body that is moving, so
 * it never holds still for Playwright's own click, which waits for that; and a real pointer also
 * proves that nothing lies on top of it.
 */
export async function pointAt(page: Page, target: Locator, touch: boolean, dy = 0): Promise<void> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to point at');
  const x = box.x + box.width / 2;
  const y = dy === 0 ? box.y + box.height / 2 : box.y + dy;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Wait until a name shows and has stopped moving (to within a pixel between two looks, with a
 * frame of the engine between them). Both conditions matter where frames are slow (WebKit on CI
 * draws in software, a few frames a second): two looks a quarter of a second apart can see the
 * same frame, and a name that the map hides on its way out is no longer moved (ui/Labels.ts), so
 * it holds still where it was hidden, and a click there finds only sky.
 *
 * Only for a body that holds still once the view does: a sun, or the home planet at the heart of
 * its system. (The two suns of Projects circle their centre, but at 0.4 u/s at most: on a map
 * that fits the galaxy, a pixel every few seconds.) A planet is always on its way round its sun:
 * settle the view on the sun, then ask where the planet is, once its name shows
 * (world.spec.ts, the flight to planned work).
 */
export async function settled(target: Locator): Promise<{ x: number; y: number }> {
  const page = target.page();
  let last = { x: Number.NaN, y: Number.NaN };
  await expect
    .poll(
      async () => {
        // The engine draws on animation frames: after two, it has drawn since the last look.
        await page.evaluate(
          () =>
            new Promise<void>((done) => {
              requestAnimationFrame(() => requestAnimationFrame(() => done()));
            }),
        );
        const shows = await target.evaluate((name) => name.hasAttribute('data-shown'));
        const box = shows ? await target.boundingBox() : null;
        const now = { x: box?.x ?? Number.NaN, y: box?.y ?? Number.NaN };
        const moved = Math.hypot(now.x - last.x, now.y - last.y);
        last = now;
        return moved;
      },
      { intervals: [250], timeout: 30_000 },
    )
    .toBeLessThan(1);
  return last;
}

/**
 * Go to another page the way a link does, without needing one on screen: the router takes any
 * plain click on a same-site link. One booted engine can then visit every page.
 */
export async function softNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((href) => {
    const link = document.createElement('a');
    link.href = href;
    document.body.append(link);
    link.click();
    link.remove();
  }, path);
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  if (path !== '/') await expect(page.locator('main h1')).toBeFocused();
}

/**
 * Leave a mark on the document that only a full page load can remove, and one on the canvas.
 * While both are there, nothing the engine has built was ever thrown away.
 */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { e2eMark?: number }).e2eMark = 1;
    document.querySelector('canvas')?.setAttribute('data-e2e-canvas', 'first');
  });
}

export function sameDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as Window & { e2eMark?: number }).e2eMark === 1);
}

export function sameCanvas(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.querySelector('canvas')?.getAttribute('data-e2e-canvas') === 'first',
  );
}

/** One thing said, and the path the page was at when it was said. */
export interface Said {
  text: string;
  path: string;
}

/**
 * Everything the element at `selector` says from now on, with the path at the time. A journey
 * between neighbours is over in two or three seconds, and a machine drawing on its CPU may not
 * look while it lasts: ask what WAS said instead of racing the ship.
 */
export async function watchText(page: Page, selector: string): Promise<() => Promise<Said[]>> {
  const key = `e2eSaid:${selector}`;
  await page.evaluate(
    ({ selector, key }) => {
      const said: { text: string; path: string }[] = [];
      (window as unknown as Record<string, unknown>)[key] = said;
      const target = document.querySelector(selector);
      if (!target) return;
      const note = (): void => {
        const text = target.textContent ?? '';
        if (said.at(-1)?.text !== text) said.push({ text, path: location.pathname });
      };
      note();
      new MutationObserver(note).observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    },
    { selector, key },
  );
  return () =>
    page.evaluate((key) => (window as unknown as Record<string, Said[]>)[key] ?? [], key);
}

/** What the visitor can see of a page, as the router is allowed to change it (swap.ts). */
export function pageContent(page: Page): Promise<{
  title: string;
  head: string;
  main: string;
  nav: string;
}> {
  return page.evaluate(() => ({
    title: document.title,
    // The per-page part of the head; the rest is the same on every page, by the build's word.
    head: [...document.head.querySelectorAll('[data-page-head]')]
      .map((node) => node.outerHTML)
      .join('\n'),
    main: document.getElementById('main')?.innerHTML ?? '',
    nav: document.querySelector('.site-nav')?.innerHTML ?? '',
  }));
}

/** Console errors and uncaught exceptions, collected from now on. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}
