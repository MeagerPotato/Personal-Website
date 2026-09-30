// The star map (src/universe/ui/StarMap.ts): the galaxy from above, for choosing where to go. It
// is another way of LOOKING, so these tests are about what changes (the view, who the keys and
// fingers belong to) and about what must not (the URL, the panel, the ship's own business).

import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import {
  engineReady,
  expect,
  nameOf,
  openUniverse,
  pointAt,
  settled,
  softNavigate,
  test,
  universe,
  watchText,
} from './support';

const html = (page: Page) => page.locator('html');
const heading = (page: Page) => page.locator('main h1');
const prompt = (page: Page) => page.locator('.dock-prompt');
const openButton = (page: Page) => page.getByRole('button', { name: 'Map', exact: true });
const closeButton = (page: Page) => page.getByRole('button', { name: 'Close map', exact: true });
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/**
 * The map is there. With `name`, that name is on it and the camera has arrived above it (names
 * hold still from then on). Not every name fits every map: on a phone with a page open, the map
 * is a strip between the top bar and the sheet.
 */
async function mapOpen(page: Page, name?: string): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-map', 'open');
  await expect(closeButton(page)).toBeVisible();
  if (name === undefined) return;
  await expect(nameOf(page, name)).toBeVisible();
  await settled(nameOf(page, name));
}

/** Whether a point on screen is clear of every name that shows (a name is a button). */
async function clearOfNames(page: Page): Promise<(x: number, y: number) => boolean> {
  const boxes = await page
    .getByRole('group', { name: 'Fly to' })
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.hasAttribute('data-shown'))
        .map((button) => button.getBoundingClientRect())
        .map(({ left, top, right, bottom }) => ({ left, top, right, bottom })),
    );
  return (x, y) =>
    boxes.every(
      ({ left, top, right, bottom }) =>
        x < left - 4 || x > right + 4 || y < top - 4 || y > bottom + 4,
    );
}

/**
 * The middle of a name, once it shows and holds still (`settled`). A name is always centred on
 * its body from left to right (ui/Labels.ts), so its middle's x IS the body's; up and down it
 * hangs below the body or above it, whichever has room, and on a phone the two differ by a whole
 * 44 px touch target. So the tests below measure zooms from left to right, and a drag up or down
 * only on a name that stayed on its side.
 */
async function middleOf(target: Locator): Promise<{ x: number; y: number; side: string | null }> {
  await settled(target);
  const box = await target.boundingBox();
  if (!box) throw new Error('a name that shows has no box');
  const side = await target.getAttribute('data-side');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, side };
}

test('the Map button pulls out to the whole galaxy, and puts it away again', async ({
  page,
  isMobile,
}) => {
  await openUniverse(page, '/');
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  await openButton(page).click();
  await mapOpen(page, 'Research');

  // Everything is on it: the four systems round home, by their suns' names, and the home
  // planet's; and nothing of it opened or changed the page. On a phone the map is so snug that
  // two of the names give way: Software's to Hardware and About Me, and Hackathons', which is
  // long and hangs at the very edge of the screen, to one of its planets' where it does not fit.
  const names = isMobile
    ? ['About Me', 'Hardware']
    : ['About Me', 'Software', 'Hardware', 'Hackathons'];
  for (const name of names) await expect(nameOf(page, name)).toBeVisible();
  expect(pathOf(page)).toBe('/');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  await expect(page.locator('[data-announcer]')).toHaveText('Star map open.');

  await closeButton(page).click();
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  await expect(openButton(page)).toBeVisible();
  await expect(page.locator('[data-announcer]')).toHaveText('Star map closed.');
});

test('the Map button works from the keyboard, which stays on it', async ({ page }) => {
  await openUniverse(page, '/');
  await openButton(page).focus();
  await page.keyboard.press('Enter');
  await mapOpen(page);
  // One button with two names: the keyboard is still on it, and Enter is now the way back.
  await expect(closeButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  await expect(openButton(page)).toBeFocused();
});

test('M opens it, and Escape closes the map before it closes the page', async ({ page }) => {
  await openUniverse(page, '/about/');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');

  await page.keyboard.press('m');
  await mapOpen(page);
  await expect(html(page)).toHaveAttribute('data-panel', 'open');

  await page.keyboard.press('Escape');
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  // One Escape, one thing: the page is still open, and still About.
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  expect(pathOf(page)).toBe('/about/');

  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
  expect(pathOf(page)).toBe('/');
});

test('a name on the map flies the ship there and puts the map away', async ({ page, isMobile }) => {
  await openUniverse(page, '/');
  await openButton(page).click();
  await mapOpen(page, 'Research');

  const said = await watchText(page, '.dock-prompt');
  await pointAt(page, nameOf(page, 'Research'), isMobile);
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  // As from the flight view: nothing opens until the ship is there. (The journey is over in a
  // few seconds, some of them under the map as it pulls back: ask what the prompt SAID.)
  await expect
    .poll(async () => (await said()).find(({ text }) => text.includes('Flying to Research')))
    .toMatchObject({ path: '/' });
});

test.describe('on a laptop', () => {
  test.skip(({ isMobile }) => isMobile, 'a mouse, a wheel and a keyboard');

  test('scrolling out opens the map, and the wheel then zooms it about the pointer', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    // Over a name or over open sky, it is all the same to the wheel.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 240);
    await mapOpen(page, 'About Me');

    // Zoom in with the pointer ON a name: the name stays under the pointer, the rest moves away.
    // The home planet's, because it is near the middle of the galaxy: zoomed in on a system at
    // its edge, the map would rather slide than show empty space past it (sim/mapView.ts,
    // clampView), and nothing would stay under the pointer. Its name hangs above or below it,
    // so the pointer rests on the name itself and only its left and right are measured.
    const about = await settled(nameOf(page, 'About Me'));
    const hackathons = await settled(nameOf(page, 'Hackathons'));
    const box = await nameOf(page, 'About Me').boundingBox();
    await page.mouse.move(about.x + (box?.width ?? 0) / 2, about.y + (box?.height ?? 0) / 2);
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(600);
    const aboutAfter = await settled(nameOf(page, 'About Me'));
    expect(Math.abs(aboutAfter.x - about.x)).toBeLessThan(12);
    // (A name that does not show is not in the accessibility tree: ask before measuring.)
    const hackathonsShows = await nameOf(page, 'Hackathons').isVisible();
    const hackathonsAfter = hackathonsShows ? await nameOf(page, 'Hackathons').boundingBox() : null;
    // Hackathons was to the left of home, and is now further that way, or off the map.
    if (hackathonsAfter)
      expect(aboutAfter.x - hackathonsAfter.x).toBeGreaterThan((about.x - hackathons.x) * 1.3);
    expect(pathOf(page)).toBe('/');
  });

  test('a drag moves the map and nothing else', async ({ page }) => {
    await openUniverse(page, '/');
    await page.keyboard.press('m');
    await mapOpen(page, 'Software');
    const before = await settled(nameOf(page, 'Software'));
    const clear = await clearOfNames(page);

    // The real galaxy (home and three systems round it) is about as wide as it is tall: fitted
    // top to bottom, it leaves a laptop's screen room on either side. From empty space (the lower
    // right, between Research and the Projects binary: nobody's), to the left.
    expect(clear(1000, 600)).toBe(true);
    await page.mouse.move(1000, 600);
    await page.mouse.down();
    await page.mouse.move(950, 600, { steps: 8 });
    await page.mouse.move(900, 600, { steps: 8 });
    await page.mouse.up();
    const after = await settled(nameOf(page, 'Software'));
    expect(after.x - before.x).toBeGreaterThan(-105);
    expect(after.x - before.x).toBeLessThan(-95);
    expect(Math.abs(after.y - before.y)).toBeLessThan(3);

    // However far it is dragged, the galaxy stays on the screen: past it is only empty space.
    expect(clear(900, 600)).toBe(true);
    await page.mouse.move(900, 600);
    await page.mouse.down();
    await page.mouse.move(100, 600, { steps: 16 });
    await page.mouse.up();
    const home = await settled(nameOf(page, 'About Me'));
    expect(home.x).toBeGreaterThan(0);
    const software = await settled(nameOf(page, 'Software'));
    expect(after.x - software.x).toBeLessThan(400);

    // It was a drag, not a click: the ship goes nowhere, and the map stays.
    await expect(html(page)).toHaveAttribute('data-map', 'open');
    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');
  });

  test.describe('the first visit', () => {
    test.use({ seenHints: false });

    test('the flight keys move the map, not the ship', async ({ page }) => {
      await openUniverse(page, '/');
      const card = page.getByRole('complementary', { name: 'How to fly' });
      await expect(card).toBeVisible();

      await page.keyboard.press('m');
      await mapOpen(page, 'Software');
      // How to fly is no help here: it steps aside (and comes back).
      await expect(card).toBeHidden();
      const before = await settled(nameOf(page, 'Software'));
      await page.keyboard.down('a');
      await page.waitForTimeout(500);
      await page.keyboard.up('a');
      const after = await settled(nameOf(page, 'Software'));
      // A looks LEFT: what is on the map slides to the right.
      expect(after.x - before.x).toBeGreaterThan(40);

      await page.keyboard.press('m');
      await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
      // Had the ship heard that A, the card would have gone for good: steering is knowing.
      await page.waitForTimeout(1200);
      await expect(card).toBeVisible();
    });
  });
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'fingers');

  // On a phone the map opens fitted to its width, and four systems fill it: the names that show
  // are the home planet's and three suns' (of the Projects binary, Hardware's: Software's gives
  // way to it and to About Me). These tests hold on to About Me and Hardware, which sit near the
  // middle, one above and right of the other.

  test('one finger drags the map, two fingers zoom it, and neither flies the ship', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await openButton(page).tap();
    await mapOpen(page, 'Hardware');
    const home = await middleOf(nameOf(page, 'About Me'));
    const sun = await middleOf(nameOf(page, 'Hardware'));

    // Real touches, through the browser's own input pipeline (Playwright itself only taps).
    const session = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });

    // Spread two fingers between About Me and Hardware, from 40 px apart to twice that: the
    // galaxy opens up round them, twice as wide. A finger that comes down on a name is that
    // name's (a tap there flies to it), and on a map this snug the names crowd the middle: the
    // fingers go down wherever is clear of them.
    const clear = await clearOfNames(page);
    const pinch = [0.5, 0.25, 0.75, 0, 1]
      .flatMap((t) => [0, 20, -20, 40, -40].map((side) => ({ t, side })))
      .flatMap(({ t, side }) => {
        const across = Math.atan2(sun.y - home.y, sun.x - home.x) + Math.PI / 2;
        const centre = {
          x: home.x + (sun.x - home.x) * t + Math.cos(across) * side,
          y: home.y + (sun.y - home.y) * t + Math.sin(across) * side,
        };
        return [0, 30, -30, 60, -60, 90].map((degrees) => ({
          centre,
          way: { x: Math.cos((degrees * Math.PI) / 180), y: Math.sin((degrees * Math.PI) / 180) },
        }));
      })
      .find(
        ({ centre, way }) =>
          clear(centre.x - way.x * 20, centre.y - way.y * 20) &&
          clear(centre.x + way.x * 20, centre.y + way.y * 20),
      );
    if (!pinch)
      throw new Error('names all round About Me and Hardware: nowhere to put two fingers');
    const fingers = (apart: number): { x: number; y: number; id: number }[] => [
      { x: pinch.centre.x - pinch.way.x * apart, y: pinch.centre.y - pinch.way.y * apart, id: 1 },
      { x: pinch.centre.x + pinch.way.x * apart, y: pinch.centre.y + pinch.way.y * apart, id: 2 },
    ];
    await touch('touchStart', fingers(20).slice(0, 1));
    await touch('touchStart', fingers(20));
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', fingers(20 + step * 2.5));
    await touch('touchEnd', []);
    const homeZoomed = await middleOf(nameOf(page, 'About Me'));
    const sunZoomed = await middleOf(nameOf(page, 'Hardware'));
    const ratio = (sunZoomed.x - homeZoomed.x) / (sun.x - home.x);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    // No thumb stick, no boost pad: on the map, fingers are the map's.
    await expect(page.locator('.touch-stick')).toBeHidden();
    await expect(page.locator('.touch-boost')).toBeHidden();

    // Closer in, there is room to move. One finger, from empty space in the lower half, to the
    // left: the map goes along, by as much. (Opened, it showed everything, and had nowhere to
    // go.) Only across: twice as close, four systems are much wider than a phone but still about
    // as tall as its map, so up and down there is next to no room (measured: 5 px). Left,
    // because Hardware sits right of the middle: moved right, its name would meet the edge of the
    // screen and step aside, and there be nothing to measure.
    const clearNow = await clearOfNames(page);
    const start = [
      { x: 300, y: 700 },
      { x: 150, y: 700 },
      { x: 300, y: 620 },
      { x: 150, y: 620 },
    ].find(({ x, y }) => clearNow(x, y) && clearNow(x - 60, y));
    if (!start) throw new Error('names all over the lower half: nowhere to put a finger');
    await touch('touchStart', [{ ...start, id: 1 }]);
    for (let step = 1; step <= 6; step += 1) {
      await touch('touchMove', [{ x: start.x - step * 10, y: start.y, id: 1 }]);
    }
    // The finger stops before it lifts. (Lifted on the move, it flicks: the browser flings, and
    // its next tap, on Close map below, would only stop the fling.) This wait is part of the
    // gesture, a finger held still, not a wait for something to happen.
    await page.waitForTimeout(200);
    await touch('touchMove', [{ x: start.x - 60, y: start.y, id: 1 }]);
    await touch('touchEnd', []);
    const dragged = await middleOf(nameOf(page, 'Hardware'));
    const homeDragged = await middleOf(nameOf(page, 'About Me'));
    expect(dragged.x - sunZoomed.x).toBeGreaterThan(-66);
    expect(dragged.x - sunZoomed.x).toBeLessThan(-54);
    // Everything goes along: the same 60 px for the home planet as for the sun.
    expect(Math.abs(homeDragged.x - homeZoomed.x - (dragged.x - sunZoomed.x))).toBeLessThan(3);
    if (dragged.side === sunZoomed.side) expect(Math.abs(dragged.y - sunZoomed.y)).toBeLessThan(6);

    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');
    // Back in flight, the boost pad is back too: this visitor has fingers.
    await closeButton(page).tap();
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect(page.locator('.touch-boost')).toBeVisible();
  });

  test('a finger on a name that moves holds the map, and a tap on a name still flies there', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await openButton(page).tap();
    await mapOpen(page, 'Hardware');
    // Everything the prompt says from here on: a journey that set out and was let go of again
    // before anyone looked would leave the prompt as it was, but not this.
    const said = await watchText(page, '.dock-prompt');
    // Hardware is a sun of a binary: it circles the binary's centre, and its name with it.
    const home = await middleOf(nameOf(page, 'About Me'));
    const sun = await middleOf(nameOf(page, 'Hardware'));
    const session = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });

    // Two fingers: the first on empty space between Hardware and About Me, the second right on
    // Hardware's name. Spread twice as far apart: the second finger is part of the pinch, not a
    // press.
    const clear = await clearOfNames(page);
    const width = page.viewportSize()?.width ?? 412;
    const towards = { x: home.x - sun.x, y: home.y - sun.y };
    const first = [0.5, 0.4, 0.6, 0.3, 0.7]
      .flatMap((s) => [0, 15, -15, 30, -30].map((side) => ({ s, side })))
      .map(({ s, side }) => {
        const length = Math.hypot(towards.x, towards.y) || 1;
        return {
          x: sun.x + towards.x * s - (towards.y / length) * side,
          y: sun.y + towards.y * s + (towards.x / length) * side,
        };
      })
      .find(({ x, y }) => clear(x, y) && x > 10 && y > 60 && x < width - 10);
    if (!first) throw new Error('names all round Hardware: nowhere to put a finger');
    const mid = { x: (first.x + sun.x) / 2, y: (first.y + sun.y) / 2 };
    const fingers = (spread: number): { x: number; y: number; id: number }[] => [
      { x: mid.x + (first.x - mid.x) * spread, y: mid.y + (first.y - mid.y) * spread, id: 1 },
      { x: mid.x + (sun.x - mid.x) * spread, y: mid.y + (sun.y - mid.y) * spread, id: 2 },
    ];
    await touch('touchStart', fingers(1).slice(0, 1));
    await touch('touchStart', fingers(1));
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', fingers(1 + step / 8));
    await touch('touchEnd', []);
    const homeZoomed = await middleOf(nameOf(page, 'About Me'));
    const zoomed = await middleOf(nameOf(page, 'Hardware'));
    expect((zoomed.x - homeZoomed.x) / (sun.x - home.x)).toBeGreaterThan(1.5);
    await expect(html(page)).toHaveAttribute('data-map', 'open');

    // One finger, down on Hardware's own name and moved left: the map goes along, by as much,
    // and the name with it. (The finger stops before it lifts, as above.) Left, because Hardware
    // now sits well right of the middle, and across only, as above.
    const start = await middleOf(nameOf(page, 'Hardware'));
    await touch('touchStart', [{ x: start.x, y: start.y, id: 1 }]);
    for (let step = 1; step <= 6; step += 1) {
      await touch('touchMove', [{ x: start.x - step * 10, y: start.y, id: 1 }]);
    }
    // Part of the gesture, not a wait for something to happen: the finger holds still a moment
    // before it lifts, so that the lift carries no fling.
    await page.waitForTimeout(200);
    await touch('touchMove', [{ x: start.x - 60, y: start.y, id: 1 }]);
    await touch('touchEnd', []);
    const dragged = await middleOf(nameOf(page, 'Hardware'));
    expect(dragged.x - start.x).toBeGreaterThan(-66);
    expect(dragged.x - start.x).toBeLessThan(-54);
    if (dragged.side === start.side) expect(Math.abs(dragged.y - start.y)).toBeLessThan(6);
    // Neither was a press of a name: nothing set out, and the map is still open.
    await expect(html(page)).toHaveAttribute('data-map', 'open');
    await expect(prompt(page)).not.toContainText('Flying to');
    expect((await said()).filter(({ text }) => text.includes('Flying to'))).toEqual([]);
    expect(pathOf(page)).toBe('/');

    // A tap on the same name is a press of it, as ever: there it goes, and the map is put away.
    await pointAt(page, nameOf(page, 'Hardware'), true);
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect
      .poll(async () => (await said()).find(({ text }) => text.includes('Flying to Hardware')))
      .toMatchObject({ path: '/' });
  });
});

test.describe('on the narrowest phone, with a page open', () => {
  test.skip(({ isMobile }) => !isMobile, 'fingers');
  test.use({ viewport: { width: 320, height: 700 } });

  test('a journey’s Stop shares the row of Close map, clear of it, and takes a finger', async ({
    page,
  }) => {
    await openUniverse(page, '/about/');
    await expect(html(page)).toHaveAttribute('data-panel', 'open');
    await openButton(page).tap();
    await mapOpen(page);
    const told = await watchText(page, '[data-announcer]');

    // A link with the map up: the page opens at once, and the ship sets out behind it, for the
    // body with the longest name there is. The journey is over in a few seconds, and a busy
    // machine can take about as long to look and put a finger down: each try looks once and then
    // taps, and should the ship arrive first all the same, it is sent home, and out again once it
    // is there (three tries at most).
    const stop = prompt(page).locator('.dock-prompt__action');
    const heard = async (start: string): Promise<number> =>
      (await told()).filter(({ text }) => text.startsWith(start)).length;
    for (let attempt = 1; (await heard('Stopped.')) === 0; attempt += 1) {
      if (attempt > 3) throw new Error('every journey was over before a finger could stop it');
      if (attempt > 1) {
        const docked = await heard('Docked at');
        await softNavigate(page, '/about/');
        await expect.poll(() => heard('Docked at'), { timeout: 30_000 }).toBeGreaterThan(docked);
      }
      const arrived = await heard('Docked at');
      await softNavigate(page, '/projects/fish-onboarding/');
      await expect
        .poll(
          async () => (await stop.textContent()) === 'Stop' || (await heard('Docked at')) > arrived,
        )
        .toBe(true);
      await expect(html(page)).toHaveAttribute('data-map', 'open');
      // The row and Stop, in one look (Close map is the Map button, open).
      const seen = await page.evaluate(() => {
        const action = document.querySelector('.dock-prompt .dock-prompt__action');
        const row = document.querySelector('.dock-prompt')?.getBoundingClientRect();
        const toggle = document.querySelector('.map-toggle')?.getBoundingClientRect();
        if (!(action instanceof HTMLElement) || action.hidden || !row || !toggle) return null;
        const box = action.getBoundingClientRect();
        if (box.width === 0) return null;
        return {
          rowRight: row.right,
          toggleLeft: toggle.left,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      });
      if (seen === null) continue;
      // "Close map" is wider than "Map": the name gives way to it (the stylesheet's --map-chip),
      // as everything in the HUD keeps a --space-3 (12 px) from its neighbours.
      expect(seen.rowRight + 12).toBeLessThanOrEqual(seen.toggleLeft + 0.5);
      // A real finger on Stop, not a click from script: nothing lies over it.
      await page.touchscreen.tap(seen.x, seen.y);
      await expect
        .poll(async () => (await heard('Stopped.')) > 0 || (await heard('Docked at')) > arrived)
        .toBe(true);
    }
    await expect(prompt(page)).not.toContainText('Stop');
  });
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the map is a cut, a name on it is a cut, and it is accessible', async ({
    page,
    isMobile,
  }) => {
    await page.goto(universe('/'));
    await engineReady(page);
    await openButton(page).click();
    // Research: a system of one sun, which holds still, and whose name shows on every screen.
    await mapOpen(page, 'Research');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    );
    expect(
      serious.map(({ id, nodes }) => `${id}: ${nodes.map((n) => n.target).join('; ')}`),
    ).toEqual([]);

    await pointAt(page, nameOf(page, 'Research'), isMobile);
    await expect.poll(() => pathOf(page)).toBe('/systems/research/');
    await expect(heading(page)).toHaveText('Research');
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect(prompt(page)).toContainText('Leave orbit');

    // From a page, the map again: where the ship is has its name on it, like everything else.
    await openButton(page).click();
    await mapOpen(page);
    // (Marked, whether or not there is room to show it: on a phone the sheet leaves the map a strip.)
    await expect(page.locator('.body-label[data-state="target"]')).toHaveText('Research');
    await expect(html(page)).toHaveAttribute('data-panel', 'open');
  });
});
