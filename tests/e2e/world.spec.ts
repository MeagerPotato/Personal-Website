// The world and the page follow each other (src/shell/follow.ts): pointing at a planet, or at its
// name, flies the ship there and opens its page on arrival. These tests fly for real, on whatever
// renderer the machine has, so they wait for outcomes and never for a number of seconds.

import type { Page } from '@playwright/test';
import {
  engineReady,
  expect,
  nameOf,
  openUniverse,
  pointAt,
  test,
  universe,
  watchText,
} from './support';

const html = (page: Page) => page.locator('html');
const heading = (page: Page) => page.locator('main h1');
const prompt = (page: Page) => page.locator('.dock-prompt');
/** What is said for someone who cannot see the ship (src/shell/announcer.ts). */
const status = (page: Page) => page.locator('[data-announcer]');
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/**
 * Somewhere that is NOT right in front of the ship, whatever the screen shows: the first name in
 * the sky from another system than home's, and the page it stands for (from the galaxy's
 * manifest).
 */
async function somewhereFar(page: Page): Promise<{ name: string; path: string }> {
  const manifest = (await (await page.request.get('/universe.json')).json()) as {
    bodies: { kind: string; title: string; href: string; system: string }[];
  };
  // Another system: a journey of a few seconds (one in the home system is over in less than two).
  const home = manifest.bodies.find(({ kind }) => kind === 'home')?.system;
  const names = page.getByRole('group', { name: 'Fly to' }).getByRole('button');
  await expect(names.first()).toBeVisible();
  for (const name of await names.allTextContents()) {
    const body = manifest.bodies.find(({ title }) => title === name);
    if (body && body.system !== home) return { name, path: body.href };
  }
  throw new Error('no other system has a name in the sky');
}

/** A flight takes as long as it takes: a CI machine renders on its CPU, and time stretches. */
const FLIGHT = { timeout: 75_000 };

test('the name of a planet flies the ship there, and its page opens on arrival', async ({
  page,
  isMobile,
}) => {
  await openUniverse(page, '/');
  // A journey is over in a few seconds, and a machine drawing on its CPU may not look while it
  // lasts: what was said, and where the page was when it was said.
  const said = await watchText(page, '.dock-prompt');
  const told = await watchText(page, '[data-announcer]');
  await pointAt(page, nameOf(page, 'About'), isMobile);

  // Nothing opens until the ship is there: the sky stays open while it flies.
  await expect
    .poll(async () =>
      (await said()).find(({ text }) => text.includes('Flying to About') && text.includes('Stop')),
    )
    .toMatchObject({ path: '/' });
  // Said, too, for someone who cannot see the ship turn.
  await expect
    .poll(async () => (await told()).find(({ text }) => text === 'Flying to About.'))
    .toMatchObject({ path: '/' });

  await expect.poll(() => pathOf(page), FLIGHT).toBe('/about/');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(heading(page)).toHaveText('About');
  await expect(prompt(page)).toContainText('Leave orbit');
  await expect(status(page)).toHaveText('Docked at About.');
});

test('the planet itself can be pointed at', async ({ page, isMobile }) => {
  await openUniverse(page, '/');
  const said = await watchText(page, '.dock-prompt');
  // The name hangs just below the disc it names, so a little above the name is the planet.
  await pointAt(page, nameOf(page, 'About'), isMobile, -14);

  await expect
    .poll(async () => (await said()).some(({ text }) => text.includes('Flying to About')))
    .toBe(true);
  await expect.poll(() => pathOf(page), FLIGHT).toBe('/about/');
  await expect(heading(page)).toHaveText('About');
});

test('Stop gives the ship back, and nothing opens', async ({ page, isMobile }) => {
  await openUniverse(page, '/');
  const { name } = await somewhereFar(page);
  // Stop is pressed the moment it is offered. A journey to the next system is over in a few
  // seconds, and a machine drawing on its CPU can take longer than that to find the button.
  await page.evaluate((name) => {
    const button = document.querySelector<HTMLButtonElement>('.dock-prompt');
    if (!button) return;
    const watch = new MutationObserver(() => {
      if (!button.textContent?.includes(`Flying to ${name}`)) return;
      watch.disconnect();
      button.click();
    });
    watch.observe(button, { subtree: true, childList: true, characterData: true });
  }, name);
  await pointAt(page, nameOf(page, name), isMobile);

  await expect(status(page)).toHaveText('Stopped.');
  await expect(prompt(page)).not.toContainText('Flying to');
  await page.waitForTimeout(1500);
  expect(pathOf(page)).toBe('/');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
});

test('a link opens its page at once and the ship follows', async ({ page }) => {
  await openUniverse(page, '/');
  const said = await watchText(page, '.dock-prompt');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Contact' })
    .click();
  // The recruiter's path: the words first, the flight behind them.
  await expect(heading(page)).toHaveText('Contact');
  await expect(prompt(page)).toContainText('Leave orbit', FLIGHT);
  expect((await said()).some(({ text }) => text.includes('Flying to Contact'))).toBe(true);
  expect(pathOf(page)).toBe('/contact/');
});

test('Close, pressed just as the ship arrives, still closes the page', async ({ page }) => {
  await openUniverse(page, '/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About' }).click();
  await expect(heading(page)).toHaveText('About');

  // Close is Back, and after Back the URL is "/" at once while the sky only shows when its HTML
  // has arrived. Hold that answer until the ship has docked: it docks in the gap, where it once
  // took the navigation over and brought the page straight back (shell/follow.ts, `busy`).
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'document') await held;
      await route.continue();
    },
  );
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(prompt(page)).toContainText('Leave orbit', FLIGHT);
  release();

  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  await page.waitForTimeout(1500);
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  expect(pathOf(page)).toBe('/');
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('a journey is a cut, not a flight', async ({ page, isMobile }) => {
    await page.goto(universe('/'));
    await engineReady(page);
    await expect(html(page)).toHaveAttribute('data-motion', 'reduced');
    const { name, path } = await somewhereFar(page);
    await pointAt(page, nameOf(page, name), isMobile);
    // Too far to glide to: the ship is simply there, and the page opens.
    await expect.poll(() => pathOf(page)).toBe(path);
    await expect(heading(page)).toHaveText(name);
    await expect(prompt(page)).toContainText('Leave orbit');
  });
});

test.describe('the first visit', () => {
  test.use({ seenHints: false });

  test('says how to fly once, until the visitor flies', async ({ page, isMobile }) => {
    await openUniverse(page, '/');
    const card = page.getByRole('complementary', { name: 'How to fly' });
    await expect(card).toBeVisible();
    // Keys for a mouse and keyboard, thumbs for a phone.
    await expect(card.getByText('to boost')).toBeVisible({ visible: !isMobile });
    await expect(card.getByText('Drag anywhere to steer')).toBeVisible({ visible: isMobile });

    if (isMobile) {
      await card.getByRole('button', { name: 'Got it' }).click();
    } else {
      // Steering is knowing: the card lingers a moment and goes.
      await page.keyboard.down('w');
      await page.waitForTimeout(600);
      await page.keyboard.up('w');
    }
    await expect(card).toBeHidden();

    await page.reload();
    await engineReady(page);
    await expect(card).toBeHidden();
  });
});
