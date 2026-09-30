/**
 * Signing in to the studio with passkeys (WebAuthn; rp.id exactly blog.allenkh.com, user
 * verification required). No passwords anywhere.
 *
 * The first passkey needs the setup code (SETUP_TOKEN, a secret set in the dashboard), and only
 * works while there is no passkey at all: once the studio has one, the code opens nothing. Lost
 * every passkey? The runbook's recovery empties the credentials table from the D1 console, and
 * the setup code works again.
 *
 * Unlike the journal, nothing here unlocks a key, so any passkey will do: this device's own, a
 * phone's over the QR code, or a security key.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ApiContext } from './env';
import { body, requireSession } from './http';
import { endSession, startSession } from './sessions';
import { HttpError, clientAddress, randomToken, timingSafeEqual } from './util';

const CHALLENGE_MS = 5 * 60 * 1000;
/** ES256 (Apple, Google, most), EdDSA, RS256 (Windows Hello). */
const ALGORITHMS = [-7, -8, -257];
const RP_NAME = 'Allen’s blog studio';

type Ctx = Context<ApiContext>;

const b64url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(8192);

// WebAuthn responses are checked in depth by SimpleWebAuthn; this only bounds their shape.
const credentialResponse = z.looseObject({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  response: z.looseObject({}),
  clientExtensionResults: z.looseObject({}).default({}),
});

async function limit(c: Ctx): Promise<void> {
  const outcome = await c.env.AUTH_LIMIT?.limit({ key: clientAddress(c.req.raw) });
  if (outcome && !outcome.success) throw new HttpError(429, 'Too many attempts; wait a minute');
}

async function saveChallenge(c: Ctx, challenge: string, purpose: string): Promise<string> {
  const id = randomToken(16);
  await c.env.DB.prepare(
    'INSERT INTO challenges (id, challenge, purpose, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(id, challenge, purpose, Date.now() + CHALLENGE_MS)
    .run();
  return id;
}

/** Each challenge works once: it is deleted as it is read. */
async function takeChallenge(c: Ctx, id: string, purpose: string): Promise<string> {
  const row = await c.env.DB.prepare(
    'DELETE FROM challenges WHERE id = ?1 AND purpose = ?2 RETURNING challenge, expires_at',
  )
    .bind(id, purpose)
    .first<{ challenge: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now())
    throw new HttpError(400, 'That took too long; try again');
  return row.challenge;
}

interface CredentialRow {
  id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string;
  label: string;
  created_at: number;
  last_used_at: number | null;
  backed_up: number;
}

async function passkeyCount(c: Ctx): Promise<number> {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM credentials').first<{
    n: number;
  }>();
  return row?.n ?? 0;
}

function checkSetupCode(c: Ctx, token: string): void {
  if (!c.env.SETUP_TOKEN) throw new HttpError(403, 'Setup is switched off (no SETUP_TOKEN)');
  if (!timingSafeEqual(token.trim(), c.env.SETUP_TOKEN))
    throw new HttpError(403, 'Wrong setup code');
}

async function registrationOptions(c: Ctx) {
  const existing = await c.env.DB.prepare(
    'SELECT id, transports FROM credentials',
  ).all<CredentialRow>();
  // One user, always the same handle: a new passkey for the studio replaces none of the others.
  const userID = new TextEncoder().encode('allenkh-blog-studio');
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: c.env.RP_ID,
    userName: 'allen',
    userDisplayName: 'Allen',
    userID,
    attestationType: 'none',
    supportedAlgorithmIDs: ALGORITHMS,
    excludeCredentials: existing.results.map((row) => ({
      id: row.id,
      transports: JSON.parse(row.transports) as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
}

async function registerCredential(
  c: Ctx,
  challengeId: string,
  purpose: string,
  response: RegistrationResponseJSON,
  label: string,
): Promise<string> {
  const challenge = await takeChallenge(c, challengeId, purpose);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: c.env.ORIGIN,
    expectedRPID: c.env.RP_ID,
    requireUserVerification: true,
    supportedAlgorithmIDs: ALGORITHMS,
  }).catch(() => ({ verified: false as const }));
  if (!verification.verified) throw new HttpError(400, 'That passkey could not be verified');
  const info = verification.registrationInfo;
  await c.env.DB.prepare(
    `INSERT INTO credentials (id, public_key, counter, transports, device_type, backed_up, aaguid,
       label, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      info.credential.id,
      info.credential.publicKey,
      info.credential.counter,
      JSON.stringify(info.credential.transports ?? []),
      info.credentialDeviceType,
      info.credentialBackedUp ? 1 : 0,
      info.aaguid,
      label.trim().slice(0, 60),
      Date.now(),
    )
    .run();
  return info.credential.id;
}

async function signIn(c: Ctx, credentialId: string) {
  const { cookie } = await startSession(c.env.DB, credentialId);
  c.header('Set-Cookie', cookie, { append: true });
}

export const auth = new Hono<ApiContext>();

/** What the studio needs before it shows anything: set up yet? signed in? */
auth.get('/auth/state', async (c) => {
  return c.json({
    setUp: (await passkeyCount(c)) > 0,
    signedIn: c.get('session') !== null,
  });
});

// --- The first passkey ------------------------------------------------------------------------

const setupCode = z.strictObject({ token: z.string().max(200) });

auth.post('/auth/setup/begin', async (c) => {
  await limit(c);
  const { token } = await body(c, setupCode);
  checkSetupCode(c, token);
  if ((await passkeyCount(c)) > 0) throw new HttpError(409, 'The studio already has a passkey');
  const options = await registrationOptions(c);
  return c.json({ challengeId: await saveChallenge(c, options.challenge, 'setup'), options });
});

auth.post('/auth/setup/finish', async (c) => {
  await limit(c);
  const input = await body(
    c,
    z.strictObject({
      token: z.string().max(200),
      challengeId: z.string().max(64),
      response: credentialResponse,
      label: z.string().max(60).default(''),
    }),
  );
  checkSetupCode(c, input.token);
  if ((await passkeyCount(c)) > 0) throw new HttpError(409, 'The studio already has a passkey');
  const id = await registerCredential(
    c,
    input.challengeId,
    'setup',
    input.response as unknown as RegistrationResponseJSON,
    input.label,
  );
  await signIn(c, id);
  return c.json({ ok: true });
});

// --- Signing in ------------------------------------------------------------------------------

auth.post('/auth/login/begin', async (c) => {
  await limit(c);
  if ((await passkeyCount(c)) === 0) throw new HttpError(404, 'No passkeys yet');
  // No list of passkeys: the device offers the ones it has for this site (discoverable).
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: 'required',
  });
  return c.json({ challengeId: await saveChallenge(c, options.challenge, 'login'), options });
});

auth.post('/auth/login/finish', async (c) => {
  await limit(c);
  const input = await body(
    c,
    z.strictObject({ challengeId: z.string().max(64), response: credentialResponse }),
  );
  const response = input.response as unknown as AuthenticationResponseJSON;
  const challenge = await takeChallenge(c, input.challengeId, 'login');
  const row = await c.env.DB.prepare(
    'SELECT id, public_key, counter, transports FROM credentials WHERE id = ?1',
  )
    .bind(response.id)
    .first<CredentialRow>();
  if (!row) throw new HttpError(401, 'That passkey is not registered here');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: c.env.ORIGIN,
    expectedRPID: c.env.RP_ID,
    requireUserVerification: true,
    credential: {
      id: row.id,
      publicKey: new Uint8Array(row.public_key),
      counter: row.counter,
      transports: JSON.parse(row.transports) as AuthenticatorTransport[],
    },
  }).catch(() => ({ verified: false as const, authenticationInfo: undefined }));
  if (!verification.verified || !verification.authenticationInfo) {
    throw new HttpError(401, 'That passkey could not be verified');
  }
  await c.env.DB.prepare('UPDATE credentials SET counter = ?2, last_used_at = ?3 WHERE id = ?1')
    .bind(row.id, verification.authenticationInfo.newCounter, Date.now())
    .run();
  await signIn(c, row.id);
  return c.json({ ok: true });
});

auth.post('/auth/logout', async (c) => {
  c.header('Set-Cookie', await endSession(c.env.DB, c.get('session')), { append: true });
  return c.json({ ok: true });
});

// --- Passkeys, once signed in ----------------------------------------------------------------

auth.get('/studio/passkeys', async (c) => {
  const session = requireSession(c);
  const { results } = await c.env.DB.prepare(
    'SELECT id, label, created_at, last_used_at, backed_up FROM credentials ORDER BY created_at',
  ).all<CredentialRow>();
  return c.json(
    results.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      synced: row.backed_up === 1,
      current: row.id === session.credentialId,
    })),
  );
});

auth.post('/studio/passkeys/begin', async (c) => {
  requireSession(c);
  const options = await registrationOptions(c);
  return c.json({ challengeId: await saveChallenge(c, options.challenge, 'passkey'), options });
});

auth.post('/studio/passkeys/finish', async (c) => {
  requireSession(c);
  const input = await body(
    c,
    z.strictObject({
      challengeId: z.string().max(64),
      response: credentialResponse,
      label: z.string().max(60).default(''),
    }),
  );
  const id = await registerCredential(
    c,
    input.challengeId,
    'passkey',
    input.response as unknown as RegistrationResponseJSON,
    input.label,
  );
  return c.json({ id });
});

auth.patch('/studio/passkeys/:id', async (c) => {
  requireSession(c);
  const { label } = await body(c, z.strictObject({ label: z.string().max(60) }));
  const result = await c.env.DB.prepare('UPDATE credentials SET label = ?2 WHERE id = ?1')
    .bind(c.req.param('id'), label.trim())
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'No such passkey');
  return c.json({ ok: true });
});

auth.delete('/studio/passkeys/:id', async (c) => {
  const session = requireSession(c);
  const id = c.req.param('id');
  if (id === session.credentialId) {
    throw new HttpError(409, 'Sign in with another passkey to remove this one');
  }
  if ((await passkeyCount(c)) <= 1) throw new HttpError(409, 'Keep at least one passkey');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE credential_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM credentials WHERE id = ?1').bind(id),
  ]);
  return c.json({ ok: true });
});
