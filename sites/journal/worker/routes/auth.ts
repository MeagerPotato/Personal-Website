/**
 * Signing in with passkeys, and the sealed key slots.
 *
 * The server's half of docs/journal-crypto.md: it verifies passkeys (WebAuthn, rp.id exactly
 * journal.allenkh.com, user verification required), hands each passkey its PRF salt, and stores
 * the account key's sealed copies. It never sees a PRF output, a passphrase, the recovery phrase
 * or the account key: a request that carries a PRF result is refused outright, because the only
 * way one gets here is a client that forgot to strip it.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationExtensionsClientInputs,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env';
import { HttpError, body } from '../lib/http';
import { endSession, startSession } from '../lib/sessions';
import { base64Url, fromBase64Url, randomToken, sha256Hex, timingSafeEqual } from '../lib/tokens';

const CHALLENGE_MS = 5 * 60 * 1000;
/** ES256 (Apple, Google, most), EdDSA, RS256 (Windows Hello). */
const ALGORITHMS = [-7, -8, -257];
const RP_NAME = "Allen's journal";
const USER_NAME = 'allen';

type Ctx = Context<AppContext>;

const b64url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(8192);

const sealedSlot = z.strictObject({
  id: z.string().regex(/^s_[A-Za-z0-9_-]{8,40}$/),
  kind: z.enum(['passkey', 'passphrase', 'recovery']),
  credentialId: b64url.optional(),
  kdf: z
    .strictObject({
      m: z
        .number()
        .int()
        .min(8)
        .max(1 << 22),
      t: z.number().int().min(1).max(64),
      p: z.number().int().min(1).max(16),
      salt: b64url,
    })
    .optional(),
  akId: z.string().regex(/^ak_[A-Za-z0-9_-]{4,40}$/),
  sealed: b64url.max(256),
  verified: z.boolean().optional(),
});
type SealedSlot = z.infer<typeof sealedSlot>;

// WebAuthn responses are checked in depth by SimpleWebAuthn; this only bounds their shape.
const credentialResponse = z.looseObject({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  response: z.looseObject({}),
  clientExtensionResults: z.looseObject({}).default({}),
});

/** The PRF output must never reach the server (docs/journal-crypto.md, "the one rule"). */
function refusePrfResults(response: { clientExtensionResults?: object }): void {
  const outputs = response.clientExtensionResults as Record<string, unknown> | undefined;
  const prf = outputs?.['prf'] as { results?: unknown } | undefined;
  if (prf && prf.results !== undefined)
    throw new HttpError(400, 'PRF results must stay on the device');
}

async function limit(c: Ctx): Promise<void> {
  const key = c.req.header('cf-connecting-ip') ?? 'local';
  const outcome = await c.env.AUTH_LIMIT?.limit({ key });
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
    throw new HttpError(400, 'That sign-in expired; try again');
  return row.challenge;
}

interface CredentialRow {
  id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string;
  prf_salt: string;
  label: string;
  created_at: number;
  last_used_at: number | null;
  device_type: string | null;
  backed_up: number;
  aaguid: string | null;
}

async function accountExists(c: Ctx): Promise<boolean> {
  return (await c.env.DB.prepare('SELECT 1 AS one FROM account WHERE id = 1').first()) !== null;
}

async function registrationOptions(c: Ctx, userHandle: Uint8Array<ArrayBuffer>, prfSalt: string) {
  const existing = await c.env.DB.prepare(
    'SELECT id, transports FROM credentials',
  ).all<CredentialRow>();
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: c.env.RP_ID,
    userName: USER_NAME,
    userDisplayName: 'Allen',
    userID: userHandle,
    attestationType: 'none',
    supportedAlgorithmIDs: ALGORITHMS,
    excludeCredentials: existing.results.map((row) => ({
      id: row.id,
      transports: JSON.parse(row.transports) as string[],
    })),
    authenticatorSelection: {
      // This device's own authenticator (iCloud Keychain, Windows Hello): PRF over the QR
      // cross-device flow is not trustworthy (docs/journal-crypto.md).
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    // The salt goes out as base64url; the client turns it into bytes before create().
    extensions: {
      prf: { eval: { first: prfSalt } },
    } as unknown as AuthenticationExtensionsClientInputs,
  });
}

/** Verifies a new passkey and stores it. Returns its id and PRF salt. */
async function registerCredential(
  c: Ctx,
  challengeId: string,
  purpose: string,
  response: RegistrationResponseJSON,
  label: string,
): Promise<{ credentialId: string; prfSalt: string; statements: D1PreparedStatement[] }> {
  refusePrfResults(response);
  const [challenge, prfSalt] = (await takeChallenge(c, challengeId, purpose)).split('.') as [
    string,
    string,
  ];
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
  const now = Date.now();
  const statement = c.env.DB.prepare(
    `INSERT INTO credentials (id, public_key, counter, transports, device_type, backed_up, aaguid,
       label, prf_salt, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(
    info.credential.id,
    info.credential.publicKey,
    info.credential.counter,
    JSON.stringify(info.credential.transports ?? []),
    info.credentialDeviceType,
    info.credentialBackedUp ? 1 : 0,
    info.aaguid,
    label.slice(0, 60),
    prfSalt,
    now,
  );
  return { credentialId: info.credential.id, prfSalt, statements: [statement] };
}

function slotStatement(c: Ctx, slot: SealedSlot): D1PreparedStatement {
  return c.env.DB.prepare(
    `INSERT INTO slots (id, kind, credential_id, kdf, ak_id, sealed, created_at, verified_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (id) DO UPDATE SET sealed = excluded.sealed, kdf = excluded.kdf,
       verified_at = excluded.verified_at`,
  ).bind(
    slot.id,
    slot.kind,
    slot.credentialId ?? null,
    slot.kdf ? JSON.stringify(slot.kdf) : null,
    slot.akId,
    slot.sealed,
    Date.now(),
    slot.verified ? Date.now() : null,
  );
}

interface SlotRow {
  id: string;
  kind: SealedSlot['kind'];
  credential_id: string | null;
  kdf: string | null;
  ak_id: string;
  sealed: string;
  created_at: number;
  verified_at: number | null;
}

async function listSlots(c: Ctx) {
  const rows = await c.env.DB.prepare(
    'SELECT id, kind, credential_id, kdf, ak_id, sealed, created_at, verified_at FROM slots',
  ).all<SlotRow>();
  return rows.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    credentialId: row.credential_id,
    kdf: row.kdf ? (JSON.parse(row.kdf) as SealedSlot['kdf']) : null,
    akId: row.ak_id,
    sealed: row.sealed,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  }));
}

function requireSession(c: Ctx, scopes: readonly ('full' | 'enroll')[] = ['full']) {
  const session = c.get('session');
  if (!session) throw new HttpError(401, 'Sign in first');
  if (!scopes.includes(session.scope)) throw new HttpError(403, 'Sign in with a passkey first');
  return session;
}

export const auth = new Hono<AppContext>();

/** What a device needs to know before showing anything: set up yet? signed in? */
auth.get('/state', async (c) => {
  const session = c.get('session');
  return c.json({
    account: await accountExists(c),
    session: session ? { scope: session.scope, credentialId: session.credentialId } : null,
    rpId: c.env.RP_ID,
  });
});

// --- First run -------------------------------------------------------------------------------

auth.post('/setup/begin', async (c) => {
  await limit(c);
  const { token } = await body(c, z.strictObject({ token: z.string().max(200) }));
  if (!c.env.SETUP_TOKEN) throw new HttpError(403, 'Setup is switched off (no SETUP_TOKEN)');
  if (!timingSafeEqual(token.trim(), c.env.SETUP_TOKEN))
    throw new HttpError(403, 'Wrong setup code');
  if (await accountExists(c)) throw new HttpError(409, 'This journal is already set up');

  const userHandle = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = randomToken(32);
  const options = await registrationOptions(c, userHandle, prfSalt);
  const challengeId = await saveChallenge(
    c,
    `${options.challenge}.${prfSalt}`,
    `setup:${base64Url(userHandle)}`,
  );
  return c.json({ challengeId, options, prfSalt });
});

auth.post('/setup/finish', async (c) => {
  await limit(c);
  const input = await body(
    c,
    z.strictObject({
      token: z.string().max(200),
      challengeId: z.string().max(64),
      userHandle: b64url.max(64),
      response: credentialResponse,
      label: z.string().max(60).default(''),
      recovery: sealedSlot,
      recoveryAuth: b64url.max(64),
      passphrase: sealedSlot.optional(),
    }),
  );
  if (!c.env.SETUP_TOKEN || !timingSafeEqual(input.token.trim(), c.env.SETUP_TOKEN)) {
    throw new HttpError(403, 'Wrong setup code');
  }
  if (await accountExists(c)) throw new HttpError(409, 'This journal is already set up');
  if (
    input.recovery.kind !== 'recovery' ||
    (input.passphrase && input.passphrase.kind !== 'passphrase')
  ) {
    throw new HttpError(400, 'Malformed key slots');
  }

  const registered = await registerCredential(
    c,
    input.challengeId,
    `setup:${input.userHandle}`,
    input.response as unknown as RegistrationResponseJSON,
    input.label,
  );
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO account (id, user_handle, recovery_auth_hash, created_at) VALUES (1, ?1, ?2, ?3)',
    ).bind(input.userHandle, await sha256Hex(input.recoveryAuth), Date.now()),
    ...registered.statements,
    slotStatement(c, input.recovery),
    ...(input.passphrase ? [slotStatement(c, input.passphrase)] : []),
  ];
  await c.env.DB.batch(statements);
  await startSession(c, registered.credentialId, 'full');
  return c.json({ credentialId: registered.credentialId, prfSalt: registered.prfSalt });
});

// --- Signing in --------------------------------------------------------------------------------

auth.post('/login/begin', async (c) => {
  await limit(c);
  const credentials = await c.env.DB.prepare(
    'SELECT id, transports, prf_salt FROM credentials',
  ).all<Pick<CredentialRow, 'id' | 'transports' | 'prf_salt'>>();
  if (credentials.results.length === 0) throw new HttpError(404, 'No passkeys yet');
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: 'required',
    allowCredentials: credentials.results.map((row) => ({
      id: row.id,
      transports: JSON.parse(row.transports) as AuthenticatorTransport[],
    })),
  });
  const challengeId = await saveChallenge(c, options.challenge, 'login');
  const prf = Object.fromEntries(credentials.results.map((row) => [row.id, row.prf_salt]));
  return c.json({ challengeId, options, prf });
});

auth.post('/login/finish', async (c) => {
  await limit(c);
  const input = await body(
    c,
    z.strictObject({ challengeId: z.string().max(64), response: credentialResponse }),
  );
  const response = input.response as unknown as AuthenticationResponseJSON;
  refusePrfResults(response);
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
  await startSession(c, row.id, 'full');
  return c.json({ credentialId: row.id, slots: await listSlots(c) });
});

/** Lost every passkey: the recovery phrase proves who you are, for long enough to add one. */
auth.post('/recover', async (c) => {
  await limit(c);
  const { recoveryAuth } = await body(c, z.strictObject({ recoveryAuth: b64url.max(64) }));
  const account = await c.env.DB.prepare(
    'SELECT recovery_auth_hash FROM account WHERE id = 1',
  ).first<{
    recovery_auth_hash: string | null;
  }>();
  const expected = account?.recovery_auth_hash;
  if (!expected || !timingSafeEqual(await sha256Hex(recoveryAuth), expected)) {
    throw new HttpError(401, 'That recovery phrase does not match');
  }
  await startSession(c, null, 'enroll');
  return c.json({ slots: (await listSlots(c)).filter((slot) => slot.kind === 'recovery') });
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// --- Passkeys ----------------------------------------------------------------------------------

auth.post('/credentials/begin', async (c) => {
  requireSession(c, ['full', 'enroll']);
  const account = await c.env.DB.prepare('SELECT user_handle FROM account WHERE id = 1').first<{
    user_handle: string;
  }>();
  if (!account) throw new HttpError(404, 'Not set up');
  const prfSalt = randomToken(32);
  const options = await registrationOptions(c, fromBase64Url(account.user_handle), prfSalt);
  const challengeId = await saveChallenge(c, `${options.challenge}.${prfSalt}`, 'credential');
  return c.json({ challengeId, options, prfSalt });
});

auth.post('/credentials/finish', async (c) => {
  const session = requireSession(c, ['full', 'enroll']);
  const input = await body(
    c,
    z.strictObject({
      challengeId: z.string().max(64),
      response: credentialResponse,
      label: z.string().max(60).default(''),
    }),
  );
  const registered = await registerCredential(
    c,
    input.challengeId,
    'credential',
    input.response as unknown as RegistrationResponseJSON,
    input.label,
  );
  await c.env.DB.batch(registered.statements);
  // A recovery session ends here: the new passkey signs in properly from now on.
  if (session.scope === 'enroll') await endSession(c);
  return c.json({ credentialId: registered.credentialId, prfSalt: registered.prfSalt });
});

auth.get('/credentials', async (c) => {
  requireSession(c);
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.label, c.created_at, c.last_used_at, c.device_type, c.backed_up, c.aaguid,
       EXISTS (SELECT 1 FROM slots s WHERE s.credential_id = c.id) AS has_slot
     FROM credentials c ORDER BY c.created_at`,
  ).all<CredentialRow & { has_slot: number }>();
  return c.json(
    rows.results.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      synced: row.backed_up === 1,
      aaguid: row.aaguid,
      unlocks: row.has_slot === 1,
    })),
  );
});

auth.patch('/credentials/:id', async (c) => {
  requireSession(c);
  const { label } = await body(c, z.strictObject({ label: z.string().max(60) }));
  await c.env.DB.prepare('UPDATE credentials SET label = ?2 WHERE id = ?1')
    .bind(c.req.param('id'), label)
    .run();
  return c.json({ ok: true });
});

auth.delete('/credentials/:id', async (c) => {
  const session = requireSession(c);
  const id = c.req.param('id');
  if (id === session.credentialId)
    throw new HttpError(409, 'Sign in with another passkey to remove this one');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM credentials').first<{
    n: number;
  }>();
  if ((count?.n ?? 0) <= 1) throw new HttpError(409, 'Keep at least one passkey');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM slots WHERE credential_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM credentials WHERE id = ?1').bind(id),
  ]);
  return c.json({ ok: true });
});

// --- Key slots ---------------------------------------------------------------------------------

auth.get('/slots', async (c) => {
  requireSession(c, ['full', 'enroll']);
  return c.json(await listSlots(c));
});

auth.put('/slots/:id', async (c) => {
  const session = requireSession(c, ['full', 'enroll']);
  const slot = await body(c, sealedSlot);
  if (slot.id !== c.req.param('id')) throw new HttpError(400, 'Slot id mismatch');
  if (slot.kind === 'passkey') {
    if (!slot.credentialId) throw new HttpError(400, 'A passkey slot names its passkey');
    const exists = await c.env.DB.prepare('SELECT 1 AS one FROM credentials WHERE id = ?1')
      .bind(slot.credentialId)
      .first();
    if (!exists) throw new HttpError(404, 'No such passkey');
  }
  if (slot.kind === 'passphrase' && !slot.kdf)
    throw new HttpError(400, 'A passphrase slot names its cost');
  // A recovery session may only add passkey slots; replacing the recovery phrase needs a passkey.
  if (session.scope === 'enroll' && slot.kind !== 'passkey')
    throw new HttpError(403, 'Sign in with a passkey first');
  await slotStatement(c, slot).run();
  return c.json({ ok: true });
});

auth.delete('/slots/:id', async (c) => {
  requireSession(c);
  const slot = await c.env.DB.prepare('SELECT kind FROM slots WHERE id = ?1')
    .bind(c.req.param('id'))
    .first<{ kind: SealedSlot['kind'] }>();
  if (!slot) throw new HttpError(404, 'No such slot');
  if (slot.kind === 'recovery')
    throw new HttpError(409, 'Replace the recovery phrase instead of deleting it');
  await c.env.DB.prepare('DELETE FROM slots WHERE id = ?1').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Replacing the recovery phrase: the new slot and the new proof, together. */
auth.post('/recovery/replace', async (c) => {
  requireSession(c);
  const input = await body(c, z.strictObject({ slot: sealedSlot, recoveryAuth: b64url.max(64) }));
  if (input.slot.kind !== 'recovery') throw new HttpError(400, 'Not a recovery slot');
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM slots WHERE kind = 'recovery' AND id <> ?1").bind(input.slot.id),
    slotStatement(c, input.slot),
    c.env.DB.prepare('UPDATE account SET recovery_auth_hash = ?1 WHERE id = 1').bind(
      await sha256Hex(input.recoveryAuth),
    ),
  ]);
  return c.json({ ok: true });
});
