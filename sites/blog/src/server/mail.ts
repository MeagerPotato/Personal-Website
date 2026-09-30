/**
 * Email: the subscription's confirmation, and each new post to confirmed subscribers.
 *
 * Every message goes through the outbox (a D1 table): written first, then sent, and retried
 * with backoff by the cron if sending fails. A message is identified by (kind, ref, address),
 * so no post is ever announced twice to anyone, however often the studio asks.
 *
 * Sending is Cloudflare Email Service (the EMAIL binding) from MAIL_FROM. Without both, email
 * is off: the subscribe form does not show, and the studio says why. End-to-end tests keep
 * mail in the outbox instead (E2E_MAILBOX) and read it back.
 */
import { themes } from '@allenkh/design/tokens';
import { site } from '../config';
import type { BlogEnv } from './env';
import type { PostSummary } from './posts';
import { activeSubscribers } from './subscribers';
import { escapeHtml, randomId } from './util';

export interface Mail {
  kind: 'confirm' | 'post';
  /** What it is about (a post id), so it is sent once per address. */
  ref: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Whether the blog can send email at all. */
export function mailReady(env: BlogEnv): boolean {
  return env.E2E_MAILBOX === '1' || (Boolean(env.EMAIL) && Boolean(env.MAIL_FROM));
}

/** "Name <address>" or a bare address, as Email Service wants it. */
export function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const name = match[1]?.replace(/^"|"$/g, '').trim();
  return name ? { email: match[2] ?? '', name } : { email: match[2] ?? '' };
}

async function deliver(env: BlogEnv, mail: Mail): Promise<void> {
  if (env.E2E_MAILBOX === '1') return;
  if (!env.EMAIL || !env.MAIL_FROM) throw new Error('Email is not set up');
  await env.EMAIL.send({
    to: mail.to,
    from: parseFrom(env.MAIL_FROM),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.headers ? { headers: mail.headers } : {}),
  });
}

/** Adds messages to the outbox; one already there (same kind, ref and address) is left alone. */
export async function queueMail(
  db: D1Database,
  mails: readonly Mail[],
  now = Date.now(),
): Promise<number> {
  if (mails.length === 0) return 0;
  const results = await db.batch(
    mails.map((mail) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO outbox (id, kind, ref, to_addr, subject, html, text, headers,
             status, created_at, send_after)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', ?9, ?9)`,
        )
        .bind(
          randomId('o'),
          mail.kind,
          mail.ref,
          mail.to,
          mail.subject,
          mail.html,
          mail.text,
          JSON.stringify(mail.headers ?? {}),
          now,
        ),
    ),
  );
  return results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
}

interface OutboxRow {
  id: string;
  kind: Mail['kind'];
  ref: string;
  to_addr: string;
  subject: string;
  html: string;
  text: string;
  headers: string;
  attempts: number;
}

/** After this many failures (about fifteen hours of retrying) a message is given up on. */
export const MAX_ATTEMPTS = 10;
const backoff = (attempts: number): number => Math.min(2 ** attempts, 360) * 60_000;

async function sendRows(env: BlogEnv, rows: readonly OutboxRow[], now: number) {
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deliver(env, {
        kind: row.kind,
        ref: row.ref,
        to: row.to_addr,
        subject: row.subject,
        html: row.html,
        text: row.text,
        headers: JSON.parse(row.headers) as Record<string, string>,
      });
      // A sent message keeps no content (a confirmation link is a secret until it is used),
      // except for the end-to-end tests, whose mailbox is this table.
      await env.DB.prepare(
        `UPDATE outbox SET status = 'sent', sent_at = ?2, error = NULL,
           html = CASE WHEN ?3 THEN html ELSE '' END, text = CASE WHEN ?3 THEN text ELSE '' END
         WHERE id = ?1`,
      )
        .bind(row.id, now, env.E2E_MAILBOX === '1' ? 1 : 0)
        .run();
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      await env.DB.prepare(
        `UPDATE outbox SET attempts = ?2, send_after = ?3, error = ?4,
           status = CASE WHEN ?2 >= ?5 THEN 'failed' ELSE 'queued' END
         WHERE id = ?1`,
      )
        .bind(row.id, attempts, now + backoff(attempts), String(error).slice(0, 300), MAX_ATTEMPTS)
        .run();
      failed += 1;
    }
  }
  return { sent, failed };
}

/**
 * Sends what is due, oldest first (the cron; a batch stays well inside a Worker's limits). A
 * post's email waits while the post is unpublished, and is never sent to someone who has
 * unsubscribed since it was queued.
 */
export async function drainOutbox(env: BlogEnv, now = Date.now(), limit = 40) {
  if (!mailReady(env)) return { sent: 0, failed: 0 };
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.kind, o.ref, o.to_addr, o.subject, o.html, o.text, o.headers, o.attempts
     FROM outbox o
     WHERE o.status = 'queued' AND o.send_after <= ?1
       AND (o.kind != 'post' OR (
         EXISTS (SELECT 1 FROM posts p WHERE p.id = o.ref AND p.status = 'published')
         AND EXISTS (SELECT 1 FROM subscribers s WHERE s.email = o.to_addr AND s.status = 'active')))
     ORDER BY o.created_at LIMIT ?2`,
  )
    .bind(now, limit)
    .all<OutboxRow>();
  return sendRows(env, results, now);
}

/** Queues a post's email for every confirmed subscriber (once each, however often it is asked). */
export async function notifySubscribers(
  env: BlogEnv,
  post: Pick<PostSummary, 'id' | 'slug' | 'title' | 'summary'>,
  now = Date.now(),
): Promise<number> {
  const subscribers = await activeSubscribers(env.DB);
  const mails = subscribers.map((subscriber) =>
    newPostMail(env.ORIGIN, post, subscriber.email, subscriber.unsubscribeToken),
  );
  let queued = 0;
  // D1 takes a batch of up to 100 statements comfortably; a list grows past that one day.
  for (let start = 0; start < mails.length; start += 50) {
    queued += await queueMail(env.DB, mails.slice(start, start + 50), now);
  }
  return queued;
}

export interface MailStatus {
  ready: boolean;
  queued: number;
  failed: number;
  sentLastMonth: number;
}

export async function mailStatus(env: BlogEnv): Promise<MailStatus> {
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(status = 'queued'), 0) AS queued,
       COALESCE(SUM(status = 'failed'), 0) AS failed,
       COALESCE(SUM(status = 'sent'), 0) AS sent
     FROM outbox`,
  ).first<{ queued: number; failed: number; sent: number }>();
  return {
    ready: mailReady(env),
    queued: row?.queued ?? 0,
    failed: row?.failed ?? 0,
    sentLastMonth: row?.sent ?? 0,
  };
}

/** Queues one message and tries it at once (a confirmation should not wait for the cron). */
export async function sendSoon(env: BlogEnv, mail: Mail, now = Date.now()): Promise<void> {
  await queueMail(env.DB, [mail], now);
  const row = await env.DB.prepare(
    `SELECT id, kind, ref, to_addr, subject, html, text, headers, attempts FROM outbox
     WHERE kind = ?1 AND ref = ?2 AND to_addr = ?3 AND status = 'queued'`,
  )
    .bind(mail.kind, mail.ref, mail.to)
    .first<OutboxRow>();
  if (row) await sendRows(env, [row], now);
}

/**
 * The cron's tidying: sent and failed mail is forgotten after a month (the outbox holds
 * addresses, and needs them no longer), and a post's email that can never go (the post was
 * deleted, or its reader unsubscribed) is dropped.
 */
export async function sweepOutbox(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM outbox WHERE status IN ('sent', 'failed') AND created_at < ?1")
      .bind(now - 30 * 24 * 60 * 60 * 1000),
    db.prepare(
      `DELETE FROM outbox WHERE status = 'queued' AND kind = 'post' AND (
         NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = outbox.ref)
         OR NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.email = outbox.to_addr AND s.status = 'active'))`,
    ),
  ]);
}

// --- The messages ------------------------------------------------------------------------------

const day = themes.day;

/** A plain, readable email: the blog's name, the words, a button, a footer. Inline styles only. */
function layout(parts: {
  heading: string;
  body: string;
  button?: { label: string; url: string };
  footer: string;
}): string {
  const button = parts.button
    ? `<p style="margin:28px 0"><a href="${escapeHtml(parts.button.url)}" style="background:${day.ink.high};color:${day.bg};text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(parts.button.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:${day.bg};color:${day.ink.high};font-family:Outfit,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="margin:0 0 24px;color:${day.ink.mid};font-size:14px;font-weight:600">${escapeHtml(site.title)}</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.3">${escapeHtml(parts.heading)}</h1>
${parts.body}${button}
<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${day.line};color:${day.ink.mid};font-size:13px">${parts.footer}</p>
</div></body></html>`;
}

const link = (url: string, label: string) =>
  `<a href="${escapeHtml(url)}" style="color:${day.accent}">${escapeHtml(label)}</a>`;

export function confirmMail(origin: string, to: string, token: string): Mail {
  const url = `${origin}/subscribe/confirm/?token=${encodeURIComponent(token)}`;
  return {
    kind: 'confirm',
    ref: token.slice(0, 16),
    to,
    subject: `Confirm your subscription to ${site.title}`,
    html: layout({
      heading: 'One click to subscribe',
      body: `<p style="margin:0">Someone (hopefully you) asked for new posts from ${escapeHtml(site.title)} to be sent to this address. Confirm, and each new post will arrive here. Nothing else will.</p>`,
      button: { label: 'Confirm my subscription', url },
      footer: `If you didn’t ask for this, ignore this email: without the click, nothing is sent. The link works for a week.`,
    }),
    text: `Someone (hopefully you) asked for new posts from ${site.title} to be sent to this address.\n\nConfirm: ${url}\n\nIf you didn't ask for this, ignore this email: without the click, nothing is sent. The link works for a week.\n`,
  };
}

export function newPostMail(
  origin: string,
  post: Pick<PostSummary, 'id' | 'slug' | 'title' | 'summary'>,
  to: string,
  unsubscribeToken: string,
): Mail {
  const url = `${origin}/${post.slug}/`;
  const unsubscribePage = `${origin}/unsubscribe/?token=${encodeURIComponent(unsubscribeToken)}`;
  const oneClick = `${origin}/api/unsubscribe/one-click?token=${encodeURIComponent(unsubscribeToken)}`;
  const summary = post.summary
    ? `<p style="margin:0;color:${day.ink.mid}">${escapeHtml(post.summary)}</p>`
    : '';
  return {
    kind: 'post',
    ref: post.id,
    to,
    subject: post.title,
    html: layout({
      heading: post.title,
      body: summary,
      button: { label: 'Read the post', url },
      footer: `You get this because you subscribed to ${escapeHtml(site.title)}. ${link(unsubscribePage, 'Unsubscribe')}.`,
    }),
    text: `${post.title}\n\n${post.summary ? `${post.summary}\n\n` : ''}Read it: ${url}\n\nYou get this because you subscribed to ${site.title}. Unsubscribe: ${unsubscribePage}\n`,
    headers: {
      'List-Unsubscribe': `<${oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      // No display name: the header allows only ASCII there, and the blog's name has a ’.
      'List-Id': `<posts.${new URL(origin).hostname}>`,
    },
  };
}
