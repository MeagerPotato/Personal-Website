// The back/forward cache: follow a link away (to GitHub, say), press Back, and the site must be
// there at once, in the same mode, with the world still moving. Nothing is reloaded, so nothing
// the engine built is thrown away: the same document and the same canvas come back.
//
// Playwright turns this cache off in Chromium (`--disable-back-forward-cache`), so this file
// turns it back on. WebKit's page cache is not driven by that switch: whether it restores there
// is reported, not required (a real iPhone is the launch checklist's, §3).
//
// On a busy machine (a dozen browsers starting at once, at the top of a local run) Chromium
// sometimes starts a restore, cancels its own navigation and loads the page afresh, visit after
// visit, until the machine calms down. It says so and says nothing else: the only reason it
// gives is `navigation-canceled` ("cancelled after js eviction was disabled", in Chromium's
// words), which is about the machine, not the page. So the visit is made again, at growing
// intervals, until Chromium finishes one. Any other reason (an unload listener, `no-store`, a
// request left open, …) is the page's own doing and fails the test at once.

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

// Room for a minute of visits that Chromium cancels (see the header), on top of the test itself.
test.describe.configure({ timeout: 150_000 });

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
 * What became of the visit: 'restored', 'pending', or, for a page that was loaded afresh, the
 * reasons the browser gives (Chromium's `notRestoredReasons`; none in WebKit).
 */
const outcome = (page: Page): Promise<string> =>
  page
    .evaluate(() => {
      if (((window as Window & { e2eRestored?: number }).e2eRestored ?? 0) > 0) return 'restored';
      const entry = performance.getEntriesByType('navigation')[0] as
        | (PerformanceEntry & {
            type?: string;
            notRestoredReasons?: { reasons?: { reason: string }[] } | null;
          })
        | undefined;
      if (entry?.type !== 'back_forward') return 'pending';
      return (entry.notRestoredReasons?.reasons ?? []).map((r) => r.reason).join(' ') || 'none';
    })
    // The document may change under the question; ask again.
    .catch(() => 'pending');

/** Leave by a full load, then Back. A restore fires no load event. */
async function awayAndBack(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.goBack({ waitUntil: 'commit' });
}

/**
 * Open the page, leave, come back, and say what became of the visit; a visit that Chromium
 * cancelled itself is tried again (see the header). Away to a blank page, the nearest thing to
 * another site here: a page of this site with ?plain would change the mode the visitor chose,
 * and a page restored after that rightly reloads in the new mode.
 */
async function visitAwayAndBack(page: Page, open: () => Promise<void>): Promise<string> {
  let visits = 0;
  const visit = async (): Promise<string> => {
    visits += 1;
    await open();
    await markDocument(page);
    await awayAndBack(page);
    let result = 'pending';
    await expect.poll(async () => (result = await outcome(page))).not.toBe('pending');
    return result;
  };
  let result = 'pending';
  await expect
    .poll(async () => (result = await visit()), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 4_000],
    })
    .not.toBe('navigation-canceled');
  if (visits > 1) {
    test
      .info()
      .annotations.push({ type: 'restores Chromium cancelled', description: `${visits - 1}` });
  }
  return result;
}

test('Back after leaving the site restores the page in plain mode, still plain', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit under Playwright: reported by the universe test');
  await countRestores(page);
  const result = await visitAwayAndBack(page, async () => {
    await page.goto(plain('/about/'));
  });

  expect(result).toBe('restored');
  expect(await restores(page)).toBe(1);
  expect(await sameDocument(page)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'plain');
  await expect(page.locator('main h1')).toHaveText('About Me');
});

test('Back after leaving the site restores the world as it was, and it is still moving', async ({
  page,
  browserName,
}) => {
  await countRestores(page);
  const open = async (): Promise<void> => {
    await page.goto(universe('/about/'));
    await engineReady(page);
  };

  if (browserName === 'webkit') {
    // Reported, not required: see the header. One visit, no second try.
    await open();
    await markDocument(page);
    await awayAndBack(page);
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

  expect(await visitAwayAndBack(page, open)).toBe('restored');
  expect(await restores(page)).toBe(1);
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
