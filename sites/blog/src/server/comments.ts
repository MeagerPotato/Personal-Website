/**
 * Comments. A reader leaves a name and some words (no email, no address kept); the comment
 * waits as 'pending' until Allen approves it in the studio. Allen's replies, written there, appear
 * at once. The words stay plain text: escaped, split into paragraphs, and bare links made
 * clickable with rel="nofollow ugc".
 */
import { z } from 'zod';
import { HttpError, escapeHtml, randomId } from './util';

export const COMMENT_MAX = 3000;
export const NAME_MAX = 60;

export const commentInput = z.strictObject({
  name: z.string().trim().min(1).max(NAME_MAX),
  body: z.string().trim().min(1).max(COMMENT_MAX),
});

export type CommentStatus = 'pending' | 'approved' | 'spam';

export interface PublicComment {
  id: string;
  parentId: string | null;
  name: string;
  body: string;
  /** Written by Allen, in the studio. */
  author: boolean;
  createdAt: number;
}

export interface StudioComment extends PublicComment {
  status: CommentStatus;
  postId: string;
  postTitle: string;
  postSlug: string | null;
}

interface Row {
  id: string;
  parent_id: string | null;
  name: string;
  body: string;
  author: number;
  created_at: number;
}

const toPublic = (row: Row): PublicComment => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  body: row.body,
  author: row.author === 1,
  createdAt: row.created_at,
});

/** A post's approved comments, oldest first (replies are placed under their parent by the page). */
export async function approvedComments(db: D1Database, postId: string): Promise<PublicComment[]> {
  const { results } = await db
    .prepare(
      `SELECT id, parent_id, name, body, author, created_at FROM comments
       WHERE post_id = ?1 AND status = 'approved' ORDER BY created_at, id`,
    )
    .bind(postId)
    .all<Row>();
  return results.map(toPublic);
}

/** Top-level comments with their replies (one level: a reply to a reply joins its thread). */
export function threads(
  comments: readonly PublicComment[],
): { comment: PublicComment; replies: PublicComment[] }[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootOf = (comment: PublicComment): PublicComment => {
    let current = comment;
    for (let hops = 0; current.parentId && hops < 20; hops += 1) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const out = new Map<string, { comment: PublicComment; replies: PublicComment[] }>();
  for (const comment of comments) {
    const root = rootOf(comment);
    if (root.id === comment.id)
      out.set(comment.id, { comment, replies: out.get(comment.id)?.replies ?? [] });
    else {
      const thread = out.get(root.id) ?? { comment: root, replies: [] };
      thread.replies.push(comment);
      out.set(root.id, thread);
    }
  }
  return [...out.values()];
}

const LINK = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/** Plain words as HTML: escaped, paragraphs on blank lines, links clickable. */
export function commentHtml(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const parts: string[] = [];
      let last = 0;
      for (const match of paragraph.matchAll(LINK)) {
        const at = match.index ?? 0;
        parts.push(escapeHtml(paragraph.slice(last, at)));
        const url = match[0];
        parts.push(
          `<a href="${escapeHtml(url)}" rel="nofollow ugc noopener noreferrer">${escapeHtml(url)}</a>`,
        );
        last = at + url.length;
      }
      parts.push(escapeHtml(paragraph.slice(last)));
      return `<p>${parts.join('').replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/** How many links a comment may carry before it goes straight to spam. */
export const MAX_LINKS = 3;

/** A reader's comment on a published post, waiting for approval. Returns its id. */
export async function addComment(
  db: D1Database,
  postId: string,
  input: z.infer<typeof commentInput>,
  parentId: string | null,
  now = Date.now(),
): Promise<string> {
  const post = await db
    .prepare("SELECT 1 AS one FROM posts WHERE id = ?1 AND status = 'published'")
    .bind(postId)
    .first();
  if (!post) throw new HttpError(404, 'No such post');
  if (parentId) {
    const parent = await db
      .prepare(
        "SELECT 1 AS one FROM comments WHERE id = ?1 AND post_id = ?2 AND status = 'approved'",
      )
      .bind(parentId, postId)
      .first();
    if (!parent) throw new HttpError(400, 'That comment is gone');
  }
  const links = [...input.body.matchAll(LINK)].length;
  const id = randomId('c');
  await db
    .prepare(
      `INSERT INTO comments (id, post_id, parent_id, name, body, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(id, postId, parentId, input.name, input.body, links > MAX_LINKS ? 'spam' : 'pending', now)
    .run();
  return id;
}

/** The studio's queue: comments with a status, newest first, with their post. */
export async function commentsFor(
  db: D1Database,
  status: CommentStatus,
  limit = 200,
): Promise<StudioComment[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.parent_id, c.name, c.body, c.author, c.created_at, c.status, c.post_id,
         p.title AS post_title, p.slug AS post_slug
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.status = ?1 ORDER BY c.created_at DESC LIMIT ?2`,
    )
    .bind(status, limit)
    .all<
      Row & { status: CommentStatus; post_id: string; post_title: string; post_slug: string | null }
    >();
  return results.map((row) => ({
    ...toPublic(row),
    status: row.status,
    postId: row.post_id,
    postTitle: row.post_title,
    postSlug: row.post_slug,
  }));
}

export async function countPending(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM comments WHERE status = 'pending'")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function setCommentStatus(
  db: D1Database,
  id: string,
  status: CommentStatus,
  now = Date.now(),
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE comments SET status = ?2,
         approved_at = CASE WHEN ?2 = 'approved' THEN COALESCE(approved_at, ?3) ELSE approved_at END
       WHERE id = ?1`,
    )
    .bind(id, status, now)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'No such comment');
}

export async function deleteComment(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare('DELETE FROM comments WHERE id = ?1').bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, 'No such comment');
}

/** Allen's reply, approved as it is written (replying approves what it answers). */
export async function replyAsAuthor(
  db: D1Database,
  parentId: string,
  body: string,
  now = Date.now(),
): Promise<string> {
  const parent = await db
    .prepare('SELECT post_id FROM comments WHERE id = ?1')
    .bind(parentId)
    .first<{ post_id: string }>();
  if (!parent) throw new HttpError(404, 'No such comment');
  const id = randomId('c');
  await db.batch([
    db
      .prepare(
        `UPDATE comments SET status = 'approved', approved_at = COALESCE(approved_at, ?2)
         WHERE id = ?1`,
      )
      .bind(parentId, now),
    db
      .prepare(
        `INSERT INTO comments (id, post_id, parent_id, name, body, status, author, created_at, approved_at)
         VALUES (?1, ?2, ?3, 'Allen', ?4, 'approved', 1, ?5, ?5)`,
      )
      .bind(id, parent.post_id, parentId, body.trim().slice(0, COMMENT_MAX), now),
  ]);
  return id;
}
