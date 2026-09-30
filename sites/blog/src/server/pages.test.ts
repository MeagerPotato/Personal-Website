/**
 * The readers' pages as their .astro files receive them, against a local D1: which post, the
 * redirects, the comment form's outcome, the page's policy; and the feed, sitemap and robots.txt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setCommentStatus, commentsFor } from './comments';
import type { BlogEnv } from './env';
import { absoluteUrls, robots, rss, sitemap } from './feeds';
import { HONEYPOT, issueFormToken } from './forms';
import {
  confirmPage,
  homePage,
  postPage,
  seriesPage,
  subscribePage,
  tagPage,
  unsubscribePage,
  type PostPage,
} from './pages';
import {
  blankDraft,
  createPost,
  listPublished,
  listSeries,
  listTags,
  publishPost,
  recentLive,
  saveDraft,
  saveSeries,
  type Draft,
} from './posts';
import { subscribe } from './subscribers';
import { FakeMail, ORIGIN, freshEnv, startPlatform } from './test/platform';

const platform = await startPlatform();
afterAll(() => platform.dispose());

let env: BlogEnv;
beforeEach(async () => {
  env = await freshEnv(platform);
});

const T0 = Date.parse('2026-09-30T12:00:00Z');

async function published(fields: Partial<Draft>, now = T0): Promise<{ id: string; slug: string }> {
  const post = await createPost(env.DB, now);
  const draft: Draft = {
    ...blankDraft(),
    title: 'First light',
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello.' }] }],
    },
    ...fields,
  };
  const { draftRev } = await saveDraft(env.DB, post.id, draft, post.draftRev, now);
  const { slug } = await publishPost(env.DB, post.id, draftRev, now);
  return { id: post.id, slug };
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, fields: Record<string, string>) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
    body: new URLSearchParams(fields).toString(),
  });

describe('a post’s page', () => {
  it('shows the post, with a policy that names its math styles', async () => {
    const math = {
      type: 'doc' as const,
      content: [{ type: 'mathBlock', attrs: { latex: 'E = mc^2' } }],
    };
    const { slug } = await published({ title: 'Mass', doc: math });
    const page = (await postPage(env, get(`/${slug}/`), slug)) as PostPage;
    expect(page.kind).toBe('post');
    expect(page.post.html).toContain('<math');
    expect(page.post.styleHashes.length).toBeGreaterThan(0);
    for (const hash of page.post.styleHashes) expect(page.csp).toContain(hash);
    expect(page.csp).toContain("'unsafe-hashes'");
    expect(page.csp).not.toContain('challenges.cloudflare.com');
    expect(page.form.token).toMatch(/^\d{13}\./);
  });

  it('sends an old address to the new one, and knows nothing of drafts', async () => {
    const { id, slug } = await published({ title: 'Old name' });
    const { draftRev } = await saveDraft(
      env.DB,
      id,
      { ...blankDraft(), title: 'Old name', slug: 'new-name' },
      2,
      T0,
    );
    await publishPost(env.DB, id, draftRev, T0);
    expect(await postPage(env, get(`/${slug}/`), slug)).toEqual({
      kind: 'redirect',
      location: '/new-name/',
      status: 301,
    });

    const draft = await createPost(env.DB, T0);
    await saveDraft(env.DB, draft.id, { ...blankDraft(), title: 'Secret', slug: 'secret' }, 1, T0);
    expect(await postPage(env, get('/secret/'), 'secret')).toEqual({ kind: 'missing' });
  });

  it('takes a comment and redirects, then shows it once approved, and offers replies', async () => {
    const target = await published({});
    const token = await issueFormToken(env.DB, 'comment', T0);
    const sent = await postPage(
      env,
      post(`/${target.slug}/`, { t: token, [HONEYPOT]: '', name: 'Ada', body: 'Hi!' }),
      target.slug,
      T0 + 60_000,
    );
    expect(sent).toEqual({
      kind: 'redirect',
      location: '/first-light/?comment=sent#comments',
      status: 303,
    });

    const thanked = (await postPage(
      env,
      get(`/${target.slug}/?comment=sent`),
      target.slug,
    )) as PostPage;
    expect(thanked.sent).toBe(true);
    expect(thanked.commentCount).toBe(0);

    const [pending] = await commentsFor(env.DB, 'pending');
    await setCommentStatus(env.DB, pending?.id ?? '', 'approved');
    const shown = (await postPage(
      env,
      get(`/${target.slug}/?reply=${pending?.id}`),
      target.slug,
    )) as PostPage;
    expect(shown.commentCount).toBe(1);
    expect(shown.threads[0]?.comment.name).toBe('Ada');
    expect(shown.replyingTo?.name).toBe('Ada');
    expect(shown.form.parentId).toBe(pending?.id);

    const nonsense = (await postPage(
      env,
      get(`/${target.slug}/?reply=c_nothing_here`),
      target.slug,
    )) as PostPage;
    expect(nonsense.replyingTo).toBeNull();
    expect(nonsense.form.parentId).toBeNull();
  });

  it('lists its series, in order, and its neighbours', async () => {
    const series = await saveSeries(
      env.DB,
      { title: 'Building a rocket', slug: '', description: '' },
      null,
      T0,
    );
    const one = await published({ title: 'Part one', series: { id: series.id, part: 1 } }, T0);
    const two = await published(
      { title: 'Part two', series: { id: series.id, part: 2 } },
      T0 + 1000,
    );
    const page = (await postPage(env, get(`/${two.slug}/`), two.slug)) as PostPage;
    expect(page.series?.info.slug).toBe('building-a-rocket');
    expect(page.series?.parts.map((part) => part.slug)).toEqual([one.slug, two.slug]);
    expect(page.older?.slug).toBe(one.slug);
    expect(page.newer).toBeNull();

    const index = await seriesPage(env, 'building-a-rocket');
    expect(index.kind === 'series' && index.posts.map((p) => p.series?.part)).toEqual([1, 2]);
    expect(await seriesPage(env, 'nothing-here')).toEqual({ kind: 'missing' });
  });

  it('opens Turnstile’s door in the policy only when it is switched on', async () => {
    const target = await published({});
    env = { ...env, TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET: 'secret' };
    const page = (await postPage(env, get(`/${target.slug}/`), target.slug)) as PostPage;
    expect(page.turnstileSiteKey).toBe('1x00000000000000000000AA');
    expect(page.csp).toContain('frame-src https://challenges.cloudflare.com');
  });
});

describe('lists', () => {
  it('shows published posts newest first, and a tag only once a post wears it', async () => {
    await published({ title: 'Older', tags: ['Rockets'] }, T0);
    await published({ title: 'Newer' }, T0 + 1000);
    const home = await homePage(env);
    expect(home.posts.map((p) => p.title)).toEqual(['Newer', 'Older']);
    expect(home.mailOn).toBe(false);

    const tag = await tagPage(env, 'rockets');
    expect(tag.kind === 'tag' && tag.posts.map((p) => p.title)).toEqual(['Older']);
    expect(await tagPage(env, 'unknown')).toEqual({ kind: 'missing' });
    expect(await tagPage(env, '../etc')).toEqual({ kind: 'missing' });
  });
});

describe('subscribing and its links', () => {
  it('shows the form, and after sending, “check your inbox”', async () => {
    env = await freshEnv(platform, { EMAIL: new FakeMail(), MAIL_FROM: 'allen@allenkh.com' });
    const page = await subscribePage(env, get('/subscribe/'));
    expect(page).toMatchObject({ kind: 'subscribe', mailOn: true, sent: false });
    const token = await issueFormToken(env.DB, 'subscribe', T0);
    const sent = await subscribePage(
      env,
      post('/subscribe/', { t: token, [HONEYPOT]: '', email: 'reader@example.com' }),
      T0 + 5000,
    );
    expect(sent).toEqual({ kind: 'redirect', location: '/subscribe/?sent=1', status: 303 });
    expect(await subscribePage(env, get('/subscribe/?sent=1'))).toMatchObject({ sent: true });
  });

  it('confirms only on the button’s POST, never on the link’s GET (mail scanners follow links)', async () => {
    const outcome = await subscribe(env.DB, 'reader@example.com', T0);
    if (outcome.kind !== 'confirm') throw new Error('expected a confirmation');
    const ask = await confirmPage(env, get(`/subscribe/confirm/?token=${outcome.token}`), T0);
    expect(ask).toEqual({ kind: 'link', state: 'ask', token: outcome.token });
    const done = await confirmPage(env, post('/subscribe/confirm/', { token: outcome.token }), T0);
    expect(done.state).toBe('done');
    const again = await confirmPage(env, post('/subscribe/confirm/', { token: outcome.token }), T0);
    expect(again.state).toBe('invalid');
    expect((await confirmPage(env, get('/subscribe/confirm/?token=<script>'), T0)).state).toBe(
      'invalid',
    );

    const leave = await unsubscribePage(
      env,
      post('/unsubscribe/', { token: outcome.unsubscribeToken }),
      T0,
    );
    expect(leave.state).toBe('done');
  });
});

describe('feeds', () => {
  it('makes a post’s own addresses absolute for other sites', () => {
    const html =
      '<a href="/other/">x</a><a href="//cdn.example.com/y">y</a>' +
      '<img src="/media/m_1/640.webp" srcset="/media/m_1/640.webp 640w, /media/m_1/1280.webp 1280w">';
    expect(absoluteUrls(html, 'https://blog.allenkh.com')).toBe(
      '<a href="https://blog.allenkh.com/other/">x</a><a href="//cdn.example.com/y">y</a>' +
        '<img src="https://blog.allenkh.com/media/m_1/640.webp" srcset="https://blog.allenkh.com/media/m_1/640.webp 640w, https://blog.allenkh.com/media/m_1/1280.webp 1280w">',
    );
  });

  it('writes an RSS feed with every post in full, a sitemap and robots.txt', async () => {
    await published({
      title: 'Tom & Jerry’s ]]> launch',
      tags: ['Rockets'],
      summary: 'A <b>test</b>.',
    });
    const feed = rss('https://blog.allenkh.com', await recentLive(env.DB, 20));
    expect(feed).toContain('<title>Tom &amp; Jerry’s ]]&gt; launch</title>');
    expect(feed).toContain('<link>https://blog.allenkh.com/tom-jerrys-launch/</link>');
    expect(feed).toContain('<description>A &lt;b&gt;test&lt;/b&gt;.</description>');
    expect(feed).toContain('<category>Rockets</category>');
    expect(feed).toContain('<content:encoded><![CDATA[<p>Hello.</p>]]></content:encoded>');

    const map = sitemap('https://blog.allenkh.com', {
      posts: await listPublished(env.DB),
      tags: await listTags(env.DB),
      series: await listSeries(env.DB),
    });
    expect(map).toContain(
      '<loc>https://blog.allenkh.com/tom-jerrys-launch/</loc><lastmod>2026-09-30</lastmod>',
    );
    expect(map).toContain('<loc>https://blog.allenkh.com/tags/rockets/</loc>');
    expect(map).not.toContain('/series/');
    expect(robots('https://blog.allenkh.com')).toContain('Disallow: /studio/');
  });
});
