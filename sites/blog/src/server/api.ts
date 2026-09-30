/**
 * The blog's API, under /api: everything the studio does (signed in), the one-click unsubscribe
 * that mail providers call, and, in the end-to-end tests only, the mailbox. Readers' own forms
 * are not here: they post to the page they are on (server/forms.ts).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from './auth';
import {
  commentsFor,
  countPending,
  deleteComment,
  replyAsAuthor,
  setCommentStatus,
  COMMENT_MAX,
} from './comments';
import { migrate } from './db/migrate';
import type { ApiContext } from './env';
import { body, requireSession } from './http';
import { drainOutbox, mailStatus, notifySubscribers } from './mail';
import { mediaInfo, storeUpload } from './media';
import {
  createPost,
  deletePost,
  deleteSeries,
  deleteTag,
  draftSchema,
  getForStudio,
  listForStudio,
  listSeries,
  listTags,
  markNotified,
  publishPost,
  saveDraft,
  saveSeries,
  saveTag,
  seriesSchema,
  tagSchema,
  unpublishPost,
  type StudioPost,
} from './posts';
import { readSession } from './sessions';
import { listSubscribers, removeSubscriber, unsubscribe } from './subscribers';
import { HttpError } from './util';

// Not strict: /api/x and /api/x/ are one route. The studio ends its calls with "/", because the
// dev server (Astro, trailingSlash: 'always') answers nothing else; the build takes either.
export const api = new Hono<ApiContext>({ strict: false }).basePath('/api');

/** RFC 8058: mail providers POST here from their own servers, with no Origin of ours. */
const ONE_CLICK = '/api/unsubscribe/one-click';

api.use('*', async (c, next) => {
  // Writes come only from the blog's own pages. SameSite does not separate subdomains of one site
  // (every *.allenkh.com is "same-site"), so the Origin header is checked as well.
  const oneClick = c.req.path.replace(/\/$/, '') === ONE_CLICK;
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !oneClick) {
    if (c.req.header('origin') !== c.env.ORIGIN)
      throw new HttpError(403, 'Cross-origin request refused');
  }
  await migrate(c.env.DB);
  c.set('session', await readSession(c.env.DB, c.req.header('cookie')));
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex');
});

api.route('/', auth);

// --- Posts -------------------------------------------------------------------------------------

/** A post in the studio's list: everything but the document itself. */
const listed = (post: StudioPost) => ({ ...post, draft: { ...post.draft, doc: null } });

api.get('/studio/overview', async (c) => {
  requireSession(c);
  const [posts, pending, mail] = await Promise.all([
    listForStudio(c.env.DB),
    countPending(c.env.DB),
    mailStatus(c.env),
  ]);
  return c.json({ posts: posts.map(listed), pendingComments: pending, mail });
});

api.post('/studio/posts', async (c) => {
  requireSession(c);
  return c.json(await createPost(c.env.DB), 201);
});

api.get('/studio/posts/:id', async (c) => {
  requireSession(c);
  return c.json(await getForStudio(c.env.DB, c.req.param('id')));
});

api.put('/studio/posts/:id/draft', async (c) => {
  requireSession(c);
  const length = Number(c.req.header('content-length') ?? '0');
  if (length > 2_500_000) throw new HttpError(413, 'This post is too long to save');
  const input = await body(
    c,
    z.strictObject({ draft: draftSchema, baseRev: z.number().int().min(1) }),
  );
  try {
    return c.json(await saveDraft(c.env.DB, c.req.param('id'), input.draft, input.baseRev));
  } catch (error) {
    // The studio shows what was saved elsewhere, next to what it has, and lets Allen choose.
    if (error instanceof HttpError && error.status === 409) {
      const current = await getForStudio(c.env.DB, c.req.param('id'));
      return c.json({ error: error.message, current }, 409);
    }
    throw error;
  }
});

api.post('/studio/posts/:id/publish', async (c) => {
  requireSession(c);
  const { rev } = await body(c, z.strictObject({ rev: z.number().int().min(1) }));
  const published = await publishPost(c.env.DB, c.req.param('id'), rev);
  return c.json({ ...published, post: await getForStudio(c.env.DB, c.req.param('id')) });
});

api.post('/studio/posts/:id/unpublish', async (c) => {
  requireSession(c);
  await unpublishPost(c.env.DB, c.req.param('id'));
  return c.json(await getForStudio(c.env.DB, c.req.param('id')));
});

api.delete('/studio/posts/:id', async (c) => {
  requireSession(c);
  await deletePost(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

/** Emails a published post to every confirmed subscriber: once, ever. */
api.post('/studio/posts/:id/notify', async (c) => {
  requireSession(c);
  const status = await mailStatus(c.env);
  if (!status.ready) throw new HttpError(409, 'Email is not set up yet');
  const post = await getForStudio(c.env.DB, c.req.param('id'));
  if (post.status !== 'published' || !post.slug) throw new HttpError(409, 'Publish the post first');
  if (post.notifiedAt) throw new HttpError(409, 'Subscribers already have this post');
  const live = await c.env.DB.prepare('SELECT title, summary FROM posts WHERE id = ?1')
    .bind(post.id)
    .first<{ title: string; summary: string }>();
  const queued = await notifySubscribers(c.env, {
    id: post.id,
    slug: post.slug,
    title: live?.title ?? post.draft.title,
    summary: live?.summary ?? '',
  });
  await markNotified(c.env.DB, post.id);
  // The first batch goes now; the cron sends the rest, 40 every five minutes.
  c.executionCtx.waitUntil(drainOutbox(c.env));
  return c.json({ queued });
});

// --- Images ------------------------------------------------------------------------------------

api.post('/studio/media', async (c) => {
  requireSession(c);
  const length = Number(c.req.header('content-length') ?? '0');
  if (length > 30 * 1024 * 1024) throw new HttpError(413, 'That image is too large');
  const type = c.req.header('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) throw new HttpError(415, 'Send the image as a form');
  const form = await c.req.formData().catch(() => null);
  if (!form) throw new HttpError(400, 'Malformed upload');
  return c.json(await storeUpload(c.env, form), 201);
});

api.get('/studio/media/:id', async (c) => {
  requireSession(c);
  const image = await mediaInfo(c.env.DB, c.req.param('id'));
  if (!image) throw new HttpError(404, 'No such image');
  return c.json(image);
});

// --- Tags and series ---------------------------------------------------------------------------

api.get('/studio/tags', async (c) => {
  requireSession(c);
  return c.json(await listTags(c.env.DB, true));
});

api.put('/studio/tags/:slug', async (c) => {
  requireSession(c);
  await saveTag(c.env.DB, c.req.param('slug'), await body(c, tagSchema));
  return c.json({ ok: true });
});

api.delete('/studio/tags/:slug', async (c) => {
  requireSession(c);
  await deleteTag(c.env.DB, c.req.param('slug'));
  return c.json({ ok: true });
});

api.get('/studio/series', async (c) => {
  requireSession(c);
  return c.json(await listSeries(c.env.DB, true));
});

api.post('/studio/series', async (c) => {
  requireSession(c);
  return c.json(await saveSeries(c.env.DB, await body(c, seriesSchema), null), 201);
});

api.put('/studio/series/:id', async (c) => {
  requireSession(c);
  return c.json(await saveSeries(c.env.DB, await body(c, seriesSchema), c.req.param('id')));
});

api.delete('/studio/series/:id', async (c) => {
  requireSession(c);
  await deleteSeries(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

// --- Comments ----------------------------------------------------------------------------------

const commentStatus = z.enum(['pending', 'approved', 'spam']);

api.get('/studio/comments', async (c) => {
  requireSession(c);
  const status = commentStatus.safeParse(c.req.query('status') ?? 'pending');
  if (!status.success) throw new HttpError(400, 'Unknown status');
  return c.json(await commentsFor(c.env.DB, status.data));
});

api.post('/studio/comments/:id/status', async (c) => {
  requireSession(c);
  const { status } = await body(c, z.strictObject({ status: commentStatus }));
  await setCommentStatus(c.env.DB, c.req.param('id'), status);
  return c.json({ ok: true });
});

api.post('/studio/comments/:id/reply', async (c) => {
  requireSession(c);
  const input = await body(c, z.strictObject({ body: z.string().trim().min(1).max(COMMENT_MAX) }));
  return c.json({ id: await replyAsAuthor(c.env.DB, c.req.param('id'), input.body) }, 201);
});

api.delete('/studio/comments/:id', async (c) => {
  requireSession(c);
  await deleteComment(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

// --- Subscribers ---------------------------------------------------------------------------------

api.get('/studio/subscribers', async (c) => {
  requireSession(c);
  return c.json(await listSubscribers(c.env.DB));
});

api.delete('/studio/subscribers/:id', async (c) => {
  requireSession(c);
  await removeSubscriber(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

// --- One-click unsubscribe (RFC 8058) ----------------------------------------------------------

api.post('/unsubscribe/one-click', async (c) => {
  await unsubscribe(c.env.DB, c.req.query('token') ?? '');
  // Always 200: the provider needs no more, and the answer says nothing about the address.
  return c.text('Unsubscribed');
});

/** A person (or a link checker) following the link: the page with a button, never a change. */
api.get('/unsubscribe/one-click', (c) => {
  const token = c.req.query('token') ?? '';
  return c.redirect(`/unsubscribe/?token=${encodeURIComponent(token)}`, 303);
});

// --- End-to-end tests only ---------------------------------------------------------------------

api.get('/test/mailbox', async (c) => {
  if (c.env.E2E_MAILBOX !== '1') throw new HttpError(404, 'Not found');
  const { results } = await c.env.DB.prepare(
    'SELECT kind, to_addr AS "to", subject, text, headers, status FROM outbox ORDER BY created_at',
  ).all();
  return c.json(results);
});

api.notFound((c) => c.json({ error: 'Not found' }, 404));
api.onError((error, c) => {
  if (error instanceof HttpError) {
    const response = c.json({ error: error.message }, error.status);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  console.error(error);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});
