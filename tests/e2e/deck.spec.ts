// The flight deck (src/universe/ui/FlightDeck.ts): KSP's cluster of instruments at the bottom of
// the view, which only READS the simulation. So these tests ask what it shows and where it sits,
// and that nothing else moved out of reach for it: the prompt steps beside it, the how-to-fly card
// keeps above it, and neither a keyboard nor a screen reader ever meets it. A view too small for
// the cluster (a phone) has the strip instead, in the Map button's row, and nothing moves for it.
//
// And the minimap beside it (src/universe/ui/MiniMap.ts): the star map at another size, there
// wherever the cluster has room, flying or docked. A press on a mark is pointing at that body,
// and a press where nothing is opens the map it is the preview of.

import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, nameOf, openUniverse, pointAt, test, watchText } from './support';

const deck = (page: Page) => page.locator('.flight-deck');
const minimap = (page: Page) => page.locator('.minimap');
const caption = (page: Page) => page.locator('.minimap__caption');
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
 * A point of the minimap's ground with nothing near it: the corner of the map that is furthest
 * from every mark that shows and from the ship, and how far from them it is, in px. (Which corner
 * that is depends on where the systems lie, and that is the content's business.)
 */
function emptyGround(page: Page): Promise<{ x: number; y: number; clear: number }> {
  return page.evaluate(() => {
    const map = document.querySelector('.minimap__map')?.getBoundingClientRect();
    if (!map) throw new Error('no minimap');
    const marks = [
      ...document.querySelectorAll('.minimap__mark:not([data-off]), .minimap__ship'),
    ].map((mark) => {
      const box = mark.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const inset = 10;
    return [
      { x: map.left + inset, y: map.top + inset },
      { x: map.right - inset, y: map.top + inset },
      { x: map.left + inset, y: map.bottom - inset },
      { x: map.right - inset, y: map.bottom - inset },
    ]
      .map(({ x, y }) => ({
        x,
        y,
        clear: Math.min(...marks.map((mark) => Math.hypot(mark.x - x, mark.y - y))),
      }))
      .reduce((best, corner) => (corner.clear > best.clear ? corner : best));
  });
}

/** What the minimap said of a journey while it lasted. */
interface JourneySeen {
  /** Each caption that had seconds in it, as "name seconds", in the order they were shown. */
  captions: string[];
  /** The most points its line was drawn through. */
  points: number;
}

/**
 * From now on, what the minimap shows of a journey, noted by the page itself: a journey is over
 * in a few seconds, and a machine drawing on its CPU may not look while it lasts.
 */
async function watchJourney(page: Page): Promise<() => Promise<JourneySeen>> {
  await page.evaluate(() => {
    const seen: JourneySeen = { captions: [], points: 0 };
    (window as unknown as { e2eJourney: JourneySeen }).e2eJourney = seen;
    const label = document.querySelector('.minimap__caption');
    const route = document.querySelector('.minimap__route');
    if (!label || !route) return;
    new MutationObserver(() => {
      const seconds = label.querySelector('small')?.textContent ?? '';
      const said = `${label.querySelector('b')?.textContent ?? ''} ${seconds}`;
      if (seconds !== '' && seen.captions.at(-1) !== said) seen.captions.push(said);
    }).observe(label, { subtree: true, childList: true, characterData: true });
    new MutationObserver(() => {
      const points = (route.getAttribute('points') ?? '').split(' ').filter(Boolean).length;
      seen.points = Math.max(seen.points, points);
    }).observe(route, { attributes: true });
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
    // At rest at the spawn point, until the pilot flies.
    await expect(speed(page)).toHaveText('0');
    await expect(page.locator('.flight-deck__hdg b')).toHaveText(/^\d{3}°$/);
    await page.keyboard.down('w');
    await expect(speed(page)).not.toHaveText('0');
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
    // The ship starts in open sky, between the systems: the map is fitted to all of them.
    await expect(minimap(page)).toHaveAttribute('data-scope', 'galaxy');
    await expect(caption(page)).toHaveText('Galaxy');
    expect(
      await overlaps({
        deck: deck(page),
        minimap: minimap(page),
        'the Map button': mapButton(page),
        'the way to the plain version': plainChip(page),
      }),
    ).toEqual([]);

    // A pointer over a sun aims at it: the caption names it, and the cursor says it can be pressed.
    const sun = markOf(page, 'system/hackathons');
    const at = await boxOf(sun);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await expect(caption(page)).toHaveText('Hackathons');
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
    await expect(caption(page)).toHaveText('Hackathons');
    await expect(minimap(page)).not.toHaveAttribute('data-pick', /.*/);

    // While it flew, the journey read as fast forward: the way that was left as a line from the
    // ship, and the caption naming the destination over seconds that only ever went down.
    const { captions, points } = await journey();
    expect(points).toBeGreaterThan(2);
    expect(captions.length).toBeGreaterThan(0);
    for (const shown of captions) expect(shown).toMatch(/^Hackathons \d+ s$/);
    const seconds = captions.map((shown) => Number(/\d+/.exec(shown)?.[0]));
    expect(seconds).toEqual([...seconds].sort((a, b) => b - a));
    // Arrived: no line and no seconds, and the ring that says "here" round the sun it is at.
    await expect(page.locator('.minimap__route')).toHaveAttribute('points', '');
    await expect(page.locator('.minimap__caption small')).toBeEmpty();
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
    await expect(deck(page)).toBeHidden();
    await expect(minimap(page)).toBeHidden();
    // Nobody flew anywhere for it.
    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');

    await page.keyboard.press('m');
    await expect(page.locator('html')).not.toHaveAttribute('data-map', /.*/);
    await expect(deck(page)).toBeVisible();
    await expect(minimap(page)).toBeVisible();
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
    await expect(caption(page)).toHaveText('Projects');
    expect(await overlaps({ minimap: minimap(page), prompt: prompt(page) })).toEqual([]);

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
    await page.waitForTimeout(400); // the names in the sky have finished fading in
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
