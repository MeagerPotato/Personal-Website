/**
 * What each of the readers' pages needs, loaded in one call from its .astro file. The pages are
 * markup; every decision (which post, a moved address, a form's outcome, which policy) is made
 * here, where pages.test.ts can check it against a real D1.
 */
import { approvedComments, threads, type PublicComment } from './comments';
import type { BlogEnv } from './env';
import {
  commentForm,
  linkToken,
  subscribeForm,
  turnstileOn,
  type CommentFormState,
  type SubscribeFormState,
} from './forms';
import { contentSecurityPolicy } from './headers';
import { mailReady } from './mail';
import {
  getPublished,
  getSeriesBySlug,
  getTag,
  listPublished,
  listSeries,
  listTags,
  neighbours,
  type LivePost,
  type PostSummary,
  type SeriesInfo,
  type TagInfo,
} from './posts';
import { isNameSlug } from './slug';
import { confirmSubscription, unsubscribe } from './subscribers';
import { site } from '../config';

/** A page, or instead: go elsewhere, or there is nothing here (404). */
export type Loaded<Page> =
  Page | { kind: 'redirect'; location: string; status: 301 | 303 } | { kind: 'missing' };

export interface Thread {
  comment: PublicComment;
  replies: PublicComment[];
}

export interface PostPage {
  kind: 'post';
  post: LivePost;
  threads: Thread[];
  commentCount: number;
  form: CommentFormState;
  /** A comment was just sent: the page thanks its writer. */
  sent: boolean;
  /** The approved comment the form answers, when replying. */
  replyingTo: PublicComment | null;
  series: { info: SeriesInfo; parts: PostSummary[] } | null;
  newer: PostSummary | null;
  older: PostSummary | null;
  mailOn: boolean;
  turnstileSiteKey: string | null;
  /** The page's Content-Security-Policy: its math styles by hash, Turnstile if on. */
  csp: string;
}

export async function postPage(
  env: BlogEnv,
  request: Request,
  slug: string,
  now = Date.now(),
): Promise<Loaded<PostPage>> {
  const found = await getPublished(env.DB, slug);
  if (!found) return { kind: 'missing' };
  if ('movedTo' in found) return { kind: 'redirect', location: `/${found.movedTo}/`, status: 301 };

  const url = new URL(request.url);
  const form = await commentForm(env, request, found, url.searchParams.get('reply'), now);
  if (form.kind === 'redirect') return { kind: 'redirect', location: form.location, status: 303 };

  const approved = await approvedComments(env.DB, found.id);
  const replyingTo = form.parentId ? (approved.find((c) => c.id === form.parentId) ?? null) : null;
  const seriesInfo = found.series ? await getSeriesBySlug(env.DB, found.series.slug) : null;
  const { newer, older } = await neighbours(env.DB, found);
  const turnstile = turnstileOn(env);
  return {
    kind: 'post',
    post: found,
    threads: threads(approved),
    commentCount: approved.length,
    form: replyingTo ? form : { ...form, parentId: null },
    sent: url.searchParams.get('comment') === 'sent',
    replyingTo,
    series: seriesInfo
      ? { info: seriesInfo, parts: await listPublished(env.DB, { seriesId: seriesInfo.id }) }
      : null,
    newer,
    older,
    mailOn: mailReady(env),
    turnstileSiteKey: turnstile ? (env.TURNSTILE_SITE_KEY ?? null) : null,
    csp: contentSecurityPolicy({ styleHashes: found.styleHashes, turnstile }),
  };
}

export interface ListPage {
  kind: 'list';
  posts: PostSummary[];
  mailOn: boolean;
}

export async function homePage(env: BlogEnv): Promise<ListPage> {
  return {
    kind: 'list',
    posts: await listPublished(env.DB, { limit: site.frontPageLimit }),
    mailOn: mailReady(env),
  };
}

export async function tagsPage(env: BlogEnv): Promise<{ kind: 'tags'; tags: TagInfo[] }> {
  return { kind: 'tags', tags: await listTags(env.DB) };
}

export async function tagPage(
  env: BlogEnv,
  slug: string,
): Promise<Loaded<{ kind: 'tag'; tag: TagInfo; posts: PostSummary[] }>> {
  if (!isNameSlug(slug)) return { kind: 'missing' };
  const tag = await getTag(env.DB, slug);
  if (!tag || tag.count === 0) return { kind: 'missing' };
  return { kind: 'tag', tag, posts: await listPublished(env.DB, { tag: slug }) };
}

export async function seriesIndexPage(
  env: BlogEnv,
): Promise<{ kind: 'series-index'; series: SeriesInfo[] }> {
  return { kind: 'series-index', series: await listSeries(env.DB) };
}

export async function seriesPage(
  env: BlogEnv,
  slug: string,
): Promise<Loaded<{ kind: 'series'; series: SeriesInfo; posts: PostSummary[] }>> {
  if (!isNameSlug(slug)) return { kind: 'missing' };
  const series = await getSeriesBySlug(env.DB, slug);
  if (!series || series.count === 0) return { kind: 'missing' };
  return { kind: 'series', series, posts: await listPublished(env.DB, { seriesId: series.id }) };
}

export interface SubscribePage {
  kind: 'subscribe';
  mailOn: boolean;
  form: SubscribeFormState;
  /** The form was just sent: "check your inbox". */
  sent: boolean;
}

export async function subscribePage(
  env: BlogEnv,
  request: Request,
  now = Date.now(),
): Promise<Loaded<SubscribePage>> {
  const form = await subscribeForm(env, request, now);
  if (form.kind === 'redirect') return { kind: 'redirect', location: form.location, status: 303 };
  return {
    kind: 'subscribe',
    mailOn: mailReady(env),
    form,
    sent: new URL(request.url).searchParams.get('sent') === '1',
  };
}

/**
 * The link in an email (confirm, unsubscribe): a GET only shows a button, because mail scanners
 * follow links; the button's POST does it.
 *   ask       the button, carrying the token
 *   done      it is done
 *   invalid   the link is malformed, unknown, or expired
 */
export interface LinkPage {
  kind: 'link';
  state: 'ask' | 'done' | 'invalid';
  token: string;
}

async function tokenFrom(request: Request): Promise<string> {
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const value = form?.get('token');
    return typeof value === 'string' ? value : '';
  }
  return new URL(request.url).searchParams.get('token') ?? '';
}

async function linkPage(
  request: Request,
  act: (token: string) => Promise<boolean>,
): Promise<LinkPage> {
  const token = await tokenFrom(request);
  if (!linkToken.safeParse(token).success) return { kind: 'link', state: 'invalid', token: '' };
  if (request.method !== 'POST') return { kind: 'link', state: 'ask', token };
  return { kind: 'link', state: (await act(token)) ? 'done' : 'invalid', token };
}

export const confirmPage = (env: BlogEnv, request: Request, now = Date.now()): Promise<LinkPage> =>
  linkPage(request, (token) => confirmSubscription(env.DB, token, now));

export const unsubscribePage = (
  env: BlogEnv,
  request: Request,
  now = Date.now(),
): Promise<LinkPage> => linkPage(request, (token) => unsubscribe(env.DB, token, now));
