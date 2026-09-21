// The micro-router (src/shell/router.ts) in real browsers. Its invariant: a soft navigation is only
// an optimisation of a hard one, so both must end in the same page, and whenever anything looks
// wrong the browser loads the page normally. WebKit is the browser this file is most about:
// docs/PLAN.md §5.1 makes the router's behaviour there the trigger for plan B.

import type { Page } from '@playwright/test';
import {
  collectErrors,
  expect,
  markDocument,
  openUniverse,
  pageContent,
  PAGES,
  plain,
  sameCanvas,
  sameDocument,
  test,
} from './support';

const html = (page: Page) => page.locator('html');
const heading = (page: Page) => page.locator('main h1');
const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name });
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Follow a real link to `path` if the page has one, else one put there for the purpose. */
async function follow(page: Page, path: string): Promise<void> {
  const existing = page.locator(`a[href="${path}"]:visible`).first();
  if ((await existing.count()) > 0) {
    await existing.click();
  } else {
    await page.evaluate((href) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = `e2e: ${href}`;
      document.getElementById('main')?.prepend(link);
    }, path);
    await page.getByRole('link', { name: `e2e: ${path}` }).click();
  }
  await expect.poll(() => pathOf(page)).toBe(path);
}

test('a soft navigation ends in the page a fresh load would have built', async ({
  page,
  context,
}) => {
  test.slow();
  const errors = collectErrors(page);
  await openUniverse(page, '/');
  await markDocument(page);
  const fresh = await context.newPage();

  for (const path of [...PAGES.slice(1), '/']) {
    await follow(page, path);
    // The same URL, loaded the ordinary way, in the mode that has no router at all.
    await fresh.goto(plain(path));
    await expect.poll(() => pageContent(page), `soft ${path}`).toEqual(await pageContent(fresh));
    await expect(html(page)).toHaveAttribute('data-panel', path === '/' ? 'closed' : 'open');
  }

  expect(await sameDocument(page)).toBe(true);
  expect(await sameCanvas(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('a link opens the page in the panel and hands the heading to the keyboard', async ({
  page,
}) => {
  await openUniverse(page, '/');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  await navLink(page, 'About').click();

  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page).toHaveTitle(/About/);
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(heading(page)).toHaveText('About');
  await expect(heading(page)).toBeFocused();
  await expect(navLink(page, 'About')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://allenkh.com/about/',
  );
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  // It once did not: "very short" transitions kept the panel hidden for one more frame, and a
  // heading in a hidden panel cannot take focus (the fix is in the stylesheet's last section).
  test('the heading still takes focus, and the panel is simply there', async ({ page }) => {
    await openUniverse(page, '/');
    await navLink(page, 'About').click();
    await expect(heading(page)).toHaveText('About');
    await expect(heading(page)).toBeFocused();
    await expect(page.locator('.panel')).toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-panel', 'closed');
    await expect(page.getByRole('button', { name: 'About this site' })).toBeFocused();
    await expect(page.locator('.panel')).toBeHidden();
  });
});

test('Back and Forward walk the pages that were seen, in one document', async ({ page }) => {
  await openUniverse(page, '/');
  await markDocument(page);
  await navLink(page, 'About').click();
  await expect(heading(page)).toHaveText('About');
  await navLink(page, 'Projects').click();
  await expect(heading(page)).toHaveText('Projects');

  await page.goBack();
  await expect(heading(page)).toHaveText('About');
  expect(pathOf(page)).toBe('/about/');
  await page.goBack();
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  expect(pathOf(page)).toBe('/');
  await page.goForward();
  await expect(heading(page)).toHaveText('About');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await page.goForward();
  await expect(heading(page)).toHaveText('Projects');
  expect(pathOf(page)).toBe('/projects/');

  expect(await sameDocument(page)).toBe(true);
  expect(await sameCanvas(page)).toBe(true);
});

test('Back returns to where the reader was in a long page', async ({ page }) => {
  await openUniverse(page, '/projects/fishai/');
  // In universe mode the panel scrolls, not the document.
  const scrollTop = () => page.evaluate(() => document.getElementById('main')?.scrollTop ?? -1);
  await page.evaluate(() => document.getElementById('main')?.scrollTo({ top: 480 }));
  await expect.poll(scrollTop).toBe(480);

  await navLink(page, 'Contact').click();
  await expect(heading(page)).toHaveText('Contact');
  expect(await scrollTop()).toBe(0);
  await page.goBack();
  await expect(heading(page)).toHaveText('FishAI');
  await expect.poll(scrollTop).toBe(480);
});

test('closing a page opened from the sky leaves no trail', async ({ page }) => {
  await openUniverse(page, '/');
  await navLink(page, 'Resume').click();
  await expect(heading(page)).toHaveText('Resume');
  const entries = await page.evaluate(() => history.length);

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  expect(pathOf(page)).toBe('/');
  // The text is gone, so focus goes to the button that brings text back.
  await expect(page.getByRole('button', { name: 'About this site' })).toBeFocused();
  // Close was Back: nothing was added, and Forward still leads to the page that was closed.
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.goForward();
  await expect(heading(page)).toHaveText('Resume');
});

test('a deep link opens docked, takes no focus, and Escape leaves for the sky', async ({
  page,
}) => {
  await openUniverse(page, '/projects/fishai/');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(heading(page)).toHaveText('FishAI');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.locator('.dock-prompt')).toContainText('Leave orbit');

  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  expect(pathOf(page)).toBe('/');
  // This visit did not come from the sky, so leaving is a step forward, and Back undoes it.
  await page.goBack();
  await expect(heading(page)).toHaveText('FishAI');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
});

test('of three clicks faster than the network, the last one wins and only it is remembered', async ({
  page,
}) => {
  await openUniverse(page, '/');
  const entries = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    for (const href of ['/about/', '/projects/', '/contact/']) {
      document.querySelector<HTMLAnchorElement>(`.site-nav a[href="${href}"]`)?.click();
    }
  });
  await expect(heading(page)).toHaveText('Contact');
  // An answer to an older click, arriving late, must not take the page over.
  await page.waitForTimeout(1500);
  await expect(heading(page)).toHaveText('Contact');
  expect(pathOf(page)).toBe('/contact/');
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
});

test('the canvas and its WebGL context survive fifty soft navigations', async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await openUniverse(page, '/');
  await markDocument(page);

  const stops = ['About', 'Projects', 'Resume', 'Contact'] as const;
  for (let visit = 0; visit < 50; visit += 1) {
    const name = stops[visit % stops.length] ?? 'About';
    await navLink(page, name).click();
    await expect(heading(page)).toHaveText(name);
    await expect(heading(page)).toBeFocused();
  }

  expect(await sameDocument(page)).toBe(true);
  expect(await sameCanvas(page)).toBe(true);
  const contextLost = await page.evaluate(
    () => document.querySelector('canvas')?.getContext('webgl2')?.isContextLost() ?? true,
  );
  expect(contextLost).toBe(false);
  await expect(html(page)).toHaveAttribute('data-engine', 'ready');
  expect(errors).toEqual([]);
});

test.describe('when a soft navigation cannot be trusted, the browser loads the page', () => {
  test('a deploy happened while the tab was open', async ({ page }) => {
    await page.route('**/about/', async (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /(<meta name="build" content=")[^"]*/,
        '$1the-next-deploy',
      );
      await route.fulfill({ response, body });
    });
    await openUniverse(page, '/');
    await markDocument(page);
    await navLink(page, 'About').click();
    await expect(heading(page)).toHaveText('About');
    expect(pathOf(page)).toBe('/about/');
    expect(await sameDocument(page)).toBe(false);
  });

  test('the network failed', async ({ page }) => {
    let failures = 0;
    await page.route('**/resume/', (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      failures += 1;
      return route.abort('failed');
    });
    await openUniverse(page, '/');
    await markDocument(page);
    await navLink(page, 'Resume').click();
    await expect(heading(page)).toHaveText('Resume');
    expect(pathOf(page)).toBe('/resume/');
    expect(failures).toBeGreaterThan(0);
    expect(await sameDocument(page)).toBe(false);
  });
});

/** The few fields of MouseEventInit these cases need (the whole type does not survive the trip). */
interface ClickInit {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

test('clicks that are not plain clicks on plain links are left to the browser', async ({
  page,
}) => {
  await openUniverse(page, '/contact/');
  // Did the router take the click? Ask from a listener that runs after the router's, which then
  // cancels the click itself so that nothing opens and the page stays for the next case.
  const routerTook = (selector: string, init: ClickInit = {}) =>
    page.evaluate(
      ([target, options]) =>
        new Promise<boolean | string>((resolve) => {
          const link = document.querySelector(target);
          if (!link) return resolve(`no element matches ${target}`);
          window.addEventListener(
            'click',
            (event) => {
              resolve(event.defaultPrevented);
              event.preventDefault();
            },
            { once: true },
          );
          link.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, ...options }),
          );
        }),
      [selector, init] as const,
    );

  expect(await routerTook('.site-nav a[href="/about/"]', { ctrlKey: true })).toBe(false);
  expect(await routerTook('.site-nav a[href="/about/"]', { metaKey: true })).toBe(false);
  expect(await routerTook('.site-nav a[href="/about/"]', { shiftKey: true })).toBe(false);
  expect(await routerTook('.site-nav a[href="/about/"]', { button: 1 })).toBe(false);
  expect(await routerTook('main a[href^="mailto:"]')).toBe(false);
  expect(await routerTook('main a[href^="https://github.com/"]')).toBe(false);
  expect(await routerTook('a.skip-link')).toBe(false);
  expect(await routerTook('a.mode-link--to-plain')).toBe(false);
  // The control: a plain click on a plain link is the router's.
  expect(await routerTook('.site-nav a[href="/about/"]')).toBe(true);
});
