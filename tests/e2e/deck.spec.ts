// The flight deck (src/universe/ui/FlightDeck.ts): KSP's cluster of instruments at the bottom of
// the view, which only READS the simulation. So these tests ask what it shows and where it sits,
// and that nothing else moved out of reach for it: the prompt steps beside it, the how-to-fly card
// keeps above it, and neither a keyboard nor a screen reader ever meets it. A view too small for
// the cluster (a phone) has the strip instead, in the Map button's row, and nothing moves for it.
//
// And the minimap beside it (src/universe/ui/MiniMap.ts): the star map at another size, there
// wherever the cluster has room, flying or docked, and built as the ball is: a round plate on the
// ball's own line, a pill over it that names, a chip under it that measures. A press on a mark is
// pointing at that body, and a press where nothing is opens the map it is the preview of.

import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, nameOf, openUniverse, pointAt, test, watchText } from './support';

const deck = (page: Page) => page.locator('.flight-deck');
const minimap = (page: Page) => page.locator('.minimap');
/** The pill over the minimap's plate (what it shows, or the name of a body), and the chip under it. */
const pill = (page: Page) => page.locator('.minimap__name');
const chip = (page: Page) => page.locator('.minimap__range');
/** The N at the top of the minimap's face. */
const north = (page: Page) => page.locator('.minimap__north');
/** The mark of a body on the minimap, by its id in the galaxy's manifest. */
const markOf = (page: Page, id: string) => page.locator(`.minimap [data-id="${id}"]`);
const prompt = (page: Page) => page.locator('.dock-prompt');
const speed = (page: Page) => page.locator('.flight-deck__speed b');
const mapButton = (page: Page) => page.locator('.map-toggle');
const plainChip = (page: Page) => page.locator('.mode-link--to-plain');
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** A flight takes as long as it takes: a CI machine renders on its CPU, and time stretches. */
const FLIGHT = { timeout: 75_000 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(target: Locator): Promise<Box> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing there to measure');
  return box;
}

const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The names of every two of these that share a pixel. */
async function overlaps(targets: Record<string, Locator>): Promise<string[]> {
  const boxes: [string, Box][] = [];
  for (const [name, target] of Object.entries(targets)) boxes.push([name, await boxOf(target)]);
  const found: string[] = [];
  boxes.forEach(([name, box], i) => {
    for (const [other, otherBox] of boxes.slice(i + 1)) {
      if (overlap(box, otherBox)) found.push(`${name} and ${other}`);
    }
  });
  return found;
}

/** How far the page can be scrolled sideways, in px. */
const sidewaysScroll = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

/**
 * The strip is one pill, 44 px tall and 124 wide, level with the Map button and 12 px or more
 * clear of it (once it has arrived: it comes up from 8 px below).
 */
async function inTheMapRow(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const [pill, map] = [await boxOf(deck(page)), await boxOf(mapButton(page))];
      return Math.round(pill.y - map.y);
    })
    .toBe(0);
  const [pill, map] = [await boxOf(deck(page)), await boxOf(mapButton(page))];
  expect(Math.round(pill.height)).toBe(44);
  expect(Math.round(pill.width)).toBe(124);
  expect(map.x - (pill.x + pill.width)).toBeGreaterThanOrEqual(12);
}

/** It has arrived (it comes up from 8 px below, as the deck does) and is where it rests. */
async function arrived(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await expect.poll(() => target.evaluate((node) => node.getAnimations().length)).toBe(0);
}

/**
 * THE MINIMAP IS THE BALL'S SIBLING: its round plate stands on the line the ball's plate stands
 * on, and its chip on the HDG chip's, to the pixel (all four read in one look at the page).
 */
async function onTheDecksLines(page: Page): Promise<void> {
  const [plate = NaN, ball = NaN, range = NaN, heading = NaN] = await page.evaluate(() =>
    ['.minimap__plate', '.flight-deck__plate', '.minimap__range', '.flight-deck__hdg'].map(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? NaN,
    ),
  );
  expect(Math.abs(plate - ball), 'the two plates').toBeLessThanOrEqual(1);
  expect(Math.abs(range - heading), 'the two chips').toBeLessThanOrEqual(1);
}

/**
 * A point of the minimap's face with nothing near it: of a grid of points on the face (6 px
 * apart, none further from its middle than nine tenths of its radius), the one furthest from
 * every mark that shows and from the ship, and how far from them it is, in px. (Where that is
 * depends on where the systems lie, and that is the content's business. The face is round: the
 * corners of the square round it are no part of the minimap.)
 */
function emptyGround(page: Page): Promise<{ x: number; y: number; clear: number }> {
  return page.evaluate(() => {
    const face = document.querySelector('.minimap__map')?.getBoundingClientRect();
    if (!face) throw new Error('no minimap');
    const marks = [
      ...document.querySelectorAll('.minimap__mark:not([data-off]), .minimap__ship'),
    ].map((mark) => {
      const box = mark.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const middle = { x: face.left + face.width / 2, y: face.top + face.height / 2 };
    const reach = 0.9 * (face.width / 2);
    let best = { ...middle, clear: -1 };
    for (let dx = -reach; dx <= reach; dx += 6) {
      for (let dy = -reach; dy <= reach; dy += 6) {
        if (Math.hypot(dx, dy) > reach) continue;
        const [x, y] = [middle.x + dx, middle.y + dy];
        const clear = Math.min(...marks.map((mark) => Math.hypot(mark.x - x, mark.y - y)));
        if (clear > best.clear) best = { x, y, clear };
      }
    }
    return best;
  });
}

/** What the minimap said of a journey while it lasted. */
interface JourneySeen {
  /** What the pill and the chip said while the chip counted, as "name seconds s", in order. */
  counted: string[];
  /** The most points its line was drawn through. */
  points: number;
  /** How much of the clock on the rim was gone (0 to 1), each time that changed, in order. */
  gone: number[];
}

/**
 * From now on, what the minimap shows of a journey, noted by the page itself: a journey is over
 * in a few seconds, and a machine drawing on its CPU may not look while it lasts.
 */
async function watchJourney(page: Page): Promise<() => Promise<JourneySeen>> {
  await page.evaluate(() => {
    const seen: JourneySeen = { counted: [], points: 0, gone: [] };
    (window as unknown as { e2eJourney: JourneySeen }).e2eJourney = seen;
    const root = document.querySelector('.minimap');
    const name = root?.querySelector('.minimap__name b');
    const range = root?.querySelector('.minimap__range');
    const clock = root?.querySelector<SVGElement>('.minimap__left');
    const route = root?.querySelector('.minimap__route');
    if (!root || !name || !range || !clock || !route) return;
    new MutationObserver(() => {
      // The chip counts a journey's seconds only while it says ETA (`data-eta`).
      if (range.hasAttribute('data-eta')) {
        const said = `${name.textContent ?? ''} ${range.querySelector('b')?.textContent ?? ''} s`;
        if (seen.counted.at(-1) !== said) seen.counted.push(said);
      }
      // The clock runs while it is out (no `data-off`): put away, it winds itself up unseen.
      if (!clock.hasAttribute('data-off')) {
        const gone = Number(clock.style.getPropertyValue('--gone'));
        if (seen.gone.at(-1) !== gone) seen.gone.push(gone);
      }
      const points = (route.getAttribute('points') ?? '').split(' ').filter(Boolean).length;
      seen.points = Math.max(seen.points, points);
    }).observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['data-eta', 'data-off', 'style', 'points'],
    });
  });
  return () => page.evaluate(() => (window as unknown as { e2eJourney: JourneySeen }).e2eJourney);
}

/**
 * A finger comes down on open sky, moves and lifts: steering, not a tap (a tap may point at a
 * planet). The first touch on the sky is what brings the boost pad out. Chromium only.
 */
async function steerByFinger(page: Page): Promise<void> {
  const spot = await page.evaluate(() => {
    for (const [x, y] of [
      [160, 300],
      [160, 200],
      [320, 240],
      [240, 420],
    ] as const) {
      if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y };
    }
    return null;
  });
  if (!spot) throw new Error('no open sky to put a finger on');
  const session = await page.context().newCDPSession(page);
  const finger = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy = 0) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: spot.x, y: spot.y - dy, id: 1 }],
    });
  await finger('touchStart');
  for (let step = 1; step <= 4; step += 1) await finger('touchMove', step * 10);
  await finger('touchEnd');
  await session.detach();
}

test.describe('on a laptop', () => {
  // The whole cluster needs a free view of 768 by 576 px: a phone has the strip (below).
  test.skip(({ isMobile }) => isMobile, 'the full deck');

  test('the deck is there in open sky, reads the ship, and leaves with the sky', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await expect(deck(page)).toBeVisible();
    await expect(deck(page)).toHaveAttribute('data-layout', 'full');
    // It arrives; under reduced motion it is simply there (below).
    expect(await deck(page).evaluate((node) => getComputedStyle(node).animationName)).toBe(
      'flight-deck-in',
    );
    // Only its instruments take a press (and do nothing with it): the corners of its box, under
    // the lamps, are the world's.
    expect(
      await deck(page).evaluate((node) => {
        const box = node.getBoundingClientRect();
        const under = (x: number, y: number): string => {
          const hit = document.elementFromPoint(x, y);
          return hit?.closest('.flight-deck') ? 'the deck' : (hit?.tagName ?? 'nothing');
        };
        return [
          under(box.left + 6, box.bottom - 6),
          under(box.right - 6, box.bottom - 6),
          under(box.left + box.width / 2, box.top + box.height / 2),
        ];
      }),
    ).toEqual(['CANVAS', 'CANVAS', 'the deck']);
    // At rest at the spawn point, until the pilot flies.
    await expect(speed(page)).toHaveText('0');
    await expect(page.locator('.flight-deck__hdg b')).toHaveText(/^\d{3}°$/);
    // The minimap beside it is its sibling: plate on plate's line, chip on chip's, at rest...
    await arrived(deck(page));
    await arrived(minimap(page));
    await onTheDecksLines(page);
    await page.keyboard.down('w');
    await expect(speed(page)).not.toHaveText('0');
    // ...and under way.
    await onTheDecksLines(page);
    await page.keyboard.up('w');

    // On the star map the flight controls are off, and so is the deck. M brings both back.
    await page.keyboard.press('m');
    await expect(page.locator('html')).toHaveAttribute('data-map', 'open');
    await expect(deck(page)).toBeHidden();
    await page.keyboard.press('m');
    await expect(page.locator('html')).not.toHaveAttribute('data-map', /.*/);
    await expect(deck(page)).toBeVisible();
  });

  test('nothing in the deck or the minimap takes the focus', async ({ page }) => {
    await openUniverse(page, '/');
    for (const picture of [deck(page), minimap(page)]) {
      await expect(picture).toBeVisible();
      await expect(picture).toHaveAttribute('aria-hidden', 'true');
      expect(await picture.locator('a, button, input, select, textarea, [tabindex]').count()).toBe(
        0,
      );
    }
    // Round the page by Tab: the bar, the names, the Map button, the way to the plain version.
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press('Tab');
      const inPicture = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('.flight-deck, .minimap')),
      );
      expect(inPicture, `Tab ${press + 1}`).toBe(false);
    }
  });

  test('the minimap shows the galaxy, names what a pointer aims at, and a press flies there', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await arrived(minimap(page));
    // The ship starts in open sky, between the systems: the map is fitted to all of them, the
    // pill says so, and the chip says how far the face reaches from its middle.
    await expect(minimap(page)).toHaveAttribute('data-scope', 'galaxy');
    await expect(pill(page)).toHaveText('Galaxy');
    await expect(pill(page)).toBeVisible();
    await expect(chip(page)).toHaveText(/^RANGE\d+(\.\d)?k?m$/);
    // Every system is in its place on the face, none is a pin, and the N marks north.
    await expect(page.locator('.minimap__mark[data-pin]:not([data-off])')).toHaveCount(0);
    await expect(north(page)).toBeVisible();
    expect(
      await overlaps({
        deck: deck(page),
        minimap: minimap(page),
        'the Map button': mapButton(page),
        'the way to the plain version': plainChip(page),
      }),
    ).toEqual([]);
    // Only the round plate and its two chips are the minimap's: the corners of its box are the
    // world's, as the corners of the deck's are.
    expect(
      await page.evaluate(() => {
        const plate = document.querySelector('.minimap__plate')?.getBoundingClientRect();
        if (!plate) throw new Error('no plate');
        const under = (x: number, y: number): string => {
          const hit = document.elementFromPoint(x, y);
          return hit?.closest('.minimap') ? 'the minimap' : (hit?.tagName ?? 'nothing');
        };
        return [
          under(plate.left + 5, plate.bottom - 5),
          under(plate.left + plate.width / 2, plate.top + plate.height / 2),
        ];
      }),
    ).toEqual(['CANVAS', 'the minimap']);

    // A pointer over a sun aims at it: the pill names it, and the cursor says it can be pressed.
    const sun = markOf(page, 'system/hackathons');
    const at = await boxOf(sun);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await expect(pill(page)).toHaveText('Hackathons');
    await expect(minimap(page)).toHaveAttribute('data-pick', '');

    // Pressed, it is the destination: the very journey a press on its name in the sky starts.
    const said = await watchText(page, '.dock-prompt');
    const journey = await watchJourney(page);
    await pointAt(page, sun, false);
    // (Off the plate again: a pointer at rest would aim at whatever the map brings under it.)
    await page.mouse.move(at.x - 200, at.y - 200);
    await expect
      .poll(async () =>
        (await said()).find(
          ({ text }) => text.includes('Flying to Hackathons') && text.includes('Stop'),
        ),
      )
      .toMatchObject({ path: '/' });

    // It docks and its page opens. The deck goes, since somebody is reading; the minimap stays,
    // fitted to the system the ship is now in: the next planet is a press away.
    await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
    await expect(prompt(page)).toContainText('Leave orbit');
    await expect(deck(page)).toBeHidden();
    await expect(minimap(page)).toBeVisible();
    await expect(minimap(page)).toHaveAttribute('data-scope', 'hackathons');
    await expect(pill(page)).toHaveText('Hackathons');
    await expect(minimap(page)).not.toHaveAttribute('data-pick', /.*/);
    // Docked, the pill rests: the page beside the minimap says where the ship is, and the ship
    // it carries round passes just above the plate.
    await expect(pill(page)).toBeHidden();

    // While it flew, the journey read as fast forward: the way that was left as a line from the
    // ship, the pill naming the destination, and the chip counting seconds that only ever went
    // down...
    const { counted, points, gone } = await journey();
    expect(points).toBeGreaterThan(2);
    expect(counted.length).toBeGreaterThan(0);
    for (const shown of counted) expect(shown).toMatch(/^Hackathons \d+ s$/);
    const seconds = counted.map((shown) => Number(/\d+/.exec(shown)?.[0]));
    expect(seconds).toEqual([...seconds].sort((a, b) => b - a));
    // ...while the rim ran down as its clock: more of it gone each time, and never less.
    expect(gone.length).toBeGreaterThan(0);
    for (const share of gone) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
    expect(gone).toEqual([...gone].sort((a, b) => a - b));
    // Arrived: no line, no seconds and no clock; the chip measures the face again, and the ring
    // that says "here" is round the sun the ship is at.
    await expect(page.locator('.minimap__route')).toHaveAttribute('points', '');
    await expect(chip(page)).not.toHaveAttribute('data-eta', /.*/);
    await expect(chip(page)).toHaveText(/^RANGE\d+(\.\d)?k?m$/);
    await expect(page.locator('.minimap__left')).toHaveAttribute('data-off', '');
    await expect(page.locator('.minimap__here')).not.toHaveAttribute('data-off', /.*/);
  });

  test('a press on the minimap where nothing is opens the star map, and both leave for it', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await arrived(minimap(page));
    const ground = await emptyGround(page);
    // Further from every mark than a mouse reaches (12 px past the mark itself).
    expect(ground.clear).toBeGreaterThan(30);
    await page.mouse.click(ground.x, ground.y);
    await expect(page.locator('html')).toHaveAttribute('data-map', 'open');
    // They fade as they leave, and from the first moment of it nothing of them takes a press:
    // what they covered is the map's.
    for (const picture of [deck(page), minimap(page)]) {
      await expect(picture).not.toHaveAttribute('data-shown', /.*/);
      expect(
        await picture.evaluate((node) =>
          [node, ...node.querySelectorAll('*')].every(
            (part) => getComputedStyle(part).pointerEvents === 'none',
          ),
        ),
      ).toBe(true);
    }
    await expect(deck(page)).toBeHidden();
    await expect(minimap(page)).toBeHidden();
    // Nobody flew anywhere for it.
    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');

    await page.keyboard.press('m');
    await expect(page.locator('html')).not.toHaveAttribute('data-map', /.*/);
    await expect(deck(page)).toBeVisible();
    await arrived(minimap(page));

    // The chip under the plate is part of the instrument, and nothing is there either: a press
    // on it opens the map too.
    const range = await boxOf(chip(page));
    await page.mouse.click(range.x + range.width / 2, range.y + range.height / 2);
    await expect(page.locator('html')).toHaveAttribute('data-map', 'open');
    await expect(minimap(page)).toBeHidden();
    expect(pathOf(page)).toBe('/');
  });

  test('docked there is no deck; leaving orbit brings it, and the prompt steps beside it', async ({
    page,
  }) => {
    await openUniverse(page, '/projects/fishai/');
    await expect(prompt(page)).toContainText('Leave orbit');
    // Somebody is reading the page: no deck, and the prompt in the middle of the free view.
    await expect(deck(page)).toBeHidden();
    // The minimap is there all the same, beside the page, fitted to the system the planet is in
    // (FishAI circles Software, one of the two suns of Projects).
    await expect(minimap(page)).toBeVisible();
    await expect(minimap(page)).toHaveAttribute('data-scope', 'projects');
    await expect(pill(page)).toHaveText('Projects');
    expect(await overlaps({ minimap: minimap(page), prompt: prompt(page) })).toEqual([]);
    // Its pill rests while the ship is docked (the page says where it is, and the ship it carries
    // round passes just above the plate), and is back to name what a pointer aims at: here the
    // other sun of the pair. (The marks take no pointer themselves: the plate under them does.)
    await expect(pill(page)).toBeHidden();
    // (That rest is one rule of the stylesheet, which reads from the minimap whether the deck
    // shows: it can only while the deck stands before the minimap in the overlay.)
    expect(
      await page.evaluate(() => document.querySelector('.flight-deck ~ .minimap') !== null),
      'the deck stands before the minimap in the overlay',
    ).toBe(true);
    const other = await boxOf(markOf(page, 'system/hardware'));
    await page.mouse.move(other.x + other.width / 2, other.y + other.height / 2);
    await expect(pill(page)).toBeVisible();
    await expect(pill(page)).toHaveText('Hardware');
    await expect(minimap(page)).toHaveAttribute('data-pick', '');
    await page.mouse.move(other.x - 240, other.y - 240);
    await expect(pill(page)).toBeHidden();
    await expect(pill(page)).toHaveText('Projects');

    await prompt(page).click();
    await expect(deck(page)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-panel', 'closed');
    // Still within reach of the planet: the prompt offers it, to the left of the deck, 12 px
    // clear of it (once the panel has gone and the prompt has slid across).
    await expect(prompt(page)).toContainText('Orbit FishAI');
    await expect
      .poll(async () => {
        const [chip, cluster] = [await boxOf(prompt(page)), await boxOf(deck(page))];
        return Math.round(cluster.x - (chip.x + chip.width));
      })
      .toBe(12);
    // And no two of the things down there share a pixel.
    expect(
      await overlaps({
        deck: deck(page),
        minimap: minimap(page),
        prompt: prompt(page),
        'the Map button': mapButton(page),
        'the way to the plain version': plainChip(page),
      }),
    ).toEqual([]);
  });

  test('the N of the minimap gives way to a pin that stands beside it', async ({ page }) => {
    // Docked at the home planet, the face shows home's own system, and every other system is a
    // pin on the circle just inside its rim. The N stands on that circle too, at twelve: a pin
    // right beside it would read as one sign with it, so the N goes, and the pin stays.
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    await expect(minimap(page)).toBeVisible();
    await expect(minimap(page)).toHaveAttribute('data-scope', 'home');
    const pins = page.locator('.minimap__mark[data-pin]:not([data-off])');
    await expect(pins.first()).toBeVisible();
    // How far the nearest pin's middle is from the N's (12 o'clock, 10 px down the face).
    const nearest = await page.evaluate(() => {
      const face = document.querySelector('.minimap__map')?.getBoundingClientRect();
      if (!face) throw new Error('no minimap');
      const [x, y] = [face.left + face.width / 2, face.top + 10];
      return Math.min(
        ...[...document.querySelectorAll('.minimap__mark[data-pin]:not([data-off])')].map((pin) => {
          const box = pin.getBoundingClientRect();
          return Math.hypot(box.left + box.width / 2 - x, box.top + box.height / 2 - y);
        }),
      );
    });
    // Which system lies which way is the content's business, so this asks either way: nearer
    // than 24 px the N is not shown, further off it is. (A glyph's box is not quite about its
    // middle, hence the 3 px between the two that are asked of nothing. Today Research lies a
    // little west of due north of home, and its pin stands beside the N.)
    if (nearest < 21) await expect(north(page)).toBeHidden();
    if (nearest > 27) await expect(north(page)).toBeVisible();
    // Either way no pin is left to read as one sign with a letter.
    expect(
      await page.evaluate(() => {
        const letter = document.querySelector('.minimap__north');
        if (!letter || getComputedStyle(letter).visibility !== 'visible') return [];
        const n = letter.getBoundingClientRect();
        return [...document.querySelectorAll('.minimap__mark[data-pin]:not([data-off])')]
          .map((pin) => pin.getBoundingClientRect())
          .filter(
            (box) =>
              box.left < n.right + 8 &&
              n.left < box.right + 8 &&
              box.top < n.bottom &&
              n.top < box.bottom,
          )
          .map((box) => `a pin at ${Math.round(box.left)}, ${Math.round(box.top)}`);
      }),
    ).toEqual([]);
  });

  test.describe('in a window too small for the cluster', () => {
    test.use({ viewport: { width: 900, height: 520 } });

    test('the deck is the strip, the Map button’s opposite number', async ({ page }) => {
      await openUniverse(page, '/');
      await expect(deck(page)).toBeVisible();
      await expect(deck(page)).toHaveAttribute('data-layout', 'strip');
      await expect(deck(page)).not.toHaveAttribute('data-seated', /.*/);
      await inTheMapRow(page);
      // No minimap where the cluster has no room: the Map button, beside the strip, is the way.
      await expect(minimap(page)).toBeHidden();
      // As far from the left edge as the button is from the right one.
      const [pill, map] = [await boxOf(deck(page)), await boxOf(mapButton(page))];
      expect(Math.round(pill.x)).toBe(Math.round(900 - (map.x + map.width)));
      await expect(speed(page)).toHaveText('0');
      await page.keyboard.down('w');
      await expect(speed(page)).not.toHaveText('0');
      await page.keyboard.up('w');
    });
  });
});

test.describe('the first visit, on a laptop', () => {
  test.skip(({ isMobile }) => isMobile, 'the full deck');
  test.use({ seenHints: false });

  test('the how-to-fly card and the deck are both there from the first frame', async ({ page }) => {
    await openUniverse(page, '/');
    const card = page.getByRole('complementary', { name: 'How to fly' });
    await expect(card).toBeVisible();
    await expect(deck(page)).toBeVisible();
    await expect(minimap(page)).toBeVisible();
    expect(await overlaps({ deck: deck(page), minimap: minimap(page), 'the card': card })).toEqual(
      [],
    );
  });

  test.describe('in a narrow window', () => {
    // The smallest windows with the whole cluster: the card's right end reaches over the deck's
    // left end there, so it keeps above it.
    test.use({ viewport: { width: 800, height: 700 } });

    test('the card keeps 12 px above the deck', async ({ page }) => {
      await openUniverse(page, '/');
      const card = page.getByRole('complementary', { name: 'How to fly' });
      await expect(deck(page)).toHaveAttribute('data-layout', 'full');
      const [above, below] = [await boxOf(card), await boxOf(deck(page))];
      expect(above.x + above.width).toBeGreaterThan(below.x);
      // The minimap is beyond the deck, and neither of them is on it.
      expect(
        await overlaps({ deck: deck(page), minimap: minimap(page), 'the card': card }),
      ).toEqual([]);
      // Both of them arrive from 8 px below, each in its own time: once they have.
      await expect
        .poll(async () => {
          const [hint, cluster] = [await boxOf(card), await boxOf(deck(page))];
          return Math.round(cluster.y - (hint.y + hint.height));
        })
        .toBe(12);
    });
  });
});

test.describe('with reduced motion', () => {
  test.skip(({ isMobile }) => isMobile, 'the full deck');
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the deck and the minimap are there, without their arrival, and axe has nothing to say', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    for (const picture of [deck(page), minimap(page)]) {
      await expect(picture).toBeVisible();
      expect(await picture.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    }
    // The names in the sky are read too: the first of them are there, and nothing on the page
    // is still fading or sliding (with less motion, next to nothing ever does).
    await expect(page.locator('.body-label[data-shown]').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      violations
        .filter(({ impact }) => impact === 'serious' || impact === 'critical')
        .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join('; ')}`),
    ).toEqual([]);
  });
});

test.describe('on a phone', () => {
  // The strip: one pill in the Map button's row. (A laptop's small window has it too: above.)
  test.skip(({ isMobile }) => !isMobile, 'the strip');

  for (const size of [
    { width: 360, height: 740 },
    { width: 320, height: 568 },
    // Held sideways.
    { width: 740, height: 360 },
  ]) {
    test.describe(`${size.width} by ${size.height}`, () => {
      test.use({ viewport: size });

      test('the strip is in the Map button’s row, clear of it, and nothing scrolls sideways', async ({
        page,
      }) => {
        await openUniverse(page, '/');
        await expect(deck(page)).toBeVisible();
        await expect(deck(page)).toHaveAttribute('data-layout', 'strip');
        // Nothing steps aside for it: the prompt, the pad and the corner chip are where they were.
        await expect(deck(page)).not.toHaveAttribute('data-seated', /.*/);
        await inTheMapRow(page);
        // And no minimap: the Map button, right beside the strip, opens the real one.
        await expect(minimap(page)).toBeHidden();
        expect(await sidewaysScroll(page)).toBe(0);
        expect(
          await overlaps({
            strip: deck(page),
            'the Map button': mapButton(page),
            'the way to the plain version': plainChip(page),
          }),
        ).toEqual([]);
        // The ball, the speed and the heading; the cluster's lamps, arcs and chevrons are not there.
        await expect(speed(page)).toHaveText('0');
        await expect(page.locator('.flight-deck__hdg b')).toHaveText(/^\d{3}°$/);
        await expect(page.locator('.flight-deck__plate')).toBeVisible();
        for (const part of ['lamp', 'arc', 'warp', 'lit']) {
          await expect(page.locator(`.flight-deck__${part}`).first(), part).toBeHidden();
        }
      });
    });
  }

  test('with a page open there is no deck, and leaving orbit brings the strip', async ({
    page,
  }) => {
    await openUniverse(page, '/projects/fishai/');
    await expect(prompt(page)).toContainText('Leave orbit');
    // Under the sheet's strip of sky there is no room for it, and somebody is reading.
    await expect(deck(page)).toHaveAttribute('data-layout', 'off');
    await expect(deck(page)).toBeHidden();

    await prompt(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-panel', 'closed');
    await expect(deck(page)).toHaveAttribute('data-layout', 'strip');
    await expect(deck(page)).toBeVisible();
    await expect(prompt(page)).toContainText('Orbit FishAI');
    await inTheMapRow(page);
    expect(
      await overlaps({
        strip: deck(page),
        prompt: prompt(page),
        'the Map button': mapButton(page),
        'the way to the plain version': plainChip(page),
      }),
    ).toEqual([]);
  });

  test('on a journey the lit lamp’s name takes the heading’s place, and the pill keeps its size', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await expect(deck(page)).toBeVisible();
    // A journey home is over in two or three seconds: what the strip showed while it lasted,
    // noted by the page itself each time the lamp's name changed.
    await page.evaluate(() => {
      const root = document.querySelector('.flight-deck');
      const lit = root?.querySelector('.flight-deck__lit');
      const heading = root?.querySelector('.flight-deck__hdg');
      const seen: { lit: string; width: number; heading: boolean }[] = [];
      (window as unknown as { e2eStrip: typeof seen }).e2eStrip = seen;
      if (!root || !lit || !heading) return;
      new MutationObserver(() => {
        seen.push({
          lit: lit.textContent ?? '',
          width: Math.round(root.getBoundingClientRect().width),
          heading: getComputedStyle(heading).display !== 'none',
        });
      }).observe(lit, { childList: true, characterData: true, subtree: true });
    });
    await pointAt(page, nameOf(page, 'About Me'), true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { e2eStrip: { lit: string; width: number; heading: boolean }[] }
          ).e2eStrip.find(({ lit }) => lit === 'Auto'),
        ),
      )
      .toEqual({ lit: 'Auto', width: 124, heading: false });
    // It docks, the page opens in the sheet, and the deck is gone.
    await expect(prompt(page)).toContainText('Leave orbit', { timeout: 75_000 });
    await expect(deck(page)).toBeHidden();
  });
});

test.describe('under a finger, on a screen with room for the cluster', () => {
  test.skip(({ isMobile }) => !isMobile, 'a touch screen');
  // A tablet held sideways.
  test.use({ viewport: { width: 1024, height: 768 } });

  test('the minimap keeps above the boost pad, and a finger on a mark flies there', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await expect(deck(page)).toHaveAttribute('data-layout', 'full');
    await arrived(minimap(page));
    const before = await boxOf(minimap(page));

    // The first touch on the sky brings the pad out, in the corner below the minimap, which is
    // where it was: it stood clear of the pad's place all along.
    const pad = page.locator('.touch-boost');
    await expect(pad).toBeHidden();
    await steerByFinger(page);
    await expect(pad).toBeVisible();
    const [map, boost] = [await boxOf(minimap(page)), await boxOf(pad)];
    expect(map).toEqual(before);
    expect(Math.round(boost.y - (map.y + map.height))).toBe(12);
    expect(
      await overlaps({
        deck: deck(page),
        minimap: minimap(page),
        'the boost pad': pad,
        'the Map button': mapButton(page),
        'the way to the plain version': plainChip(page),
      }),
    ).toEqual([]);

    // A finger on a sun's mark: down aims, up flies there.
    const said = await watchText(page, '.dock-prompt');
    await pointAt(page, markOf(page, 'system/hackathons'), true);
    await expect
      .poll(async () => (await said()).some(({ text }) => text.includes('Flying to Hackathons')))
      .toBe(true);
    await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
    await expect(prompt(page)).toContainText('Leave orbit');
  });
});

test.describe('the first visit, on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the strip');
  test.use({ seenHints: false });

  test('the strip waits for the how-to-fly card', async ({ page }) => {
    await openUniverse(page, '/');
    const card = page.getByRole('complementary', { name: 'How to fly' });
    await expect(card).toBeVisible();
    // It is the strip, and it would show; but the card speaks first.
    await expect(deck(page)).toHaveAttribute('data-layout', 'strip');
    await expect(deck(page)).toHaveAttribute('data-shown', '');
    await expect(deck(page)).toBeHidden();
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();
    await expect(deck(page)).toBeVisible();
    await inTheMapRow(page);
  });
});

// THE MINIMAP'S TWO SIZES (the stylesheet's `--minimap-size` and `--minimap-held`): under a mouse
// its plate is a fifth larger in flight, and while the ship is docked it holds the size it always
// had, since the carried ship passes right above it. It eases from one to the other, and the
// drawing on its face follows. (Under a finger it holds the smaller size always: the tablet's
// test above stands as it was.)
test.describe('the minimap’s two sizes', () => {
  test.skip(({ isMobile }) => isMobile, 'the full deck, under a mouse');

  /** How wide the minimap's round plate is right now, in whole px. */
  const plateWidth = (page: Page): Promise<number> =>
    page
      .locator('.minimap__plate')
      .evaluate((plate) => Math.round(plate.getBoundingClientRect().width));

  /** The changes of size that are under way or waiting on the minimap: none while it rests. */
  const sizing = (page: Page): Promise<string[]> =>
    minimap(page).evaluate((node) =>
      node
        .getAnimations({ subtree: true })
        .filter((animation): animation is CSSTransition => animation instanceof CSSTransition)
        .map((transition) => transition.transitionProperty)
        .filter((property) => property === 'width' || property === 'height'),
    );

  /** The face is drawn to its own size: one unit of the drawing is one CSS px. */
  const faceDrawnAt = (page: Page): Promise<string | null> =>
    page.locator('.minimap__map').getAttribute('viewBox');

  for (const [width, height, plate] of [
    [1280, 576, 176],
    [1280, 800, 212],
    [1600, 900, 220],
  ] as const) {
    test.describe(`in flight, ${width} by ${height}`, () => {
      test.use({ viewport: { width, height } });

      test(`the plate is ${plate} px across from the first frame, on the ball’s line`, async ({
        page,
      }) => {
        await openUniverse(page, '/');
        await expect(minimap(page)).toBeVisible();
        // It does not grow in: it is this size when it first shows, and no change is under way.
        expect(await plateWidth(page)).toBe(plate);
        expect(await sizing(page)).toEqual([]);
        await arrived(deck(page));
        await arrived(minimap(page));
        expect(await plateWidth(page)).toBe(plate);
        expect(await faceDrawnAt(page)).toBe(`0 0 ${plate - 28} ${plate - 28}`);
        // Still the ball's sibling, and still clear of everything else down there.
        await onTheDecksLines(page);
        expect(
          await overlaps({
            deck: deck(page),
            minimap: minimap(page),
            'the Map button': mapButton(page),
            'the way to the plain version': plainChip(page),
          }),
        ).toEqual([]);
      });
    });
  }

  test.describe('beside a page, 1600 by 900', () => {
    test.use({ viewport: { width: 1600, height: 900 } });

    test('docked it holds the smaller size; it grows once the ship has left, and shrinks as it docks', async ({
      page,
    }) => {
      await openUniverse(page, '/projects/fishai/');
      await expect(prompt(page)).toContainText('Leave orbit');
      await expect(minimap(page)).toBeVisible();
      expect(await plateWidth(page)).toBe(184);
      expect(await sizing(page)).toEqual([]);
      expect(await faceDrawnAt(page)).toBe('0 0 156 156');

      // Leaving: the deck comes, and the plate grows after it (it waits until the ship is on its
      // way back to the middle of the view: the size is asked for, never a number of seconds).
      await prompt(page).click();
      await expect(deck(page)).toBeVisible();
      await expect.poll(() => plateWidth(page)).toBe(220);
      await expect.poll(() => sizing(page)).toEqual([]);
      await expect.poll(() => faceDrawnAt(page)).toBe('0 0 192 192');
      await arrived(deck(page));
      await onTheDecksLines(page);

      // And back into orbit: the plate is its smaller self again, with the drawing on it.
      await expect(prompt(page)).toContainText('Orbit FishAI');
      await prompt(page).click();
      await expect(prompt(page)).toContainText('Leave orbit', FLIGHT);
      await expect.poll(() => plateWidth(page)).toBe(184);
      await expect.poll(() => faceDrawnAt(page)).toBe('0 0 156 156');
      expect(await overlaps({ minimap: minimap(page), prompt: prompt(page) })).toEqual([]);
    });
  });

  // The narrowest windows that have the cluster: the larger plate comes closest to the deck there.
  for (const [height, plate, gap] of [
    [576, 176, 64],
    [900, 220, 20],
  ] as const) {
    test.describe(`in the narrowest window with the cluster, 768 by ${height}`, () => {
      test.use({ viewport: { width: 768, height } });

      test(`nothing down there shares a pixel, and the plate keeps ${gap} px from the deck`, async ({
        page,
      }) => {
        // Out of an orbit, so that the prompt is there too: "Orbit FishAI", beside the deck.
        await openUniverse(page, '/projects/fishai/');
        await expect(prompt(page)).toContainText('Leave orbit');
        await prompt(page).click();
        await expect(deck(page)).toHaveAttribute('data-layout', 'full');
        await expect(deck(page)).toBeVisible();
        await expect(prompt(page)).toContainText('Orbit FishAI');
        await expect.poll(() => plateWidth(page)).toBe(plate);
        await expect.poll(() => sizing(page)).toEqual([]);
        // (Once the panel has gone and the prompt has slid across.)
        await expect
          .poll(async () => {
            const [chip, cluster] = [await boxOf(prompt(page)), await boxOf(deck(page))];
            return Math.round(cluster.x - (chip.x + chip.width));
          })
          .toBe(12);
        expect(
          await overlaps({
            deck: deck(page),
            minimap: minimap(page),
            prompt: prompt(page),
            'the Map button': mapButton(page),
            'the way to the plain version': plainChip(page),
          }),
        ).toEqual([]);
        const [cluster, scope] = [await boxOf(deck(page)), await boxOf(minimap(page))];
        expect(Math.round(scope.x - (cluster.x + cluster.width))).toBe(gap);
        await onTheDecksLines(page);
      });
    });
  }
});
