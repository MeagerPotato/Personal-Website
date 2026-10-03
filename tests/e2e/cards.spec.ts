// The deck of cards in real browsers (src/shell/cards.ts and deck.ts; "the deck" in
// src/styles/global.css). On a wide screen a page's cards stand in two columns round the body it
// belongs to; the URL's fragment says which one is open, and none is the overview. What is
// measured here is what the stylesheet and the shell promise each other: two columns and nothing
// on top of anything, the fragment as the one state, and a keyboard that never rests on something
// it cannot see.
//
// The desktop projects run at 1280 x 800 and see the deck. Run this file as a spec:
//   npx playwright test tests/e2e/cards.spec.ts

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  collectErrors,
  engineReady,
  expect,
  openUniverse,
  pageContent,
  softNavigate,
  test,
  universe,
} from './support';

const html = (page: Page) => page.locator('html');
const heading = (page: Page) => page.locator('main h1');
const title = (page: Page, id: string) => page.locator(`#${id} > a`);
const prompt = (page: Page) => page.locator('.dock-prompt');
const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name });
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const hashOf = (page: Page): string => new URL(page.url()).hash;

/** The titles of the About page's cards, in the page's order: three under the head, five beside. */
const ABOUT = [
  'about-intro',
  'berkeley',
  'rockets',
  'robots',
  'security',
  'software',
  'work',
  'community',
] as const;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the cards are (the head first), the stage they stand in, and what is left free: once
 * the cards are at rest. They arrive, and are carried from place to place, by animations that
 * move what is seen and not what is laid out; what is measured is where they end up.
 */
async function layout(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return !target?.closest('#main');
    }),
  );
  return page.evaluate(() => {
    const boxOf = (element: Element): Box => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const style = getComputedStyle(document.documentElement);
    return {
      cards: [...document.querySelectorAll('#main > [data-card]')].map(boxOf),
      stage: boxOf(document.querySelector('.panel') as Element),
      free: {
        left: Number.parseFloat(style.getPropertyValue('--panel-inset-left')),
        right: Number.parseFloat(style.getPropertyValue('--panel-inset-right')),
      },
      width: innerWidth,
    };
  });
}

/** Everything wrong with a deck, in words: none is the stylesheet's promise. */
function problems({ cards, stage }: { cards: Box[]; stage: Box }): string[] {
  const found: string[] = [];
  const columns = new Set(cards.map((card) => Math.round(card.left)));
  if (columns.size !== 2) found.push(`${columns.size} column edges`);
  cards.forEach((card, index) => {
    if (
      card.left < stage.left - 0.5 ||
      card.top < stage.top - 0.5 ||
      card.right > stage.right + 0.5 ||
      card.bottom > stage.bottom + 0.5
    )
      found.push(`card ${index} is outside the stage`);
    cards.slice(index + 1).forEach((other, next) => {
      if (
        card.left < other.right &&
        other.left < card.right &&
        card.top < other.bottom &&
        other.top < card.bottom
      )
        found.push(`card ${index} is over card ${index + 1 + next}`);
    });
  });
  // Reading order is the page's order: down the left column, then down the right one.
  const seen = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => a.card.left - b.card.left || a.card.top - b.card.top)
    .map(({ index }) => index);
  if (seen.some((index, place) => index !== place))
    found.push(`read in the order ${seen.join(' ')}`);
  return found;
}

/** What the deck writes on <html>, and the fragment it follows from. */
const state = (page: Page) =>
  page.evaluate(() => ({
    hash: location.hash,
    open: document.documentElement.dataset.cardOpen ?? null,
    side: document.documentElement.dataset.cardSide ?? null,
    mates: document.documentElement.style.getPropertyValue('--deck-mates') || null,
  }));

const OVERVIEW = { hash: '', open: null, side: null, mates: null };

/**
 * One notch of a mouse wheel over the open sky, then a pause: two turns of the wheel count as
 * two only if they are apart (a gesture ends after 250 ms, and steps are 400 ms apart: deck.ts).
 * The pause is part of the input, as the time between a finger's down and up is.
 */
async function notch(page: Page, dy: number): Promise<void> {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(450);
}

async function seriousIssues(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(
      ({ id, help, nodes }) =>
        `${id}: ${help} (${nodes.map(({ target }) => target.join(' ')).join('; ')})`,
    );
}

test.describe('on a wide screen', () => {
  test.skip(({ isMobile }) => isMobile, 'the deck needs 1280 px');

  test('the cards stand in two columns, none over another, in every state and at every size', async ({
    page,
  }) => {
    test.slow();
    const errors = collectErrors(page);
    await openUniverse(page, '/about/');
    await expect(html(page)).not.toHaveAttribute('data-card-open');

    // The smallest deck, the tests' own size, and a desktop monitor.
    for (const size of [
      { width: 1280, height: 576 },
      { width: 1280, height: 800 },
      { width: 1920, height: 1080 },
    ]) {
      const at = `${size.width} x ${size.height}`;
      await page.setViewportSize(size);
      const overview = await layout(page);
      expect(overview.cards).toHaveLength(ABOUT.length + 1);
      expect(problems(overview), `${at}, the overview`).toEqual([]);

      for (const [index, id] of ABOUT.entries()) {
        await title(page, id).click();
        await expect(html(page)).toHaveAttribute('data-card-open', String(index + 1));
        const open = await layout(page);
        expect(problems(open), `${at}, ${id} open`).toEqual([]);
        // The open card is the wide one, and every other card a title row (44 px).
        const heights = open.cards.map((card) => Math.round(card.bottom - card.top));
        expect(heights[index + 1], `${at}, ${id} open`).toBeGreaterThan(44);
        expect(
          heights.filter((_, card) => card !== index + 1),
          `${at}, ${id} open`,
        ).toEqual(Array.from({ length: ABOUT.length }, () => 44));
        // What is left free is everything between the columns, less 24 px on each side: there
        // the body is framed, and the engine's own controls stand.
        const head = open.cards[0];
        const last = open.cards.at(-1);
        expect(open.free.left).toBe(Math.round((head?.right ?? NaN) + 24));
        expect(open.free.right).toBe(Math.round(open.width - (last?.left ?? NaN) + 24));
      }
      await page.keyboard.press('Escape');
      await expect(html(page)).not.toHaveAttribute('data-card-open');
    }

    // Other pages, at the smallest size: a head with crumbs and a lede, cards with tables,
    // pictures and lists; a page with one section, and one with a sun to each card.
    await page.setViewportSize({ width: 1280, height: 576 });
    for (const path of ['/projects/fishai/', '/resume/', '/contact/', '/projects/']) {
      await softNavigate(page, path);
      const overview = await layout(page);
      expect(problems(overview), `${path}, the overview`).toEqual([]);
      const ids = await page
        .locator('#main > [data-card] > h2')
        .evaluateAll((titles) => titles.map((heading) => heading.id));
      expect(ids).toHaveLength(overview.cards.length - 1);
      for (const [index, id] of ids.entries()) {
        await title(page, id).click();
        await expect(html(page)).toHaveAttribute('data-card-open', String(index + 1));
        expect(problems(await layout(page)), `${path}, ${id} open`).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
  });

  test('a title opens its card: the fragment says so, and history gains nothing', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await navLink(page, 'About').click();
    await expect(heading(page)).toBeFocused();
    expect(await state(page)).toEqual(OVERVIEW);
    const entries = await page.evaluate(() => history.length);

    // The third section stands in the left column, which it shares with three others.
    await title(page, 'rockets').click();
    await expect(page).toHaveURL(/\/about\/#rockets$/);
    expect(await state(page)).toEqual({ hash: '#rockets', open: '3', side: 'left', mates: '3' });
    // One in the right column, straight from the first.
    await title(page, 'work').click();
    expect(await state(page)).toEqual({ hash: '#work', open: '7', side: 'right', mates: '4' });
    // Its own title closes it again.
    await title(page, 'work').click();
    await expect(page).toHaveURL(/\/about\/$/);
    expect(await state(page)).toEqual(OVERVIEW);
    // A press anywhere in a short card opens it: here in the text under its title.
    await page
      .locator('#main > [data-card]')
      .nth(2)
      .click({ position: { x: 150, y: 70 } });
    expect(await state(page)).toEqual({ hash: '#berkeley', open: '2', side: 'left', mates: '3' });
    // And a press on the head, which is then the page's title alone, shows every card again.
    await page
      .locator('#main > [data-card]')
      .first()
      .click({ position: { x: 120, y: 22 } });
    expect(await state(page)).toEqual(OVERVIEW);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    // The page's own content was never written to: it is what a fresh load builds.
    const soft = await pageContent(page);

    // And Close still means leave: Back to the sky, as if no card had been opened.
    await title(page, 'security').click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(html(page)).toHaveAttribute('data-panel', 'closed');
    expect(pathOf(page)).toBe('/');
    expect(await page.evaluate(() => history.length)).toBe(entries);
    expect(await state(page)).toEqual(OVERVIEW);

    await page.goto(universe('/about/'));
    expect((await pageContent(page)).main).toBe(soft.main);
  });

  test('the wheel steps through the cards and back, and never opens the map there', async ({
    page,
  }) => {
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    const entries = await page.evaluate(() => history.length);

    await notch(page, 120);
    expect(await state(page)).toMatchObject({ hash: '#about-intro', open: '1' });
    await notch(page, 120);
    expect(await state(page)).toMatchObject({ hash: '#berkeley', open: '2' });
    // A screen reader hears where that is; the focus was on nothing, and stays there.
    await expect(page.locator('[data-announcer]')).toHaveText('Berkeley, section 2 of 8');
    await notch(page, -120);
    await notch(page, -120);
    expect(await state(page)).toEqual(OVERVIEW);
    // Up from the overview is nowhere, and a long way down is one card at a time.
    await notch(page, -480);
    expect(await state(page)).toEqual(OVERVIEW);
    await notch(page, 480);
    expect(await state(page)).toMatchObject({ open: '1' });

    await expect(html(page)).not.toHaveAttribute('data-map');
    expect(await page.evaluate(() => history.length)).toBe(entries);
    expect(pathOf(page)).toBe('/about/');

    // Over the open sky the wheel is the map's, as it always was.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-panel', 'closed');
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 240);
    await expect(html(page)).toHaveAttribute('data-map', 'open');
  });

  test('a card too long for its column scrolls inside itself, and the scroll keys read on', async ({
    page,
  }) => {
    // The smallest deck: FishAI's table of bots does not fit beside two title rows.
    await page.setViewportSize({ width: 1280, height: 576 });
    await openUniverse(page, '/projects/fishai/');
    const card = page.locator('#main > [data-card]').nth(3);
    const scrolled = () => card.evaluate((element) => Math.round(element.scrollTop));
    /** How far it can still scroll down (a key scrolls while that is a pixel or more). */
    const room = () =>
      card.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);

    // The focus is on nothing: Page Down is the cards' key, and opens the first card.
    await page.keyboard.press('PageDown');
    await expect(page).toHaveURL(/#project-glance$/);
    await expect(page.locator('[data-announcer]')).toHaveText('At a glance, section 1 of 5');
    await title(page, 'the-bots').click();
    await expect(page).toHaveURL(/#the-bots$/);
    expect(await room()).toBeGreaterThan(100);

    // The wheel scrolls it from anywhere on the page, and never steps on in the same turn.
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 60);
    await expect.poll(scrolled).toBe(60);
    await page.waitForTimeout(300);

    // The keys read it to its end, and only then go on to the next card.
    for (let presses = 0; presses < 8 && (await room()) >= 1; presses += 1) {
      const before = await scrolled();
      await page.keyboard.press('PageDown');
      await expect.poll(scrolled).toBeGreaterThan(before);
      // The scroll eases: wait until it has arrived before asking again.
      await expect
        .poll(async () => {
          const now = await scrolled();
          await page.waitForTimeout(80);
          return (await scrolled()) === now;
        })
        .toBe(true);
      await expect(page).toHaveURL(/#the-bots$/);
    }
    expect(await room()).toBeLessThan(1);
    await page.keyboard.press('PageDown');
    await expect(page).toHaveURL(/#what-the-lab-found$/);
    // The card that closed is back at its top, for whoever opens it again.
    expect(await scrolled()).toBe(0);
  });

  test('a hard load of a card is what opening it by hand comes to', async ({ page, context }) => {
    await openUniverse(page, '/');
    await navLink(page, 'About').click();
    await expect(heading(page)).toBeFocused();
    await title(page, 'rockets').click();
    await expect(page).toHaveURL(/\/about\/#rockets$/);

    const fresh = await context.newPage();
    await fresh.goto(`${universe('/about/')}#rockets`);
    await engineReady(fresh);
    expect(await state(fresh)).toEqual(await state(page));
    const round = ({ cards }: { cards: Box[] }) =>
      cards.map((card) => Object.values(card).map((edge) => Math.round(edge)));
    // (Once the typeface has arrived: the open card is as tall as its lines.)
    const soft = round(await layout(page));
    await expect.poll(async () => round(await layout(fresh))).toEqual(soft);
    expect(await pageContent(fresh)).toEqual(await pageContent(page));
    // A deep link takes no focus, as a page's own does not.
    expect(await fresh.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test('Back leaves the page, however many cards were opened, and comes back to the open one', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await navLink(page, 'About').click();
    await expect(heading(page)).toBeFocused();
    for (const id of ['berkeley', 'robots', 'community']) {
      await title(page, id).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
    }

    // One step back is the sky: the cards were places in the page, not pages.
    await page.goBack();
    await expect(html(page)).toHaveAttribute('data-panel', 'closed');
    expect(pathOf(page)).toBe('/');
    await page.goForward();
    await expect(heading(page)).toHaveText('About Me');
    await expect.poll(() => state(page)).toMatchObject({ hash: '#community', open: '8' });

    // On to another page and back: the card that was open is open.
    await navLink(page, 'Contact').click();
    await expect(heading(page)).toHaveText('Contact');
    expect(await state(page)).toEqual(OVERVIEW);
    await page.goBack();
    await expect(heading(page)).toHaveText('About Me');
    await expect
      .poll(() => state(page))
      .toEqual({ hash: '#community', open: '8', side: 'right', mates: '4' });
  });

  test('Escape closes the map first, then the card, then the page', async ({ page }) => {
    await page.goto(`${universe('/about/')}#rockets`);
    await engineReady(page);
    await expect(html(page)).toHaveAttribute('data-card-open', '3');

    await page.keyboard.press('m');
    await expect(html(page)).toHaveAttribute('data-map', 'open');
    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-map');
    await expect(html(page)).toHaveAttribute('data-card-open', '3');

    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-card-open');
    await expect(html(page)).toHaveAttribute('data-panel', 'open');
    expect(pathOf(page)).toBe('/about/');
    expect(hashOf(page)).toBe('');

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-panel', 'closed');
    expect(pathOf(page)).toBe('/');
  });

  test('the keyboard walks the cards in reading order and never rests on something clipped', async ({
    page,
    browserName,
  }) => {
    // Safari's Tab stops at fields and buttons and leaves links out, unless the visitor has
    // asked for them; Playwright's WebKit has no such setting. There the focus is put on each
    // stop in turn, which is what Tab comes to: the order is the page's either way.
    const next = (stop: number): Promise<void> =>
      browserName === 'webkit'
        ? page.evaluate(
            (index) => (window as unknown as { e2eStops: HTMLElement[] }).e2eStops[index]?.focus(),
            stop,
          )
        : page.keyboard.press('Tab');
    await openUniverse(page, '/about/');
    // Everything in the content that Tab stops at, in the page's order.
    const stops = await page.evaluate(() => {
      const found = [...document.querySelectorAll<HTMLElement>('#main a[href], #main button')];
      (window as unknown as { e2eStops: HTMLElement[] }).e2eStops = found;
      return found.map((stop) =>
        stop.closest('h2') ? `title:${stop.closest('h2')?.id}` : 'inside',
      );
    });
    expect(stops.filter((stop) => stop.startsWith('title:'))).toEqual(
      ABOUT.map((id) => `title:${id}`),
    );

    // From Close, the first control of the content: every Tab is the next stop, and shows.
    await page.getByRole('button', { name: 'Close' }).focus();
    for (const [index, stop] of stops.entries()) {
      await next(index);
      const now = await page.evaluate(() => {
        const focused = document.activeElement as HTMLElement;
        const card = focused.closest('[data-card]');
        if (!card) return { stop: -1, shows: false, open: null, card: -1 };
        const box = focused.getBoundingClientRect();
        const within = card.getBoundingClientRect();
        return {
          stop: (window as unknown as { e2eStops: HTMLElement[] }).e2eStops.indexOf(focused),
          // Inside its card's box, top to bottom: not under a fade, not past a clipped edge.
          shows: box.top >= within.top - 1 && box.bottom <= within.bottom + 1,
          open: document.documentElement.dataset.cardOpen ?? null,
          card: [...(card.parentElement?.children ?? [])].indexOf(card),
        };
      });
      expect(now.stop, `Tab ${index + 1}`).toBe(index);
      expect(now.shows, `Tab ${index + 1} (${stop}) shows`).toBe(true);
      // A title shows in every state and opens nothing; anything else is in the open card.
      if (stop === 'inside') expect(now.open, `Tab ${index + 1}`).toBe(String(now.card));
    }

    // Enter on a title opens its card, and again closes it: the focus stays on the title.
    await title(page, 'security').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#security$/);
    await expect(title(page, 'security')).toBeFocused();
    // With the focus in the content the arrows and Page Down are the cards' too: at the end of
    // this short card, on to the next, and the focus goes with it.
    await page.keyboard.press('PageDown');
    await expect(page).toHaveURL(/#software$/);
    await expect(title(page, 'software')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page).toHaveURL(/#security$/);
    await expect(title(page, 'security')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => hashOf(page)).toBe('');
    await expect(html(page)).not.toHaveAttribute('data-card-open');
    await expect(title(page, 'security')).toBeFocused();
    // Nothing was said: the focus moved instead.
    await expect(page.locator('[data-announcer]')).toHaveText('');
    // The ship did not leave: the arrows were the page's.
    await expect(prompt(page)).toContainText('Leave orbit');
    expect(pathOf(page)).toBe('/about/');
  });

  test('the engine’s own controls stand in the middle of what the cards leave free', async ({
    page,
  }) => {
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    /** How far the middle of a control is from the middle of the free part of the view. */
    const off = (selector: string) =>
      page.evaluate((query) => {
        const style = getComputedStyle(document.documentElement);
        const left = Number.parseFloat(style.getPropertyValue('--panel-inset-left'));
        const right = Number.parseFloat(style.getPropertyValue('--panel-inset-right'));
        const box = document.querySelector(query)?.getBoundingClientRect();
        return box ? Math.abs(box.left + box.width / 2 - (left + innerWidth - right) / 2) : NaN;
      }, selector);

    for (const id of [null, 'rockets', 'work'] as const) {
      if (id) await title(page, id).click();
      // They glide there with the camera (and with a card open on the left, not about 640).
      for (const control of ['.map-toggle', '.dock-prompt']) {
        await expect.poll(() => off(control), `${control}, ${id ?? 'overview'}`).toBeLessThan(1.5);
      }
    }
    // Nothing of the cards lies on them.
    const layer = await layout(page);
    for (const control of ['.map-toggle', '.dock-prompt']) {
      const box = await page.locator(control).boundingBox();
      expect(box).not.toBeNull();
      for (const card of layer.cards) {
        const apart =
          (box?.x ?? 0) >= card.right ||
          (box?.x ?? 0) + (box?.width ?? 0) <= card.left ||
          (box?.y ?? 0) >= card.bottom ||
          (box?.y ?? 0) + (box?.height ?? 0) <= card.top;
        expect(apart, control).toBe(true);
      }
    }
  });

  test('a resize across the breakpoint keeps the card, in whichever layout the window has', async ({
    page,
  }) => {
    await page.goto(`${universe('/about/')}#rockets`);
    await engineReady(page);
    expect(problems(await layout(page))).toEqual([]);

    // Narrower than the deck: today's side panel, one column that scrolls, the same fragment.
    await page.setViewportSize({ width: 1100, height: 800 });
    const columns = async () =>
      new Set((await layout(page)).cards.map((card) => Math.round(card.left))).size;
    await expect.poll(columns).toBe(1);
    expect(await state(page)).toMatchObject({ hash: '#rockets', open: '3' });
    const panel = await page.locator('.panel').boundingBox();
    expect(panel?.width).toBe(480);
    expect(Math.round((panel?.x ?? 0) + (panel?.width ?? 0))).toBe(1100 - 24);
    // There a title is a place in the column: it scrolls the panel, and the wheel is the map's.
    await title(page, 'robots').click();
    await expect(page).toHaveURL(/#robots$/);
    await expect
      .poll(() => page.evaluate(() => document.getElementById('main')?.scrollTop ?? 0))
      .toBeGreaterThan(200);

    // Wide again, and too short for a deck: still the panel.
    await page.setViewportSize({ width: 1280, height: 560 });
    await expect.poll(columns).toBe(1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(columns).toBe(2);
    expect(await state(page)).toEqual({ hash: '#robots', open: '4', side: 'right', mates: '4' });
    expect(problems(await layout(page))).toEqual([]);
    expect(await page.evaluate(() => document.getElementById('main')?.scrollTop)).toBe(0);
  });

  test.describe('judged by axe', () => {
    // axe judges a page that holds still (a11y.spec.ts): with reduced motion a journey is a cut.
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('no serious accessibility issue, in the overview or with a card open', async ({
      page,
    }) => {
      test.slow();
      await openUniverse(page, '/about/');
      await expect(prompt(page)).toContainText('Leave orbit', { timeout: 75_000 });
      await page.waitForTimeout(400); // the names that changed have finished fading
      expect.soft(await seriousIssues(page), 'the overview').toEqual([]);
      await title(page, 'software').click();
      await expect(html(page)).toHaveAttribute('data-card-open', '6');
      expect.soft(await seriousIssues(page), 'a card open').toEqual([]);

      await softNavigate(page, '/projects/fishai/');
      await expect(prompt(page)).toContainText('Leave orbit', { timeout: 75_000 });
      await page.waitForTimeout(400);
      expect.soft(await seriousIssues(page), 'a project').toEqual([]);
      await title(page, 'the-bots').click();
      expect.soft(await seriousIssues(page), 'a project, a card open').toEqual([]);
    });

    test('with reduced motion nothing animates: the cards are simply there', async ({ page }) => {
      await openUniverse(page, '/about/');
      const animations = () => page.evaluate(() => document.getAnimations().length);
      await expect.poll(animations).toBe(0);
      await title(page, 'robots').click();
      await expect(html(page)).toHaveAttribute('data-card-open', '4');
      expect(await animations()).toBe(0);
      await title(page, 'rockets').click();
      expect(await animations()).toBe(0);
      await page.keyboard.press('Escape');
      await expect(html(page)).not.toHaveAttribute('data-card-open');
      expect(await animations()).toBe(0);
      expect(problems(await layout(page))).toEqual([]);
    });
  });
});

test('a phone keeps its sheet: one column, and the fragment is a place in it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the bottom sheet');
  await openUniverse(page, '/about/');
  const panel = await page.locator('.panel').boundingBox();
  const size = page.viewportSize();
  // Across the whole width, up from the bottom edge.
  expect(panel?.x).toBe(0);
  expect(panel?.width).toBe(size?.width);
  expect(Math.round((panel?.y ?? 0) + (panel?.height ?? 0))).toBe(size?.height);
  expect(new Set((await layout(page)).cards.map((card) => Math.round(card.left))).size).toBe(1);

  await page.evaluate(() => document.querySelector<HTMLElement>('#rockets > a')?.click());
  await expect(page).toHaveURL(/#rockets$/);
  await expect
    .poll(() => page.evaluate(() => document.getElementById('main')?.scrollTop ?? 0))
    .toBeGreaterThan(200);
  // Every card is in the column in full: nothing is a stub or a chip here.
  const short = await page.locator('#main > [data-card]').evaluateAll(
    (cards) =>
      cards.filter((card) => {
        const style = getComputedStyle(card);
        return style.overflowY !== 'visible' || style.maxHeight !== 'none';
      }).length,
  );
  expect(short).toBe(0);
});
