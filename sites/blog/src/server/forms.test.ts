/**
 * The readers' forms and the mail they cause, against a local D1: comments waiting for approval,
 * the walls against spam, the double opt-in, a post's email to subscribers (once), and the
 * one-click unsubscribe. Mail goes to a recording binding instead of Email Service.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approvedComments, commentsFor, replyAsAuthor, setCommentStatus } from './comments';
import type { BlogEnv } from './env';
import {
  HONEYPOT,
  MAX_FORM_AGE_MS,
  checkFormToken,
  commentForm,
  issueFormToken,
  subscribeForm,
  type CommentFormState,
  type SubscribeFormState,
} from './forms';
import { MAX_ATTEMPTS, drainOutbox, notifySubscribers, sweepOutbox } from './mail';
import { runCron } from './scheduled';
import { confirmSubscription, listSubscribers, sweepSubscribers } from './subscribers';
import { FakeMail, ORIGIN, context, freshEnv, startPlatform } from './test/platform';
import { api } from './api';

const platform = await startPlatform();
afterAll(() => platform.dispose());

const T0 = Date.parse('2026-09-30T12:00:00Z');
/** Long enough after the form was made for a person to have typed something. */
const LATER = T0 + 60_000;

let env: BlogEnv;
let mail: FakeMail;
beforeEach(async () => {
  mail = new FakeMail();
  env = await freshEnv(platform, { EMAIL: mail, MAIL_FROM: 'Captain’s Log <allen@allenkh.com>' });
});

/** A published post to comment on, written straight into the table. */
async function post(slug = 'first-light'): Promise<{ id: string; slug: string }> {
  const id = `p_${slug.replace(/-/g, '_')}_0000`;
  await env.DB.prepare(
    `INSERT INTO posts (id, status, draft, draft_saved_at, slug, title, summary, published_at,
       updated_at, published_rev, created_at)
     VALUES (?1, 'published', '{}', ?3, ?2, 'First light', 'The first post.', ?3, ?3, 1, ?3)`,
  )
    .bind(id, slug, T0)
    .run();
  return { id, slug };
}

function formPost(url: string, fields: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
    body: new URLSearchParams(fields).toString(),
  });
}

async function comment(
  target: { id: string; slug: string },
  fields: Record<string, string>,
  now = LATER,
) {
  const token = await issueFormToken(env.DB, 'comment', T0);
  const request = formPost(`${ORIGIN}/${target.slug}/`, { t: token, [HONEYPOT]: '', ...fields });
  return commentForm(env, request, target, null, now);
}

describe('the signed form token', () => {
  it('refuses a forged token, one sent too fast, and one left open too long', async () => {
    const token = await issueFormToken(env.DB, 'comment', T0);
    expect(await checkFormToken(env.DB, token, 'comment', LATER)).toBeNull();
    expect(await checkFormToken(env.DB, token, 'subscribe', LATER)).toBe('forged');
    expect(
      await checkFormToken(
        env.DB,
        token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
        'comment',
        LATER,
      ),
    ).toBe('forged');
    expect(await checkFormToken(env.DB, `${T0 + 1}${token.slice(13)}`, 'comment', LATER)).toBe(
      'forged',
    );
    expect(await checkFormToken(env.DB, token, 'comment', T0 + 500)).toBe('fast');
    expect(await checkFormToken(env.DB, token, 'comment', T0 + MAX_FORM_AGE_MS + 1)).toBe('stale');
    expect(await checkFormToken(env.DB, undefined, 'comment', LATER)).toBe('forged');
  });
});

describe('comments', () => {
  it('waits for approval, then shows under the post, with Allen’s reply', async () => {
    const target = await post();
    const outcome = await comment(target, { name: 'Ada', body: 'Lovely launch.\n\nMore please.' });
    expect(outcome).toEqual({ kind: 'redirect', location: '/first-light/?comment=sent#comments' });
    expect(await approvedComments(env.DB, target.id)).toEqual([]);

    const [pending] = await commentsFor(env.DB, 'pending');
    expect(pending).toMatchObject({ name: 'Ada', postSlug: 'first-light', status: 'pending' });
    await setCommentStatus(env.DB, pending?.id ?? '', 'approved', LATER);
    await replyAsAuthor(env.DB, pending?.id ?? '', 'Thank you!', LATER + 1);
    const shown = await approvedComments(env.DB, target.id);
    expect(shown.map((c) => [c.name, c.author, c.parentId === null])).toEqual([
      ['Ada', false, true],
      ['Allen', true, false],
    ]);
  });

  it('keeps what was typed when something is wrong, and says what', async () => {
    const target = await post();
    const empty = (await comment(target, { name: 'Ada', body: '   ' })) as CommentFormState;
    expect(empty.kind).toBe('form');
    expect(empty.error).toBe('Please write a comment.');
    expect(empty.name).toBe('Ada');

    const fast = (await comment(target, { name: 'Ada', body: 'Hi' }, T0 + 100)) as CommentFormState;
    expect(fast.error).toMatch(/quick/);
    expect(fast.body).toBe('Hi');
    // A fresh token comes back with the form, ready to send again.
    expect(await checkFormToken(env.DB, fast.token, 'comment', T0 + 100 + 60_000)).toBeNull();

    const long = (await comment(target, {
      name: 'Ada',
      body: 'x'.repeat(3001),
    })) as CommentFormState;
    expect(long.error).toMatch(/too long/);
    expect(await commentsFor(env.DB, 'pending')).toEqual([]);
  });

  it('tells a bot that fills the hidden field “thanks”, and keeps nothing', async () => {
    const target = await post();
    const outcome = await comment(target, {
      name: 'Bot',
      body: 'Buy now',
      [HONEYPOT]: 'https://spam.example.com',
    });
    expect(outcome.kind).toBe('redirect');
    expect(await commentsFor(env.DB, 'pending')).toEqual([]);
    expect(await commentsFor(env.DB, 'spam')).toEqual([]);
  });

  it('sends a comment full of links straight to spam', async () => {
    const target = await post();
    const links = ['a', 'b', 'c', 'd'].map((name) => `https://${name}.example.com`).join(' ');
    await comment(target, { name: 'Linker', body: `Look: ${links}` });
    expect(await commentsFor(env.DB, 'pending')).toEqual([]);
    expect(await commentsFor(env.DB, 'spam')).toHaveLength(1);
  });

  it('answers only replies to approved comments on the same post', async () => {
    const target = await post();
    const other = await post('second-light');
    await comment(target, { name: 'Ada', body: 'First!' });
    const [first] = await commentsFor(env.DB, 'pending');
    const early = (await comment(target, {
      name: 'Bo',
      body: 'Reply',
      parent: first?.id ?? '',
    })) as CommentFormState;
    expect(early.error).toBe('That comment is gone');

    await setCommentStatus(env.DB, first?.id ?? '', 'approved');
    const elsewhere = (await comment(other, {
      name: 'Bo',
      body: 'Reply',
      parent: first?.id ?? '',
    })) as CommentFormState;
    expect(elsewhere.error).toBe('That comment is gone');
    expect(
      (await comment(target, { name: 'Bo', body: 'Reply', parent: first?.id ?? '' })).kind,
    ).toBe('redirect');
  });
});

async function subscribeWith(email: string, now = LATER) {
  const token = await issueFormToken(env.DB, 'subscribe', T0);
  return subscribeForm(
    env,
    formPost(`${ORIGIN}/subscribe/`, { t: token, [HONEYPOT]: '', email }),
    now,
  );
}

const confirmLink = (text: string): string => {
  const match = /\/subscribe\/confirm\/\?token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error(`no confirmation link in: ${text}`);
  return match[1];
};

describe('subscribing by email', () => {
  it('confirms by email first (double opt-in), then sends each new post once', async () => {
    const outcome = await subscribeWith('  Reader@example.com ');
    expect(outcome).toEqual({ kind: 'redirect', location: '/subscribe/?sent=1' });
    expect(mail.sent).toHaveLength(1);
    const [confirm] = mail.sent;
    expect(confirm).toMatchObject({
      to: 'reader@example.com',
      subject: 'Confirm your subscription to Captain’s Log',
    });
    expect(confirm?.from).toEqual({ email: 'allen@allenkh.com', name: 'Captain’s Log' });

    const target = await post();
    // Not confirmed yet: nobody gets the post.
    expect(
      await notifySubscribers(env, { ...target, title: 'First light', summary: '' }, LATER),
    ).toBe(0);

    expect(await confirmSubscription(env.DB, confirmLink(confirm?.text ?? ''), LATER)).toBe(true);
    expect((await listSubscribers(env.DB))[0]).toMatchObject({
      email: 'reader@example.com',
      status: 'active',
    });

    const announce = { ...target, title: 'First light', summary: 'The first post.' };
    expect(await notifySubscribers(env, announce, LATER)).toBe(1);
    expect(await notifySubscribers(env, announce, LATER)).toBe(0); // once, however often asked
    await drainOutbox(env, LATER);
    const postMail = mail.sent[1];
    expect(postMail?.subject).toBe('First light');
    expect(postMail?.text).toContain(`${ORIGIN}/first-light/`);
    expect(postMail?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(postMail?.headers?.['List-Unsubscribe']).toMatch(
      /^<http:\/\/localhost:4321\/api\/unsubscribe\/one-click\?token=[A-Za-z0-9_-]+>$/,
    );

    // The sent message keeps no content: the confirmation link was a secret until it was used.
    const stored = await env.DB.prepare(
      "SELECT html, text FROM outbox WHERE kind = 'confirm'",
    ).first();
    expect(stored).toEqual({ html: '', text: '' });
  });

  it('answers the same whatever the address, so it tells nobody who subscribes', async () => {
    await subscribeWith('reader@example.com');
    const [confirm] = mail.sent;
    await confirmSubscription(env.DB, confirmLink(confirm?.text ?? ''), LATER);
    const again = await subscribeWith('reader@example.com', LATER + 20 * 60_000);
    expect(again).toEqual({ kind: 'redirect', location: '/subscribe/?sent=1' });
    expect(mail.sent).toHaveLength(1); // subscribed already: nothing new is sent
  });

  it('refuses what is not an address, and a confirmation link that is old or reused', async () => {
    const bad = (await subscribeWith('not an address')) as SubscribeFormState;
    expect(bad.error).toMatch(/email address/);
    expect(bad.email).toBe('not an address');

    await subscribeWith('reader@example.com');
    const token = confirmLink(mail.sent[0]?.text ?? '');
    expect(await confirmSubscription(env.DB, token, LATER + 8 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(await confirmSubscription(env.DB, token, LATER)).toBe(true);
    expect(await confirmSubscription(env.DB, token, LATER)).toBe(false);
  });

  it('forgets an address that never confirmed', async () => {
    await subscribeWith('reader@example.com');
    await sweepSubscribers(env.DB, LATER + 8 * 24 * 60 * 60 * 1000);
    expect(await listSubscribers(env.DB)).toEqual([]);
  });

  it('is closed while email is not set up', async () => {
    env = await freshEnv(platform);
    const closed = (await subscribeWith('reader@example.com')) as SubscribeFormState;
    expect(closed.error).toMatch(/not open/);
    expect(await listSubscribers(env.DB)).toEqual([]);
  });

  it('unsubscribes with one click from the mail app, and never on a mere visit', async () => {
    await subscribeWith('reader@example.com');
    await confirmSubscription(env.DB, confirmLink(mail.sent[0]?.text ?? ''), LATER);
    const target = await post();
    await notifySubscribers(env, { ...target, title: 'First light', summary: '' }, LATER);
    await drainOutbox(env, LATER);
    const link = /<([^>]+)>/.exec(mail.sent[1]?.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? '';

    const visit = await api.fetch(new Request(link), env, context());
    expect(visit.status).toBe(303);
    expect(visit.headers.get('location')).toMatch(/^\/unsubscribe\/\?token=/);
    expect((await listSubscribers(env.DB))[0]?.status).toBe('active');

    // A mail provider's POST: from its own servers, with no Origin of ours.
    const click = await api.fetch(
      new Request(link, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      env,
      context(),
    );
    expect(click.status).toBe(200);
    expect((await listSubscribers(env.DB))[0]?.status).toBe('unsubscribed');
  });

  it('never sends a queued post to someone who unsubscribed after it was queued', async () => {
    await subscribeWith('reader@example.com');
    await confirmSubscription(env.DB, confirmLink(mail.sent[0]?.text ?? ''), LATER);
    const target = await post();
    await notifySubscribers(env, { ...target, title: 'First light', summary: '' }, LATER);
    await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed'").run();
    expect(await drainOutbox(env, LATER)).toEqual({ sent: 0, failed: 0 });
    await sweepOutbox(env.DB, LATER);
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE kind = 'post'",
    ).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe('the outbox', () => {
  it('retries a failed send with growing waits, then gives up', async () => {
    mail.failing = new Error('E_TEMPORARY');
    await subscribeWith('reader@example.com');
    const row = () =>
      env.DB.prepare('SELECT status, attempts, send_after, error FROM outbox').first<{
        status: string;
        attempts: number;
        send_after: number;
        error: string;
      }>();
    expect(await row()).toMatchObject({
      status: 'queued',
      attempts: 1,
      send_after: LATER + 2 * 60_000,
    });
    expect((await row())?.error).toContain('E_TEMPORARY');

    // Not due yet: the cron leaves it alone.
    expect(await drainOutbox(env, LATER + 60_000)).toEqual({ sent: 0, failed: 0 });
    let now = LATER;
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      now = (await row())?.send_after ?? now;
      expect(await drainOutbox(env, now)).toEqual({ sent: 0, failed: 1 });
    }
    expect(await row()).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });

    // Working again: a failed message stays failed (the studio shows it), nothing is resent.
    mail.failing = null;
    expect(await drainOutbox(env, now + 24 * 60 * 60 * 1000)).toEqual({ sent: 0, failed: 0 });
  });

  it('is sent by the cron, which also tidies up', async () => {
    mail.failing = new Error('E_TEMPORARY');
    await subscribeWith('reader@example.com');
    mail.failing = null;
    await runCron(env, LATER + 10 * 60_000);
    expect(mail.sent).toHaveLength(1);
    await runCron(env, LATER + 40 * 24 * 60 * 60 * 1000);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
