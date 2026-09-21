// The promises docs/DESIGN.md makes about small screens, measured: nothing scrolls sideways at
// 360 px (or at 320 px, the narrowest phone still about), and everything a finger is meant to hit
// is at least 44 px in both directions. A restyle that breaks one of these fails here.

import type { Page } from '@playwright/test';
import { engineReady, expect, openUniverse, PAGES, plain, softNavigate, test } from './support';

const NARROW = [
  { width: 360, height: 740 },
  { width: 320, height: 568 },
] as const;

/** How far the page can be scrolled sideways, in px. */
const sidewaysScroll = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const main = document.getElementById('main');
    return Math.max(
      root.scrollWidth - root.clientWidth,
      main ? main.scrollWidth - main.clientWidth : 0,
    );
  });

/** Visible controls smaller than 44 px either way, as "class text WxH", and how many were looked at. */
const smallTargets = (page: Page, selector: string) =>
  page.evaluate((targets) => {
    const small: string[] = [];
    let measured = 0;
    for (const element of document.querySelectorAll<HTMLElement>(targets)) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      measured += 1;
      if (box.width < 43.5 || box.height < 43.5) {
        small.push(
          `${element.className || element.tagName} "${element.textContent?.trim().slice(0, 24)}" ` +
            `${Math.round(box.width)}x${Math.round(box.height)}`,
        );
      }
    }
    return { small, measured };
  }, selector);

const CONTROLS = [
  '.wordmark',
  '.site-nav a',
  '.panel-button',
  '.mode-link',
  '.dock-prompt',
  '.map-toggle',
  '.body-label',
  '.skip-link:focus',
].join(', ');

for (const size of NARROW) {
  test.describe(`at ${size.width} px`, () => {
    test.use({ viewport: size });

    test('no plain page scrolls sideways', async ({ page }) => {
      for (const path of [...PAGES, '/nope/']) {
        await page.goto(path === '/nope/' ? path : plain(path));
        expect(await sidewaysScroll(page), path).toBe(0);
      }
    });

    test('no universe page scrolls sideways, and the nav keeps to its rows', async ({ page }) => {
      await openUniverse(page, '/');
      for (const path of PAGES) {
        if (path !== '/') await softNavigate(page, path);
        expect(await sidewaysScroll(page), path).toBe(0);
      }
      const rows = await page.evaluate(
        () =>
          new Set(
            [...document.querySelectorAll('.site-nav a')].map((link) =>
              Math.round(link.getBoundingClientRect().top),
            ),
          ).size,
      );
      // One row at 360 px. At 320 px it depends on the visitor's system font: one row with Segoe
      // or Roboto, two with a wide one (DejaVu on a Linux CI runner), which is a graceful wrap.
      expect(rows).toBeLessThanOrEqual(size.width >= 360 ? 1 : 2);
    });
  });
}

test.describe('touch targets', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('are at least 44 px in plain mode', async ({ page }) => {
    for (const path of ['/', '/projects/', '/contact/']) {
      await page.goto(plain(path));
      const targets = await smallTargets(page, CONTROLS);
      expect(targets.small, path).toEqual([]);
      // The wordmark, four nav links and a mode link at the very least.
      expect(targets.measured, path).toBeGreaterThanOrEqual(6);
    }
  });

  test('are at least 44 px in the universe, docked and in open sky', async ({ page }) => {
    await openUniverse(page, '/');
    const sky = await smallTargets(page, CONTROLS);
    expect(sky.small, 'open sky').toEqual([]);
    // ...and "About this site", and at least one name in the sky.
    expect(sky.measured, 'open sky').toBeGreaterThanOrEqual(8);
    await page.goto('/projects/fishai/');
    await engineReady(page);
    const docked = await smallTargets(page, CONTROLS);
    expect(docked.small, 'docked').toEqual([]);
    // ...and Expand, Close and "Leave orbit".
    expect(docked.measured, 'docked').toBeGreaterThanOrEqual(9);
  });
});
