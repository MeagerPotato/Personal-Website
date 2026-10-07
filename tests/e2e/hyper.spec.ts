// HYPERSPACE (docs/PLAN.md §5.5): a journey that is long and fast enough may be shown as a jump.
// Shift takes it while its chip shows (on a phone: a round pad where the boost pad stands); the
// flight under it is the same flight, so it docks where and when it would have.
//
// These tests read `<html data-hyper>` (offered, windup, tunnel), which the shell writes from the
// simulation's own state. An offer lasts a second or two and a machine drawing on its CPU may not
// look while it does, so every press here is made BY THE PAGE, the moment the state it waits for
// is told (as rebuild.spec.ts presses Stop): nothing depends on the frame rate.

import type { Page } from '@playwright/test';
import {
  collectErrors,
  engineReady,
  expect,
  keptNow,
  nameOf,
  openUniverse,
  pointAt,
  softNavigate,
  test,
  watchAttribute,
  watchText,
} from './support';

const html = (page: Page) => page.locator('html');
const prompt = (page: Page) => page.locator('.dock-prompt');
const chip = (page: Page) => page.locator('.hyper-offer');
const status = (page: Page) => page.locator('[data-announcer]');
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** A flight takes as long as it takes: a CI machine renders on its CPU, and time stretches. */
const FLIGHT = { timeout: 75_000 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the page does, once, the moment `<html data-hyper>` takes a value. */
type Act =
  /** A fresh press of Shift, and its release. */
  | 'shift'
  /** Tab with Shift down: the second half of Shift+Tab. */
  | 'chord'
  /** The prompt's button: on a journey, Stop. */
  | 'stop'
  /** Open the star map, then press Shift: at once, and again two frames later. */
  | 'map'
  /** Take the WebGL context away, the way a browser would. */
  | 'lose'
  /** A finger on the offer's pad, once it has arrived: down, up, click. */
  | 'tap'
  /** Note where everything on the screen stands, once it has arrived. */
  | 'measure';
type Script = Partial<Record<'offered' | 'windup' | 'tunnel', Act>>;

/** What the page noted while it did that. */
interface Noted {
  /** Did the offer's button ever show? */
  shown: boolean;
  /** `lose`: could the context be taken away? */
  lost?: boolean;
  /** `map`: was the button hidden two frames after the map opened? */
  hiddenOnMap?: boolean;
  /** `tap`: where the pad stood, and what a finger at its middle lands on. */
  pad?: Box;
  hit?: string;
  /** `measure`: where each thing stood, or null for what is not on this screen. */
  boxes?: Record<string, Box | null>;
}

const WHAT = {
  chip: '.hyper-offer',
  prompt: '.dock-prompt',
  deck: '.flight-deck',
  minimap: '.minimap',
  'the Map button': '.map-toggle',
  'the way to the plain version': '.mode-link--to-plain',
} as const;

/** From now on the page acts by this script, and notes what it sees (`noted`). */
async function react(page: Page, script: Script): Promise<void> {
  await page.evaluate(
    ({ script, what }) => {
      const root = document.documentElement;
      const noted: Noted = { shown: false };
      (window as Window & { e2eHyper?: Noted }).e2eHyper = noted;
      const offer = (): HTMLButtonElement | null => document.querySelector('.hyper-offer');

      // Did the offer ever show? (A rebuilt engine brings a button of its own: watch them all.)
      const overlay = document.getElementById('universe-overlay');
      const look = (): void => {
        if (offer()?.hidden === false) noted.shown = true;
      };
      look();
      if (overlay) {
        new MutationObserver(look).observe(overlay, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['hidden'],
        });
      }

      const frames = (count: number): Promise<void> =>
        new Promise((done) => {
          const step = (): void => {
            count -= 1;
            if (count < 0) done();
            else requestAnimationFrame(step);
          };
          step();
        });
      const boxOf = (selector: string): Box | null => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return null;
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      /** Everything that slides or grows into its place has: the chip, the prompt, the deck. */
      const arrived = async (): Promise<void> => {
        await frames(2);
        const moving = Object.values(what).flatMap(
          (selector) => document.querySelector(selector)?.getAnimations() ?? [],
        );
        await Promise.race([
          Promise.all(moving.map((animation) => animation.finished.catch(() => undefined))),
          new Promise((done) => setTimeout(done, 1500)),
        ]);
        await frames(1);
      };
      const shift = (): void => {
        const init = { code: 'ShiftLeft', key: 'Shift', bubbles: true };
        window.dispatchEvent(new KeyboardEvent('keydown', { ...init, shiftKey: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', init));
      };

      const acts: Record<Act, () => void | Promise<void>> = {
        shift,
        chord: () => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              code: 'Tab',
              key: 'Tab',
              shiftKey: true,
              bubbles: true,
            }),
          );
        },
        stop: () => document.querySelector<HTMLButtonElement>('.dock-prompt')?.click(),
        map: async () => {
          document.querySelector<HTMLButtonElement>('.map-toggle')?.click();
          shift();
          await frames(2);
          noted.hiddenOnMap = offer()?.hidden !== false;
          shift();
        },
        lose: () => {
          const canvas = document.querySelector<HTMLCanvasElement>('#universe-host canvas');
          canvas?.setAttribute('data-e2e-canvas', 'lost');
          // The canvas has a context already, and asking again hands back that very one.
          const lose = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
          lose?.loseContext();
          noted.lost = Boolean(lose);
        },
        tap: async () => {
          await arrived();
          const pad = offer();
          const rect = pad?.getBoundingClientRect();
          if (!pad || !rect) return;
          noted.pad = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          const under = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          noted.hit =
            under !== null && pad.contains(under)
              ? 'the pad'
              : (under?.className ?? under?.tagName ?? 'nothing');
          const finger = { button: 0, pointerType: 'touch', isPrimary: true, bubbles: true };
          pad.dispatchEvent(new PointerEvent('pointerdown', finger));
          pad.dispatchEvent(new PointerEvent('pointerup', finger));
          pad.click();
        },
        measure: async () => {
          await arrived();
          noted.boxes = Object.fromEntries(
            Object.entries(what).map(([name, selector]) => [name, boxOf(selector)]),
          );
        },
      };

      const done = new Set<string>();
      new MutationObserver(() => {
        const state = root.dataset.hyper as keyof Script | undefined;
        const act = state === undefined ? undefined : script[state];
        if (state === undefined || act === undefined || done.has(state)) return;
        done.add(state);
        void acts[act]();
      }).observe(root, { attributes: true, attributeFilter: ['data-hyper'] });
    },
    { script, what: WHAT },
  );
}

const noted = (page: Page): Promise<Noted> =>
  page.evaluate(() => (window as Window & { e2eHyper?: Noted }).e2eHyper ?? { shown: false });

/**
 * Set out for a body by its name in the sky. The name is a real button and this is its click,
 * made without a pointer: from the spawn point a far system's name may be off the screen, and
 * the journey that follows is the one a press on it, on its mark on the minimap or on the star
 * map begins (world.spec.ts, deck.spec.ts and map.spec.ts press those for real).
 */
async function setOut(page: Page, name: string): Promise<void> {
  const button = page.locator('.body-label').filter({ hasText: new RegExp(`^${name}$`) });
  await expect(button).toHaveCount(1);
  await button.dispatchEvent('click');
}

const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('Shift on a long journey shows it as a jump, and it docks where it was going', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openUniverse(page, '/');
  const hyper = await watchAttribute(page, 'data-hyper');
  const told = await watchText(page, '[data-announcer]');
  await react(page, { offered: 'shift' });
  await setOut(page, 'Hackathons');

  await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
  await expect(status(page)).toHaveText('Docked at Hackathons.');
  await expect(prompt(page)).toContainText('Leave orbit');
  // Offered, wound up, the tunnel, and gone before the ship arrived.
  expect(await hyper()).toEqual([null, 'offered', 'windup', 'tunnel', null]);
  await expect(html(page)).not.toHaveAttribute('data-hyper', /.*/);
  await expect(chip(page)).toBeHidden();
  expect((await noted(page)).shown).toBe(true);
  // Said once, when the tunnel opened; the offer itself is not announced.
  const said = (await told()).map(({ text }) => text);
  expect(said.filter((text) => text.includes('yperspace'))).toEqual(['Hyperspace.']);
  expect(said.indexOf('Flying to Hackathons.')).toBeLessThan(said.indexOf('Hyperspace.'));
  expect(said.indexOf('Hyperspace.')).toBeLessThan(said.indexOf('Docked at Hackathons.'));
  // Both of its shaders compiled, in this browser too (they are drawn once at boot).
  expect(errors).toEqual([]);
});

test('Shift+Tab is no jump: the wind-up is taken back, and the offer stands again', async ({
  page,
}) => {
  await openUniverse(page, '/');
  const hyper = await watchAttribute(page, 'data-hyper');
  const told = await watchText(page, '[data-announcer]');
  await react(page, { offered: 'shift', windup: 'chord' });
  await setOut(page, 'Hackathons');

  await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
  await expect(status(page)).toHaveText('Docked at Hackathons.');
  expect(await hyper()).toEqual([null, 'offered', 'windup', 'offered', null]);
  expect((await told()).map(({ text }) => text)).not.toContain('Hyperspace.');
});

test('Stop in the tunnel ends the jump with the journey, and the ship comes to rest', async ({
  page,
}) => {
  await openUniverse(page, '/');
  const hyper = await watchAttribute(page, 'data-hyper');
  await react(page, { offered: 'shift', tunnel: 'stop' });
  await setOut(page, 'Hackathons');

  await expect(status(page)).toHaveText('Stopped.', FLIGHT);
  await expect(html(page)).not.toHaveAttribute('data-hyper', /.*/);
  expect(await hyper()).toEqual([null, 'offered', 'windup', 'tunnel', null]);
  await expect(prompt(page)).not.toContainText('Flying to');
  // From the autopilot's speed in the tunnel to rest, where it is: nothing opens.
  await expect
    .poll(async () => {
      const { ship } = await keptNow(page);
      return Math.hypot(ship.vx, ship.vz);
    }, FLIGHT)
    .toBeLessThan(0.5);
  expect(pathOf(page)).toBe('/');
  await expect(html(page)).toHaveAttribute('data-panel', 'closed');
});

test.describe('nothing is offered', () => {
  test('on a hop inside home, which never gets fast enough', async ({ page, isMobile }) => {
    await openUniverse(page, '/');
    const hyper = await watchAttribute(page, 'data-hyper');
    await react(page, { offered: 'shift' });
    await pointAt(page, nameOf(page, 'About Me'), isMobile);

    await expect.poll(() => pathOf(page), FLIGHT).toBe('/about/');
    await expect(prompt(page)).toContainText('Leave orbit');
    expect(await hyper()).toEqual([null]);
    expect((await noted(page)).shown).toBe(false);
  });

  test('on a journey that began with a link: its page is open, and Shift is the page’s', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    const hyper = await watchAttribute(page, 'data-hyper');
    await react(page, { offered: 'shift' });
    await softNavigate(page, '/systems/hackathons/');

    await expect(prompt(page)).toContainText('Leave orbit', FLIGHT);
    // The journey itself had a jump to give; there was nowhere to offer it, and nothing took it.
    expect(await hyper()).toEqual([null, 'offered', null]);
    expect((await noted(page)).shown).toBe(false);
    expect(pathOf(page)).toBe('/systems/hackathons/');
  });

  test('while the star map is open: its button goes, and Shift does nothing', async ({ page }) => {
    await openUniverse(page, '/');
    const hyper = await watchAttribute(page, 'data-hyper');
    await react(page, { offered: 'map' });
    await setOut(page, 'Hackathons');

    await expect(status(page)).toHaveText('Docked at Hackathons.', FLIGHT);
    expect(await hyper()).toEqual([null, 'offered', null]);
    expect((await noted(page)).hiddenOnMap).toBe(true);
  });

  test.describe('to a visitor who asked for less motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('no offer, and Shift does nothing', async ({ page }) => {
      await openUniverse(page, '/');
      const hyper = await watchAttribute(page, 'data-hyper');
      await react(page, { offered: 'shift' });
      await page.keyboard.press('Shift');
      await setOut(page, 'Hackathons');
      await page.keyboard.press('Shift');

      // Their journeys are cuts, and none of them is ever a jump.
      await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
      await expect(prompt(page)).toContainText('Leave orbit');
      await page.keyboard.press('Shift');
      expect(await hyper()).toEqual([null]);
      expect((await noted(page)).shown).toBe(false);
    });
  });
});

test('a context lost in the tunnel: the rebuilt engine is in the tunnel again, with no second punch', async ({
  page,
}) => {
  await openUniverse(page, '/');
  const hyper = await watchAttribute(page, 'data-hyper');
  const told = await watchText(page, '[data-announcer]');
  await react(page, { offered: 'shift', tunnel: 'lose' });
  await setOut(page, 'Hackathons');

  await expect.poll(async () => (await noted(page)).lost, FLIGHT).not.toBeUndefined();
  test.skip(!(await noted(page)).lost, 'this browser cannot lose a context on request');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector('#universe-host canvas');
        return canvas !== null && canvas.getAttribute('data-e2e-canvas') !== 'lost';
      }),
    )
    .toBe(true);
  await engineReady(page);

  await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
  await expect(status(page)).toHaveText('Docked at Hackathons.');
  // The old engine's jump went with it (the page is told so), and the new one took it up IN the
  // tunnel: no second wind-up, and "Hyperspace." is not said twice.
  expect(await hyper()).toEqual([null, 'offered', 'windup', 'tunnel', null, 'tunnel', null]);
  const said = (await told()).map(({ text }) => text);
  expect(said.filter((text) => text === 'Hyperspace.')).toHaveLength(1);
});

test.describe('a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the round pad');

  test('the offer is a round pad exactly where the boost pad stands, and a tap jumps', async ({
    page,
  }) => {
    await openUniverse(page, '/');
    // Where the boost pad stands. It waits for the first touch on the sky, so it is shown for
    // the length of one measurement (the engine hides it again with its next frame).
    const boost = await page.evaluate(() => {
      const pad = document.querySelector<HTMLElement>('.touch-boost');
      if (!pad) return null;
      const was = pad.hidden;
      pad.hidden = false;
      const rect = pad.getBoundingClientRect();
      pad.hidden = was;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(boost?.width).toBeGreaterThanOrEqual(44);
    const hyper = await watchAttribute(page, 'data-hyper');
    await react(page, { offered: 'tap' });
    await setOut(page, 'Hackathons');

    await expect.poll(() => pathOf(page), FLIGHT).toBe('/systems/hackathons/');
    const { pad, hit } = await noted(page);
    expect(pad).toEqual(boost);
    // Round, and nothing lies on it.
    expect(pad?.width).toBe(pad?.height);
    expect(hit).toBe('the pad');
    expect(await hyper()).toEqual([null, 'offered', 'windup', 'tunnel', null]);
  });
});

/** The chip keeps off everything else on the screen, and is big enough to press. */
async function standsClear(page: Page, here: readonly (keyof typeof WHAT)[]): Promise<Box> {
  const hyper = await watchAttribute(page, 'data-hyper');
  await react(page, { offered: 'measure' });
  await setOut(page, 'Hackathons');
  await expect.poll(async () => (await noted(page)).boxes, FLIGHT).toBeDefined();
  const boxes = (await noted(page)).boxes ?? {};
  // It was measured while it was on offer.
  expect(await hyper()).toContain('offered');

  const present = Object.keys(WHAT).filter((name) => boxes[name] != null);
  expect(present.sort()).toEqual([...here].sort());
  const box = boxes.chip;
  if (!box) throw new Error('no chip to measure');
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const touching = present.filter((name) => {
    const other = boxes[name];
    return name !== 'chip' && other != null && overlap(box, other);
  });
  expect(touching).toEqual([]);
  // All of it on the screen.
  const view = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view?.width ?? 0);
  expect(box.y + box.height).toBeLessThanOrEqual(view?.height ?? 0);
  return box;
}

const ALL = Object.keys(WHAT) as (keyof typeof WHAT)[];

test.describe('where the chip stands, under a mouse', () => {
  test.skip(({ isMobile }) => isMobile, 'a mouse');

  for (const [width, height] of [
    [1280, 800],
    [768, 576],
  ] as const) {
    test(`beside the seated deck at ${width} by ${height}: above the prompt, 12 px left of the cluster`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openUniverse(page, '/');
      const box = await standsClear(page, ALL);
      const { boxes } = await noted(page);
      const deck = boxes?.deck;
      const dock = boxes?.prompt;
      if (!deck || !dock) throw new Error('no deck or no prompt');
      expect(Math.round(deck.x - (box.x + box.width))).toBe(12);
      // A row above the prompt, 8 px clear of it, its right end on the prompt's.
      expect(Math.round(dock.y - (box.y + box.height))).toBe(8);
      expect(Math.round(dock.x + dock.width - (box.x + box.width))).toBe(0);
    });
  }

  test('in the bottom right corner at 700 by 500, where the deck is a strip and there is no minimap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 500 });
    await openUniverse(page, '/');
    const box = await standsClear(
      page,
      ALL.filter((name) => name !== 'minimap'),
    );
    expect(Math.round(700 - (box.x + box.width))).toBe(24);
    // On its ledge, 12 px above the bottom of the view.
    expect(Math.round(500 - (box.y + box.height))).toBe(12);
  });
});

test.describe('where the pad stands, on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a finger');

  test('clear of the prompt, the strip, the Map button and the corner chip', async ({ page }) => {
    await openUniverse(page, '/');
    await standsClear(
      page,
      ALL.filter((name) => name !== 'minimap'),
    );
  });
});
