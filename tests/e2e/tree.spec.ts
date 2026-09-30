// Allen's tree of solar systems, as the Projects binary (src/content/systems/projects.md): two
// suns, Software and Hardware, circling one centre. /projects/ is the binary's page, each sun has
// its own, and the old Code system's URL still works (public/_redirects). Served as Cloudflare
// will serve it: wrangler dev applies _redirects as it applies _headers.

import type { Page } from '@playwright/test';
import {
  expect,
  nameOf,
  openUniverse,
  plain,
  plannedName,
  pointAt,
  settled,
  softNavigate,
  test,
  watchText,
} from './support';

const html = (page: Page) => page.locator('html');
const heading = (page: Page) => page.locator('main h1');
const prompt = (page: Page) => page.locator('.dock-prompt');
const status = (page: Page) => page.locator('[data-announcer]');
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
/** A flight takes as long as it takes: a CI machine renders on its CPU, and time stretches. */
const FLIGHT = { timeout: 75_000 };

test.describe('the Code system’s old address', () => {
  for (const old of ['/systems/code/', '/systems/code']) {
    test(`${old} has moved for good, to Software`, async ({ request }) => {
      const response = await request.get(old, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      const location = response.headers()['location'] ?? '';
      expect(new URL(location, 'https://allenkh.com').pathname).toBe('/systems/software/');
    });
  }

  test('a browser that follows it lands on the Software sun’s page', async ({ page }) => {
    await page.goto(plain('/systems/code/'));
    expect(pathOf(page)).toBe('/systems/software/');
    await expect(heading(page)).toHaveText('Software');
    await expect(page.locator('main .eyebrow')).toHaveText('Sun of Projects');
  });
});

test('Projects is the binary’s page, shown from its first sun, Software', async ({ page }) => {
  await openUniverse(page, '/');
  const told = await watchText(page, '[data-announcer]');
  await navLink(page, 'Projects').click();

  await expect(heading(page)).toHaveText('Projects');
  // One section per sun, the two suns of the binary first.
  await expect(page.locator('main h2').nth(0)).toHaveText('Software');
  await expect(page.locator('main h2').nth(1)).toHaveText('Hardware');
  await expect(prompt(page)).toContainText('Leave orbit', FLIGHT);
  await expect
    .poll(async () => (await told()).some(({ text }) => text === 'Docked at Software.'))
    .toBe(true);
  expect(pathOf(page)).toBe('/projects/');
});

test('pressing the other sun flies there and opens its own page', async ({ page, isMobile }) => {
  await openUniverse(page, '/');
  await page.keyboard.press('m');
  await expect(html(page)).toHaveAttribute('data-map', 'open');
  await settled(nameOf(page, 'Hardware'));
  await pointAt(page, nameOf(page, 'Hardware'), isMobile);

  await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hardware/');
  await expect(heading(page)).toHaveText('Hardware');
  await expect(status(page)).toHaveText('Docked at Hardware.');
  // Its page says what it is, and which way the other one is.
  await expect(page.locator('main .twin')).toContainText('One of the two suns of Projects');
  await expect(page.locator('main .twin').getByRole('link', { name: 'Software' })).toHaveAttribute(
    'href',
    '/systems/software/',
  );
});

test('a deep link to FishAI starts in orbit round a moon of Canadian Fish', async ({ page }) => {
  await openUniverse(page, '/projects/fishai/');
  await expect(prompt(page)).toContainText('Leave orbit');
  await expect(page.locator('.body-label[data-state="target"]')).toHaveText('FishAI');
  await expect(heading(page)).toHaveText('FishAI');
  await expect(page.locator('main .eyebrow')).toHaveText('Moon of Canadian Fish');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link')).toHaveText([
    'Projects',
    'Software',
    'Canadian Fish',
  ]);
});

test('planned work says so, and shows its planet in place of a picture', async ({ page }) => {
  await page.goto(plain('/projects/fish-online/'));
  await expect(heading(page)).toHaveText('Fish Online');
  await expect(page.locator('.facts')).toContainText('Planned');
  const planet = page.locator('.cover--planet');
  await expect(planet).toBeVisible();
  await expect(planet).toHaveAttribute('data-planned', '');
  await expect(planet).toHaveAttribute('data-biome', 'tide');
  // No picture pretends to be one: the stand-in is decoration, hidden from assistive technology.
  await expect(planet).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('main img')).toHaveCount(0);
});

test('finished work without a picture shows its planet, and says "Completed"', async ({ page }) => {
  await page.goto(plain('/projects/cyberpatriot/'));
  await expect(heading(page)).toHaveText('CyberPatriot');
  await expect(page.locator('.facts')).toContainText('Completed');
  await expect(page.locator('.facts')).toContainText('Sep 2022 – May 2026');
  const planet = page.locator('.cover--planet');
  await expect(planet).toBeVisible();
  await expect(planet).not.toHaveAttribute('data-planned', /.*/);
});

test('planned work is called planned, in the sky and out loud', async ({ page }) => {
  await openUniverse(page, '/projects/canadian-fish-demo/');
  await expect(prompt(page)).toContainText('Leave orbit');
  const told = await watchText(page, '[data-announcer]');
  // Its moon, a short hop away.
  await softNavigate(page, '/projects/fish-online/');
  await expect(heading(page)).toHaveText('Fish Online');
  await expect
    .poll(async () => (await told()).map(({ text }) => text), FLIGHT)
    .toContain('Docked at Fish Online, planned.');
  // The name over it says so too (its words, whether or not the name has room to show).
  await expect(page.locator('.body-label[data-state="target"]')).toHaveText(
    plannedName('Fish Online'),
  );
});
