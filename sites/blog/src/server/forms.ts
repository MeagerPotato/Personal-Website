/**
 * The readers' two forms: a comment under a post, and subscribing by email. Both are plain HTML
 * forms posted to the page they are on, so they work without JavaScript; the page shows its own
 * error beside the words already typed, and success redirects (303) so a reload sends nothing twice.
 *
 * Spam gets several small walls, none of which a person notices:
 *   - Astro refuses a form posted from another origin (security.checkOrigin);
 *   - every form carries a signed timestamp: forged, older than two days, or sent less than two
 *     seconds after the page was made, it is refused (the page offers a fresh one);
 *   - a field people never see (`website`) must stay empty: a bot that fills it is told "thanks";
 *   - a rate limit per address (FORM_LIMIT);
 *   - Cloudflare Turnstile, when its keys are set;
 *   - and in the end Allen, who approves every comment before anyone sees it.
 */
import { z } from 'zod';
import { addComment, commentInput, NAME_MAX, COMMENT_MAX } from './comments';
import type { BlogEnv } from './env';
import { confirmMail, mailReady, sendSoon } from './mail';
import { emailSchema, subscribe } from './subscribers';
import {
  HttpError,
  base64Url,
  clientAddress,
  fromBase64Url,
  randomToken,
  timingSafeEqual,
} from './util';

export type FormPurpose = 'comment' | 'subscribe';

/** A form sent sooner than this after its page was made was not typed by a person. */
export const MIN_FILL_MS = 2000;
/** A form older than this is refused (a fresh one comes with the answer). */
export const MAX_FORM_AGE_MS = 2 * 24 * 60 * 60 * 1000;
/** The field people never see. */
export const HONEYPOT = 'website';
export const TURNSTILE_FIELD = 'cf-turnstile-response';

// --- The signed timestamp ------------------------------------------------------------------------

const keys = new WeakMap<D1Database, Promise<CryptoKey>>();

/** The key that signs forms: made once, kept in `settings`, shared by every isolate. */
function formKey(db: D1Database): Promise<CryptoKey> {
  let key = keys.get(db);
  if (!key) {
    key = (async () => {
      await db
        .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('form_key', ?1)")
        .bind(randomToken(32))
        .run();
      const row = await db
        .prepare("SELECT value FROM settings WHERE key = 'form_key'")
        .first<{ value: string }>();
      if (!row) throw new Error('No form key');
      return crypto.subtle.importKey(
        'raw',
        fromBase64Url(row.value),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
    })();
    key.catch(() => keys.delete(db));
    keys.set(db, key);
  }
  return key;
}

async function sign(db: D1Database, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await formKey(db),
    new TextEncoder().encode(message),
  );
  return base64Url(new Uint8Array(signature));
}

export async function issueFormToken(
  db: D1Database,
  purpose: FormPurpose,
  now = Date.now(),
): Promise<string> {
  return `${now}.${await sign(db, `${purpose}.${now}`)}`;
}

export type TokenProblem = 'forged' | 'fast' | 'stale';

export async function checkFormToken(
  db: D1Database,
  token: unknown,
  purpose: FormPurpose,
  now = Date.now(),
): Promise<TokenProblem | null> {
  if (typeof token !== 'string') return 'forged';
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return 'forged';
  const issued = Number(match[1]);
  if (!timingSafeEqual(match[2] ?? '', await sign(db, `${purpose}.${issued}`))) return 'forged';
  if (now - issued < MIN_FILL_MS) return 'fast';
  if (now - issued > MAX_FORM_AGE_MS) return 'stale';
  return null;
}

// --- Turnstile ---------------------------------------------------------------------------------

export const turnstileOn = (env: BlogEnv): boolean =>
  Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);

async function passesTurnstile(env: BlogEnv, response: unknown, ip: string): Promise<boolean> {
  if (!turnstileOn(env)) return true;
  if (typeof response !== 'string' || !response || response.length > 2048) return false;
  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET ?? '');
  body.set('response', response);
  if (ip !== 'local') body.set('remoteip', ip);
  try {
    const answer = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const outcome = (await answer.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

// --- The checks every form goes through --------------------------------------------------------

type Checked = { ok: true } | { ok: false; silent: boolean; message: string };

const PROBLEM: Record<TokenProblem, string> = {
  forged: 'That form could not be read. Please send it again.',
  fast: 'That was quick! Please send it once more.',
  stale: 'That form was open a long time. Please send it again.',
};

async function checkForm(
  env: BlogEnv,
  request: Request,
  form: FormData,
  purpose: FormPurpose,
  now: number,
): Promise<Checked> {
  const ip = clientAddress(request);
  const limit = await env.FORM_LIMIT?.limit({ key: `${purpose}:${ip}` });
  if (limit && !limit.success) {
    return {
      ok: false,
      silent: false,
      message: 'Too many at once. Please wait a minute and try again.',
    };
  }
  const problem = await checkFormToken(env.DB, form.get('t'), purpose, now);
  if (problem) return { ok: false, silent: false, message: PROBLEM[problem] };
  const honeypot = form.get(HONEYPOT);
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    return { ok: false, silent: true, message: '' };
  }
  if (!(await passesTurnstile(env, form.get(TURNSTILE_FIELD), ip))) {
    return { ok: false, silent: false, message: 'Please complete the check below the form.' };
  }
  return { ok: true };
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

async function readForm(request: Request): Promise<FormData | null> {
  const type = request.headers.get('content-type') ?? '';
  if (
    !type.includes('application/x-www-form-urlencoded') &&
    !type.includes('multipart/form-data')
  ) {
    return null;
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 64 * 1024) return null;
  return request.formData().catch(() => null);
}

// --- Comments --------------------------------------------------------------------------------------

export interface CommentFormState {
  kind: 'form';
  token: string;
  /** What was typed, to put back after an error. */
  name: string;
  body: string;
  /** The approved comment this answers, when replying. */
  parentId: string | null;
  error: string | null;
}

export type FormOutcome<State> = State | { kind: 'redirect'; location: string };

const PARENT_ID = /^c_[A-Za-z0-9_-]{8,40}$/;

/**
 * The comment form on a post's page: a fresh form for a GET, and for a POST either a redirect
 * (sent, or silently dropped) or the form again with what went wrong.
 */
export async function commentForm(
  env: BlogEnv,
  request: Request,
  post: { id: string; slug: string },
  replyTo: string | null,
  now = Date.now(),
): Promise<FormOutcome<CommentFormState>> {
  const fresh = async (values: Partial<CommentFormState> = {}): Promise<CommentFormState> => ({
    kind: 'form',
    token: await issueFormToken(env.DB, 'comment', now),
    name: '',
    body: '',
    parentId: replyTo && PARENT_ID.test(replyTo) ? replyTo : null,
    error: null,
    ...values,
  });
  if (request.method !== 'POST') return fresh();

  const sent: FormOutcome<CommentFormState> = {
    kind: 'redirect',
    location: `/${post.slug}/?comment=sent#comments`,
  };
  const form = await readForm(request);
  if (!form) return fresh({ error: 'That form could not be read. Please send it again.' });
  const parent = text(form, 'parent');
  const values = {
    name: text(form, 'name').slice(0, NAME_MAX * 2),
    body: text(form, 'body').slice(0, COMMENT_MAX * 2),
    parentId: PARENT_ID.test(parent) ? parent : null,
  };
  const checked = await checkForm(env, request, form, 'comment', now);
  if (!checked.ok) return checked.silent ? sent : fresh({ ...values, error: checked.message });

  const input = commentInput.safeParse({ name: values.name, body: values.body });
  if (!input.success) {
    const issue = input.error.issues[0];
    const field = issue?.path[0] === 'name' ? 'name' : 'comment';
    const tooLong = issue?.code === 'too_big';
    return fresh({
      ...values,
      error: tooLong
        ? `That ${field} is too long (${field === 'name' ? NAME_MAX : COMMENT_MAX} characters at most).`
        : `Please write a ${field}.`,
    });
  }
  try {
    await addComment(env.DB, post.id, input.data, values.parentId, now);
  } catch (error) {
    if (error instanceof HttpError)
      return fresh({ ...values, parentId: null, error: error.message });
    throw error;
  }
  return sent;
}

// --- Subscribing --------------------------------------------------------------------------------

export interface SubscribeFormState {
  kind: 'form';
  token: string;
  email: string;
  error: string | null;
}

/**
 * The subscribe form. Whatever the address's state (new, waiting, subscribed already), the answer
 * is the same "check your inbox", so the form cannot tell anyone who subscribes.
 */
export async function subscribeForm(
  env: BlogEnv,
  request: Request,
  now = Date.now(),
): Promise<FormOutcome<SubscribeFormState>> {
  const fresh = async (values: Partial<SubscribeFormState> = {}): Promise<SubscribeFormState> => ({
    kind: 'form',
    token: await issueFormToken(env.DB, 'subscribe', now),
    email: '',
    error: null,
    ...values,
  });
  if (request.method !== 'POST') return fresh();
  if (!mailReady(env)) return fresh({ error: 'Subscribing by email is not open yet.' });

  const sent: FormOutcome<SubscribeFormState> = {
    kind: 'redirect',
    location: '/subscribe/?sent=1',
  };
  const form = await readForm(request);
  if (!form) return fresh({ error: 'That form could not be read. Please send it again.' });
  const email = text(form, 'email').slice(0, 320);
  const checked = await checkForm(env, request, form, 'subscribe', now);
  if (!checked.ok) return checked.silent ? sent : fresh({ email, error: checked.message });

  const address = emailSchema.safeParse(email);
  if (!address.success) return fresh({ email, error: 'That doesn’t look like an email address.' });
  const outcome = await subscribe(env.DB, address.data, now);
  if (outcome.kind === 'confirm') {
    await sendSoon(env, confirmMail(env.ORIGIN, address.data, outcome.token), now);
  }
  return sent;
}

/** A token from a link (confirm, unsubscribe): its shape checked, nothing else. */
export const linkToken = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
