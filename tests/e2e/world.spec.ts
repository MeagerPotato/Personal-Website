// The world and the page follow each other (src/shell/follow.ts): pointing at a planet, or at its
// name, flies the ship there and opens its page on arrival. These tests fly for real, on whatever
// renderer the machine has, so they wait for outcomes and never for a number of seconds.

import type { Page } from '@playwright/test';
import {
  engineReady,
  expect,
  nameOf,
  openUniverse,
  plannedName,
  pointAt,
  settled,
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
 * manifest). Built work only, on purpose: planned work is named "Fish Online, Planned" and its
 * page is a single line, and these tests are about a journey, not about what planned work says
 * (tree.spec.ts is).
 */
async function somewhereFar(page: Page): Promise<{ name: string; path: string }> {
  const manifest = (await (await page.request.get('/universe.json')).json()) as {
    bodies: { kind: string; title: string; href: string; system: string; planned?: true }[];
  };
  // Another system: a journey of a few seconds (one in the home system is over in less than two).
  const home = manifest.bodies.find(({ kind }) => kind === 'home')?.system;
  const built = manifest.bodies.filter((body) => body.system !== home && body.planned !== true);
  const names = page.getByRole('group', { name: 'Fly to' }).getByRole('button');
  await expect(names.first()).toBeVisible();
  for (const name of await names.allTextContents()) {
    const body = built.find(({ title }) => title === name);
    if (body) return { name, path: body.href };
  }
  throw new Error('no other system has a name of built work in the sky');
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
  // The home planet is called "About Me"; the nav keeps the short "About".
  await pointAt(page, nameOf(page, 'About Me'), isMobile);

  // Nothing opens until the ship is there: the sky stays open while it flies.
  await expect
    .poll(async () =>
      (await said()).find(
        ({ text }) => text.includes('Flying to About Me') && text.includes('Stop'),
      ),
    )
    .toMatchObject({ path: '/' });
  // Said, too, for someone who cannot see the ship turn.
  await expect
    .poll(async () => (await told()).find(({ text }) => text === 'Flying to About Me.'))
    .toMatchObject({ path: '/' });

  await expect.poll(() => pathOf(page), FLIGHT).toBe('/about/');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(heading(page)).toHaveText('About Me');
  await expect(prompt(page)).toContainText('Leave orbit');
  await expect(status(page)).toHaveText('Docked at About Me.');
});

test('the planet itself can be pointed at', async ({ page, isMobile }) => {
  await openUniverse(page, '/');
  const said = await watchText(page, '.dock-prompt');
  // The name hangs just below the disc it names, so a little above the name is the planet.
  await pointAt(page, nameOf(page, 'About Me'), isMobile, -14);

  await expect
    .poll(async () => (await said()).some(({ text }) => text.includes('Flying to About Me')))
    .toBe(true);
  await expect.poll(() => pathOf(page), FLIGHT).toBe('/about/');
  await expect(heading(page)).toHaveText('About Me');
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
  await expect(heading(page)).toHaveText('About Me');

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

test.describe('on a laptop', () => {
  // The keyboard's way there. On a phone, fingers bring the same names into view (map.spec.ts,
  // Research all the way in), and the flight there from a page's link is tree.spec.ts's, on every
  // screen.
  test.skip(({ isMobile }) => isMobile, 'a keyboard');

  test('planned work is flown to like any other, and its one-line page says so', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    const said = await watchText(page, '.dock-prompt');
    const told = await watchText(page, '[data-announcer]');
    await page.keyboard.press('m');
    await expect(html(page)).toHaveAttribute('data-map', 'open');

    // Research, whose only work is planned, is at the top of the galaxy (until 2026-10-03 it was
    // at the bottom). Closer in (+, three times, about the middle: about as close as five times
    // was while the map opened further out), and with the map as far up as it goes (the arrow
    // held until Research's name holds still), its bodies' names have room beside its sun's.
    const research = nameOf(page, 'Research');
    await settled(research);
    for (let press = 0; press < 3; press += 1) await page.keyboard.press('Equal');
    await page.keyboard.down('ArrowUp');
    await settled(research);
    await page.keyboard.up('ArrowUp');

    // Both of Research's bodies are planned: the planet, and Kalshi, its moon. They are on their
    // way round (the planet in six minutes), and a name goes wherever its body leaves it room
    // (below it, above it, beside it, slid along it): measured headless over a whole turn of the
    // binary, in this view the planet's name shows every second and the moon's all but one in
    // fifteen. So: whichever shows first, however long the way here took (a slow machine gets
    // here later in the turn, and draws its frames on the CPU: it is given time).
    const planned = [
      { title: 'Sports Analysis', path: '/projects/sports-analysis/' },
      { title: 'Kalshi', path: '/projects/kalshi/' },
    ] as const;
    const shows = (title: string) =>
      nameOf(page, plannedName(title)).and(page.locator('[data-shown]')).count();
    const found: { body?: (typeof planned)[number] } = {};
    await expect
      .poll(
        async () => {
          found.body = undefined;
          for (const body of planned) if ((await shows(body.title)) > 0) found.body ??= body;
          return found.body?.title;
        },
        { timeout: 60_000 },
      )
      .toBeDefined();
    const target = found.body;
    if (!target) throw new Error('a planned name showed, and then there was none');
    await pointAt(page, nameOf(page, plannedName(target.title)), false);

    // As for built work: nothing opens until the ship is there, then its page.
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect.poll(() => pathOf(page), FLIGHT).toBe(target.path);
    await expect(heading(page)).toHaveText(target.title);
    await expect(status(page)).toHaveText(`Docked at ${target.title}, planned.`);
    expect(
      (await said()).filter(({ text }) => text.includes(`Flying to ${target.title}`)),
    ).not.toEqual([]);
    expect((await told()).map(({ text }) => text)).toContain(`Flying to ${target.title}, planned.`);
    // One line and a status, and its planet where a picture would be: nothing pretends to be built.
    await expect(page.locator('main .facts')).toContainText('Planned');
    await expect(page.locator('main .cover--planet')).toHaveAttribute('data-planned', '');
  });
});
