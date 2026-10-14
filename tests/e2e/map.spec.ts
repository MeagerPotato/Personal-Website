// The star map (src/universe/ui/StarMap.ts): the galaxy from above, for choosing where to go. It
// is another way of LOOKING, so these tests are about what changes (the view, who the keys and
// fingers belong to) and about what must not (the URL, the panel, the ship's own business).

import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import {
  bodyOf,
  engineReady,
  expect,
  keptNow,
  loadWith,
  nameOf,
  openUniverse,
  plannedName,
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
 * The middle of a name, once it shows and holds still (`settled`): where a finger goes to press
 * it. Not where its body is: on the map a name hangs below its body, above it, beside it or slid
 * along it, wherever it has room, and may change places as the map moves. The tests below measure
 * the map by the bodies themselves (`bodyOf`).
 */
async function middleOf(target: Locator): Promise<{ x: number; y: number }> {
  await settled(target);
  const box = await target.boundingBox();
  if (!box) throw new Error('a name that shows has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real touches, through the browser's own input pipeline (Playwright itself only taps). */
async function fingersOn(page: Page) {
  const session = await page.context().newCDPSession(page);
  return (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number; id: number }[],
  ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

/**
 * Two fingers spread about the first of `centres` where both can come down clear of every name (a
 * finger that comes down on a name is that name's: a tap there flies to it), from `from` px apart
 * to `to`. The map zooms about the point between them, which is returned.
 */
async function spread(
  page: Page,
  centres: readonly { x: number; y: number }[],
  from: number,
  to: number,
): Promise<{ x: number; y: number }> {
  const touch = await fingersOn(page);
  const clear = await clearOfNames(page);
  const pinch = centres
    .flatMap((centre) =>
      [0, 30, -30, 60, -60, 90].map((degrees) => ({
        centre,
        way: { x: Math.cos((degrees * Math.PI) / 180), y: Math.sin((degrees * Math.PI) / 180) },
      })),
    )
    .find(
      ({ centre, way }) =>
        clear(centre.x - (way.x * from) / 2, centre.y - (way.y * from) / 2) &&
        clear(centre.x + (way.x * from) / 2, centre.y + (way.y * from) / 2),
    );
  if (!pinch) throw new Error('names all round the pinch: nowhere to put two fingers');
  const { centre, way } = pinch;
  const fingers = (apart: number): { x: number; y: number; id: number }[] => [
    { x: centre.x - (way.x * apart) / 2, y: centre.y - (way.y * apart) / 2, id: 1 },
    { x: centre.x + (way.x * apart) / 2, y: centre.y + (way.y * apart) / 2, id: 2 },
  ];
  await touch('touchStart', fingers(from).slice(0, 1));
  await touch('touchStart', fingers(from));
  for (let step = 1; step <= 8; step += 1) {
    await touch('touchMove', fingers(from + ((to - from) * step) / 8));
  }
  await touch('touchEnd', []);
  return centre;
}

/**
 * One finger drags the map by (dx, dy), from wherever near `near` it can come down clear of every
 * name and end on the screen. It stops before it lifts: lifted on the move, it flicks (the browser
 * flings, and the map goes on).
 */
async function drag(page: Page, near: { x: number; y: number }, dx: number, dy: number) {
  const touch = await fingersOn(page);
  const clear = await clearOfNames(page);
  const size = page.viewportSize() ?? { width: 412, height: 839 };
  const on = (x: number, y: number) => x > 8 && y > 8 && x < size.width - 8 && y < size.height - 8;
  const start = [0, 60, 90, 120, 160]
    .flatMap((r) => [90, -90, 0, 180, 45, -45, 135, -135].map((degrees) => ({ r, degrees })))
    .map(({ r, degrees }) => ({
      x: near.x + r * Math.cos((degrees * Math.PI) / 180),
      y: near.y + r * Math.sin((degrees * Math.PI) / 180),
    }))
    .find(({ x, y }) => clear(x, y) && on(x, y) && on(x + dx, y + dy));
  if (!start) throw new Error('names everywhere: nowhere to put a finger');
  await touch('touchStart', [{ ...start, id: 1 }]);
  for (let step = 1; step <= 6; step += 1) {
    await touch('touchMove', [
      { x: start.x + (dx * step) / 6, y: start.y + (dy * step) / 6, id: 1 },
    ]);
  }
  // Part of the gesture, not a wait for something to happen: the finger holds still a moment, and
  // lifts where it stopped.
  await page.waitForTimeout(200);
  await touch('touchMove', [{ x: start.x + dx, y: start.y + dy, id: 1 }]);
  await touch('touchEnd', []);
}

/**
 * A name coming, going, changing sides or sliding along its body: which, what it became (its side,
 * "hidden", or its side and "slid"), when (ms, the time of the frame: the clock the engine counts
 * a name's dwell on), and whether the map itself moved in that frame (a finger on it).
 */
interface NameChange {
  name: string;
  now: string;
  at: number;
  moved: boolean;
}

/** What `watchNames` keeps in the page. */
interface NamesWatch {
  changes: NameChange[];
  /** When the map was first seen open (ms, page time: a frame with `html[data-map]`), or null. */
  opened: number | null;
  /** The frame from which the map has ARRIVED, and its names hold still (`ARRIVAL`), or null. */
  arrived: number | null;
  /** When each frame looked at was (ms, page time). */
  frames: number[];
  /** How many frames the map itself moved in, and how many in a row, up to now, it has not. */
  moved: number;
  still: number;
}

/**
 * Every frame from now on (`requestAnimationFrame`), which names show, on which side of their
 * bodies (`data-side`: below, above, left, right), and where they hang from them (the second move
 * of the transform Labels writes, `translate(body) translate(place)`), kept in the page: `changes`
 * is each name that came, went, changed sides, or moved more than `SLID_PX` from one frame to the
 * next along its body (tests/map-names/ counts the same), `arrived` when the map, once opened,
 * had arrived (`ARRIVAL`), and `frames` when each frame was. Time is the frame's own (what `requestAnimationFrame` hands
 * over, which is what the engine counts a name's dwell from), not the moment this got its turn in
 * the frame: two changes the engine made a second apart are a second apart here too, however long
 * the frames between them took to draw.
 *
 * It also sees whether the MAP moved in a frame (a finger dragging it), from where the names say
 * their bodies are: under a finger every body goes along, and at rest the slowest of those named
 * (a sun, the home planet) hardly moves from one frame to the next. `drawn` waits for more than
 * so many frames from a moment on, and `rested` for the map to have moved and then held still so
 * many frames in a row: a number of FRAMES, since how many a page draws in a second is the
 * machine's business (60 on a GPU, 10 where CI draws in software).
 */
async function watchNames(page: Page): Promise<{
  changes: () => Promise<NameChange[]>;
  arrived: () => Promise<number>;
  frames: () => Promise<number[]>;
  drawn: (from: number, frames: number) => Promise<void>;
  rested: (frames: number) => Promise<void>;
}> {
  await page.evaluate((arrival) => {
    const SLID_PX = 10;
    const STILL_PX = 0.5;
    const watch: NamesWatch = {
      changes: [],
      opened: null,
      arrived: null,
      frames: [],
      moved: 0,
      still: 0,
    };
    // The engine's clock since the map opened (ms), the frame before this one, and how many
    // frames it is since the blend was over by that clock.
    let blend = 0;
    let last = Number.NaN;
    let since = 0;
    const seen = new Map<
      Element,
      { side: string; x: number; y: number; bodyX: number; bodyY: number }
    >();
    const look = (now: number): void => {
      watch.frames.push(now);
      if (watch.opened === null && document.documentElement.hasAttribute('data-map')) {
        watch.opened = now;
      }
      if (watch.opened !== null && watch.arrived === null) {
        blend += Math.min(now - last || 0, arrival.frameMs);
        if (blend >= arrival.blendMs) since += 1;
        if (since > arrival.frames && now >= watch.opened + arrival.ms) watch.arrived = now;
      }
      last = now;
      const changes: Omit<NameChange, 'moved'>[] = [];
      // How far the stillest body went, of those named in this frame and in the one before.
      let least = Infinity;
      for (const name of document.querySelectorAll<HTMLElement>('.body-label')) {
        const side = name.hasAttribute('data-shown')
          ? (name.getAttribute('data-side') ?? 'below')
          : 'hidden';
        const [bodyX = Number.NaN, bodyY = Number.NaN, x = Number.NaN, y = Number.NaN] = (
          name.style.transform.match(/-?[\d.]+/g) ?? []
        ).map(Number);
        const was = seen.get(name);
        seen.set(name, { side, x, y, bodyX, bodyY });
        if (was === undefined) continue;
        if (side !== 'hidden' && was.side !== 'hidden') {
          const went = Math.hypot(bodyX - was.bodyX, bodyY - was.bodyY);
          if (Number.isFinite(went)) least = Math.min(least, went);
        }
        const slid =
          side !== 'hidden' && was.side === side && Math.hypot(x - was.x, y - was.y) > SLID_PX;
        if (was.side === side && !slid) continue;
        changes.push({
          name: name.textContent ?? '',
          now: slid ? `${side}, slid` : side,
          at: Math.round(now),
        });
      }
      // (With no name to tell by, the map is taken to be at rest: nothing is let off unseen.)
      const moved = Number.isFinite(least) && least > STILL_PX;
      watch.moved += moved ? 1 : 0;
      watch.still = moved ? 0 : watch.still + 1;
      for (const change of changes) watch.changes.push({ ...change, moved });
      requestAnimationFrame(look);
    };
    look(performance.now());
    Object.assign(window, { e2eNames: watch });
  }, ARRIVAL);
  const watched = (): Promise<NamesWatch> =>
    page.evaluate(() => (window as unknown as { e2eNames: NamesWatch }).e2eNames);
  return {
    changes: async () => (await watched()).changes,
    arrived: async () => {
      await expect.poll(async () => (await watched()).arrived, { timeout: 45_000 }).not.toBeNull();
      return (await watched()).arrived ?? Number.NaN;
    },
    frames: async () => (await watched()).frames,
    drawn: async (from, frames) => {
      await expect
        .poll(async () => (await watched()).frames.filter((at) => at >= from).length, {
          timeout: 45_000,
        })
        .toBeGreaterThan(frames);
    },
    rested: async (frames) => {
      await expect
        .poll(
          async () => {
            const { moved, still } = await watched();
            return moved > 0 ? still : -1;
          },
          { timeout: 45_000 },
        )
        .toBeGreaterThanOrEqual(frames);
    },
  };
}

/**
 * When the camera has pulled all the way out to the map, and its names hold still: 1.2 s after it
 * opens (`html[data-map]`), which is its blend (`tuning.map.blendSec`, 0.9 s) and a few frames
 * more. The blend runs on the ENGINE's clock, on which a frame counts for a tenth of a second at
 * most however long it took to draw (`tuning.loop.maxFrameSec`): a page that draws fewer than ten
 * frames a second (in software, with a busy CPU; a slow phone) is still on its way after 0.9 s
 * by the wall. So the blend is counted as the engine counts it, frame by frame, and the map has
 * arrived three frames after that is over, and not before the 1.2 s.
 */
const ARRIVAL = { ms: 1200, blendMs: 900, frameMs: 100, frames: 3 };

/** Wait for the page's first frame at or after `ms` (page time). */
async function frameAt(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (at) =>
      new Promise<void>((done) => {
        const step = (): void => {
          if (performance.now() >= at) done();
          else requestAnimationFrame(step);
        };
        step();
      }),
    ms,
  );
}

/** The names that show, right now (their text). */
function shownNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.body-label[data-shown]')].map((name) => name.textContent ?? ''),
  );
}

/**
 * The names of planets and moons whose tag lies on a sun or the home planet, right now: the
 * landmarks the map is read by, which only a system's name may lie on (and that as a last resort:
 * ui/Labels.ts). A landmark is where its name says its body is (`bodyOf`), and at least as big as
 * the map draws it at its smallest (`tuning.map.minRadiusPx`: a sun 9 px, the home planet 8); a
 * tag is the visible part of a name's 44 px box, at its top below the body, at its bottom above
 * it, in the middle beside it (global.css).
 */
function tagsOnLandmarks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names = [...document.querySelectorAll<HTMLElement>('.body-label[data-shown]')];
    const landmark = (name: HTMLElement): boolean =>
      name.dataset.kind === 'sun' || name.dataset.kind === 'home';
    const discs = names.filter(landmark).map((name) => {
      const [x = Number.NaN, y = Number.NaN] = (name.style.transform.match(/-?[\d.]+/g) ?? []).map(
        Number,
      );
      const origin = name.offsetParent?.getBoundingClientRect();
      return {
        title: name.textContent ?? '',
        x: x + (origin?.left ?? 0),
        y: y + (origin?.top ?? 0),
        r: name.dataset.kind === 'sun' ? 9 : 8,
      };
    });
    const lying: string[] = [];
    for (const name of names) {
      if (landmark(name)) continue;
      const box = name.getBoundingClientRect();
      const tag = Number.parseFloat(window.getComputedStyle(name, '::after').height);
      const side = name.dataset.side;
      const top =
        side === 'above'
          ? box.bottom - tag
          : side === 'left' || side === 'right'
            ? box.top + (box.height - tag) / 2
            : box.top;
      for (const disc of discs) {
        const dx = disc.x - Math.min(Math.max(disc.x, box.left), box.right);
        const dy = disc.y - Math.min(Math.max(disc.y, top), top + tag);
        if (dx * dx + dy * dy < disc.r * disc.r) lying.push(`${name.textContent} on ${disc.title}`);
      }
    }
    return lying;
  });
}

/**
 * Each name that changed, with the map at rest, within a second of its last change (whenever that
 * was: under the finger too), with both changes. A name lets a change stand for a second
 * (`tuning.labels.dwellSec`) before it makes another OF ITS OWN ACCORD; one it must make, it makes
 * (ui/Labels.ts: its place gone past the edge of the view, or the room needed by a system's name
 * that has come into it). While a finger moves the map those come as the finger brings them, two
 * to a name within a second now and then (tests/map-names/ counts them: a hundred and more in 200 s of fingers
 * on a phone this far in, and it holds a moving map to no such rule): whether ONE drag has such a
 * pair is a matter of how long after the pinch it comes and how many frames it is seen in, which
 * is the machine's business. (Where CI draws in software, Days2Meet's name went above its planet
 * in one frame of the drag and, the finger still moving, had to leave that room 600 ms later to
 * Software's, whose sun had come into view.) At rest nothing brings them, and the second holds.
 */
function againAtRest(changes: readonly NameChange[]): string[] {
  const last = new Map<string, NameChange>();
  const twice: string[] = [];
  for (const change of changes) {
    const before = last.get(change.name);
    if (before && !change.moved && change.at - before.at < 1000) {
      twice.push(
        `${change.name}: ${before.now}, then ${change.now} ${change.at - before.at} ms later`,
      );
    }
    last.set(change.name, change);
  }
  return twice;
}

/** The steps of the simulation in a second: a planted snapshot counts time in them. */
const STEPS_PER_SECOND = 60;

/**
 * Research is at the top edge of the galaxy (since 2026-10-03: until then it was at the bottom),
 * and all its work is planned: the planet Sports Analysis, and Kalshi, its moon. 495 s into a
 * visit (planted: the time is part of what a page keeps) the planet comes round to due north of
 * its sun, and its moon to due north of it: the very top of everything, under the top bar and
 * the Close map button. Fingers bring them in, as a visitor's would: two spread about the sun,
 * and the map slides (at the edge of the galaxy it would rather do that than show empty space
 * past it: sim/mapView.ts, clampView); one drags the sun back to the middle of the map, as far as
 * the map goes; twice, and the map is nine times as close. Both names show, wholly on the screen.
 * (Tried in the browser at five moments of the planet's turn, on both phones: 140, 320, 430, 495
 * and 610 s into a visit, the planet to every side of its sun; both names showed at each.)
 */
async function researchUpClose(page: Page): Promise<void> {
  await openUniverse(page, '/');
  const first = await keptNow(page);
  await loadWith(page, { ...first, steps: 495 * STEPS_PER_SECOND }, '/');
  await openButton(page).tap();
  await mapOpen(page, 'Research');
  const size = page.viewportSize() ?? { width: 412, height: 839 };
  // The map is what the top bar and the Map button leave of the screen.
  const button = await closeButton(page).boundingBox();
  const middle = {
    x: size.width / 2,
    y: ((button?.y ?? 0) + (button?.height ?? 0) + size.height) / 2,
  };
  for (let round = 0; round < 2; round += 1) {
    const sun = await bodyOf(nameOf(page, 'Research'));
    const near = [0, 20, -20, 40, -40].flatMap((dx) =>
      [0, -20, 20].map((dy) => ({ x: sun.x + dx, y: sun.y + dy })),
    );
    await spread(page, near, 40, 120);
    const slid = await bodyOf(nameOf(page, 'Research'));
    await drag(page, { x: slid.x, y: slid.y - 80 }, middle.x - slid.x, middle.y - slid.y);
  }
  for (const title of ['Sports Analysis', 'Kalshi']) {
    const name = nameOf(page, plannedName(title));
    await expect(name).toBeVisible();
    const box = await name.boundingBox();
    expect(box).not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  }
  // No planet's or moon's name lies on Research's sun, nor on any other, to make room for them.
  expect(await tagsOnLandmarks(page)).toEqual([]);
  // It was all the map's: nothing set out.
  await expect(html(page)).toHaveAttribute('data-map', 'open');
  await expect(prompt(page)).not.toContainText('Flying to');
  expect(pathOf(page)).toBe('/');
}

test('the Map button pulls out to the whole galaxy, and puts it away again', async ({ page }) => {
  await openUniverse(page, '/');
  await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
  await openButton(page).click();
  await mapOpen(page, 'Research');

  // Everything is on it: the four systems round home, by their suns' names (both of the Projects
  // binary's), and the home planet's; and nothing of it opened or changed the page. On a phone
  // too, where the map is so snug that the names of a system's planets crowd its sun's: a name
  // has other places than under its body (above it, beside it, slid along it), and the systems'
  // names are placed first, together (ui/Labels.ts).
  for (const name of ['About Me', 'Software', 'Hardware', 'Research', 'Hackathons']) {
    await expect(nameOf(page, name)).toBeVisible();
  }
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

    // Zoom in with the pointer ON the home planet: it stays under the pointer, the rest moves
    // away. The home planet, because it is near the middle of the galaxy: zoomed in on a system at
    // its edge, the map would rather slide than show empty space past it (sim/mapView.ts,
    // clampView), and nothing would stay under the pointer. (Its name goes wherever it has room,
    // and may change places as the map zooms: the bodies are what is measured.)
    const about = await bodyOf(nameOf(page, 'About Me'));
    const hackathons = await bodyOf(nameOf(page, 'Hackathons'));
    await page.mouse.move(about.x, about.y);
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(600);
    const aboutAfter = await bodyOf(nameOf(page, 'About Me'));
    expect(Math.hypot(aboutAfter.x - about.x, aboutAfter.y - about.y)).toBeLessThan(3);
    // (A name that does not show is not in the accessibility tree: ask before measuring.)
    const hackathonsShows = await nameOf(page, 'Hackathons').isVisible();
    const hackathonsAfter = hackathonsShows ? await bodyOf(nameOf(page, 'Hackathons')) : null;
    // Hackathons was to the left of home, and is now further that way, or off the map.
    if (hackathonsAfter)
      expect(aboutAfter.x - hackathonsAfter.x).toBeGreaterThan((about.x - hackathons.x) * 1.3);
    expect(pathOf(page)).toBe('/');
  });

  test('a drag moves the map and nothing else', async ({ page }) => {
    await openUniverse(page, '/');
    await page.keyboard.press('m');
    await mapOpen(page, 'Software');
    const before = await bodyOf(nameOf(page, 'Software'));
    const clear = await clearOfNames(page);

    // The real galaxy (home and three systems round it) is not twice as wide as it is tall:
    // fitted top to bottom, it leaves a laptop's screen some room on either side, about a hundred
    // pixels each way. From empty space (the lower right corner, past the Projects binary:
    // nobody's), to the left, by half of that.
    expect(clear(1200, 730)).toBe(true);
    await page.mouse.move(1200, 730);
    await page.mouse.down();
    await page.mouse.move(1175, 730, { steps: 8 });
    await page.mouse.move(1150, 730, { steps: 8 });
    await page.mouse.up();
    const after = await bodyOf(nameOf(page, 'Software'));
    expect(after.x - before.x).toBeGreaterThan(-55);
    expect(after.x - before.x).toBeLessThan(-45);
    expect(Math.abs(after.y - before.y)).toBeLessThan(3);

    // However far it is dragged, the galaxy stays on the screen: past it is only empty space, and
    // the map stops with the galaxy's edge a name's height inside its own.
    expect((await clearOfNames(page))(1150, 730)).toBe(true);
    await page.mouse.move(1150, 730);
    await page.mouse.down();
    await page.mouse.move(350, 730, { steps: 16 });
    await page.mouse.up();
    const home = await bodyOf(nameOf(page, 'About Me'));
    expect(home.x).toBeGreaterThan(0);
    const software = await bodyOf(nameOf(page, 'Software'));
    expect(after.x - software.x).toBeGreaterThan(0);
    expect(after.x - software.x).toBeLessThan(200);
    const hackathons = await bodyOf(nameOf(page, 'Hackathons'));
    expect(hackathons.x).toBeGreaterThan(0);

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
      const before = await bodyOf(nameOf(page, 'Software'));
      await page.keyboard.down('a');
      await page.waitForTimeout(500);
      await page.keyboard.up('a');
      const after = await bodyOf(nameOf(page, 'Software'));
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

  // On a phone the map opens fitted to its width, and four systems fill it, every one of them
  // named (the first test). These tests hold on to the home planet and Hardware, which sit near
  // the middle, one above and right of the other, and measure the map by the bodies themselves:
  // their names go wherever they have room, and may change places as the map moves.

  test('one finger drags the map, two fingers zoom it, and neither flies the ship', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    await openButton(page).tap();
    await mapOpen(page, 'Hardware');
    const home = await bodyOf(nameOf(page, 'About Me'));
    const sun = await bodyOf(nameOf(page, 'Hardware'));

    // Two fingers spread between the home planet and Hardware, from 40 px apart to twice that:
    // the galaxy opens up round them, twice as wide. On a map this snug the names crowd the
    // middle: the fingers go down wherever is clear of them, as near the line between the two as
    // they can.
    const across = Math.atan2(sun.y - home.y, sun.x - home.x) + Math.PI / 2;
    const centres = [0.5, 0.25, 0.75, 0, 1].flatMap((t) =>
      [0, 20, -20, 40, -40].map((side) => ({
        x: home.x + (sun.x - home.x) * t + Math.cos(across) * side,
        y: home.y + (sun.y - home.y) * t + Math.sin(across) * side,
      })),
    );
    await spread(page, centres, 40, 80);
    const homeZoomed = await bodyOf(nameOf(page, 'About Me'));
    const sunZoomed = await bodyOf(nameOf(page, 'Hardware'));
    const ratio = (sunZoomed.x - homeZoomed.x) / (sun.x - home.x);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    // No thumb stick, no boost pad: on the map, fingers are the map's.
    await expect(page.locator('.touch-stick')).toBeHidden();
    await expect(page.locator('.touch-boost')).toBeHidden();

    // Closer in, there is room to move. One finger, from empty space in the lower half, to the
    // left: the map goes along, by as much, and everything with it. (Opened, it showed
    // everything, and had nowhere to go.) Left, because Hardware sits right of the middle: moved
    // right, it would go off the screen, and its name with it.
    await drag(page, { x: 300, y: 700 }, -60, 0);
    const dragged = await bodyOf(nameOf(page, 'Hardware'));
    const homeDragged = await bodyOf(nameOf(page, 'About Me'));
    expect(dragged.x - sunZoomed.x).toBeGreaterThan(-66);
    expect(dragged.x - sunZoomed.x).toBeLessThan(-54);
    expect(Math.abs(dragged.y - sunZoomed.y)).toBeLessThan(3);
    // Everything goes along: the same 60 px for the home planet as for the sun.
    expect(Math.abs(homeDragged.x - homeZoomed.x - (dragged.x - sunZoomed.x))).toBeLessThan(3);

    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');
    // Back in flight, the boost pad is back too: this visitor has fingers.
    await closeButton(page).tap();
    await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    await expect(page.locator('.touch-boost')).toBeVisible();
  });

  test('closer still, one finger drags the map up and down as well as across', async ({ page }) => {
    await openUniverse(page, '/');
    await openButton(page).tap();
    await mapOpen(page, 'About Me');
    const home = await bodyOf(nameOf(page, 'About Me'));

    // Two fingers spread from 40 px apart to 120, beside the home planet, wherever they come down
    // clear of every name: three times as close, the galaxy is wider than a phone's map, though
    // not as tall. About the home planet, at its bottom edge, the map comes to rest against that
    // edge, and has room to go up from there (the finger's way down) as well as across.
    const offsets = [
      { x: 0, y: -40 },
      { x: 0, y: 40 },
      { x: -40, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: -70 },
      { x: 0, y: 70 },
    ];
    await spread(
      page,
      offsets.map((offset) => ({ x: home.x + offset.x, y: home.y + offset.y })),
      40,
      120,
    );
    const zoomed = await bodyOf(nameOf(page, 'About Me'));

    // One finger, from empty space, down and to the left: the map goes along, by as much both
    // ways, and the home planet with it. Every frame of it, the names are watched, and a dozen
    // frames more once it holds still (the finger stops before it lifts): some must change as
    // the map moves, their bodies nearing the edge of the view, but once it is at rest none
    // comes, goes or changes places within a second of its last change, the drag's included.
    const names = await watchNames(page);
    await drag(page, { x: 300, y: 650 }, -42, 42);
    await names.rested(12);
    const dragged = await bodyOf(nameOf(page, 'About Me'));
    expect(againAtRest(await names.changes())).toEqual([]);
    expect(dragged.x - zoomed.x).toBeGreaterThan(-48);
    expect(dragged.x - zoomed.x).toBeLessThan(-36);
    expect(dragged.y - zoomed.y).toBeGreaterThan(36);
    expect(dragged.y - zoomed.y).toBeLessThan(48);

    // A drag, not a press: nothing set out, and the map is still open.
    await expect(html(page)).toHaveAttribute('data-map', 'open');
    await expect(prompt(page)).not.toContainText('Flying to');
    expect(pathOf(page)).toBe('/');
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
    const home = await bodyOf(nameOf(page, 'About Me'));
    const sun = await bodyOf(nameOf(page, 'Hardware'));
    const onName = await middleOf(nameOf(page, 'Hardware'));
    const touch = await fingersOn(page);

    // Two fingers: the first on empty space between Hardware and the home planet, the second
    // right on Hardware's name. Spread twice as far apart: the second finger is part of the
    // pinch, not a press.
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
    const mid = { x: (first.x + onName.x) / 2, y: (first.y + onName.y) / 2 };
    const fingers = (apart: number): { x: number; y: number; id: number }[] => [
      { x: mid.x + (first.x - mid.x) * apart, y: mid.y + (first.y - mid.y) * apart, id: 1 },
      { x: mid.x + (onName.x - mid.x) * apart, y: mid.y + (onName.y - mid.y) * apart, id: 2 },
    ];
    await touch('touchStart', fingers(1).slice(0, 1));
    await touch('touchStart', fingers(1));
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', fingers(1 + step / 8));
    await touch('touchEnd', []);
    const homeZoomed = await bodyOf(nameOf(page, 'About Me'));
    const zoomed = await bodyOf(nameOf(page, 'Hardware'));
    expect((zoomed.x - homeZoomed.x) / (sun.x - home.x)).toBeGreaterThan(1.5);
    await expect(html(page)).toHaveAttribute('data-map', 'open');

    // One finger, down on Hardware's own name and moved left: the map goes along, by as much,
    // and the sun with it. Left, because Hardware now sits well right of the middle.
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
    const dragged = await bodyOf(nameOf(page, 'Hardware'));
    expect(dragged.x - zoomed.x).toBeGreaterThan(-66);
    expect(dragged.x - zoomed.x).toBeLessThan(-54);
    expect(Math.abs(dragged.y - zoomed.y)).toBeLessThan(3);
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

  test('at rest, the names hold still: frame after frame, none comes, goes or changes sides', async ({
    page,
  }) => {
    // 1,500 s into a visit (planted: the time is part of what a page keeps), a busy moment on a
    // phone's map: every system named, and the planets round them crowding their suns' names.
    await openUniverse(page, '/');
    const first = await keptNow(page);
    await loadWith(page, { ...first, steps: 1500 * STEPS_PER_SECOND }, '/');
    const names = await watchNames(page);
    await openButton(page).tap();
    // The names hold still from the moment the camera has pulled all the way out to the map: every
    // frame from then on, for four seconds (the page counts them, on its own clock), none comes,
    // goes or changes sides. And for more than 60 frames, however long the page takes to draw
    // them: a second's worth on a GPU, six where it draws in software (CI, or a slow phone).
    const from = await names.arrived();
    await frameAt(page, from + 4000);
    await names.drawn(from, 60);
    expect((await names.frames()).filter((at) => at >= from).length).toBeGreaterThan(60);
    expect((await names.changes()).filter((change) => change.at >= from)).toEqual([]);
    for (const name of ['About Me', 'Software', 'Hardware', 'Research', 'Hackathons']) {
      await expect(nameOf(page, name)).toBeVisible();
    }
  });

  test('all the way in, fingers bring the names of Research’s planned work into view', async ({
    page,
  }) => {
    await researchUpClose(page);
  });
});

test.describe('on a phone 360 px wide', () => {
  test.skip(({ isMobile }) => !isMobile, 'fingers');
  test.use({ viewport: { width: 360, height: 740 } });

  test('the first view names every system, whenever the visitor looks', async ({ page }) => {
    await openUniverse(page, '/');
    const first = await keptNow(page);
    // As the page loads, and later in a visit (the Projects binary a third and two thirds of the
    // way round, and every planet wherever it is by then): the time is part of what a page keeps,
    // so a page can be loaded at any moment.
    for (const seconds of [0, 1500, 3000]) {
      if (seconds > 0) await loadWith(page, { ...first, steps: seconds * 60 }, '/');
      const names = await watchNames(page);
      await openButton(page).tap();
      // The moment the map has arrived, not later: every system's name, and no planet's or
      // moon's on a sun or the home planet.
      await names.arrived();
      const [shown, lying] = await Promise.all([shownNames(page), tagsOnLandmarks(page)]);
      expect(shown).toEqual(
        expect.arrayContaining(['About Me', 'Software', 'Hardware', 'Research', 'Hackathons']),
      );
      expect(lying).toEqual([]);
      await closeButton(page).tap();
      await expect(html(page)).not.toHaveAttribute('data-map', /.*/);
    }
  });

  test('all the way in, fingers bring the names of Research’s planned work into view', async ({
    page,
  }) => {
    await researchUpClose(page);
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
