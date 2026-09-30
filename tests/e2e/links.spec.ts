// Allen's profiles elsewhere (src/site/profiles.ts): GitHub and LinkedIn circle home as relays on
// the Contact satellite's ring. A relay is a body nothing docks at, and its name in the sky is a
// real link, in a group of its own. To see what the world offers beside one, these tests put the
// ship there the way a reload does, with a snapshot (pose memory, as tests/e2e/pose.spec.ts does).

import type { Locator, Page } from '@playwright/test';
import {
  expect,
  keptNow,
  loadWith,
  openUniverse,
  plain,
  pointAt,
  slowFrames,
  test,
  watchText,
  type Kept,
} from './support';

const html = (page: Page) => page.locator('html');
const pathOf = (page: Page): string => new URL(page.url()).pathname;
/**
 * The names of links: a group of their own, beside "Fly to". Found by what it is rather than by
 * its role, so that a name that does not show is found too (it is out of the accessibility tree).
 */
const elsewhere = (page: Page) =>
  page.locator('#universe-overlay [role="group"][aria-label="Elsewhere"]');
/** A link's name in the sky, whether or not it shows. */
const linkOf = (page: Page, title: string): Locator =>
  elsewhere(page)
    .locator('a.body-label')
    .filter({ hasText: new RegExp(`^${title}$`) });

interface Body {
  id: string;
  kind: string;
  title: string;
  href: string;
  orbit: { radius: number; phase: number; periodSec: number } | null;
  docks?: false;
}

async function bodiesOf(page: Page): Promise<Body[]> {
  return ((await (await page.request.get('/universe.json')).json()) as { bodies: Body[] }).bodies;
}

/** The profiles, as the build put them in the galaxy: [title, href], in slot order. */
async function linksOf(page: Page): Promise<[string, string][]> {
  return (await bodiesOf(page))
    .filter((body) => body.kind === 'link')
    .map((body) => [body.title, body.href]);
}

/**
 * The ship at rest just outside the ring of `body` (a body of the home system, whose planet is
 * at the origin), 6 u out from where the body passes 4 s after the snapshot's clock, and facing
 * the way it comes: it goes by the ship while the page settles, in front of open sky, and stays
 * within reach for seconds either side (sim/orbits.ts: x = r sin θ, z = r cos θ, θ growing).
 */
function beside(spawn: Kept, body: Body): Kept {
  const orbit = body.orbit;
  if (!orbit) throw new Error(`${body.id} is not on a ring`);
  const angleAt = (seconds: number): number =>
    orbit.phase + (2 * Math.PI * (spawn.steps / 60 + seconds)) / orbit.periodSec;
  const passes = angleAt(4);
  const x = Math.sin(passes) * (orbit.radius + 6);
  const z = Math.cos(passes) * (orbit.radius + 6);
  const comes = angleAt(0);
  const heading = Math.atan2(
    Math.sin(comes) * orbit.radius - x,
    Math.cos(comes) * orbit.radius - z,
  );
  return { ...spawn, dock: null, ship: { x, z, vx: 0, vz: 0, heading, yawRate: 0 } };
}

/**
 * Answer a relay's own site here (these tests never leave the machine), from before anything is
 * pressed: a press that should have stayed on the site and did not must not reach the real one.
 * Returns how many times the browser has gone there.
 */
async function answerElsewhere(page: Page, relay: Body): Promise<() => number> {
  let visits = 0;
  await page.route(`${new URL(relay.href).origin}/**`, (route) => {
    visits += 1;
    return route.fulfill({ contentType: 'text/html', body: '<title>Elsewhere</title>' });
  });
  return () => visits;
}

/** Put the ship beside the body titled `title` on the home page, in universe mode. */
async function parkBeside(page: Page, title: string): Promise<Body> {
  await openUniverse(page, '/');
  const spawn = await keptNow(page);
  const body = (await bodiesOf(page)).find((candidate) => candidate.title === title);
  if (!body) throw new Error(`no body is called ${title}`);
  await loadWith(page, beside(spawn, body), '/');
  return body;
}

test('the profiles are the same everywhere: the sky, the home page and the contact page', async ({
  page,
}) => {
  await openUniverse(page, '/');
  const links = await linksOf(page);
  expect(links.map(([title]) => title)).toEqual(expect.arrayContaining(['GitHub', 'LinkedIn']));

  // In the sky: real links, heard with the site they go to, and never a way to fly.
  const inSky = await elsewhere(page)
    .locator('a')
    .evaluateAll((anchors) =>
      anchors.map((anchor) => [
        anchor.textContent,
        anchor.getAttribute('href'),
        anchor.getAttribute('rel'),
        anchor.getAttribute('aria-label'),
        anchor.getAttribute('target'),
      ]),
    );
  expect(inSky).toEqual(
    links.map(([title, href]) => [
      title,
      href,
      'me noopener',
      `${title}, on ${new URL(href).hostname.replace(/^www\./, '')}`,
      null,
    ]),
  );
  const flyTo = await page
    .getByRole('group', { name: 'Fly to' })
    .locator('button')
    .allTextContents();
  for (const [title] of links) expect(flyTo).not.toContain(title);

  // The home page's "Elsewhere" and the contact page list the same networks, in the same order.
  const listed = (at: Page) =>
    at
      .locator('main ul.links a[rel="me noopener"]')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => [anchor.textContent?.trim(), anchor.getAttribute('href')]),
      );
  expect(await listed(page)).toEqual(links);
  await page.goto(plain('/contact/'));
  expect(await listed(page)).toEqual(links);
});

test('a relay offers no orbit, where the satellite on its ring does', async ({ page }) => {
  // The satellite first, put exactly as the relay will be: it offers its orbit.
  await parkBeside(page, 'Contact');
  await expect(page.locator('.dock-prompt')).toContainText('Orbit Contact');

  await parkBeside(page, 'GitHub');
  const said = await watchText(page, '.dock-prompt');
  const told = await watchText(page, '[data-announcer]');
  // The relay is right there, its name in view...
  await expect(linkOf(page, 'GitHub')).toHaveAttribute('data-shown', '');
  // ...and E, pressed beside it, does nothing at all.
  await page.keyboard.press('e');
  await page.waitForTimeout(1500);
  for (const { text } of [...(await said()), ...(await told())]) {
    expect(text).not.toContain('GitHub');
    expect(text).not.toContain('Flying to');
  }
  expect(pathOf(page)).toBe('/');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
});

test('pointing at a relay brings its link forward, and leaving is a second press', async ({
  page,
  isMobile,
}) => {
  const relay = await parkBeside(page, 'GitHub');
  const visits = await answerElsewhere(page, relay);
  const said = await watchText(page, '.dock-prompt');
  const github = linkOf(page, 'GitHub');
  // The name hangs just below the disc it names, so a little above the name is the relay.
  await expect(github).toHaveAttribute('data-shown', '');
  await pointAt(page, github, isMobile, -14);

  // Its name takes the focus, lit, and nothing else happens: no journey, no page.
  await expect(github).toBeFocused();
  await expect(github).toHaveAttribute('data-beckon', '');
  await page.waitForTimeout(1000);
  expect(pathOf(page)).toBe('/');
  expect(visits()).toBe(0);
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  for (const { text } of await said()) expect(text).not.toContain('Flying to');

  // Leaving is the link itself, pressed: the browser follows it, in this tab.
  await page.keyboard.press('Enter');
  await expect.poll(() => page.url()).toBe(relay.href);
});

test.describe('with a finger', () => {
  test.use({ hasTouch: true });

  // The phone is Chromium with a finger (pointAt: an area, as a phone reports a fingertip), and
  // WebKit is an iPhone's engine. Each test parks afresh: the relay rides its ring past a ship
  // that holds still, and on CI (software drawing) a test that went on for long would find its
  // name gone off the edge of the screen.
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName === 'chromium' && !isMobile, 'Chromium with a finger is the phone');
  });

  test('a finger on a relay stays on the site, on a slow phone too', async ({ page }) => {
    // The browser moves a finger onto the nearest thing that answers clicks, and the name hangs
    // just below the relay: the world has to answer them too (ui/Picker.ts), or a finger on the
    // relay presses the link and leaves.
    const relay = await parkBeside(page, 'GitHub');
    const github = linkOf(page, 'GitHub');
    await expect(github).toHaveAttribute('data-shown', '');
    const visits = await answerElsewhere(page, relay);

    // As slowly as a slow phone draws. The tap's own mouse events came after a frame there, by
    // when its name had the focus, and took it away (core/input/TouchControls.ts).
    await slowFrames(page, 100);
    await pointAt(page, github, true, -14);
    await expect(github).toBeFocused();
    await expect(github).toHaveAttribute('data-beckon', '');
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          let frames = 0;
          const next = (): void => {
            frames += 1;
            if (frames === 3) done();
            else requestAnimationFrame(next);
          };
          requestAnimationFrame(next);
        }),
    );
    expect(await github.evaluate((name) => document.activeElement === name)).toBe(true);
    // (A press of the link sets off at once; three slow frames on, it would have been asked for.)
    expect(visits()).toBe(0);
    expect(pathOf(page)).toBe('/');
  });

  test('a finger on its name leaves, in this tab', async ({ page }) => {
    const relay = await parkBeside(page, 'GitHub');
    const github = linkOf(page, 'GitHub');
    await expect(github).toHaveAttribute('data-shown', '');
    const visits = await answerElsewhere(page, relay);
    await pointAt(page, github, true);
    await expect.poll(() => page.url()).toBe(relay.href);
    expect(visits()).toBe(1);
  });
});

test('in forced colours a link still shows its arrow, in the ink of its name', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'forced colours are emulated in Chromium only');
  await page.emulateMedia({ forcedColors: 'active' });
  await openUniverse(page, '/');
  // (Whether or not its name shows: forced or not, a colour is worked out all the same.)
  const github = linkOf(page, 'GitHub');
  await expect(github).toHaveCount(1);
  const [ink, arrow, tag] = await github.evaluate((anchor) => [
    getComputedStyle(anchor).color,
    getComputedStyle(anchor, '::before').backgroundColor,
    getComputedStyle(anchor, '::after').backgroundColor,
  ]);
  // Forced colours paint every fill the page's background, the tag's too: left to them, the arrow
  // would be drawn in the colour of what it sits on, and the one sign that the name leaves gone.
  expect(arrow).toBe(ink);
  expect(arrow).not.toBe(tag);
});
