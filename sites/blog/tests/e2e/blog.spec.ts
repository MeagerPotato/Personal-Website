// The blog end to end: Allen sets up the studio with a passkey, writes a post with every kind of
// block and publishes it; a reader reads it (with JavaScript and without), and comments; Allen
// approves and replies; two tabs on one post meet a conflict; and every page, the readers' and
// the studio's, passes axe in light and in dark. One blog for the whole file, so the tests run
// in order and each builds on the last.

import { AxeBuilder } from '@axe-core/playwright';
import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { join } from 'node:path';
import sharp from 'sharp';

test.describe.configure({ mode: 'serial' });

interface Visitor {
  page: Page;
  /** Errors, uncaught exceptions and CSP violations, as any of its pages reported them. */
  problems: string[];
  /** Requests the server refused, by status: some are what a test asked for (a wrong code). */
  refused: string[];
}

const REFUSED = /^Failed to load resource: the server responded with a status of (.+)$/;

/** A browser with its own cookies; Allen's also has a passkey authenticator. */
async function visitor(
  browser: Browser,
  options: BrowserContextOptions = {},
  { passkeys = false } = {},
): Promise<Visitor> {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const where = event.sourceFile
        ? ` at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`
        : '';
      console.error(
        `CSP violation: ${event.violatedDirective} ${event.blockedURI}${where} ${event.sample}`.trim(),
      );
    });
  });
  const problems: string[] = [];
  const refused: string[] = [];
  context.on('console', (message) => {
    if (message.type() !== 'error') return;
    const status = REFUSED.exec(message.text())?.[1];
    if (status) refused.push(status);
    else problems.push(message.text());
  });
  context.on('weberror', (error) => problems.push(error.error().message));
  const page = await context.newPage();
  if (passkeys) {
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
        automaticPresenceSimulation: true,
      },
    });
  }
  return { page, problems, refused };
}

/** A folder for a picture of every page the sweep checks, light and dark (unset: none). */
const SHOTS = process.env.E2E_SHOTS;

/** Serious or critical axe findings (WCAG 2.2 AA), one line each, in light mode and in dark. */
async function seriousIssues(page: Page, name: string): Promise<string[]> {
  const found: string[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    if (SHOTS) {
      const file = `blog-${name}-${colorScheme}.png`.replaceAll(/[^\w.-]+/g, '-');
      await page.screenshot({ path: join(SHOTS, file), fullPage: true });
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

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post', exact: true });
const saveState = (page: Page) => page.locator('.post-bar__save');
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
/** A link in the studio's sidebar ("Comments" carries its count: matched by its start). */
const sidebar = (page: Page, name: string) =>
  page.locator('.sidebar').getByRole('link', { name: new RegExp(`^${name}`) });

let allen: Visitor;
let reader: Visitor;
/** The post's address in the studio. */
let studioPost = '';

test.beforeAll(async ({ browser }) => {
  allen = await visitor(browser, { viewport: { width: 1280, height: 900 } }, { passkeys: true });
  reader = await visitor(browser, { viewport: { width: 1280, height: 900 } });
});

test.afterAll(async () => {
  await allen?.page.context().close();
  await reader?.page.context().close();
});

test('sets up the studio with a passkey, and only with the setup code', async () => {
  const { page } = allen;
  await page.goto('/studio/');
  await expect(heading(page, 'Set up the studio')).toBeVisible();
  await page.getByLabel('Setup code').fill('not-the-code');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong setup code');

  await page.getByLabel('Setup code').fill('e2e-setup-code');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(heading(page, 'Posts')).toBeVisible();
});

test('writes a post with every kind of block, and publishes it', async () => {
  const { page } = allen;
  await page.getByRole('button', { name: 'New post' }).click();
  await expect(page).toHaveURL(/\/studio\/posts\/p_[\w-]+\/$/);
  studioPost = new URL(page.url()).pathname;

  const title = page.getByRole('textbox', { name: 'Title' });
  await title.fill('First flight');
  await title.press('Enter');
  await expect(editor(page)).toBeFocused();
  await expect(page).toHaveTitle('First flight · Studio');

  // Text, a heading (Markdown's "# "), and inline math ($…$ as it is typed).
  await page.keyboard.type('The rocket left the pad at 10:42, on a clear morning.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Ascent');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The burn gave $\\Delta v = 94$ in all.');
  await expect(editor(page).locator('.node-mathInline math')).toHaveCount(1);

  // A math block, from the "/" menu: its LaTeX opens, and Ctrl+Enter goes on writing below.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/math');
  await expect(page.getByRole('option', { name: /Math block/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const latex = page.getByRole('textbox', { name: 'Math block, in LaTeX' });
  await expect(latex).toBeFocused();
  await page.keyboard.type('F = \\dot{m} v_e');
  await page.keyboard.press('Control+Enter');
  await expect(latex).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator('.node-mathBlock math')).toHaveCount(1);

  // Code (Markdown's ```), left with Enter three times.
  await page.keyboard.type('# Data');
  await page.keyboard.press('Enter');
  await page.keyboard.type('``` ');
  await page.keyboard.type('def thrust(mdot, ve):');
  await page.keyboard.press('Enter');
  await page.keyboard.type('    return mdot * ve');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');

  // An image, from the "/" menu: made smaller on the device, uploaded, put where the menu was.
  const photo = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: { r: 120, g: 180, b: 220 } },
  })
    .png()
    .toBuffer();
  await page.keyboard.type('/image');
  await expect(page.getByRole('option', { name: /Image/ })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'pad.png', mimeType: 'image/png', buffer: photo });
  const image = editor(page).locator('.studio-figure img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await editor(page).locator('figcaption').click();
  await page.keyboard.type('The pad, before launch.');
  await page.getByRole('textbox', { name: 'Alt text' }).fill('A small rocket on its launch rail');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('python');

  // Its properties.
  await page.getByLabel('Summary').fill('Ten seconds of thrust, and what the data said.');
  const tags = page.getByLabel('Tags');
  for (const tag of ['Rockets', 'Test flights']) {
    await tags.fill(tag);
    await tags.press('Enter');
  }
  await expect(page.locator('.tag-input__tag')).toHaveText(['Rockets', 'Test flights']);

  await expect(saveState(page)).toHaveText('Saved');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('.banner--good')).toContainText('Published at');
  await expect(page.locator('.post-bar .standing')).toHaveText('Published');
});

test('a reader reads it as it was written, and needs no script to', async ({ browser }) => {
  const { page } = reader;
  await page.goto('/first-flight/');
  await expect(heading(page, 'First flight')).toBeVisible();
  const article = page.locator('article');
  await expect(article.getByRole('heading', { level: 2, name: 'Ascent' })).toBeVisible();
  await expect(article.locator('math')).toHaveCount(2);
  await expect(article.locator('.hljs-keyword').first()).toHaveText('def');
  const figure = article.locator('figure');
  await expect(figure.locator('img')).toHaveAttribute('alt', 'A small rocket on its launch rail');
  await expect(figure.locator('img')).toHaveAttribute('srcset', /640w/);
  await expect(figure.locator('figcaption')).toHaveText('The pad, before launch.');
  await expect
    .poll(() => figure.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.locator('script').count()).toBe(0);

  // Its tags lead to the others that wear them; the feed and the sitemap have it.
  await article.getByRole('link', { name: 'Rockets' }).click();
  await expect(heading(page, 'Rockets')).toBeVisible();
  await expect(page.getByRole('link', { name: /First flight/ })).toBeVisible();
  const feed = await page.request.get('/rss.xml');
  expect(await feed.text()).toContain('<title>First flight</title>');
  expect(await (await page.request.get('/sitemap.xml')).text()).toContain('/first-flight/');

  // With JavaScript off, the page is the same page.
  const plain = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
  const bare = await plain.newPage();
  await bare.goto('/first-flight/');
  await expect(heading(bare, 'First flight')).toBeVisible();
  await expect(bare.locator('article math')).toHaveCount(2);
  await plain.close();
});

test('a reader comments, and it waits for Allen', async () => {
  const { page } = reader;
  await page.goto('/first-flight/');
  await page.getByLabel('Name').fill('Ada');
  await page.getByLabel('Comment', { exact: true }).fill('Which motor was it?');
  // The form turns away what is sent faster than a person could (server/forms.ts, MIN_FILL_MS).
  await page.waitForTimeout(2_100);
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect(page).toHaveURL(/\?comment=sent#comments$/);
  await expect(page.getByRole('status')).toContainText('once Allen has read it');
  await expect(page.locator('.comment-list')).toHaveCount(0);
});

test('Allen answers from the studio, and the reader sees both', async () => {
  const { page } = allen;
  await page.goto('/studio/');
  const comments = sidebar(page, 'Comments');
  await expect(comments).toContainText('1');
  await comments.click();
  await expect(heading(page, 'Comments')).toBeVisible();
  const card = page.locator('.comment-card', { hasText: 'Which motor was it?' });
  await card.getByRole('button', { name: 'Reply' }).click();
  await card.getByRole('textbox').fill('An F15. More on it in part two.');
  await card.getByRole('button', { name: 'Publish reply' }).click();
  // Replying approved it: nothing is waiting any more.
  await expect(card).toHaveCount(0);
  await expect(comments).not.toContainText('1');

  await reader.page.goto('/first-flight/');
  const thread = reader.page.locator('.comment-list');
  await expect(thread).toContainText('Which motor was it?');
  await expect(thread.locator('.comment-replies')).toContainText('An F15. More on it in part two.');
});

test('a preview shows the draft as readers will see it, before it is live', async () => {
  const { page } = allen;
  await page.goto(studioPost);
  await page.getByRole('textbox', { name: 'Title' }).fill('First flight, and a landing');
  await expect(page.locator('.post-bar .standing')).toHaveText('Edits not live');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = await popup;
  await expect(preview.getByRole('note')).toContainText('A preview of the draft');
  await expect(heading(preview, 'First flight, and a landing')).toBeVisible();
  await preview.close();

  // Readers still have the published words until "Update".
  await reader.page.goto('/first-flight/');
  await expect(heading(reader.page, 'First flight')).toBeVisible();
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.locator('.post-bar .standing')).toHaveText('Published');
  await reader.page.reload();
  await expect(heading(reader.page, 'First flight, and a landing')).toBeVisible();
});

test('two tabs on one post: the later save asks which version to keep', async () => {
  const first = allen.page;
  const second = await first.context().newPage();
  await second.goto(studioPost);
  await first.getByLabel('Summary').fill('Written in the first tab.');
  await expect(saveState(first)).toHaveText('Saved');

  await second.getByLabel('Summary').fill('Written in the second tab.');
  await expect(second.getByRole('alert')).toContainText('This post was changed somewhere else');
  await second.getByRole('button', { name: 'Keep this one' }).click();
  await expect(saveState(second)).toHaveText('Saved');
  await second.close();

  await first.reload();
  await expect(first.getByLabel('Summary')).toHaveValue('Written in the second tab.');
});

test('a series, made in Organize, strings the post into it', async () => {
  const { page } = allen;
  await sidebar(page, 'Organize').click();
  await page.getByRole('button', { name: 'New series' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Rocket build');
  await page.getByRole('button', { name: 'Make the series' }).click();
  await expect(page.locator('.organize-item', { hasText: '/series/rocket-build/' })).toBeVisible();

  await page.goto(studioPost);
  await page.getByLabel('Series').selectOption({ label: 'Rocket build' });
  await page.getByLabel('Part').fill('1');
  await expect(saveState(page)).toHaveText('Saved');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.locator('.post-bar .standing')).toHaveText('Published');

  await reader.page.goto('/series/rocket-build/');
  await expect(heading(reader.page, 'Rocket build')).toBeVisible();
  await expect(
    reader.page.getByRole('link', { name: /First flight, and a landing/ }),
  ).toBeVisible();
});

test('signing out, and in again with the passkey; a second passkey here is refused', async () => {
  const { page } = allen;
  await sidebar(page, 'Settings').click();
  await page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await expect(page.getByRole('alert')).toHaveText(/already has a passkey/);

  await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
  const signIn = page.getByRole('button', { name: /^Sign in with/ });
  await expect(signIn).toBeVisible();
  await signIn.click();
  await expect(heading(page, 'Posts')).toBeVisible();
});

test('no page has a serious accessibility issue', async ({ browser }) => {
  const check = async (page: Page, name: string) => {
    await expect(page.locator('h1')).toHaveCount(1);
    expect.soft(await seriousIssues(page, name), name).toEqual([]);
  };

  // The readers' pages.
  const pages: [string, string][] = [
    ['home', '/'],
    ['post', '/first-flight/'],
    ['tags', '/tags/'],
    ['tag', '/tags/rockets/'],
    ['series-index', '/series/'],
    ['series', '/series/rocket-build/'],
    ['not-found', '/no-such-page/'],
  ];
  for (const [name, path] of pages) {
    await reader.page.goto(path);
    await check(reader.page, name);
  }

  // The studio's screens, and the post being written.
  const { page } = allen;
  for (const name of ['Posts', 'Comments', 'Subscribers', 'Organize', 'Settings']) {
    await sidebar(page, name).click();
    await expect(heading(page, name)).toBeVisible();
    // Organize's rows open into their forms: one is opened, so a form is checked too.
    if (name === 'Organize') await page.locator('.organize-item__summary').first().click();
    await check(page, `studio-${name.toLowerCase()}`);
  }
  await page.goto(studioPost);
  await expect(editor(page)).toBeVisible();
  await check(page, 'studio-post');

  // The studio at a phone's width: the tab bar instead of the sidebar, and the post.
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/studio/');
  await expect(heading(page, 'Posts')).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await check(page, 'phone-studio-posts');
  await page.goto(studioPost);
  await expect(editor(page)).toBeVisible();
  await check(page, 'phone-studio-post');
  if (desktop) await page.setViewportSize(desktop);

  // A phone: the readers' pages, and the studio's door for someone signed out.
  const phone = await visitor(browser, { ...devices['Pixel 7'], ignoreHTTPSErrors: true });
  for (const [name, path] of [
    ['phone-home', '/'],
    ['phone-post', '/first-flight/'],
    ['phone-studio', '/studio/'],
  ] as const) {
    await phone.page.goto(path);
    await check(phone.page, name);
  }
  expect(phone.problems).toEqual([]);
  expect(phone.refused).toEqual([]);
  await phone.page.context().close();
});

test('no page logged an error or a CSP violation', () => {
  expect(allen.problems).toEqual([]);
  expect(reader.problems).toEqual([]);
  // What the tests asked to be refused (the wrong setup code, the save over a newer one), and no more.
  expect(allen.refused).toEqual(['403 (Forbidden)', '409 (Conflict)']);
  expect(reader.refused).toEqual(['404 (Not Found)']); // the page that is not there
});
