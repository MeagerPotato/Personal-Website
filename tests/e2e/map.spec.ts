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

/** Where a body is on screen: its name hangs just below its disc. */
async function discOf(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await nameOf(page, name).boundingBox();
  if (!box) throw new Error(`${name} has no name on the map`);
  return { x: box.x + box.width / 2, y: box.y - 12 };
}

/** Wait until something on screen has stopped moving (to within a pixel between two looks). */
async function settled(target: Locator): Promise<{ x: number; y: number }> {
  let last = { x: Number.NaN, y: Number.NaN };
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const now = { x: box?.x ?? Number.NaN, y: box?.y ?? Number.NaN };
        const moved = Math.hypot(now.x - last.x, now.y - last.y);
        last = now;
        return moved;
      },
      { intervals: [250], timeout: 30_000 },
    )
    .toBeLessThan(1);
  return last;
}

test('the Map button pulls out to the whole galaxy, and puts it away again', async ({ page }) => {
  await openUniverse(page, '/');
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  await openButton(page).click();
  await mapOpen(page, 'Code');

  // Everything is on it: both systems by name, and nothing of it opened or changed the page.
  await expect(nameOf(page, 'About')).toBeVisible();
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
  await mapOpen(page, 'Code');

  const said = await watchText(page, '.dock-prompt');
  await pointAt(page, nameOf(page, 'Code'), isMobile);
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  // As from the flight view: nothing opens until the ship is there. (The journey is over in a
  // few seconds, some of them under the map as it pulls back: ask what the prompt SAID.)
  await expect
    .poll(async () => (await said()).find(({ text }) => text.includes('Flying to Code')))
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
    await mapOpen(page, 'Code');

    // Zoom in with the pointer ON a name: the name stays under the pointer, the rest moves away.
    const code = await settled(nameOf(page, 'Code'));
    const about = await settled(nameOf(page, 'About'));
    const box = await nameOf(page, 'Code').boundingBox();
    await page.mouse.move(code.x + (box?.width ?? 0) / 2, code.y - 10);
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(600);
    const codeAfter = await settled(nameOf(page, 'Code'));
    expect(Math.abs(codeAfter.x - code.x)).toBeLessThan(12);
    // (A name that does not show is not in the accessibility tree: ask before measuring.)
    const aboutShows = await nameOf(page, 'About').isVisible();
    const aboutAfter = aboutShows ? await nameOf(page, 'About').boundingBox() : null;
    // About was below and to the left of Code, and is now further that way, or off the map.
    if (aboutAfter) expect(aboutAfter.y - codeAfter.y).toBeGreaterThan((about.y - code.y) * 1.3);
    expect(pathOf(page)).toBe('/');
  });

  test('a drag moves the map and nothing else', async ({ page }) => {
    await openUniverse(page, '/');
    await page.keyboard.press('m');
    await mapOpen(page, 'Code');
    const before = await settled(nameOf(page, 'Code'));
    const clear = await clearOfNames(page);

    // The real galaxy is two systems on a slant: fitted top to bottom, it leaves a laptop's screen
    // room on either side. From empty space (the lower right: nobody's), to the left.
    expect(clear(1000, 600)).toBe(true);
    await page.mouse.move(1000, 600);
    await page.mouse.down();
    await page.mouse.move(950, 600, { steps: 8 });
    await page.mouse.move(900, 600, { steps: 8 });
    await page.mouse.up();
    const after = await settled(nameOf(page, 'Code'));
    expect(after.x - before.x).toBeGreaterThan(-105);
    expect(after.x - before.x).toBeLessThan(-95);
    expect(Math.abs(after.y - before.y)).toBeLessThan(3);

    // However far it is dragged, the galaxy stays on the screen: past it is only empty space.
    expect(clear(900, 600)).toBe(true);
    await page.mouse.move(900, 600);
    await page.mouse.down();
    await page.mouse.move(100, 600, { steps: 16 });
    await page.mouse.up();
    const home = await settled(nameOf(page, 'About'));
    expect(home.x).toBeGreaterThan(0);
    const code = await settled(nameOf(page, 'Code'));
    expect(after.x - code.x).toBeLessThan(400);

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
      await mapOpen(page, 'Code');
      // How to fly is no help here: it steps aside (and comes back).
      await expect(card).toBeHidden();
      const before = await settled(nameOf(page, 'Code'));
      await page.keyboard.down('a');
      await page.waitForTimeout(500);
      await page.keyboard.up('a');
      const after = await settled(nameOf(page, 'Code'));
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

  test('one finger drags the map, two fingers zoom it, and neither flies the ship', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await openButton(page).tap();
    await mapOpen(page, 'Code');
    const before = await settled(nameOf(page, 'Code'));

    // Real touches, through the browser's own input pipeline (Playwright itself only taps).
    const session = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });

    // Spread two fingers between the Code sun and FishAI, from 40 px apart to three times that:
    // the system opens up round them (as close as the map goes: from a snug fit on a phone, about
    // twice). A finger that comes down on a name is that name's (a tap there flies to it), and
    // on a snug map the names crowd the sun: the fingers go down wherever is clear of them.
    const planet = await settled(nameOf(page, 'FishAI'));
    const clear = await clearOfNames(page);
    const sun = await discOf(page, 'Code');
    const disc = await discOf(page, 'FishAI');
    const pinch = [0.5, 0.25, 0.75, 0, 1]
      .flatMap((t) => [0, 20, -20, 40, -40].map((side) => ({ t, side })))
      .flatMap(({ t, side }) => {
        const across = Math.atan2(disc.y - sun.y, disc.x - sun.x) + Math.PI / 2;
        const centre = {
          x: sun.x + (disc.x - sun.x) * t + Math.cos(across) * side,
          y: sun.y + (disc.y - sun.y) * t + Math.sin(across) * side,
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
    if (!pinch) throw new Error('names all round the Code system: nowhere to put two fingers');
    const fingers = (apart: number): { x: number; y: number; id: number }[] => [
      { x: pinch.centre.x - pinch.way.x * apart, y: pinch.centre.y - pinch.way.y * apart, id: 1 },
      { x: pinch.centre.x + pinch.way.x * apart, y: pinch.centre.y + pinch.way.y * apart, id: 2 },
    ];
    await touch('touchStart', fingers(20).slice(0, 1));
    await touch('touchStart', fingers(20));
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', fingers(20 + step * 5));
    await touch('touchEnd', []);
    const zoomed = await settled(nameOf(page, 'Code'));
    const planetAfter = await settled(nameOf(page, 'FishAI'));
    const apart = Math.hypot(planet.x - before.x, planet.y - before.y);
    expect(Math.hypot(planetAfter.x - zoomed.x, planetAfter.y - zoomed.y)).toBeGreaterThan(
      apart * 1.8,
    );
    // No thumb stick, no boost pad: on the map, fingers are the map's.
    await expect(page.locator('.touch-stick')).toBeHidden();
    await expect(page.locator('.touch-boost')).toBeHidden();

    // Closer in, there is room to move: toward the rest of the galaxy, left of Code and below
    // it. One finger, from empty space in the lower half, right and up: the map goes along, by
    // as much. (Opened, it showed everything, and had nowhere to go.)
    const start = { x: 150, y: 700 };
    expect(clear(start.x, start.y)).toBe(true);
    await touch('touchStart', [{ ...start, id: 1 }]);
    for (let step = 1; step <= 6; step += 1) {
      await touch('touchMove', [{ x: start.x + step * 10, y: start.y - step * 5, id: 1 }]);
    }
    // The finger stops before it lifts. (Lifted on the move, it flicks: the browser flings, and
    // its next tap, on Close map below, would only stop the fling.)
    await page.waitForTimeout(200);
    await touch('touchMove', [{ x: start.x + 60, y: start.y - 30, id: 1 }]);
    await touch('touchEnd', []);
    const dragged = await settled(nameOf(page, 'Code'));
    expect(dragged.x - zoomed.x).toBeGreaterThan(54);
    expect(dragged.x - zoomed.x).toBeLessThan(66);
    expect(dragged.y - zoomed.y).toBeGreaterThan(-36);
    expect(dragged.y - zoomed.y).toBeLessThan(-24);

    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');
    // Back in flight, the boost pad is back too: this visitor has fingers.
    await closeButton(page).tap();
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect(page.locator('.touch-boost')).toBeVisible();
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
    await mapOpen(page, 'Code');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    );
    expect(
      serious.map(({ id, nodes }) => `${id}: ${nodes.map((n) => n.target).join('; ')}`),
    ).toEqual([]);

    await pointAt(page, nameOf(page, 'Code'), isMobile);
    await expect.poll(() => pathOf(page)).toBe('/systems/code/');
    await expect(heading(page)).toHaveText('Code');
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect(prompt(page)).toContainText('Leave orbit');

    // From a page, the map again: where the ship is has its name on it, like everything else.
    await openButton(page).click();
    await mapOpen(page);
    // (Marked, whether or not there is room to show it: on a phone the sheet leaves the map a strip.)
    await expect(page.locator('.body-label[data-state="target"]')).toHaveText('Code');
    await expect(html(page)).toHaveAttribute('data-panel', 'open');
  });
});
