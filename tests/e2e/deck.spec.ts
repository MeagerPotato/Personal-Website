// The flight deck (src/universe/ui/FlightDeck.ts): KSP's cluster of instruments at the bottom of
// the view, which only READS the simulation. So these tests ask what it shows and where it sits,
// and that nothing else moved out of reach for it: the prompt steps beside it, the how-to-fly card
// keeps above it, and neither a keyboard nor a screen reader ever meets it.

import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, openUniverse, test } from './support';

const deck = (page: Page) => page.locator('.flight-deck');
const prompt = (page: Page) => page.locator('.dock-prompt');
const speed = (page: Page) => page.locator('.flight-deck__speed b');

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

  test('nothing in it takes the focus', async ({ page }) => {
    await openUniverse(page, '/');
    await expect(deck(page)).toBeVisible();
    await expect(deck(page)).toHaveAttribute('aria-hidden', 'true');
    expect(await deck(page).locator('a, button, input, select, textarea, [tabindex]').count()).toBe(
      0,
    );
    // Round the page by Tab: the bar, the names, the Map button, the way to the plain version.
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press('Tab');
      const inDeck = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('.flight-deck')),
      );
      expect(inDeck, `Tab ${press + 1}`).toBe(false);
    }
  });

  test('docked there is no deck; leaving orbit brings it, and the prompt steps beside it', async ({
    page,
  }) => {
    await openUniverse(page, '/projects/fishai/');
    await expect(prompt(page)).toContainText('Leave orbit');
    // Somebody is reading the page: no deck, and the prompt in the middle of the free view.
    await expect(deck(page)).toBeHidden();

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
        prompt: prompt(page),
        'the Map button': page.locator('.map-toggle'),
        'the way to the plain version': page.locator('.mode-link--to-plain'),
      }),
    ).toEqual([]);
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
    expect(await overlaps({ deck: deck(page), 'the card': card })).toEqual([]);
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

  test('the deck is there, without its arrival, and axe has nothing to say about it', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await expect(deck(page)).toBeVisible();
    expect(await deck(page).evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
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
