// A browser may take the WebGL context away (a phone that put the tab in the background, a GPU
// that was reset). The engine then builds itself again on a fresh canvas (src/universe/api.ts),
// and a visitor should notice nothing: the same page, the ship where it was, and whatever the
// page last asked of the engine (here: the star map) still in force.

import type { Page } from '@playwright/test';
import { engineReady, expect, openUniverse, test, watchText } from './support';

const html = (page: Page) => page.locator('html');
const prompt = (page: Page) => page.locator('.dock-prompt');
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Take the context away, the way a browser would. Answers false where that cannot be done. */
function loseContext(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#universe-host canvas');
    if (!canvas) return false;
    canvas.setAttribute('data-e2e-canvas', 'lost');
    // The canvas has a context already, and asking again hands back that very one.
    const lose = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return Boolean(lose);
  });
}

const rebuilt = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const canvas = document.querySelector('#universe-host canvas');
    return canvas !== null && canvas.getAttribute('data-e2e-canvas') !== 'lost';
  });

test('a lost WebGL context is rebuilt, docked where it was, with the page still open', async ({
  page,
}) => {
  await openUniverse(page, '/about/');
  await expect(prompt(page)).toContainText('Leave orbit');

  test.skip(!(await loseContext(page)), 'this browser cannot lose a context on request');
  await expect.poll(() => rebuilt(page)).toBe(true);
  await engineReady(page);

  // Still a universe (one lost context is not a reason to go plain), still docked, still About.
  await expect(html(page)).toHaveAttribute('data-mode', 'universe');
  await expect(prompt(page)).toContainText('Leave orbit');
  expect(pathOf(page)).toBe('/about/');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(page.locator('main h1')).toHaveText('About');
});

test('the star map is still open after a rebuild', async ({ page }) => {
  await openUniverse(page, '/');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(html(page)).toHaveAttribute('data-map', 'open');

  test.skip(!(await loseContext(page)), 'this browser cannot lose a context on request');
  await expect.poll(() => rebuilt(page)).toBe(true);
  await engineReady(page);

  await expect(html(page)).toHaveAttribute('data-map', 'open');
  const close = page.getByRole('button', { name: 'Close map', exact: true });
  await expect(close).toBeVisible();
  // And it is the new engine's map: its button closes it.
  await close.click();
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeVisible();
});

test('a Stop pressed in the frame the context goes still ends the journey and closes its page', async ({
  page,
}) => {
  // What the navigator queued in that frame is delivered before the old engine is taken down
  // (api.ts, deliverPending); lost with it, the journey's page stayed open and nothing was said.
  await openUniverse(page, '/');
  const told = await watchText(page, '[data-announcer]');
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.dock-prompt');
    if (!button) return;
    // The moment the journey offers Stop: press it, and take the context away in the same task.
    const watch = new MutationObserver(() => {
      if (!button.querySelector('.dock-prompt__action')?.textContent?.includes('Stop')) return;
      watch.disconnect();
      button.click();
      const canvas = document.querySelector<HTMLCanvasElement>('#universe-host canvas');
      canvas?.setAttribute('data-e2e-canvas', 'lost');
      const lose = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      lose?.loseContext();
      (window as Window & { e2eLost?: boolean }).e2eLost = Boolean(lose);
    });
    watch.observe(button, { subtree: true, childList: true, characterData: true });
    // A link to a planet in the next system: its page opens at once, and the ship sets out.
    const link = document.createElement('a');
    link.href = '/projects/fishai/';
    document.body.append(link);
    link.click();
    link.remove();
  });
  await expect
    .poll(() => page.evaluate(() => (window as Window & { e2eLost?: boolean }).e2eLost))
    .not.toBeUndefined();
  test.skip(
    !(await page.evaluate(() => (window as Window & { e2eLost?: boolean }).e2eLost)),
    'this browser cannot lose a context on request',
  );
  await expect.poll(() => rebuilt(page)).toBe(true);
  await engineReady(page);

  await expect.poll(async () => (await told()).map(({ text }) => text)).toContain('Stopped.');
  await expect.poll(() => pathOf(page)).toBe('/');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  await expect(html(page)).toHaveAttribute('data-mode', 'universe');
  await expect(prompt(page)).not.toContainText('Stop');
});
