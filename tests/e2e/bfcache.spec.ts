// The back/forward cache: follow a link away (to GitHub, say), press Back, and the site must be
// there at once, in the same mode, with the world still moving. Nothing is reloaded, so nothing
// the engine built is thrown away: the same document and the same canvas come back.
//
// Playwright turns this cache off in Chromium (`--disable-back-forward-cache`), so this file
// turns it back on. WebKit's page cache is not driven by that switch: whether it restores there
// is reported, not required (a real iPhone is the launch checklist's, §3).

import type { Page } from '@playwright/test';
import {
  engineReady,
  expect,
  markDocument,
  plain,
  sameCanvas,
  sameDocument,
  test,
  universe,
} from './support';

// Chromium's headless SHELL (Playwright's default) never caches a page; the full browser in its
// new headless mode (channel 'chromium') does, once the switch is off.
test.use({
  launchOptions: [
    async ({ browserName }, use) => {
      await use(
        browserName === 'chromium'
          ? { channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] }
          : {},
      );
    },
    { scope: 'worker' },
  ],
});

/** Counts the times this document is shown again from the cache. */
async function countRestores(page: Page): Promise<void> {
  await page.addInitScript(() => {
    addEventListener('pageshow', (event) => {
      if (event.persisted) {
        const w = window as Window & { e2eRestored?: number };
        w.e2eRestored = (w.e2eRestored ?? 0) + 1;
      }
    });
  });
}

const restores = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Window & { e2eRestored?: number }).e2eRestored ?? 0);

/**
 * Away by a full load, then Back. A restore fires no load event. (Away to a blank page, the
 * nearest thing to another site here: a page of this site with ?plain would change the mode
 * the visitor chose, and a page restored after that rightly reloads in the new mode.)
 */
async function awayAndBack(page: Page, away: string): Promise<void> {
  await page.goto(away);
  await page.goBack({ waitUntil: 'commit' });
}

test('Back after leaving the site restores the page in plain mode, still plain', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit under Playwright: reported by the universe test');
  await countRestores(page);
  await page.goto(plain('/about/'));
  await markDocument(page);
  await awayAndBack(page, 'about:blank');

  await expect.poll(() => restores(page)).toBe(1);
  expect(await sameDocument(page)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
  await expect(page.locator('main h1')).toHaveText('About');
});

test('Back after leaving the site restores the world as it was, and it is still moving', async ({
  page,
  browserName,
}) => {
  await countRestores(page);
  await page.goto(universe('/about/'));
  await engineReady(page);
  await markDocument(page);
  await awayAndBack(page, 'about:blank');

  if (browserName === 'webkit') {
    // Reported, not required: see the header.
    const restored = await expect
      .poll(() => restores(page), { timeout: 5_000 })
      .toBe(1)
      .then(
        () => true,
        () => false,
      );
    test.info().annotations.push({ type: 'webkit page cache', description: String(restored) });
    return;
  }

  await expect.poll(() => restores(page)).toBe(1);
  expect(await sameDocument(page)).toBe(true);
  expect(await sameCanvas(page)).toBe(true);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-mode', 'universe');
  await expect(html).toHaveAttribute('data-engine', 'ready');

  // Still drawing: the picture changes (the orbit camera drifts round the home planet).
  const canvas = page.locator('#universe-host canvas');
  const first = await canvas.screenshot();
  await expect
    .poll(async () => Buffer.compare(first, await canvas.screenshot()) !== 0, { timeout: 10_000 })
    .toBe(true);
});
