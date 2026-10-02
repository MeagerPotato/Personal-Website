// The baked sky (src/universe/world/SkyBake.ts): gas cliffs, a Milky Way and far galaxies, painted
// once into a panorama AFTER the first frame, so that it never holds the first frame up. The page
// says where it is on <html data-sky>: `baking` (the old glows are still the sky), then `ready`.
// A lost WebGL context paints the same sky again, and a visitor who asked for less motion gets
// it with a cut.

import { inflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { engineReady, expect, openUniverse, test, universe } from './support';

const html = (page: Page) => page.locator('html');

/** What <html data-sky> has said so far, in order. Call before the page loads. */
async function watchSky(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as Window & { e2eSky?: string[] }).e2eSky = said;
    const note = (): void => {
      const now = document.documentElement.dataset.sky;
      if (now !== undefined && said[said.length - 1] !== now) said.push(now);
    };
    // The document, not <html>: this runs before the page has one.
    new MutationObserver(note).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-sky'],
    });
  });
  return () => page.evaluate(() => (window as Window & { e2eSky?: string[] }).e2eSky ?? []);
}

/**
 * The colour of one CSS pixel of the page, as the screen shows it: a screenshot one pixel big.
 * (A PNG of one pixel is its filter byte and then the pixel, whatever the filter.)
 */
async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' });
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT')
      chunks.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const [, r = 0, g = 0, b = 0] = inflateSync(Buffer.concat(chunks));
  return [r, g, b];
}

/** Three places in the sky that the first frame at home leaves free of bodies, names and HUD. */
async function skyPoints(page: Page): Promise<Array<[number, number]>> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  return (
    [
      [0.9, 0.56],
      [0.78, 0.64],
      [0.2, 0.6],
    ] as const
  ).map(([u, v]) => [Math.round(size.width * u), Math.round(size.height * v)]);
}

async function skyAt(page: Page): Promise<number[][]> {
  const pixels: number[][] = [];
  for (const [x, y] of await skyPoints(page)) pixels.push(await pixelAt(page, x, y));
  return pixels;
}

/** The largest difference between two readings of the sky, in code values. */
const apart = (a: number[][], b: number[][]): number =>
  Math.max(...a.flatMap((pixel, i) => pixel.map((c, j) => Math.abs(c - (b[i]?.[j] ?? 0)))));

test('the baked sky arrives after the first frame: baking, then ready', async ({ page }) => {
  const said = await watchSky(page);
  await openUniverse(page, '/');
  await expect(html(page)).toHaveAttribute('data-sky', 'ready', { timeout: 45_000 });
  expect(await said()).toEqual(['baking', 'ready']);
});

test.describe('for a visitor who asked for less motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the sky arrives with a cut, and a lost context paints the same sky again', async ({
    page,
  }) => {
    // Nothing twinkles and nothing drifts here, so the sky holds still to be compared.
    await page.goto(universe('/'));
    await engineReady(page);
    await expect(html(page)).toHaveAttribute('data-sky', 'ready', { timeout: 45_000 });
    // A cut: the sky is whole in the frame that says so. (A fade would still be coming in.)
    const arrived = await skyAt(page);
    await expect.poll(async () => apart(await skyAt(page), arrived)).toBeLessThanOrEqual(3);
    const before = await skyAt(page);
    expect(apart(before, arrived)).toBeLessThanOrEqual(3);

    const lost = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#universe-host canvas');
      canvas?.setAttribute('data-e2e-canvas', 'lost');
      const lose = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      lose?.loseContext();
      return Boolean(lose);
    });
    test.skip(!lost, 'this browser cannot lose a context on request');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector('#universe-host canvas');
          return canvas !== null && canvas.getAttribute('data-e2e-canvas') !== 'lost';
        }),
      )
      .toBe(true);
    await engineReady(page);
    // The new engine says `baking` again, then paints the very same panorama.
    await expect(html(page)).toHaveAttribute('data-sky', 'ready', { timeout: 45_000 });
    await expect.poll(async () => apart(await skyAt(page), before)).toBeLessThanOrEqual(3);
  });
});
