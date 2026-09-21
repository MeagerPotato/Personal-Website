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
        await expect(page.locator('.dock-prompt')).toContainText('Leave orbit');
      }
      await page.waitForTimeout(400); // the names that changed have finished fading
      expect.soft(await seriousIssues(page), path).toEqual([]);
    }
    expect(await sameDocument(page)).toBe(true);
  });
});
