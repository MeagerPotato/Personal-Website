/**
 * The blog's API end to end, against a real (local) D1 and R2 from Miniflare, with a software
 * passkey signing real WebAuthn responses: setting up the studio, signing in, writing and
 * publishing, images, and what the API refuses.
 */
import { SoftAuthenticator } from '@allenkh/testing/passkey';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BlogEnv } from './env';
import { serveMedia } from './media';
import { blankDraft, getPublished, listPublished, type Draft, type StudioPost } from './posts';
import {
  Browser,
  ORIGIN,
  RP_ID,
  SETUP_TOKEN,
  context,
  freshEnv,
  startPlatform,
} from './test/platform';

const platform = await startPlatform();
afterAll(() => platform.dispose());

let env: BlogEnv;
beforeEach(async () => {
  env = await freshEnv(platform);
});

type Json = Record<string, unknown>;

/** The studio's first run: the setup code, then a passkey. */
async function setUp() {
  const browser = new Browser(env);
  const passkey = new SoftAuthenticator(RP_ID, ORIGIN);
  const begin = await browser.json('POST', '/auth/setup/begin', { token: SETUP_TOKEN });
  expect(begin.status).toBe(200);
  const response = await passkey.register(begin.body['options'] as Json);
  const finish = await browser.json('POST', '/auth/setup/finish', {
    token: SETUP_TOKEN,
    challengeId: begin.body['challengeId'],
    response,
    label: 'Laptop',
  });
  expect(finish.status).toBe(200);
  return { browser, passkey };
}

async function signIn(passkey: SoftAuthenticator, browser = new Browser(env)) {
  const begin = await browser.json('POST', '/auth/login/begin');
  expect(begin.status).toBe(200);
  const response = await passkey.assert(begin.body['options'] as Json);
  const finish = await browser.json('POST', '/auth/login/finish', {
    challengeId: begin.body['challengeId'],
    response,
  });
  return { browser, finish };
}

const doc = (...paragraphs: string[]) => ({
  type: 'doc' as const,
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

const draft = (fields: Partial<Draft> = {}): Draft => ({
  ...blankDraft(),
  title: 'First light',
  doc: doc('Hello, space.'),
  ...fields,
});

/** A new post, saved with `fields`. Returns it as the studio then sees it. */
async function write(browser: Browser, fields: Partial<Draft> = {}): Promise<StudioPost> {
  const created = await browser.json<StudioPost>('POST', '/studio/posts');
  expect(created.status).toBe(201);
  const saved = await browser.json('PUT', `/studio/posts/${created.body.id}/draft`, {
    draft: draft(fields),
    baseRev: created.body.draftRev,
  });
  expect(saved.status).toBe(200);
  return (await browser.json<StudioPost>('GET', `/studio/posts/${created.body.id}`)).body;
}

const publish = (browser: Browser, post: StudioPost) =>
  browser.json('POST', `/studio/posts/${post.id}/publish`, { rev: post.draftRev });

describe('addresses', () => {
  it('answers with or without a trailing slash (the studio sends one; the dev server needs it)', async () => {
    const browser = new Browser(env);
    expect((await browser.json('GET', '/auth/state')).body).toEqual({
      setUp: false,
      signedIn: false,
    });
    expect((await browser.json('GET', '/auth/state/')).body).toEqual({
      setUp: false,
      signedIn: false,
    });
  });
});

describe('signing in to the studio', () => {
  it('takes the setup code for the first passkey, and never again', async () => {
    const stranger = new Browser(env);
    expect((await stranger.json('GET', '/auth/state')).body).toEqual({
      setUp: false,
      signedIn: false,
    });
    const wrong = await stranger.json('POST', '/auth/setup/begin', { token: 'guess' });
    expect(wrong.status).toBe(403);

    const { browser } = await setUp();
    expect((await browser.json('GET', '/auth/state')).body).toEqual({
      setUp: true,
      signedIn: true,
    });
    expect((await browser.json('GET', '/studio/overview')).status).toBe(200);

    const again = await stranger.json('POST', '/auth/setup/begin', { token: SETUP_TOKEN });
    expect(again.status).toBe(409);
  });

  it('signs in with the passkey on another browser, and out again', async () => {
    const { passkey } = await setUp();
    const { browser, finish } = await signIn(passkey);
    expect(finish.status).toBe(200);
    expect(browser.cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43}$/);
    expect((await browser.json('GET', '/studio/overview')).status).toBe(200);

    const out = await browser.call('POST', '/auth/logout');
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(browser.cookie).toBe('');
    expect((await browser.json('GET', '/studio/overview')).status).toBe(401);
  });

  it('refuses a passkey it does not know, and a challenge used twice', async () => {
    const { passkey } = await setUp();
    const stranger = new SoftAuthenticator(RP_ID, ORIGIN);
    await stranger.register({ challenge: 'unused' });
    const unknown = await signIn(stranger);
    expect(unknown.finish.status).toBe(401);

    const browser = new Browser(env);
    const begin = await browser.json('POST', '/auth/login/begin');
    const answer = await passkey.assert(begin.body['options'] as Json);
    const challengeId = begin.body['challengeId'];
    expect(
      (await browser.json('POST', '/auth/login/finish', { challengeId, response: answer })).status,
    ).toBe(200);
    const replay = await new Browser(env).json('POST', '/auth/login/finish', {
      challengeId,
      response: answer,
    });
    expect(replay.status).toBe(400);
  });

  it('refuses the right passkey used on another site (a phishing page)', async () => {
    const { passkey } = await setUp();
    const browser = new Browser(env);
    const begin = await browser.json('POST', '/auth/login/begin');
    const finish = await browser.json('POST', '/auth/login/finish', {
      challengeId: begin.body['challengeId'],
      response: await passkey.assert(begin.body['options'] as Json, {
        origin: 'https://allenkh-blog.example.com',
      }),
    });
    expect(finish.status).toBe(401);
    expect(browser.cookie).toBe('');
  });

  it('keeps at least one passkey, and never the one in use', async () => {
    const { browser } = await setUp();
    const phone = new SoftAuthenticator(RP_ID, ORIGIN);
    const begin = await browser.json('POST', '/studio/passkeys/begin');
    const added = await browser.json('POST', '/studio/passkeys/finish', {
      challengeId: begin.body['challengeId'],
      response: await phone.register(begin.body['options'] as Json),
      label: 'Phone',
    });
    expect(added.status).toBe(200);

    const list = await browser.json<{ id: string; label: string; current: boolean }[]>(
      'GET',
      '/studio/passkeys',
    );
    expect(list.body.map((key) => [key.label, key.current])).toEqual([
      ['Laptop', true],
      ['Phone', false],
    ]);
    const current = list.body[0]?.id ?? '';
    expect((await browser.json('DELETE', `/studio/passkeys/${current}`)).status).toBe(409);

    // The phone's own session ends with its passkey.
    const { browser: onPhone } = await signIn(phone);
    expect((await browser.json('DELETE', `/studio/passkeys/${phone.id}`)).status).toBe(200);
    expect((await onPhone.json('GET', '/studio/overview')).status).toBe(401);
  });

  it('refuses writes from any other origin, allenkh.com’s other subdomains included', async () => {
    const { browser } = await setUp();
    const response = await browser.call('POST', '/studio/posts', undefined, {
      origin: 'https://days2meet.allenkh.com',
    });
    expect(response.status).toBe(403);
    expect(await listPublished(env.DB)).toEqual([]);
  });

  it('answers every API call with no-store, and nothing without a session', async () => {
    const browser = new Browser(env);
    const response = await browser.call('GET', '/studio/overview');
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });
});

describe('writing and publishing', () => {
  it('saves a draft over the version it was based on, and says when another tab was faster', async () => {
    const { browser } = await setUp();
    const post = await write(browser, { title: 'Draft one' });
    expect(post.draftRev).toBe(2);

    const stale = await browser.json<{ error: string; current: StudioPost }>(
      'PUT',
      `/studio/posts/${post.id}/draft`,
      {
        draft: draft({ title: 'From an old tab' }),
        baseRev: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.current.draft.title).toBe('Draft one');
    expect(stale.body.current.draftRev).toBe(2);
  });

  it('publishes a post, and keeps its old address arriving when it moves', async () => {
    const { browser } = await setUp();
    const post = await write(browser, {
      tags: ['Rockets', 'rockets ', 'Math'],
      summary: 'A test.',
    });
    const first = await publish(browser, post);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ slug: 'first-light', firstTime: true });

    const live = await getPublished(env.DB, 'first-light');
    expect(live).toMatchObject({ title: 'First light', summary: 'A test.', words: 2 });
    expect(live && 'html' in live && live.html).toBe('<p>Hello, space.</p>');
    expect(live && 'tags' in live && live.tags.map((tag) => tag.name)).toEqual(['Math', 'Rockets']);

    const saved = await browser.json('PUT', `/studio/posts/${post.id}/draft`, {
      draft: draft({ slug: 'first-light-again' }),
      baseRev: post.draftRev,
    });
    const second = await browser.json('POST', `/studio/posts/${post.id}/publish`, {
      rev: saved.body['draftRev'],
    });
    expect(second.body).toMatchObject({ slug: 'first-light-again', firstTime: false });
    expect(await getPublished(env.DB, 'first-light')).toEqual({ movedTo: 'first-light-again' });

    expect((await browser.json('POST', `/studio/posts/${post.id}/unpublish`)).status).toBe(200);
    expect(await listPublished(env.DB)).toEqual([]);
    expect(await getPublished(env.DB, 'first-light-again')).toBeNull();
    expect(await getPublished(env.DB, 'first-light')).toBeNull();
  });

  it('refuses what cannot be published', async () => {
    const { browser } = await setUp();
    const untitled = await write(browser, { title: '  ' });
    expect((await publish(browser, untitled)).status).toBe(400);

    const reserved = await write(browser, { slug: 'studio' });
    expect((await publish(browser, reserved)).status).toBe(400);

    const one = await write(browser, { title: 'Same name' });
    expect((await publish(browser, one)).status).toBe(200);
    const two = await write(browser, { title: 'Same name' });
    expect((await publish(browser, two)).status).toBe(409);

    const stale = await browser.json('POST', `/studio/posts/${two.id}/publish`, { rev: 1 });
    expect(stale.status).toBe(409);
  });

  it('lists the studio’s posts without their documents', async () => {
    const { browser } = await setUp();
    await write(browser, { title: 'Long one', doc: doc('word '.repeat(500)) });
    const overview = await browser.json<{ posts: StudioPost[] }>('GET', '/studio/overview');
    expect(overview.body.posts).toHaveLength(1);
    expect(overview.body.posts[0]?.draft.title).toBe('Long one');
    expect(overview.body.posts[0]?.draft.doc).toBeNull();
  });

  it('deletes a post and everything that was only its own', async () => {
    const { browser } = await setUp();
    const post = await write(browser);
    await publish(browser, post);
    expect((await browser.json('DELETE', `/studio/posts/${post.id}`)).status).toBe(200);
    expect(await listPublished(env.DB)).toEqual([]);
    expect((await browser.json('GET', `/studio/posts/${post.id}`)).status).toBe(404);
  });
});

/** Bytes that begin like a PNG or a WebP (the server checks the first bytes, nothing more). */
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
const WEBP = Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 5, 6);

function upload(type: string, files: Record<string, Uint8Array>): FormData {
  const form = new FormData();
  form.set('type', type);
  form.set('width', '1600');
  form.set('height', '900');
  for (const [name, bytes] of Object.entries(files))
    form.set(name, new Blob([bytes as Uint8Array<ArrayBuffer>]), 'image');
  return form;
}

describe('images', () => {
  it('stores each size the studio made, and serves it for a year', async () => {
    const { browser } = await setUp();
    const stored = await browser.json<{ id: string; ext: string; widths: number[] }>(
      'POST',
      '/studio/media',
      upload('image/png', { w640: PNG, w1280: PNG }),
    );
    expect(stored.status).toBe(201);
    expect(stored.body).toMatchObject({
      ext: 'png',
      width: 1600,
      height: 900,
      widths: [640, 1280],
    });
    // The studio can ask again (a post's cover, when the post is opened).
    const info = await browser.json('GET', `/studio/media/${stored.body.id}`);
    expect(info.body).toEqual(stored.body);
    expect((await browser.json('GET', '/studio/media/m_nothing-here')).status).toBe(404);

    const url = `${ORIGIN}/media/${stored.body.id}/640.png`;
    const response = await serveMedia(new Request(url), env, context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);

    const head = await serveMedia(new Request(url, { method: 'HEAD' }), env, context());
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await serveMedia(new Request(url, { method: 'POST' }), env, context())).status).toBe(
      405,
    );
    expect(
      (await serveMedia(new Request(`${ORIGIN}/media/${stored.body.id}/999.png`), env, context()))
        .status,
    ).toBe(404);
    expect(
      (await serveMedia(new Request(`${ORIGIN}/media/../secrets.png`), env, context())).status,
    ).toBe(404);
  });

  it('refuses a file that is not the image it says it is', async () => {
    const { browser } = await setUp();
    const lying = await browser.json('POST', '/studio/media', upload('image/webp', { w640: PNG }));
    expect(lying.status).toBe(415);
    const svg = await browser.json('POST', '/studio/media', upload('image/svg+xml', { w640: PNG }));
    expect(svg.status).toBe(415);
    const good = await browser.json('POST', '/studio/media', upload('image/webp', { w640: WEBP }));
    expect(good.status).toBe(201);
  });

  it('keeps images out of the hands of anyone not signed in', async () => {
    await setUp();
    const stranger = new Browser(env);
    const response = await stranger.json(
      'POST',
      '/studio/media',
      upload('image/png', { w640: PNG }),
    );
    expect(response.status).toBe(401);
  });
});
