// axe on every page, in both modes (docs/PLAN.md §7: no serious issues). What axe cannot judge
// (text over the moving 3D sky) it reports as "incomplete", not as a violation: that contrast is
// checked by eye, and by the numbers in docs/DESIGN.md.

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  expect,
  markDocument,
  openUniverse,
  PAGES,
  plain,
  sameDocument,
  softNavigate,
  test,
} from './support';

async function seriousIssues(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(
      ({ id, help, nodes }) =>
        `${id}: ${help} (${nodes.map(({ target }) => target.join(' ')).join('; ')})`,
    );
}

for (const path of [...PAGES, '/nope/']) {
  test(`plain ${path} has no serious accessibility issues`, async ({ page }) => {
    await page.goto(path === '/nope/' ? path : plain(path));
    expect(await seriousIssues(page)).toEqual([]);
  });
}

test.describe('in the universe', () => {
  // axe judges a page that holds still. With reduced motion a journey is a cut, so every page is
  // judged docked and at rest, and not in the moment where one name fades out under another
  // (which axe takes for two buttons on top of each other, and nobody else notices).
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('no page has a serious accessibility issue', async ({ page }) => {
    test.slow();
    // One engine for all of them: open sky first, then every page in the panel.
    await openUniverse(page, '/');
    await markDocument(page);
    for (const path of PAGES) {
      if (path !== '/') {
        await softNavigate(page, path);
        // Mostly a cut, but a body within reach is glided to, and on a busy machine that takes a while.
        await expect(page.locator('.dock-prompt')).toContainText('Leave orbit', {
          timeout: 75_000,
        });
      }
      await page.waitForTimeout(400); // the names that changed have finished fading
      expect.soft(await seriousIssues(page), path).toEqual([]);
    }
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe('with a keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'a keyboard');

  // Shift is the boost key, and also half of Shift+Tab. Going back one control must change
  // nothing else (WCAG 3.2.1): not leave orbit, and so not close the page being read.
  test('Shift+Tab only moves the focus back, from anywhere in the bar', async ({ page }) => {
    await openUniverse(page, '/projects/fishai/');
    const prompt = page.locator('.dock-prompt');
    await expect(prompt).toContainText('Leave orbit');
    const resume = page.locator('.site-nav').getByRole('link', { name: 'Resume' });
    await resume.focus();
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    // A non-event: give the ship time to leave, as it did (well inside this) before the fix.
    await page.waitForTimeout(1500);
    await page.keyboard.up('Shift');
    await expect(resume).not.toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/projects/fishai/');
    await expect(page.locator('html')).toHaveAttribute('data-panel', 'open');
    await expect(prompt).toContainText('Leave orbit');
  });
});
