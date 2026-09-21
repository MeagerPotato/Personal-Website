// One URL, two modes (AGENTS.md, invariants 1 and 2): which mode a visitor gets, what plain mode
// is never made to download, and what happens when the 3D world cannot start.

import {
  engineReady,
  expect,
  markDocument,
  openUniverse,
  plain,
  sameDocument,
  test,
  universe,
} from './support';

const mainNav = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Main' });

test.describe('plain mode', () => {
  test('never asks for the engine, the galaxy or a second script', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));

    await page.goto(plain('/projects/fishai/'));
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
    await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'query');

    // boot.ts and nothing else: it looks at the mode and stops.
    expect(requested.filter((path) => path.endsWith('.js')).length).toBeLessThanOrEqual(1);
    expect(requested).not.toContain('/universe.json');
    await expect(page.locator('canvas')).toHaveCount(0);

    // For contrast, the same page in universe mode: that is what plain mode was spared.
    requested.length = 0;
    await openUniverse(page, '/projects/fishai/');
    expect(requested.filter((path) => path.endsWith('.js')).length).toBeGreaterThanOrEqual(3);
    expect(requested).toContain('/universe.json');
  });

  test('lasts for the visit once chosen, and one link brings the world back', async ({ page }) => {
    await page.goto(plain('/'));
    await mainNav(page).getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
    await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'session');

    await page.getByRole('link', { name: 'Launch the starfield', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'universe');
    await engineReady(page);
    // ...and that choice is remembered: a bare URL is the universe from now on.
    await page.goto('/contact/');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'universe');
    await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'saved');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('every word is still there', async ({ page }) => {
      await page.goto('/projects/fishai/');
      await expect(page.locator('html')).not.toHaveAttribute('data-mode', /.*/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(mainNav(page).getByRole('link', { name: 'Projects' })).toBeVisible();
      expect((await page.locator('main').innerText()).length).toBeGreaterThan(1000);
    });
  });

  test.describe('for a visitor who asks for reduced motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('is the default, with an invitation that works', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
      await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'reduced-motion');
      await expect(page.getByText('Your device asks for reduced motion')).toBeVisible();

      await page.getByRole('link', { name: 'Launch the starfield anyway' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-mode', 'universe');
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
      await engineReady(page);
    });
  });
});

test.describe('the 404 page', () => {
  test('is a real 404, and plain whatever the visitor prefers', async ({ page }) => {
    await page.goto(universe('/')); // remembers "universe"
    const response = await page.goto('/nope/');
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
    await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('is reached by a normal page load from inside the universe', async ({ page }) => {
    await openUniverse(page, '/about/');
    await markDocument(page);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/nope/';
      link.textContent = 'A link that leads nowhere';
      document.getElementById('main')?.prepend(link);
    });
    await page.getByRole('link', { name: 'A link that leads nowhere' }).click();
    await expect(page).toHaveURL(/\/nope\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'page');
    expect(await sameDocument(page)).toBe(false);
  });
});

test.describe('when the 3D world cannot start', () => {
  test('the page turns plain, says so, and loses nothing', async ({ page }) => {
    // A browser that has WebGL2 on paper and gives no context: the mode script cannot know.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type.includes('webgl')) return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });

    await page.goto(universe('/about/'));
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
    await expect(page.locator('html')).toHaveAttribute('data-mode-reason', 'engine-failed');
    await expect(page.getByText('The 3D view could not start on this device')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);

    // With no canvas to protect, links are links again.
    await markDocument(page);
    await mainNav(page).getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/\/contact\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await sameDocument(page)).toBe(false);
  });
});
