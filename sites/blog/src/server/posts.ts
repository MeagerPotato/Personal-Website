/**
 * Posts, tags and series in D1. A post has a DRAFT (what the studio saves while Allen writes)
 * and a LIVE version (what readers see), copied from the draft and rendered when it is
 * published (db/migrations.ts explains the columns). Everything readers see is read here.
 */
import { z } from 'zod';
import type { ImageExt } from '../editor/nodes';
import { FAMILIES, familyFor, type Family } from '../site/tags';
import { renderPost, type Heading } from './render';
import { MAX_SLUG, isNameSlug, isPostSlug, slugify } from './slug';
import { HttpError, randomId } from './util';

export { FAMILIES, familyFor, type Family } from '../site/tags';

const MEDIA_ID = /^m_[A-Za-z0-9_-]{8,40}$/;
const SERIES_ID = /^s_[A-Za-z0-9_-]{8,40}$/;
/** A document's JSON may be this long at most (a long post with many images is ~200 KB). */
export const MAX_DOC_BYTES = 2_000_000;

/** The studio's working copy of a post. */
export const draftSchema = z.strictObject({
  title: z.string().max(200),
  summary: z.string().max(300),
  /** Empty until chosen: publishing makes one from the title. */
  slug: z.string().max(MAX_SLUG),
  doc: z.looseObject({ type: z.literal('doc') }).nullable(),
  /** Tag names as typed; each becomes a tag (and its slug) when the post is published. */
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  series: z
    .strictObject({
      id: z.string().regex(SERIES_ID),
      part: z.number().int().min(1).max(999).nullable(),
    })
    .nullable(),
  cover: z.strictObject({ id: z.string().regex(MEDIA_ID), alt: z.string().max(300) }).nullable(),
  /** The date the post shows ("YYYY-MM-DD"), or null for the day it is first published. */
  date: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .nullable(),
});
export type Draft = z.infer<typeof draftSchema>;

export const blankDraft = (): Draft => ({
  title: '',
  summary: '',
  slug: '',
  doc: null,
  tags: [],
  series: null,
  cover: null,
  date: null,
});

export interface Cover {
  id: string;
  alt: string;
  ext: ImageExt;
  width: number;
  height: number;
  widths: number[];
}

export interface TagRef {
  slug: string;
  name: string;
  family: Family;
}

export interface SeriesRef {
  id: string;
  slug: string;
  title: string;
  part: number | null;
}

export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  publishedAt: number;
  updatedAt: number;
  words: number;
  cover: Cover | null;
  tags: TagRef[];
  series: SeriesRef | null;
}

export interface LivePost extends PostSummary {
  html: string;
  text: string;
  headings: Heading[];
  styleHashes: string[];
}

/** "12:00 UTC on that day": a date that reads as the same day everywhere on Earth but the Pacific edges. */
export const dateToTime = (date: string): number => Date.parse(`${date}T12:00:00Z`);

interface SummaryRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  published_at: number;
  updated_at: number;
  words: number;
  cover: string | null;
  series_id: string | null;
  series_part: number | null;
  series_slug: string | null;
  series_title: string | null;
}

interface LiveRow extends SummaryRow {
  html: string;
  text: string;
  toc: string;
  style_hashes: string;
}

const SUMMARY_COLUMNS = `p.id, p.slug, p.title, p.summary, p.published_at, p.updated_at, p.words,
  p.cover, p.series_id, p.series_part, s.slug AS series_slug, s.title AS series_title`;

const FROM_LIVE = `FROM posts p LEFT JOIN series s ON s.id = p.series_id WHERE p.status = 'published'`;

async function tagsFor(db: D1Database, ids: readonly string[]): Promise<Map<string, TagRef[]>> {
  const byPost = new Map<string, TagRef[]>();
  if (ids.length === 0) return byPost;
  // Every live post's tags in one query (a personal blog's worth), then picked per post.
  const { results } = await db
    .prepare(
      `SELECT pt.post_id, t.slug, t.name, t.family FROM post_tags pt
       JOIN tags t ON t.slug = pt.tag JOIN posts p ON p.id = pt.post_id
       WHERE p.status = 'published' ORDER BY t.name COLLATE NOCASE`,
    )
    .all<{ post_id: string; slug: string; name: string; family: Family }>();
  const wanted = new Set(ids);
  for (const row of results) {
    if (!wanted.has(row.post_id)) continue;
    const list = byPost.get(row.post_id) ?? [];
    list.push({ slug: row.slug, name: row.name, family: row.family });
    byPost.set(row.post_id, list);
  }
  return byPost;
}

function toSummary(row: SummaryRow, tags: Map<string, TagRef[]>): PostSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    words: row.words,
    cover: row.cover ? (JSON.parse(row.cover) as Cover) : null,
    tags: tags.get(row.id) ?? [],
    series:
      row.series_id && row.series_slug && row.series_title
        ? {
            id: row.series_id,
            slug: row.series_slug,
            title: row.series_title,
            part: row.series_part,
          }
        : null,
  };
}

// --- What readers see --------------------------------------------------------------------------

/** Published posts, newest first; only those with `tag`, or in `seriesId` (in series order). */
export async function listPublished(
  db: D1Database,
  filter: { tag?: string; seriesId?: string; limit?: number } = {},
): Promise<PostSummary[]> {
  const limit = Math.min(filter.limit ?? 500, 500);
  let statement: D1PreparedStatement;
  if (filter.tag) {
    statement = db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} ${FROM_LIVE}
         AND p.id IN (SELECT post_id FROM post_tags WHERE tag = ?1)
         ORDER BY p.published_at DESC, p.id DESC LIMIT ?2`,
      )
      .bind(filter.tag, limit);
  } else if (filter.seriesId) {
    statement = db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} ${FROM_LIVE} AND p.series_id = ?1
         ORDER BY p.series_part IS NULL, p.series_part, p.published_at, p.id LIMIT ?2`,
      )
      .bind(filter.seriesId, limit);
  } else {
    statement = db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} ${FROM_LIVE} ORDER BY p.published_at DESC, p.id DESC LIMIT ?1`,
      )
      .bind(limit);
  }
  const { results } = await statement.all<SummaryRow>();
  const tags = await tagsFor(
    db,
    results.map((row) => row.id),
  );
  return results.map((row) => toSummary(row, tags));
}

/** A published post by its address; an old address answers where the post lives now. */
export async function getPublished(
  db: D1Database,
  slug: string,
): Promise<LivePost | { movedTo: string } | null> {
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, p.html, p.text, p.toc, p.style_hashes ${FROM_LIVE} AND p.slug = ?1`,
    )
    .bind(slug)
    .first<LiveRow>();
  if (!row) {
    const moved = await db
      .prepare(
        `SELECT p.slug FROM slug_history h JOIN posts p ON p.id = h.post_id
         WHERE h.slug = ?1 AND p.status = 'published'`,
      )
      .bind(slug)
      .first<{ slug: string }>();
    return moved ? { movedTo: moved.slug } : null;
  }
  return toLive(row, await tagsFor(db, [row.id]));
}

const toLive = (row: LiveRow, tags: Map<string, TagRef[]>): LivePost => ({
  ...toSummary(row, tags),
  html: row.html,
  text: row.text,
  headings: JSON.parse(row.toc) as Heading[],
  styleHashes: JSON.parse(row.style_hashes) as string[],
});

/** The newest published posts in full (the feed). */
export async function recentLive(db: D1Database, limit: number): Promise<LivePost[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, p.html, p.text, p.toc, p.style_hashes ${FROM_LIVE}
       ORDER BY p.published_at DESC, p.id DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<LiveRow>();
  const tags = await tagsFor(
    db,
    results.map((row) => row.id),
  );
  return results.map((row) => toLive(row, tags));
}

/**
 * The posts just before and after one. Posts are ordered by date, then by id: two posts given
 * the same date (both at noon UTC) still have a fixed order, the same one the lists use.
 */
export async function neighbours(
  db: D1Database,
  post: Pick<PostSummary, 'id' | 'publishedAt'>,
): Promise<{ newer: PostSummary | null; older: PostSummary | null }> {
  const one = async (sql: string) => {
    const row = await db
      .prepare(`SELECT ${SUMMARY_COLUMNS} ${FROM_LIVE} ${sql} LIMIT 1`)
      .bind(post.publishedAt, post.id)
      .first<SummaryRow>();
    return row ? toSummary(row, new Map()) : null;
  };
  return {
    newer: await one(
      `AND (p.published_at > ?1 OR (p.published_at = ?1 AND p.id > ?2))
       ORDER BY p.published_at ASC, p.id ASC`,
    ),
    older: await one(
      `AND (p.published_at < ?1 OR (p.published_at = ?1 AND p.id < ?2))
       ORDER BY p.published_at DESC, p.id DESC`,
    ),
  };
}

export interface TagInfo extends TagRef {
  description: string;
  /** Published posts with it. */
  count: number;
}

/** Tags, with how many published posts wear each. `all` includes the unused (the studio). */
export async function listTags(db: D1Database, all = false): Promise<TagInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT t.slug, t.name, t.family, t.description,
         (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id
          WHERE pt.tag = t.slug AND p.status = 'published') AS count
       FROM tags t ORDER BY t.name COLLATE NOCASE`,
    )
    .all<TagInfo>();
  return all ? results : results.filter((tag) => tag.count > 0);
}

export async function getTag(db: D1Database, slug: string): Promise<TagInfo | null> {
  return (await listTags(db, true)).find((tag) => tag.slug === slug) ?? null;
}

export interface SeriesInfo {
  id: string;
  slug: string;
  title: string;
  description: string;
  count: number;
}

export async function listSeries(db: D1Database, all = false): Promise<SeriesInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.slug, s.title, s.description,
         (SELECT COUNT(*) FROM posts p WHERE p.series_id = s.id AND p.status = 'published') AS count
       FROM series s ORDER BY s.created_at DESC`,
    )
    .all<SeriesInfo>();
  return all ? results : results.filter((series) => series.count > 0);
}

export async function getSeriesBySlug(db: D1Database, slug: string): Promise<SeriesInfo | null> {
  return (await listSeries(db, true)).find((series) => series.slug === slug) ?? null;
}

// --- The studio --------------------------------------------------------------------------------

export interface StudioPost {
  id: string;
  status: 'draft' | 'published';
  draft: Draft;
  draftRev: number;
  draftSavedAt: number;
  /** The live address, once published. */
  slug: string | null;
  publishedRev: number | null;
  publishedAt: number | null;
  updatedAt: number | null;
  notifiedAt: number | null;
  createdAt: number;
}

interface StudioRow {
  id: string;
  status: 'draft' | 'published';
  draft: string;
  draft_rev: number;
  draft_saved_at: number;
  slug: string | null;
  published_rev: number | null;
  published_at: number | null;
  updated_at: number | null;
  notified_at: number | null;
  created_at: number;
}

const STUDIO_COLUMNS = `id, status, draft, draft_rev, draft_saved_at, slug, published_rev,
  published_at, updated_at, notified_at, created_at`;

/** A stored draft, read defensively: a field that no longer fits is reset, not fatal. */
export function readDraft(json: string): Draft {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return blankDraft();
  }
  const whole = draftSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const blank = blankDraft() as Record<string, unknown>;
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(draftSchema.shape)) {
    const field = (schema as z.ZodType).safeParse(input[key]);
    fields[key] = field.success ? field.data : blank[key];
  }
  return fields as Draft;
}

function toStudio(row: StudioRow): StudioPost {
  return {
    id: row.id,
    status: row.status,
    draft: readDraft(row.draft),
    draftRev: row.draft_rev,
    draftSavedAt: row.draft_saved_at,
    slug: row.slug,
    publishedRev: row.published_rev,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
  };
}

export async function listForStudio(db: D1Database): Promise<StudioPost[]> {
  const { results } = await db
    .prepare(
      `SELECT ${STUDIO_COLUMNS} FROM posts
       ORDER BY COALESCE(published_at, draft_saved_at) DESC`,
    )
    .all<StudioRow>();
  return results.map(toStudio);
}

export async function getForStudio(db: D1Database, id: string): Promise<StudioPost> {
  const row = await db
    .prepare(`SELECT ${STUDIO_COLUMNS} FROM posts WHERE id = ?1`)
    .bind(id)
    .first<StudioRow>();
  if (!row) throw new HttpError(404, 'No such post');
  return toStudio(row);
}

export async function createPost(db: D1Database, now = Date.now()): Promise<StudioPost> {
  const id = randomId('p');
  await db
    .prepare('INSERT INTO posts (id, draft, draft_saved_at, created_at) VALUES (?1, ?2, ?3, ?3)')
    .bind(id, JSON.stringify(blankDraft()), now)
    .run();
  return getForStudio(db, id);
}

/**
 * Saves a draft over the version it was based on. Another tab (or device) that saved in between
 * wins the race: this one gets 409 and the current draft, and the studio says so.
 */
export async function saveDraft(
  db: D1Database,
  id: string,
  draft: Draft,
  baseRev: number,
  now = Date.now(),
): Promise<{ draftRev: number; draftSavedAt: number }> {
  const json = JSON.stringify(draft);
  if (new TextEncoder().encode(json).length > MAX_DOC_BYTES) {
    throw new HttpError(413, 'This post is too long to save');
  }
  const row = await db
    .prepare(
      `UPDATE posts SET draft = ?1, draft_rev = draft_rev + 1, draft_saved_at = ?2
       WHERE id = ?3 AND draft_rev = ?4 RETURNING draft_rev`,
    )
    .bind(json, now, id, baseRev)
    .first<{ draft_rev: number }>();
  if (!row) {
    await getForStudio(db, id); // 404 when it is gone
    throw new HttpError(409, 'This post was changed somewhere else');
  }
  return { draftRev: row.draft_rev, draftSavedAt: now };
}

interface MediaRow {
  id: string;
  type: string;
  width: number;
  height: number;
  widths: string;
}

const EXT: Record<string, ImageExt> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

async function coverFor(db: D1Database, cover: Draft['cover']): Promise<Cover | null> {
  if (!cover) return null;
  const row = await db
    .prepare('SELECT id, type, width, height, widths FROM media WHERE id = ?1')
    .bind(cover.id)
    .first<MediaRow>();
  if (!row) throw new HttpError(400, 'The cover image is missing; choose it again');
  return {
    id: row.id,
    alt: cover.alt,
    ext: EXT[row.type] ?? 'webp',
    width: row.width,
    height: row.height,
    widths: JSON.parse(row.widths) as number[],
  };
}

/** The slug a draft publishes at: its own, or one made from its title. */
export function slugForDraft(draft: Draft): string {
  return draft.slug.trim() || slugify(draft.title);
}

/**
 * Makes draft `rev` the live version: rendered, its tags made, its old address remembered. The
 * studio saves before it publishes, so `rev` is the draft on screen; anything else is 409.
 */
export async function publishPost(
  db: D1Database,
  id: string,
  rev: number,
  now = Date.now(),
): Promise<{ slug: string; firstTime: boolean }> {
  const post = await getForStudio(db, id);
  if (post.draftRev !== rev) throw new HttpError(409, 'Save the post before publishing it');
  const { draft } = post;

  const title = draft.title.trim();
  if (!title) throw new HttpError(400, 'Give the post a title first');
  const slug = slugForDraft(draft);
  if (!isPostSlug(slug)) {
    throw new HttpError(400, `“${slug}” can’t be an address: use letters, numbers and hyphens`);
  }
  const taken = await db
    .prepare(
      `SELECT 1 AS one FROM posts WHERE slug = ?1 AND id != ?2
       UNION ALL SELECT 1 FROM slug_history WHERE slug = ?1 AND post_id != ?2`,
    )
    .bind(slug, id)
    .first();
  if (taken) throw new HttpError(409, `Another post already uses /${slug}/`);

  const cover = await coverFor(db, draft.cover);
  if (draft.series) {
    const series = await db
      .prepare('SELECT 1 AS one FROM series WHERE id = ?1')
      .bind(draft.series.id)
      .first();
    if (!series) throw new HttpError(400, 'That series no longer exists; choose another');
  }

  const tags = new Map<string, string>();
  for (const name of draft.tags) {
    const tagSlug = slugify(name, 40);
    if (isNameSlug(tagSlug) && !tags.has(tagSlug)) tags.set(tagSlug, name.trim());
  }

  const rendered = await renderPost(draft.doc as Parameters<typeof renderPost>[0]);
  const publishedAt = draft.date ? dateToTime(draft.date) : (post.publishedAt ?? now);

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE posts SET status = 'published', slug = ?1, title = ?2, summary = ?3, html = ?4,
           text = ?5, words = ?6, toc = ?7, style_hashes = ?8, cover = ?9, series_id = ?10,
           series_part = ?11, published_rev = draft_rev, published_at = ?12, updated_at = ?13
         WHERE id = ?14 AND draft_rev = ?15`,
      )
      .bind(
        slug,
        title,
        draft.summary.trim(),
        rendered.html,
        rendered.text,
        rendered.words,
        JSON.stringify(rendered.headings),
        JSON.stringify(rendered.styleHashes),
        cover ? JSON.stringify(cover) : null,
        draft.series?.id ?? null,
        draft.series?.part ?? null,
        publishedAt,
        now,
        id,
        rev,
      ),
    // Its own old address can be its address again.
    db.prepare('DELETE FROM slug_history WHERE slug = ?1 AND post_id = ?2').bind(slug, id),
  ];
  // The address it had while live, if it changes: old links keep arriving.
  if (post.slug && post.slug !== slug && post.publishedRev !== null) {
    statements.push(
      db
        .prepare(
          'INSERT OR REPLACE INTO slug_history (slug, post_id, created_at) VALUES (?1, ?2, ?3)',
        )
        .bind(post.slug, id, now),
    );
  }
  for (const [tagSlug, name] of tags) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tags (slug, name, family, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (slug) DO NOTHING`,
        )
        .bind(tagSlug, name, familyFor(tagSlug), now),
    );
  }
  statements.push(db.prepare('DELETE FROM post_tags WHERE post_id = ?1').bind(id));
  for (const tagSlug of tags.keys()) {
    statements.push(
      db.prepare('INSERT INTO post_tags (post_id, tag) VALUES (?1, ?2)').bind(id, tagSlug),
    );
  }
  const [update] = await db.batch(statements);
  if (!update?.meta.changes) throw new HttpError(409, 'Save the post before publishing it');
  return { slug, firstTime: post.publishedRev === null };
}

/**
 * A draft as its page would show it, for the studio's preview: rendered now, with its tags in
 * the colours they have (or will get), and not yet a date of its own unless it was given one.
 */
export async function previewDraft(
  db: D1Database,
  id: string,
  now = Date.now(),
): Promise<LivePost> {
  const post = await getForStudio(db, id);
  const { draft } = post;
  const rendered = await renderPost(draft.doc as Parameters<typeof renderPost>[0]);
  const tags: TagRef[] = [];
  for (const name of draft.tags) {
    const slug = slugify(name, 40);
    if (!isNameSlug(slug) || tags.some((tag) => tag.slug === slug)) continue;
    const existing = await db
      .prepare('SELECT name, family FROM tags WHERE slug = ?1')
      .bind(slug)
      .first<{ name: string; family: Family }>();
    tags.push({
      slug,
      name: existing?.name ?? name.trim(),
      family: existing?.family ?? familyFor(slug),
    });
  }
  const series = draft.series
    ? await db
        .prepare('SELECT id, slug, title FROM series WHERE id = ?1')
        .bind(draft.series.id)
        .first<{ id: string; slug: string; title: string }>()
    : null;
  return {
    id: post.id,
    slug: slugForDraft(draft) || post.id,
    title: draft.title.trim() || 'Untitled',
    summary: draft.summary.trim(),
    publishedAt: draft.date ? dateToTime(draft.date) : (post.publishedAt ?? now),
    updatedAt: now,
    words: rendered.words,
    cover: await coverFor(db, draft.cover).catch(() => null),
    tags,
    series: series && draft.series ? { ...series, part: draft.series.part } : null,
    html: rendered.html,
    text: rendered.text,
    headings: rendered.headings,
    styleHashes: rendered.styleHashes,
  };
}

/** Takes a post off the site. Its address stays its own, for when it is published again. */
export async function unpublishPost(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare("UPDATE posts SET status = 'draft' WHERE id = ?1").bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, 'No such post');
}

/** Deletes a post, its comments and its old addresses. Its images stay (they may be reused). */
export async function deletePost(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, 'No such post');
}

/** Records that subscribers were told about a post, so they never are twice. */
export async function markNotified(db: D1Database, id: string, now = Date.now()): Promise<void> {
  await db.prepare('UPDATE posts SET notified_at = ?2 WHERE id = ?1').bind(id, now).run();
}

// --- Series and tags, from the studio ----------------------------------------------------------

export const seriesSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  slug: z.string().max(MAX_SLUG).default(''),
  description: z.string().max(600).default(''),
});

export async function saveSeries(
  db: D1Database,
  input: z.infer<typeof seriesSchema>,
  id: string | null,
  now = Date.now(),
): Promise<SeriesInfo> {
  const slug = input.slug.trim() || slugify(input.title);
  if (!isNameSlug(slug))
    throw new HttpError(400, 'Use letters, numbers and hyphens in the address');
  const clash = await db
    .prepare('SELECT id FROM series WHERE slug = ?1 AND id != ?2')
    .bind(slug, id ?? '')
    .first();
  if (clash) throw new HttpError(409, `Another series already uses /series/${slug}/`);
  const seriesId = id ?? randomId('s');
  if (id) {
    const result = await db
      .prepare('UPDATE series SET slug = ?2, title = ?3, description = ?4 WHERE id = ?1')
      .bind(id, slug, input.title, input.description)
      .run();
    if (!result.meta.changes) throw new HttpError(404, 'No such series');
  } else {
    await db
      .prepare(
        'INSERT INTO series (id, slug, title, description, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(seriesId, slug, input.title, input.description, now)
      .run();
  }
  const saved = (await listSeries(db, true)).find((series) => series.id === seriesId);
  if (!saved) throw new HttpError(404, 'No such series');
  return saved;
}

export async function deleteSeries(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM series WHERE id = ?1').bind(id).run();
}

export const tagSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  family: z.enum(FAMILIES),
  description: z.string().max(600).default(''),
});

export async function saveTag(
  db: D1Database,
  slug: string,
  input: z.infer<typeof tagSchema>,
): Promise<void> {
  const result = await db
    .prepare('UPDATE tags SET name = ?2, family = ?3, description = ?4 WHERE slug = ?1')
    .bind(slug, input.name, input.family, input.description)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'No such tag');
}

export async function deleteTag(db: D1Database, slug: string): Promise<void> {
  await db.prepare('DELETE FROM tags WHERE slug = ?1').bind(slug).run();
}
