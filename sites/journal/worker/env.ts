/** What the journal Worker is given (wrangler.jsonc; secrets from the dashboard or .dev.vars). */
export interface Env {
  /** Encrypted records, passkeys, sealed key slots, sessions. */
  readonly DB: D1Database;
  /** Encrypted files (photos and their thumbnails). */
  readonly BLOBS: R2Bucket;
  /** Per-IP limit on the sign-in endpoints. Approximate by design: exact lockouts live in D1. */
  readonly AUTH_LIMIT?: RateLimit;

  /** WebAuthn relying party id: exactly this host, never the parent domain (docs/journal-crypto.md). */
  readonly RP_ID: string;
  /** The one origin allowed to call the API and to sign in, e.g. https://journal.allenkh.com. */
  readonly ORIGIN: string;

  /**
   * Secret. Asked for once, when the journal is set up, so that nobody who finds the address
   * before Allen does can claim it. Unused afterwards.
   */
  readonly SETUP_TOKEN?: string;
  /** Secrets for the daily reminder (Web Push VAPID keys, base64url). */
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
}

export interface Session {
  readonly idHash: string;
  readonly credentialId: string | null;
  /** 'full' after a passkey sign-in; 'enroll' after the recovery phrase (may only add a passkey). */
  readonly scope: 'full' | 'enroll';
}

export interface AppContext {
  Bindings: Env;
  Variables: { session: Session | null };
}
