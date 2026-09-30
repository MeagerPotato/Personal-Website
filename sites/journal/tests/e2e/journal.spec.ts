// The journal's promise, end to end: set up with a passkey and a recovery phrase, write a day,
// lock and unlock, join from a second device with the phrase, and see each other's edits, while
// the server receives nothing but ciphertext. One journal for the whole file, so the tests run
// in order and each builds on the last.

import { AxeBuilder } from '@axe-core/playwright';
import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

test.describe.configure({ mode: 'serial' });

/** Words that appear nowhere but in what these tests write: the server must never see them. */
const SECRET = 'Quillwort Marmalade';
const TODO = 'Water the sundews';
const PERSON = 'Maya Quillwort';

interface Device {
  page: Page;
  /** Errors, uncaught exceptions and CSP violations, as the page reported them. */
  problems: string[];
  /** Every request body sent to /api: everything the server was ever given. */
  sent: Buffer[];
}

/** A browser with its own storage and its own passkey authenticator: one of Allen's devices. */
async function device(browser: Browser, options: BrowserContextOptions = {}): Promise<Device> {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  const problems: string[] = [];
  const sent: Buffer[] = [];
  page.on('console', (message) => {
    // Chrome logs every request that fails for want of a network; the offline test makes some.
    const offline = message.text() === 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED';
    if (message.type() === 'error' && !offline) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('request', (request) => {
    const body = request.postDataBuffer();
    if (body && new URL(request.url()).pathname.startsWith('/api/')) sent.push(body);
  });
  return { page, problems, sent };
}

/** A folder for a picture of every screen the sweep checks, light and dark (unset: none). */
const SHOTS = process.env.E2E_SHOTS;

/**
 * Serious or critical axe findings (WCAG 2.2 AA), one line each, in light mode and in dark (the
 * journal is written at night). Motion reduced, so no colour is caught halfway through a fade.
 */
async function seriousIssues(page: Page, screen: string): Promise<string[]> {
  const found: string[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    if (SHOTS) {
      const name = `${screen}-${colorScheme}.png`.replaceAll(/[^\w.-]+/g, '-');
      await page.screenshot({ path: join(SHOTS, name), fullPage: true });
    }
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const { id, help, impact, nodes } of violations) {
      if (impact !== 'serious' && impact !== 'critical') continue;
      const where = nodes.map(({ target }) => target.join(' ')).join('; ');
      found.push(`${colorScheme}: ${id}: ${help} (${where})`);
    }
  }
  await page.emulateMedia({ colorScheme: null, reducedMotion: null });
  return found;
}

const entry = (page: Page) => page.getByRole('textbox', { name: /^Journal entry/ });
const moods = (page: Page) => page.getByRole('radiogroup', { name: /mood/i });
/** The screen's one heading, which has the focus whenever a new screen has just been shown. */
const title = (page: Page) => page.getByRole('heading', { level: 1 });

let phrase = '';
let laptop: Device;
let phone: Device;

test.beforeAll(async ({ browser }) => {
  laptop = await device(browser, { viewport: { width: 1280, height: 860 } });
});

test.afterAll(async () => {
  await laptop?.page.context().close();
  await phone?.page.context().close();
});

test('sets up the journal with a recovery phrase and a passkey', async () => {
  const { page } = laptop;
  await page.goto('/');
  await page.getByLabel('Setup code').fill('e2e-setup-code');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.locator('.phrase__word')).toHaveCount(24);
  await expect(title(page)).toBeFocused();
  const words = await page.locator('.phrase__word').allTextContents();
  phrase = words.join(' ');
  await page.getByLabel('I’ve written down all 24 words').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Three words, chosen at random, typed back.
  await expect(page.locator('label.field > span')).toHaveCount(3);
  const asked = await page.locator('label.field > span').allTextContents();
  for (const label of asked) {
    const position = Number(label.replace('Word ', ''));
    await page.getByLabel(label, { exact: true }).fill(words[position - 1] ?? '');
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Make a passkey' }).click();
  await expect(title(page)).toHaveText('Unlock once to finish');
  await expect(title(page)).toBeFocused();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(moods(page)).toBeVisible();
  await expect(title(page)).toBeFocused();
});

test('writes a day, and the server receives only ciphertext', async () => {
  const { page } = laptop;
  let uploads = 0;
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'PUT' && request.url().includes('/api/blobs/') && response.ok()) {
      uploads += 1;
    }
  });

  await moods(page).getByRole('radio', { name: 'Good' }).click();
  await page.getByRole('button', { name: 'coding', exact: true }).click();

  await entry(page).click();
  await page.keyboard.type(`A day with ${SECRET} in it.`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/to-do');
  await expect(page.getByRole('option', { name: /To-do list/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type(TODO);
  await expect(entry(page).getByRole('checkbox')).toHaveCount(1);

  const photo = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 120, g: 180, b: 220 } },
  })
    .jpeg()
    .toBuffer();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos' }).click();
  await (await chooser).setFiles({ name: 'sky.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.locator('.photo img')).toBeVisible();

  // A person, then the same name again: still one person.
  for (const typed of [PERSON, PERSON.toLowerCase()]) {
    await page.getByRole('button', { name: 'Person' }).click();
    await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.link-chip')).toHaveCount(1);

  // Saved, sent, and the photo's two sealed files (picture and thumbnail) uploaded.
  await expect(page.locator('.sidebar .sync__words')).toHaveText('Synced');
  await expect.poll(() => uploads, { timeout: 30_000 }).toBe(2);

  const everything = Buffer.concat(laptop.sent);
  for (const words of [SECRET, TODO, PERSON]) expect(everything.includes(words)).toBe(false);
  // No photo left the device as a photo (a JPEG starts FF D8 FF and names itself JFIF).
  expect(
    laptop.sent.some((body) => body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))),
  ).toBe(false);
  expect(everything.includes('JFIF')).toBe(false);
});

test('a reload locks the journal, and the passkey opens it again', async () => {
  const { page } = laptop;
  await page.reload();
  await expect(page.getByRole('button', { name: /^Unlock with/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Unlock with/ }).click();
  await expect(entry(page)).toContainText(SECRET);
  await expect(moods(page).getByRole('radio', { name: 'Good' })).toBeChecked();
  await expect(title(page)).toBeFocused();
});

test('the day’s activities fold to its own and the usual ones, the rest a click away', async () => {
  const { page } = laptop;
  const all = page.getByRole('button', { name: 'All activities' });
  const chip = (name: string) => page.getByRole('button', { name, exact: true });
  // A new journal showed every activity; now the day has one, the rest are folded away.
  await expect(all).toHaveAttribute('aria-expanded', 'false');
  await expect(chip('coding')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('rocketry')).toHaveCount(0);

  // Unfolded, every group; picked there, it stays when folded.
  await all.click();
  await expect(all).toHaveAttribute('aria-expanded', 'true');
  await chip('rocketry').click();
  await all.click();
  await expect(chip('rocketry')).toHaveAttribute('aria-pressed', 'true');
  // Taken back while folded, it stays in place for the moment: a slip is one tap to undo.
  await chip('rocketry').click();
  await expect(chip('rocketry')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('coding')).toHaveAttribute('aria-pressed', 'true');
});

test('with no connection, the app still opens and unlocks this device’s copy', async () => {
  const { page } = laptop;
  const context = page.context();
  const words = page.locator('.sidebar .sync__words');
  // The service worker has kept this build and answers for the page.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state ?? 'none'))
    .toBe('activated');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline: unlocking this device’s own copy.')).toBeVisible();
  await page.getByRole('button', { name: /^Unlock with/ }).click();
  await expect(entry(page)).toContainText(SECRET);
  await expect(words).toHaveText(/^Offline/);

  // Back online, it syncs by itself. Not on the 'online' event: the authenticator's DevTools
  // session makes a page reloaded offline believe it is online, so none ever fires. Which is the
  // case of a captive portal, where only the journal's own retries bring it back.
  await context.setOffline(false);
  await expect(words).toHaveText('Synced');
});

test('a phone joins with the recovery phrase and sees the same day', async ({ browser }) => {
  phone = await device(browser, devices['Pixel 7']);
  const { page } = phone;
  await page.goto('/');
  await page.getByRole('button', { name: 'Use recovery phrase' }).click();
  await page.getByRole('textbox').fill(phrase);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Make a passkey' }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();

  await expect(entry(page)).toContainText(SECRET);
  await expect(entry(page)).toContainText(TODO);
  await expect(moods(page).getByRole('radio', { name: 'Good' })).toBeChecked();
  await expect(page.locator('.link-chip')).toHaveText(PERSON);
  // The photo came down sealed and opened here.
  const photo = page.locator('.photo img');
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test('an edit on the phone reaches the laptop', async () => {
  await moods(phone.page).getByRole('radio', { name: 'Great' }).click();
  await expect(phone.page.locator('#more .sync__words')).toHaveText('Synced');

  const { page } = laptop;
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(moods(page).getByRole('radio', { name: 'Great' })).toBeChecked();
  await expect(entry(page)).toContainText(SECRET);
});

test('a device tells when the server keeps a change from it', async () => {
  const { page } = laptop;
  const words = page.locator('.sidebar .sync__words');
  // A server that leaves the records in here out of the laptop's pulls.
  const kept = new Set<string>();
  const withhold = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { changes: { id: string }[] };
    const changes = body.changes.filter((change) => !kept.has(change.id));
    await route.fulfill({ response, json: { ...body, changes } });
  };
  await page.route('**/api/sync?since=*', withhold);

  // The phone changes the day (and learns its id from what it sends)...
  const isPush = (request: Request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/sync';
  const pushed = phone.page.waitForRequest(isPush);
  await moods(phone.page).getByRole('radio', { name: 'Good' }).click();
  const push = await pushed;
  const day = (push.postDataJSON() as { changes: { id: string }[] }).changes[0]?.id ?? '';
  expect(day).toMatch(/^k_/);
  kept.add(day);
  await push.response();
  // ...and its next session publishes its manifest, which lists that version.
  await phone.page.reload();
  await expect(phone.page.getByRole('button', { name: /^Unlock with/ })).toBeEnabled();
  await phone.page.getByRole('button', { name: /^Unlock with/ }).click();
  await expect(phone.page.locator('#more .sync__words')).toHaveText('Synced');

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(words).toHaveText('Server missing changes');
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(moods(page).getByRole('radio', { name: 'Great' })).toBeChecked();
  await page.locator('.sidebar').getByRole('link', { name: 'Details' }).click();
  await expect(page).toHaveURL(/\/settings\/data$/);
  const notice = page.locator('#data .callout');
  await expect(notice).toContainText(
    'Another of your devices has had 1 change that the server hasn’t given this one.',
  );
  await expect(notice).toBeInViewport();
  expect.soft(await seriousIssues(page, 'settings, server missing changes')).toEqual([]);
  // At a phone's width the status is in the More sheet, whose link closes it on the way.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  const sheet = page.locator('#more');
  await expect(sheet.locator('.sync__words')).toHaveText('Server missing changes');
  expect.soft(await seriousIssues(page, 'phone more, server missing changes')).toEqual([]);
  await sheet.getByRole('link', { name: 'Details' }).click();
  await expect(sheet).toBeHidden();
  await expect(notice).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 860 });

  // An honest server again: the day's next version comes through, and the warning goes.
  await page.unroute('**/api/sync?since=*', withhold);
  const again = phone.page.waitForRequest(isPush);
  await moods(phone.page).getByRole('radio', { name: 'Great' }).click();
  await (await again).response();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(words).toHaveText('Synced');
  await expect(notice).toHaveCount(0);
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(moods(page).getByRole('radio', { name: 'Great' })).toBeChecked();
});

test('the month review draws its snapshot', async () => {
  const { page } = laptop;
  await page.getByRole('link', { name: 'Calendar' }).click();
  await page.getByRole('link', { name: 'Month review' }).click();
  const picture = page.locator('.share__preview img');
  await expect(picture).toBeVisible();
  // Each shape at its own size (and, for a look, saved beside the screenshots).
  const shapes = page.getByRole('radiogroup', { name: 'Shape' });
  for (const [shape, height] of [
    ['Story', 1920],
    ['Square', 1080],
    ['Post', 1350],
  ] as const) {
    await shapes.getByRole('radio', { name: shape }).click();
    await expect
      .poll(() =>
        picture.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]),
      )
      .toEqual([1080, height]);
    if (SHOTS) {
      // Through a canvas: the page's policy lets nothing fetch the picture's blob: address.
      const png = await picture.evaluate((image: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d')?.drawImage(image, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1] ?? '';
      });
      writeFileSync(join(SHOTS, `journal-snapshot-${shape.toLowerCase()}.png`), png, 'base64');
    }
  }
});

test('the year in pixels is one tab stop, walked with the keyboard', async () => {
  const { page } = laptop;
  await page.getByRole('link', { name: 'Stats', exact: true }).click();
  const grid = page.getByRole('grid', { name: /in pixels$/ });
  const stop = grid.locator('button[tabindex="0"]');
  const focused = grid.locator('button:focus');
  const today = await page.evaluate(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
  await expect(stop).toHaveCount(1);
  await expect(stop).toHaveAttribute('data-date', today);

  // Dates that exist whatever today is: January 1st, and the 1st of this month.
  const first = `${today.slice(0, 7)}-01`;
  await stop.focus();
  await page.keyboard.press('Control+Home');
  await expect(focused).toHaveAttribute('data-date', `${today.slice(0, 4)}-01-01`);
  await page.keyboard.press('End');
  await expect(focused).toHaveAttribute('data-date', first);
  await expect(stop).toHaveAttribute('data-date', first);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/day/${first}$`));
  await expect(title(page)).toBeFocused();
});

test('each new screen gives its title the focus, and the moods are one tab stop', async () => {
  const { page } = laptop;
  // A link followed from the keyboard, then Back: the title of the screen shown takes the focus.
  await page.getByRole('link', { name: 'Timeline', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Timeline');
  await expect(title(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/day\//);
  await expect(title(page)).toBeFocused();

  // Today's moods are one stop in the tab order, on the checked mood, and the arrow keys move
  // the check (round from the first to the last).
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(title(page)).toBeFocused();
  const great = moods(page).getByRole('radio', { name: 'Great' });
  const awful = moods(page).getByRole('radio', { name: 'Awful' });
  await expect(great).toBeChecked();
  await expect(moods(page).locator('[tabindex="0"]')).toHaveCount(1);
  await page.getByRole('button', { name: /highlight/i }).focus();
  await page.keyboard.press('Tab');
  await expect(great).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(awful).toBeFocused();
  await expect(awful).toBeChecked();
  await expect(great).not.toBeChecked();
  await expect(awful).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowRight');
  await expect(great).toBeChecked();
  // Tab leaves the group; Shift+Tab comes back to the checked mood.
  await page.keyboard.press('Tab');
  await expect(great).not.toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(great).toBeFocused();
});

test('no screen has a serious accessibility issue', async () => {
  const { page } = laptop;
  // Arrived: the address, and the new screen's one heading (a screen still loading has none).
  const check = async (screen: string, url: RegExp) => {
    await expect(page).toHaveURL(url);
    await expect(page.locator('main h1')).toHaveCount(1);
    expect.soft(await seriousIssues(page, screen), screen).toEqual([]);
  };
  const screens: [string, RegExp][] = [
    ['Today', /\/$/],
    ['Calendar', /\/calendar$/],
    ['Timeline', /\/timeline$/],
    ['Stats', /\/stats$/],
    ['People', /\/people$/],
    ['Search', /\/search$/],
    ['Settings', /\/settings$/],
  ];
  for (const [name, url] of screens) {
    await page.getByRole('link', { name, exact: true }).click();
    await check(name, url);
  }
  // The day with every activity unfolded.
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'All activities' }).click();
  await check('Today, all activities', /\/$/);
  // And the screens one level down: the month review, a person, a new event.
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await page.getByRole('link', { name: 'Month review' }).click();
  await check('month review', /\/month\/\d{4}-\d{2}$/);
  await page.getByRole('link', { name: 'People', exact: true }).click();
  await page.getByRole('link', { name: PERSON }).click();
  await check('person', /\/person\/[\w-]+$/);
  await page.getByRole('link', { name: 'Timeline', exact: true }).click();
  await page.getByRole('link', { name: 'New event' }).click();
  await check('new event', /\/event\/new$/);
  // The phone's layout: the tab bar, and the More sheet open.
  await expect(phone.page.locator('main h1')).toBeVisible();
  expect.soft(await seriousIssues(phone.page, 'phone'), 'phone').toEqual([]);
  await phone.page.getByRole('button', { name: 'More' }).click();
  await expect(phone.page.locator('#more')).toBeVisible();
  expect.soft(await seriousIssues(phone.page, 'phone more'), 'phone, More open').toEqual([]);
  await phone.page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Lock' }).first().click();
  await expect(page.getByRole('button', { name: /^Unlock with/ })).toBeVisible();
  await expect(title(page)).toBeFocused();
  expect.soft(await seriousIssues(page, 'lock screen'), 'lock screen').toEqual([]);
});

test('removed from a device that cannot tell the server, the journal says it stays signed in', async () => {
  const { page } = phone;
  const remove = page.getByRole('button', { name: 'Remove from this device' });
  const unlock = page.getByRole('button', { name: /^Unlock with/ });
  // The browser's own questions, answered in turn.
  const answers: boolean[] = [];
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void (answers.shift() ? dialog.accept() : dialog.dismiss());
  });
  // The session cannot be ended: no connection for that one request.
  await page.route('**/api/logout', (route) => route.abort('internetdisconnected'));

  await page.getByRole('button', { name: 'More' }).click();
  await page.locator('#more').getByRole('link', { name: 'Settings' }).click();
  await expect(title(page)).toHaveText('Settings');

  // Remove? Yes. Still signed in to the server, then: remove anyway? No, and the journal stays.
  answers.push(true, false);
  await remove.click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toContain('can’t be reached');
  await expect(unlock).toBeVisible();

  // Yes both times: this device is empty, and joins again like a new one.
  await unlock.click();
  await expect(title(page)).toHaveText('Settings');
  answers.push(true, true);
  await remove.click();
  await expect(page.getByRole('button', { name: 'Use recovery phrase' })).toBeVisible();
  expect(asked).toHaveLength(4);
});

test('neither device logged an error or a CSP violation', () => {
  expect(laptop.problems).toEqual([]);
  expect(phone.problems).toEqual([]);
});
