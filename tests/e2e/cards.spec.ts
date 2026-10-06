// The deck of cards in real browsers (src/shell/cards.ts and deck.ts; "the deck" in
// src/styles/global.css). On a wide screen a page's cards stand in two columns round the body it
// belongs to; the URL's fragment says which one is open, and none is the overview. What is
// measured here is what the stylesheet and the shell promise each other: two columns and nothing
// on top of anything, the fragment as the one state, and a keyboard that never rests on something
// it cannot see. And what the engine adds to them: a leader from every card to the body
// (src/universe/ui/Leaders.ts), which for the open card ends on what that card points at.
//
// The desktop projects run at 1280 x 800 and see the deck. Run this file as a spec:
//   npx playwright test tests/e2e/cards.spec.ts

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  collectErrors,
  engineReady,
  expect,
  loseContext,
  openUniverse,
  pageContent,
  rebuilt,
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

/**
 * What is wrong with where the cards stand DOWN their columns, in words. With a card open
 * (`packed`) both columns stand together at the top of the stage, the deck's gap (12 px) and no
 * more between one card and the next: the chips over the open card, the open card, the chips
 * under it, and sky under the last. With none open a column of two cards or more reaches from
 * the top of the stage to its foot.
 */
function misplaced({ cards, stage }: { cards: Box[]; stage: Box }, packed: boolean): string[] {
  const found: string[] = [];
  const edges = [...new Set(cards.map((card) => Math.round(card.left)))].sort((a, b) => a - b);
  edges.forEach((edge, side) => {
    const name = side === 0 ? 'the left column' : 'the right column';
    const column = cards
      .filter((card) => Math.round(card.left) === edge)
      .sort((a, b) => a.top - b.top);
    const down = (column[0]?.top ?? NaN) - stage.top;
    if (!(Math.abs(down) <= 0.5)) found.push(`${name} starts ${down.toFixed(1)} px down`);
    const gaps = column.slice(1).map((card, above) => card.top - (column[above]?.bottom ?? NaN));
    if (packed && gaps.some((gap) => !(Math.abs(gap - 12) <= 0.5)))
      found.push(
        `${name} has ${gaps.map((gap) => gap.toFixed(1)).join(', ')} px between its cards`,
      );
    const under = stage.bottom - (column.at(-1)?.bottom ?? NaN);
    if (!packed && column.length > 1 && !(Math.abs(under) <= 0.5))
      found.push(`${name} ends ${under.toFixed(1)} px over the foot of the stage`);
  });
  return found;
}

/**
 * With a card open: whatever a card that is NOT open still offers besides a section's title.
 * What a chip holds is cut off under its title row, but it is laid out there all the same, and
 * packed that is where the next chip's title stands. So each link and button of it has to be
 * said to be out of sight as well (opacity 0, on it or on something round it), or whatever goes
 * by where a box lies (axe) finds two things to press in one place.
 */
const offered = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const open = Number(document.documentElement.dataset.cardOpen ?? 0);
    return [...document.querySelectorAll<HTMLElement>('#main > [data-card]')].flatMap(
      (card, index) => {
        if (index === open) return [];
        const title = card.querySelector(':scope > h2 > a');
        return [...card.querySelectorAll<HTMLElement>('a[href], button, input, summary')]
          .filter((control) => {
            if (control === title) return false;
            for (let at: Element | null = control; at && at !== card; at = at.parentElement) {
              if (getComputedStyle(at).opacity === '0') return false;
            }
            return true;
          })
          .map((control) => `card ${index}: ${control.textContent.trim().slice(0, 24)}`);
      },
    );
  });

/**
 * Every section's card in the overview (a stub): how much of it is left under its title row for
 * what it holds (`under`, in px, inside its hairlines), and how far the middle of its title is
 * from the middle of the card (`off`).
 */
const stubs = (page: Page): Promise<{ under: number; off: number }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#main > [data-card]:not(:first-child)')].map((card) => {
      const box = card.getBoundingClientRect();
      const row = card.querySelector(':scope > h2')?.getBoundingClientRect();
      const words = card.querySelector(':scope > h2 > a')?.getBoundingClientRect();
      const hairline = Number.parseFloat(getComputedStyle(card).borderBottomWidth);
      return {
        under: row ? box.bottom - hairline - row.bottom : NaN,
        off: words ? Math.abs((words.top + words.bottom - box.top - box.bottom) / 2) : NaN,
      };
    }),
  );

/**
 * The stubs that show a sliver of what they hold. A stub is its title and the start of its text
 * (a line of it is 22 px) or, with no room for that, its title alone in the middle of the card,
 * as a chip is: the stylesheet's promise for a window 576 px tall under a tall head.
 */
const slivers = (cards: { under: number; off: number }[]): string[] =>
  cards.flatMap(({ under, off }, index) => {
    if (under >= 26) return [];
    if (under < 0.5 && off < 1) return [];
    return [`stub ${index + 1}: ${under.toFixed(1)} px under its title, ${off.toFixed(1)} px off`];
  });

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
 * Where the page is one column that scrolls (the side panel, the sheet): how far the title `id`
 * stands below the top of that column, in px. A title the reader is AT stands a step under the
 * top (its scroll margin); one further down the page is hundreds of pixels away, or thousands.
 */
const below = (page: Page, id: string): Promise<number> =>
  page.evaluate((key) => {
    const column = document.getElementById('main');
    const heading = document.getElementById(key);
    if (!column || !heading) return NaN;
    return heading.getBoundingClientRect().top - column.getBoundingClientRect().top;
  }, id);

/** `below` for a title the reader is at: inside the top of the column, not above it. */
const AT_HAND = 160;

/**
 * The links at `selector` that a pointer cannot press where they stand: outside the box of their
 * card (cut off by it), or under something else (a fade, another card).
 */
const outOfReach = (page: Page, selector: string): Promise<string[]> =>
  page.evaluate((query) => {
    return [...document.querySelectorAll<HTMLElement>(query)].flatMap((link) => {
      const card = link.closest('[data-card]')?.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      const inside =
        card !== undefined &&
        box.top >= card.top &&
        box.bottom <= card.bottom &&
        box.left >= card.left &&
        box.right <= card.right;
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return inside && hit !== null && link.contains(hit) ? [] : [link.textContent.trim()];
    });
  }, selector);

/**
 * The names the engine writes over the world hold still: none is on its way in or out. (axe
 * judges colours as they are, and a name half-way through its fade is neither there nor gone.)
 */
const namesRest = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return !target?.closest('#universe-overlay');
    }),
  );

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

/** A leader: which card's it is (0 is the first section), and where it runs, in window px. */
interface Lead {
  card: number;
  open: boolean;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * The leaders as a visitor sees them (ui/Leaders.ts), in the cards' order: each from its card
 * to the body. Read in one task, so all from one frame of the engine. Null while they are away
 * or on their way in or out.
 */
const leaders = (page: Page): Promise<Lead[] | null> =>
  page.evaluate(() => {
    const all = document.querySelectorAll('#universe-host svg.leaders');
    // One engine, one set: an engine that is taken down takes its own with it.
    if (all.length > 1) throw new Error(`${all.length} sets of leaders`);
    const svg = all[0];
    if (!svg) return null;
    const style = getComputedStyle(svg);
    if (style.visibility !== 'visible' || style.opacity !== '1') return null;
    const origin = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('g.leader')].flatMap((group, card) => {
      if (getComputedStyle(group).visibility !== 'visible') return [];
      const line = group.querySelector('.leader__line')?.getAttribute('d') ?? '';
      const [x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN] = (line.match(/-?[\d.]+/g) ?? []).map(Number);
      return [
        {
          card,
          open: group.hasAttribute('data-open'),
          from: { x: origin.left + x1, y: origin.top + y1 },
          to: { x: origin.left + x2, y: origin.top + y2 },
        },
      ];
    });
  });

const count = async (page: Page): Promise<number> => (await leaders(page))?.length ?? 0;

/**
 * The circle the leaders of an overview end on. Each line says "the middle of the body is
 * somewhere along me": `x`, `y` is the point nearest all of them (least squares), `off` how far
 * the worst line passes from it, `radius` how far from it the lines stop, and `spread` how much
 * they differ in that. A disc seen from all round: `off` and `spread` are nothing.
 */
function discOf(lines: Lead[]) {
  let [a, b, c, p, q] = [0, 0, 0, 0, 0];
  const normals = lines.map(({ from, to }) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const nx = -(to.y - from.y) / length;
    const ny = (to.x - from.x) / length;
    const d = nx * from.x + ny * from.y;
    a += nx * nx;
    b += nx * ny;
    c += ny * ny;
    p += nx * d;
    q += ny * d;
    return { nx, ny, d };
  });
  const x = (c * p - b * q) / (a * c - b * b);
  const y = (a * q - b * p) / (a * c - b * b);
  const radii = lines.map(({ to }) => Math.hypot(to.x - x, to.y - y));
  return {
    x,
    y,
    radius: Math.min(...radii),
    spread: Math.max(...radii) - Math.min(...radii),
    off: Math.max(...normals.map(({ nx, ny, d }) => Math.abs(nx * x + ny * y - d))),
  };
}

/** The middle, across, of what the cards leave free: where the camera holds the body. */
const middleOf = ({ free, width }: { free: { left: number; right: number }; width: number }) =>
  (free.left + width - free.right) / 2;

/**
 * The open card's leader, once it is the only one and its end has come to rest (within a pixel
 * between two looks a quarter of a second apart): the camera has turned to what the card points
 * at and closed in, and holds it there while the body goes on turning.
 */
async function openLeader(page: Page): Promise<Lead> {
  const seen: { lead: Lead | null } = { lead: null };
  await expect
    .poll(
      async () => {
        // The engine draws on animation frames: after two, it has drawn since the last look.
        await page.evaluate(
          () =>
            new Promise<void>((done) => {
              requestAnimationFrame(() => requestAnimationFrame(() => done()));
            }),
        );
        const now = (await leaders(page)) ?? [];
        const only = now.length === 1 && now[0]?.open ? now[0] : null;
        const last = seen.lead;
        seen.lead = only;
        return only && last ? Math.hypot(only.to.x - last.to.x, only.to.y - last.to.y) : NaN;
      },
      { intervals: [250], timeout: 30_000 },
    )
    .toBeLessThan(1);
  if (!seen.lead) throw new Error('no leader');
  return seen.lead;
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
      // Both columns reach from the top of the stage to its foot.
      expect(misplaced(overview, false), `${at}, the overview`).toEqual([]);
      expect(slivers(await stubs(page)), `${at}, the overview`).toEqual([]);

      for (const [index, id] of ABOUT.entries()) {
        await title(page, id).click();
        await expect(html(page)).toHaveAttribute('data-card-open', String(index + 1));
        const open = await layout(page);
        expect(problems(open), `${at}, ${id} open`).toEqual([]);
        // The title rows are together at the top of both columns, the open card in its place
        // among them: nothing is spread down a column while a card is being read.
        expect(misplaced(open, true), `${at}, ${id} open`).toEqual([]);
        // And a chip offers its title, nothing of what lies cut off under it.
        expect(await offered(page), `${at}, ${id} open`).toEqual([]);
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
      expect(misplaced(overview, false), `${path}, the overview`).toEqual([]);
      const short = await stubs(page);
      expect(slivers(short), `${path}, the overview`).toEqual([]);
      // FishAI's head (crumbs, a sign, a lede) leaves the two sections under it no room for a
      // line: titles alone. The three beside it show the start of what they hold.
      if (path === '/projects/fishai/') {
        expect(short.map(({ under }) => under < 0.5)).toEqual([true, true, false, false, false]);
      }
      const ids = await page
        .locator('#main > [data-card] > h2')
        .evaluateAll((titles) => titles.map((heading) => heading.id));
      expect(ids).toHaveLength(overview.cards.length - 1);
      for (const [index, id] of ids.entries()) {
        await title(page, id).click();
        await expect(html(page)).toHaveAttribute('data-card-open', String(index + 1));
        // A card longer than its column (the resume's Experience) scrolls inside itself, and the
        // title rows under it are still on the stage, directly under it.
        const open = await layout(page);
        expect(problems(open), `${path}, ${id} open`).toEqual([]);
        expect(misplaced(open, true), `${path}, ${id} open`).toEqual([]);
        expect(await offered(page), `${path}, ${id} open`).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
  });

  test('what a page is for is in reach on arrival: the resume’s PDF, the ways to reach Allen', async ({
    page,
  }) => {
    test.slow();
    const errors = collectErrors(page);
    const SIZES = [
      { width: 1280, height: 576 },
      { width: 1280, height: 800 },
      { width: 1920, height: 1080 },
    ];
    /**
     * How much taller card `index` is than what it holds (its last child, the space under that,
     * its hairline), in px: nothing, for a stub that stopped growing where its text ends.
     */
    const spare = (index: number) =>
      page
        .locator('#main > [data-card]')
        .nth(index)
        .evaluate((card) => {
          const style = getComputedStyle(card);
          const last = card.lastElementChild?.getBoundingClientRect();
          if (!last) return NaN;
          const under = Number.parseFloat(style.paddingBottom);
          const hairline = Number.parseFloat(style.borderBottomWidth);
          return card.getBoundingClientRect().bottom - last.bottom - under - hairline;
        });

    // The resume's first card ends with the key that downloads it. Short or tall, the stub keeps
    // that key at its foot: in its box, with nothing over it.
    await openUniverse(page, '/resume/');
    const download = '#main > .resume-intro > .actions a[download]';
    await expect(page.locator(download)).toHaveCount(1);
    for (const size of SIZES) {
      const at = `${size.width} x ${size.height}`;
      await page.setViewportSize(size);
      expect(problems(await layout(page)), at).toEqual([]);
      expect(await outOfReach(page, download), at).toEqual([]);
      expect(await state(page), at).toEqual(OVERVIEW);
    }
    // On a monitor the card has room for all it holds: every way to reach Allen as well.
    expect(await outOfReach(page, '#main > .resume-intro a')).toEqual([]);
    // The key is a link of its own: a press of it is the link's, and opens no card. (The
    // download itself is stopped here, once the page has had its say about the press.)
    await page.evaluate(() => {
      window.addEventListener('click', (event) => event.preventDefault(), { once: true });
    });
    await page.locator(download).click();
    expect(await state(page)).toEqual(OVERVIEW);

    // Contact is its head and ONE card, with a column to itself: all of it shows, at every size
    // of the deck, and the card ends where what it holds does, not at the foot of its column.
    await softNavigate(page, '/contact/');
    const ways = '#main > [data-card]:not(:first-child) a';
    expect(await page.locator(ways).count()).toBeGreaterThanOrEqual(3);
    for (const size of SIZES) {
      const at = `${size.width} x ${size.height}`;
      await page.setViewportSize(size);
      expect(problems(await layout(page)), at).toEqual([]);
      expect(await outOfReach(page, ways), at).toEqual([]);
      expect(Math.abs(await spare(1)), at).toBeLessThan(1);
    }
    expect(errors).toEqual([]);
  });

  test('the resume’s PDF stays in reach with its card open, however little of the card shows', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const download = '#main > .resume-intro > .actions a[download]';
    const card = page.locator('#main > .resume-intro');
    const measures = () => card.evaluate((element) => [element.scrollHeight, element.clientHeight]);
    /** How far the key's foot stands over its card's, in px. */
    const overFoot = () =>
      page.evaluate((query) => {
        const key = document.querySelector(query);
        const box = key?.closest('[data-card]');
        if (!key || !box) return NaN;
        return box.getBoundingClientRect().bottom - key.getBoundingClientRect().bottom;
      }, download);

    // The smallest deck: beside two title rows the open card is cut, well above its key.
    await page.setViewportSize({ width: 1280, height: 576 });
    await openUniverse(page, '/resume/');
    await title(page, 'resume-contact').click();
    await expect(html(page)).toHaveAttribute('data-card-open', '1');
    await layout(page);
    await expect(html(page)).toHaveAttribute('data-card-more');
    const [holds = 0, shows = 0] = await measures();
    const range = holds - shows;
    expect(range).toBeGreaterThan(40);

    // The key stands at the foot of what shows, where a pointer can press it, and stays there
    // while the card is read: half-way, and at the card's end, where that is its own place in
    // the flow. The card measures the same throughout: the key's plate takes no room.
    expect(await outOfReach(page, download)).toEqual([]);
    const stuck = await overFoot();
    for (const top of [Math.round(range / 2), range]) {
      await card.evaluate((element, y) => element.scrollTo(0, y), top);
      expect(await outOfReach(page, download), `scrolled ${top} px`).toEqual([]);
      expect(Math.abs((await overFoot()) - stuck), `scrolled ${top} px`).toBeLessThan(1);
      expect(await measures(), `scrolled ${top} px`).toEqual([holds, shows]);
    }
    await expect(html(page)).not.toHaveAttribute('data-card-more');

    // A window with room for the whole card: nothing is cut, every link of the card is in
    // reach, and the key is the same step over the card's foot.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(html(page)).not.toHaveAttribute('data-card-more');
    expect(problems(await layout(page))).toEqual([]);
    expect(await outOfReach(page, '#main > .resume-intro a')).toEqual([]);
    expect(Math.abs((await overFoot()) - stuck)).toBeLessThan(1);
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

  test('an open card with more under its cut fades its last lines, until the last is in sight', async ({
    page,
  }) => {
    // The smallest deck: "Rockets" is longer than its column leaves it beside three title rows.
    await page.setViewportSize({ width: 1280, height: 576 });
    await openUniverse(page, '/about/');
    const card = page.locator('#main > [data-card]').nth(3);
    /** The fade's height: the card's last box, stuck to the foot of the plate. Null: none. */
    const fade = () =>
      card.evaluate((element) => {
        const style = getComputedStyle(element, '::after');
        return style.content !== 'none' && style.position === 'sticky' ? style.height : null;
      });
    const measures = () => card.evaluate((element) => [element.scrollHeight, element.clientHeight]);
    const scrolled = () => card.evaluate((element) => Math.round(element.scrollTop));

    await title(page, 'rockets').click();
    await expect(html(page)).toHaveAttribute('data-card-open', '3');
    await expect(html(page)).toHaveAttribute('data-card-more');
    expect(await fade()).toBe('48px');
    const [holds = 0, shows = 0] = await measures();
    /** How far the card can scroll, and the space under its last line (its own padding). */
    const range = holds - shows;
    const space = await card.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingBottom),
    );
    expect(range).toBeGreaterThan(60);
    expect(space).toBeGreaterThanOrEqual(8);

    // The wheel reads on (from anywhere on the page) until the last line is in sight: the 8 px
    // still under the cut are space under that line, which is not more to read. The fade is
    // gone, and the card measures what it did with it.
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, range - 8);
    await expect.poll(scrolled).toBe(range - 8);
    await expect(html(page)).not.toHaveAttribute('data-card-more');
    expect(await fade()).toBeNull();
    expect(await measures()).toEqual([holds, shows]);
    // Back up a few lines (a new turn of the wheel), and it says so again.
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -40);
    await expect.poll(scrolled).toBe(range - 48);
    await expect(html(page)).toHaveAttribute('data-card-more');
    expect(await fade()).toBe('48px');

    // A taller window shows the whole card: nothing is cut, so nothing fades.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(html(page)).not.toHaveAttribute('data-card-more');
    expect(await fade()).toBeNull();
    // Small again, it is cut again; and the word goes when the card closes.
    await page.setViewportSize({ width: 1280, height: 576 });
    await expect(html(page)).toHaveAttribute('data-card-more');
    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-card-open');
    await expect(html(page)).not.toHaveAttribute('data-card-more');
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

    // Escape closes the card and leaves the keyboard where it can be seen: on the title of the
    // card it closed, in its ring, a press away from opening it again. From that very title
    // nothing moves, so it is said instead.
    const said = () => page.locator('[data-announcer]').evaluate((region) => region.textContent);
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-card-open', '5');
    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-card-open');
    await expect(title(page, 'security')).toBeFocused();
    expect(await said()).toBe('All sections');
    // (WebKit keeps its own counsel on whether a focus that script first put there shows a ring.)
    if (browserName !== 'webkit') {
      const ring = await title(page, 'security').evaluate(
        (link) => getComputedStyle(link).outlineStyle,
      );
      expect(ring).toBe('solid');
    }
    // From a link inside the card (the focus opens the card it lands in), the same key takes
    // the focus to that title: it moved, so nothing more is said.
    await page.locator('#main > [data-card]').nth(5).locator('p a').first().focus();
    await expect(html(page)).toHaveAttribute('data-card-open', '5');
    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-card-open');
    await expect(title(page, 'security')).toBeFocused();
    expect(await said()).toBe('All sections');
    expect(pathOf(page)).toBe('/about/');

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

  test('a change of card is seen: the cards are carried there, and the leaders wait for them', async ({
    page,
  }) => {
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    await expect.poll(() => count(page)).toBe(ABOUT.length);
    // (The cards have arrived: nothing in the content is on the move.)
    await layout(page);

    // What the leaders do from now on: step aside, and come back.
    await page.evaluate(() => {
      const svg = document.querySelector('#universe-host svg.leaders');
      const said: string[] = [];
      (window as unknown as { e2eAside: string[] }).e2eAside = said;
      if (!svg) return;
      new MutationObserver(() =>
        said.push(svg.hasAttribute('data-aside') ? 'aside' : 'back'),
      ).observe(svg, { attributes: true, attributeFilter: ['data-aside'] });
    });

    // Robots opens: the first card of the right column. In the same task the layout is final,
    // and every card that it moved has set out from where it was.
    const journeys = await page.evaluate(() => {
      document.querySelector<HTMLElement>('#robots > a')?.click();
      const cards = [...document.querySelectorAll('#main > [data-card]')];
      return document.getAnimations().flatMap((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const card = effect?.target ? cards.indexOf(effect.target) : -1;
        if (!effect || card < 0) return [];
        const first = effect.getKeyframes()[0] ?? {};
        return [
          {
            card,
            // A journey is made by script: the stylesheet's own animations ended long ago.
            script: !(animation instanceof CSSAnimation),
            ms: effect.getTiming().duration,
            moves: ['translate', 'clipPath'].filter((property) => property in first),
          },
        ];
      });
    });
    expect(await state(page)).toMatchObject({ hash: '#robots', open: '4' });
    const moves = (card: number) => journeys.find((journey) => journey.card === card)?.moves;
    // The head grew shorter where it stands: nothing to carry.
    expect(moves(0)).toBeUndefined();
    // The cards under it are title rows now, higher up.
    for (const card of [1, 2, 3]) expect(moves(card), `card ${card}`).toEqual(['translate']);
    // The open card starts as the box it was, its title where its title was: it slides toward
    // the body as it widens (the window's edge kept) and unrolls downward. The cards under it
    // give way, and widen with their column the same way.
    for (const card of [4, 5, 6, 7, 8]) {
      expect(moves(card), `card ${card}`).toEqual(['translate', 'clipPath']);
    }
    expect(journeys.every((journey) => journey.script && journey.ms === 240)).toBe(true);

    // They arrive, and where they rest is the layout: no card over another, nothing left running.
    expect(problems(await layout(page))).toEqual([]);
    // The leaders stepped aside while the cards travelled, and came back: the open card's alone.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { e2eAside: string[] }).e2eAside))
      .toEqual(['aside', 'back']);
    await expect.poll(() => count(page)).toBe(1);
  });

  test('a window resized takes the leaders along with the cards: nothing steps aside', async ({
    page,
  }) => {
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    await expect.poll(() => count(page)).toBe(ABOUT.length);
    await layout(page);
    await page.evaluate(() => {
      const svg = document.querySelector('#universe-host svg.leaders');
      const said: string[] = [];
      (window as unknown as { e2eAside: string[] }).e2eAside = said;
      if (!svg) return;
      new MutationObserver(() =>
        said.push(svg.hasAttribute('data-aside') ? 'aside' : 'back'),
      ).observe(svg, { attributes: true, attributeFilter: ['data-aside'] });
    });
    /** How far the worst leader begins from its card: the inner edge, halfway up the title row. */
    const astray = async (): Promise<number> => {
      const deck = await layout(page);
      const lines = (await leaders(page)) ?? [];
      if (lines.length !== ABOUT.length) return NaN;
      return Math.max(
        ...lines.map((line) => {
          const box = deck.cards[line.card + 1];
          if (!box) return NaN;
          const edge = box.left < deck.width / 2 ? box.right : box.left;
          return Math.hypot(line.from.x - edge, line.from.y - (box.top + 22));
        }),
      );
    };
    expect(await astray()).toBeLessThan(1.5);

    // Wider and taller, still a deck: every card is somewhere else, and nothing travelled there.
    const before = await layout(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    await expect
      .poll(async () => Math.round((await layout(page)).cards.at(-1)?.left ?? 0))
      .toBeGreaterThan(Math.round(before.cards.at(-1)?.left ?? 0) + 100);
    await expect.poll(astray).toBeLessThan(1.5);
    expect(
      await page.evaluate(() => (window as unknown as { e2eAside: string[] }).e2eAside),
    ).toEqual([]);
  });

  test('every card has a leader to the body, and the open card’s ends on what it points at', async ({
    page,
  }) => {
    test.slow();
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');

    // One for every section and none for the head, once the ship is in orbit and the view rests.
    await expect.poll(() => count(page)).toBe(ABOUT.length);
    const overview = await layout(page);
    const lines = (await leaders(page)) ?? [];
    expect(lines.map(({ card, open }) => ({ card, open }))).toEqual(
      ABOUT.map((_, card) => ({ card, open: false })),
    );
    // Each begins on the edge of its card that faces the body, halfway up its title row (44 px)...
    /**
     * How far a leader begins from that place on card `box`, whose title row is `row` px. (The
     * shell measures the cards in whole pixels, where they will rest and not where an animation
     * has them: a box that is 307.2 px wide may put its line most of a pixel under its edge.)
     */
    const astray = (line: Lead, box: Box | undefined, row: number, width: number): number =>
      box === undefined
        ? NaN
        : Math.hypot(
            line.from.x - (box.left < width / 2 ? box.right : box.left),
            line.from.y - (box.top + row / 2),
          );
    for (const line of lines) {
      const box = overview.cards[line.card + 1];
      expect(astray(line, box, 44, overview.width), `leader ${line.card}`).toBeLessThan(1.5);
    }
    // ...and they all make for one point and stop equally short of it: the limb of the body,
    // which the camera holds in the middle of what the cards leave free. (So no two cross.)
    const disc = discOf(lines);
    expect(disc.off).toBeLessThan(1);
    expect(disc.spread).toBeLessThan(1.5);
    expect(disc.radius).toBeGreaterThan(40);
    expect(Math.abs(disc.x - middleOf(overview))).toBeLessThan(3);

    // A card open on the right: its leader alone, from the open card (a title row of 52 px)...
    await title(page, 'robots').click();
    const right = await openLeader(page);
    let open = await layout(page);
    expect(right.card).toBe(3);
    expect(astray(right, open.cards[4], 52, open.width)).toBeLessThan(1.5);
    // ...to what the card points at: a place on the body, round from the middle of its disc
    // toward the card. (The body is as big with a card open as without: the camera closes in as
    // much as the free part narrows, so the overview's disc, moved across, is the measure.)
    expect(Math.hypot(right.to.x - middleOf(open), right.to.y - disc.y)).toBeLessThan(disc.radius);
    expect(right.to.x - middleOf(open)).toBeGreaterThan(disc.radius / 8);
    // Its station is butter, as the ring before the open card's title is: here.
    const butter = await page.evaluate(() => {
      const stop = document.querySelector('#universe-host .leader[data-open] .leader__stop');
      const ring = document.querySelector('#robots > a');
      return {
        stop: stop && getComputedStyle(stop).fill,
        ring: ring && getComputedStyle(ring, '::before').backgroundColor,
      };
    });
    expect(butter.stop).toBe(butter.ring);
    expect(butter.stop).toMatch(/^rgb/);

    // One on the left, straight from the first: the body is turned the other way round.
    await title(page, 'berkeley').click();
    const left = await openLeader(page);
    open = await layout(page);
    expect(left.card).toBe(1);
    expect(astray(left, open.cards[2], 52, open.width)).toBeLessThan(1.5);
    expect(Math.hypot(left.to.x - middleOf(open), left.to.y - disc.y)).toBeLessThan(disc.radius);
    expect(middleOf(open) - left.to.x).toBeGreaterThan(disc.radius / 8);

    // Closed again, every card has its line back.
    await page.keyboard.press('Escape');
    await expect.poll(() => count(page)).toBe(ABOUT.length);

    // A planet that travels round its sun, in another family: five cards, five lines to its
    // limb, in the colour of the band on its cards.
    /** The colour of the lines, and of the band on the first section's card (in the left column). */
    const family = () =>
      page.evaluate(() => {
        const line = document.querySelector('#universe-host .leader[data-on] .leader__line');
        const card = document.querySelector('#main > section[data-card]');
        return {
          line: line && getComputedStyle(line).stroke,
          band: card && getComputedStyle(card).borderRightColor,
        };
      });
    const home = await family();
    expect(home.line).toBe(home.band);
    await softNavigate(page, '/projects/fishai/');
    await expect(prompt(page)).toContainText('Leave orbit', { timeout: 75_000 });
    await expect.poll(() => count(page)).toBe(5);
    const planet = discOf((await leaders(page)) ?? []);
    expect(planet.off).toBeLessThan(1);
    expect(planet.spread).toBeLessThan(1.5);
    const away = await family();
    expect(away.line).toBe(away.band);
    expect(away.line).not.toBe(home.line);
  });

  test('the leaders keep off the star map, and leave with the ship', async ({ page }) => {
    await openUniverse(page, '/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    await expect.poll(() => count(page)).toBe(ABOUT.length);

    // The map is another way of looking at the world: no card points at anything on it.
    await page.keyboard.press('m');
    await expect(html(page)).toHaveAttribute('data-map', 'open');
    await expect.poll(() => leaders(page)).toBeNull();
    await page.keyboard.press('m');
    await expect(html(page)).not.toHaveAttribute('data-map');
    await expect.poll(() => count(page)).toBe(ABOUT.length);

    // And with a card open, the one line: gone on the map, back when it closes. (The focus is
    // on the card's title, where a key is the page's: the Map button it is.)
    await title(page, 'security').click();
    await expect.poll(() => count(page)).toBe(1);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(html(page)).toHaveAttribute('data-map', 'open');
    await expect.poll(() => leaders(page)).toBeNull();
    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-map');
    await expect.poll(() => count(page)).toBe(1);

    // The ship leaves: the page closes, and nothing points at a body nobody is at.
    await prompt(page).click();
    await expect(html(page)).toHaveAttribute('data-panel', 'closed');
    await expect.poll(() => leaders(page)).toBeNull();
  });

  test('the leaders are back after the engine is rebuilt, one set of them', async ({ page }) => {
    await page.goto(`${universe('/about/')}#robots`);
    await engineReady(page);
    await expect(prompt(page)).toContainText('Leave orbit');
    await expect.poll(() => count(page)).toBe(1);

    test.skip(!(await loseContext(page)), 'this browser cannot lose a context on request');
    await expect.poll(() => rebuilt(page)).toBe(true);
    await engineReady(page);

    // The new engine was told the deck again (api.ts): the open card's line, and (`leaders`
    // throws on two sets) the old engine's went with it.
    await expect.poll(() => count(page)).toBe(1);
    expect((await leaders(page))?.[0]).toMatchObject({ card: 3, open: true });
    await page.keyboard.press('Escape');
    await expect(html(page)).not.toHaveAttribute('data-card-open');
    await expect.poll(() => count(page)).toBe(ABOUT.length);
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
    // The card that was open is the reader's place in the column: the panel has gone to it.
    await expect.poll(() => below(page, 'rockets')).toBeLessThan(AT_HAND);
    expect(await below(page, 'rockets')).toBeGreaterThanOrEqual(0);
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

  test('a reload at a card’s URL comes back to the card where the page is one column', async ({
    page,
  }) => {
    // Under 1280 px wide: the side panel, where a fragment is a place to scroll to. A browser
    // goes there by itself on the first load, and Chromium not on a reload (the router restores
    // scroll positions by hand): there the shell does.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`${universe('/about/')}#work`);
    await engineReady(page);
    const there = async (when: string): Promise<void> => {
      await expect.poll(() => below(page, 'work'), when).toBeLessThan(AT_HAND);
      expect(await below(page, 'work'), when).toBeGreaterThanOrEqual(0);
      expect(await state(page), when).toMatchObject({ hash: '#work', open: '7' });
    };
    await there('the first load');
    for (const again of ['a reload', 'a second reload']) {
      await page.reload();
      await engineReady(page);
      await there(again);
    }
    // And the entry remembers that place: on to another page and Back.
    await navLink(page, 'Contact').click();
    await expect(heading(page)).toHaveText('Contact');
    await page.goBack();
    await expect(heading(page)).toHaveText('About Me');
    await there('Back');
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
      await namesRest(page);
      expect.soft(await seriousIssues(page), 'the overview').toEqual([]);
      await title(page, 'software').click();
      await expect(html(page)).toHaveAttribute('data-card-open', '6');
      expect.soft(await seriousIssues(page), 'a card open').toEqual([]);

      await softNavigate(page, '/projects/fishai/');
      await expect(prompt(page)).toContainText('Leave orbit', { timeout: 75_000 });
      await namesRest(page);
      expect.soft(await seriousIssues(page), 'a project').toEqual([]);
      await title(page, 'the-bots').click();
      expect.soft(await seriousIssues(page), 'a project, a card open').toEqual([]);
    });

    test('with reduced motion nothing animates: the cards are simply there', async ({ page }) => {
      await openUniverse(page, '/about/');
      const animations = () => page.evaluate(() => document.getAnimations().length);
      await expect.poll(animations).toBe(0);
      // Nor do the leaders step aside for cards that do not travel: watch them from here on.
      await expect(prompt(page)).toContainText('Leave orbit', { timeout: 75_000 });
      await expect.poll(() => count(page)).toBe(ABOUT.length);
      await page.evaluate(() => {
        const svg = document.querySelector('#universe-host svg.leaders');
        const said: string[] = [];
        (window as unknown as { e2eAside: string[] }).e2eAside = said;
        if (!svg) return;
        new MutationObserver(() => said.push('aside')).observe(svg, {
          attributes: true,
          attributeFilter: ['data-aside'],
        });
      });
      await title(page, 'robots').click();
      await expect(html(page)).toHaveAttribute('data-card-open', '4');
      expect(await animations()).toBe(0);
      await title(page, 'rockets').click();
      expect(await animations()).toBe(0);
      await page.keyboard.press('Escape');
      await expect(html(page)).not.toHaveAttribute('data-card-open');
      expect(await animations()).toBe(0);
      expect(problems(await layout(page))).toEqual([]);
      await expect.poll(() => count(page)).toBe(ABOUT.length);
      expect(
        await page.evaluate(() => (window as unknown as { e2eAside: string[] }).e2eAside),
      ).toEqual([]);
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

test('a phone comes back to the card it was at after a reload', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the bottom sheet');
  await page.goto(`${universe('/about/')}#rockets`);
  await engineReady(page);
  const there = async (when: string): Promise<void> => {
    await expect.poll(() => below(page, 'rockets'), when).toBeLessThan(AT_HAND);
    expect(await below(page, 'rockets'), when).toBeGreaterThanOrEqual(0);
  };
  await there('the first load');
  // Chromium follows no fragment on a reload of an entry whose scroll the router restores by
  // hand: the shell goes to the place (src/shell/cards.ts, `arrive`).
  await page.reload();
  await engineReady(page);
  await there('a reload');
});
