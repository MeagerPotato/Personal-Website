/**
 * What the blog's Worker is given (wrangler.jsonc; secrets from the dashboard or .dev.vars).
 * Everything optional is a feature that stays off until it is set up: email without EMAIL and
 * MAIL_FROM, Turnstile without its two keys.
 */
export interface BlogEnv {
  /** Posts, tags, series, comments, subscribers, the outbox, passkeys, sessions. */
  readonly DB: D1Database;
  /** Images uploaded in the studio, each in the sizes the device made. */
  readonly MEDIA: R2Bucket;
  /** The studio's sign-in. Approximate by design. */
  readonly AUTH_LIMIT?: RateLimit;
  /** Readers' forms: comments and subscriptions. */
  readonly FORM_LIMIT?: RateLimit;

  /** WebAuthn relying party: exactly this host, never the parent domain. */
  readonly RP_ID: string;
  /** The one origin, e.g. https://blog.allenkh.com: links in feeds and emails, the CSRF check. */
  readonly ORIGIN: string;

  /**
   * Secret. Makes the studio's first passkey, and opens nothing once there is one. Every passkey
   * lost: the runbook empties the passkeys from the D1 console, and the code works again.
   */
  readonly SETUP_TOKEN?: string;

  /** Cloudflare Email Service (a `send_email` binding) and the address mail comes from. */
  readonly EMAIL?: MailBinding;
  /**
   * "Name <address>" on a domain onboarded to Email Service. Set in the dashboard as a secret:
   * a deploy keeps secrets (plain dashboard variables it would drop), and no address beyond
   * the public contact one is ever written in the repository.
   */
  readonly MAIL_FROM?: string;

  /** Cloudflare Turnstile on the comment form: the widget's site key (public) and secret. */
  readonly TURNSTILE_SITE_KEY?: string;
  readonly TURNSTILE_SECRET?: string;

  /**
   * Tests and the dev server only (.dev.vars): mail is kept in the outbox instead of sent, and
   * GET /api/test/mailbox shows it. Never set in wrangler.jsonc.
   */
  readonly E2E_MAILBOX?: string;
}

/** The part of Email Service's `send_email` binding the blog uses. */
export interface MailBinding {
  send(message: MailMessage): Promise<{ messageId: string }>;
}

export interface MailMessage {
  to: string;
  from: string | { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface StudioSession {
  readonly idHash: string;
  readonly credentialId: string | null;
}

export interface ApiContext {
  Bindings: BlogEnv;
  Variables: { session: StudioSession | null };
}
