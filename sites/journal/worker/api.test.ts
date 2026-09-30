/**
 * The journal API end to end, against a real (local) D1 and R2 from Miniflare, with a software
 * passkey signing real WebAuthn responses: setup, sign-in, recovery, sync conflicts, files, and
 * the rules that keep secrets on the device.
 */
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toBase64Url } from '../src/vault/bytes';
import {
  kekFromPrf,
  kekFromRecovery,
  newAccountKey,
  openAccountKey,
  recoveryAuth,
  sealAccountKey,
} from '../src/vault/keys';
import { newRecoveryPhrase, recoveryEntropy } from '../src/vault/recovery';
import type { Env } from './env';
import { app } from './index';
import { SoftAuthenticator } from './test/authenticator';

const ORIGIN = 'http://localhost:5173';
const RP_ID = 'localhost';
const SETUP_TOKEN = 'orbit-ladder-velvet';

// Local D1 and R2 exactly as  gets them, from wrangler.jsonc, in memory only.
const platform = await getPlatformProxy<{ DB: D1Database; BLOBS: R2Bucket }>({
  configPath: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url).href),
  persist: false,
  remoteBindings: false,
  envFiles: [],
});
afterAll(() => platform.dispose());

type Body = Record<string, unknown>;

/** One device: its own cookie jar. */
class Device {
  cookie = '';
  constructor(private readonly env: Env) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { ...headers } };
    if (method !== 'GET' && method !== 'HEAD')
      (init.headers as Record<string, string>)['origin'] ??= ORIGIN;
    if (this.cookie) (init.headers as Record<string, string>)['cookie'] = this.cookie;
    if (body instanceof Uint8Array) {
      init.body = body;
      (init.headers as Record<string, string>)['content-length'] = String(body.length);
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
    const response = await app.fetch(new Request(`${ORIGIN}/api${path}`, init), this.env, {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.startsWith('__Host-sid=')) {
      const value = setCookie.split(';')[0] ?? '';
      this.cookie = value === '__Host-sid=' ? '' : value;
    }
    return response;
  }

  async json(method: string, path: string, body?: unknown) {
    const response = await this.call(method, path, body);
    return { status: response.status, body: (await response.json()) as Body, response };
  }
}

async function freshEnv(): Promise<Env> {
  const DB = platform.env.DB;
  // A clean journal per test: empty every table the migrations made (the schema stays, as the
  // Worker remembers per isolate that it has migrated).
  const tables = await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();
  for (const { name } of tables.results) {
    if (name !== 'schema') await DB.prepare(`DELETE FROM "${name}"`).run();
  }
  return {
    DB,
    BLOBS: platform.env.BLOBS,
    RP_ID,
    ORIGIN,
    SETUP_TOKEN,
  } as Env;
}

/** Setup as the app does it: passkey, recovery phrase, then the passkey's own slot. */
async function setUp(env: Env) {
  const device = new Device(env);
  const passkey = new SoftAuthenticator(RP_ID, ORIGIN);
  const begin = await device.json('POST', '/setup/begin', { token: SETUP_TOKEN });
  expect(begin.status).toBe(200);
  const options = begin.body['options'] as Body;
  const registration = await passkey.register(options);

  const ak = newAccountKey();
  const phrase = newRecoveryPhrase();
  const entropy = recoveryEntropy(phrase);
  const recoverySlotId = `s_${toBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const recoveryRef = { kind: 'recovery' as const, slotId: recoverySlotId, akId: ak.akId };
  const finish = await device.json('POST', '/setup/finish', {
    token: SETUP_TOKEN,
    challengeId: begin.body['challengeId'],
    userHandle: (options['user'] as Body)['id'],
    response: registration,
    label: 'iPhone',
    recovery: {
      id: recoverySlotId,
      kind: 'recovery',
      akId: ak.akId,
      sealed: await sealAccountKey(ak.raw, await kekFromRecovery(entropy), recoveryRef),
    },
    recoveryAuth: await recoveryAuth(entropy),
  });
  expect(finish.status).toBe(200);
  const credentialId = finish.body['credentialId'] as string;

  const prf = crypto.getRandomValues(new Uint8Array(32));
  const passkeySlotId = `s_${toBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const passkeySlot = { kind: 'passkey' as const, slotId: passkeySlotId, akId: ak.akId };
  const put = await device.json('PUT', `/slots/${passkeySlotId}`, {
    id: passkeySlotId,
    kind: 'passkey',
    akId: ak.akId,
    credentialId,
    sealed: await sealAccountKey(ak.raw, await kekFromPrf(prf, credentialId), passkeySlot),
    verified: true,
  });
  expect(put.status).toBe(200);
  return { device, passkey, ak, phrase, prf, credentialId, passkeySlot };
}

async function signIn(env: Env, passkey: SoftAuthenticator, options: { leakPrf?: boolean } = {}) {
  const device = new Device(env);
  const begin = await device.json('POST', '/login/begin');
  const assertion = await passkey.assert(begin.body['options'] as Body, options);
  const finish = await device.json('POST', '/login/finish', {
    challengeId: begin.body['challengeId'],
    response: assertion,
  });
  return { device, begin, finish };
}

let env: Env;
beforeEach(async () => {
  env = await freshEnv();
});

describe('setup', () => {
  it('starts empty, and asks for the setup code', async () => {
    const device = new Device(env);
    const state = await device.json('GET', '/state');
    expect(state.body).toMatchObject({ account: false, session: null, rpId: RP_ID });

    const wrong = await device.json('POST', '/setup/begin', { token: 'guess' });
    expect(wrong.status).toBe(403);
  });

  it('is refused entirely when no setup code is configured', async () => {
    const device = new Device({ ...env, SETUP_TOKEN: undefined });
    expect((await device.json('POST', '/setup/begin', { token: '' })).status).toBe(403);
  });

  it('offers a platform passkey with user verification and a PRF salt, scoped to this host', async () => {
    const device = new Device(env);
    const begin = await device.json('POST', '/setup/begin', { token: SETUP_TOKEN });
    const options = begin.body['options'] as Body;
    expect((options['rp'] as Body)['id']).toBe(RP_ID);
    expect(options['authenticatorSelection']).toMatchObject({
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    });
    const salt = begin.body['prfSalt'] as string;
    expect(salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(options['extensions']).toMatchObject({ prf: { eval: { first: salt } } });
  });

  it('creates the account, signs the device in, and happens only once', async () => {
    const { device } = await setUp(env);
    const state = await device.json('GET', '/state');
    expect(state.body['account']).toBe(true);
    expect((state.body['session'] as Body)['scope']).toBe('full');

    const again = await new Device(env).json('POST', '/setup/begin', { token: SETUP_TOKEN });
    expect(again.status).toBe(409);
  });

  it('sets a __Host- cookie that is Secure, HttpOnly and SameSite=Strict', async () => {
    const { passkey } = await setUp(env);
    const { finish } = await signIn(env, passkey);
    const cookie = finish.response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
  });
});

describe('signing in', () => {
  it('works with the passkey, and hands back the sealed slots, which open with its PRF', async () => {
    const { passkey, prf, credentialId, ak } = await setUp(env);
    const { finish } = await signIn(env, passkey);
    expect(finish.status).toBe(200);
    expect(finish.body['credentialId']).toBe(credentialId);
    const slots = finish.body['slots'] as Body[];
    expect(slots.map((slot) => slot['kind']).sort()).toEqual(['passkey', 'recovery']);

    const mine = slots.find((slot) => slot['credentialId'] === credentialId) as Body;
    const keys = await openAccountKey(
      mine['sealed'] as string,
      await kekFromPrf(prf, credentialId),
      {
        kind: 'passkey',
        slotId: mine['id'] as string,
        akId: ak.akId,
      },
    );
    expect(keys.akId).toBe(ak.akId);
  });

  it('gives each passkey its PRF salt when signing in', async () => {
    const { passkey, credentialId } = await setUp(env);
    const begin = await new Device(env).json('POST', '/login/begin');
    const options = begin.body['options'] as Body;
    expect(options['rpId']).toBe(RP_ID);
    expect(options['userVerification']).toBe('required');
    expect(Object.keys(begin.body['prf'] as Body)).toEqual([credentialId]);
    expect(passkey.id).toBe(credentialId);
  });

  it('refuses a response that carries the PRF output', async () => {
    const { passkey } = await setUp(env);
    const { finish } = await signIn(env, passkey, { leakPrf: true });
    expect(finish.status).toBe(400);
    expect(finish.body['error']).toMatch(/PRF/);
  });

  it('uses each challenge once', async () => {
    const { passkey } = await setUp(env);
    const device = new Device(env);
    const begin = await device.json('POST', '/login/begin');
    const assertion = await passkey.assert(begin.body['options'] as Body);
    const first = await device.json('POST', '/login/finish', {
      challengeId: begin.body['challengeId'],
      response: assertion,
    });
    expect(first.status).toBe(200);
    const replay = await new Device(env).json('POST', '/login/finish', {
      challengeId: begin.body['challengeId'],
      response: assertion,
    });
    expect(replay.status).toBe(400);
  });

  it('refuses a passkey used from another origin', async () => {
    const { passkey } = await setUp(env);
    const device = new Device(env);
    const begin = await device.json('POST', '/login/begin');
    const assertion = await passkey.assert(begin.body['options'] as Body, {
      origin: 'https://days2meet.allenkh.com',
    });
    const finish = await device.json('POST', '/login/finish', {
      challengeId: begin.body['challengeId'],
      response: assertion,
    });
    expect(finish.status).toBe(401);
  });

  it('refuses a stranger passkey', async () => {
    await setUp(env);
    const stranger = new SoftAuthenticator(RP_ID, ORIGIN);
    await stranger.register({ challenge: 'x' });
    const { finish } = await signIn(env, stranger);
    expect(finish.status).toBe(401);
  });

  it('refuses writes that come from another origin, even with a session', async () => {
    const { device } = await setUp(env);
    const response = await device.call(
      'POST',
      '/sync',
      { changes: [] },
      { origin: 'https://fishai.allenkh.com' },
    );
    expect(response.status).toBe(403);
  });

  it('signs out', async () => {
    const { device } = await setUp(env);
    await device.json('POST', '/logout');
    expect((await device.json('GET', '/state')).body['session']).toBeNull();
  });

  it('forgets a session after an hour without use', async () => {
    const { device } = await setUp(env);
    await env.DB.prepare('UPDATE sessions SET last_seen_at = last_seen_at - 3700000').run();
    expect((await device.json('GET', '/state')).body['session']).toBeNull();
  });
});

describe('recovery', () => {
  it('lets the recovery phrase register a new passkey, and nothing else', async () => {
    const { phrase } = await setUp(env);
    const device = new Device(env);
    const wrong = await device.json('POST', '/recover', {
      recoveryAuth: await recoveryAuth(recoveryEntropy(newRecoveryPhrase())),
    });
    expect(wrong.status).toBe(401);

    const recovered = await device.json('POST', '/recover', {
      recoveryAuth: await recoveryAuth(recoveryEntropy(phrase)),
    });
    expect(recovered.status).toBe(200);
    expect((recovered.body['slots'] as Body[]).map((slot) => slot['kind'])).toEqual(['recovery']);

    // Enough to add a passkey, not enough to read or write the journal.
    expect((await device.json('GET', '/sync?since=0')).status).toBe(401);
    const begin = await device.json('POST', '/credentials/begin');
    expect(begin.status).toBe(200);
    const replacement = new SoftAuthenticator(RP_ID, ORIGIN);
    const finish = await device.json('POST', '/credentials/finish', {
      challengeId: begin.body['challengeId'],
      response: await replacement.register(begin.body['options'] as Body),
      label: 'New iPhone',
    });
    expect(finish.status).toBe(200);
    expect((await signIn(env, replacement)).finish.status).toBe(200);
  });
});

describe('sync', () => {
  const sealed = (n: number) => toBase64Url(new Uint8Array(300).fill(n));

  it('writes new records, and every device pulls them in order', async () => {
    const { device } = await setUp(env);
    const push = await device.json('POST', '/sync', {
      changes: [
        { id: 'k_aaaaaaaaaaaaaaaaaaaaaa', baseRev: 0, sealed: sealed(1) },
        { id: 'r_bbbbbbbbbbbbbbbbbbbbbb', baseRev: 0, sealed: sealed(2) },
      ],
    });
    expect(push.body['results']).toEqual([
      { id: 'k_aaaaaaaaaaaaaaaaaaaaaa', ok: true, rev: 1, seq: 1 },
      { id: 'r_bbbbbbbbbbbbbbbbbbbbbb', ok: true, rev: 1, seq: 2 },
    ]);
    const pull = await device.json('GET', '/sync?since=0');
    expect(pull.body['cursor']).toBe(2);
    expect((pull.body['changes'] as Body[]).map((change) => change['id'])).toEqual([
      'k_aaaaaaaaaaaaaaaaaaaaaa',
      'r_bbbbbbbbbbbbbbbbbbbbbb',
    ]);
    const nothingNew = await device.json('GET', '/sync?since=2');
    expect(nothingNew.body).toMatchObject({ changes: [], cursor: 2, more: false });
  });

  it('turns a stale write into a conflict that carries what is there now', async () => {
    const { device } = await setUp(env);
    const id = 'k_cccccccccccccccccccccc';
    await device.json('POST', '/sync', { changes: [{ id, baseRev: 0, sealed: sealed(1) }] });
    const phone = await device.json('POST', '/sync', {
      changes: [{ id, baseRev: 1, sealed: sealed(2) }],
    });
    expect(phone.body['results']).toEqual([{ id, ok: true, rev: 2, seq: 2 }]);

    // The laptop still thinks the record is at rev 1.
    const laptop = await device.json('POST', '/sync', {
      changes: [{ id, baseRev: 1, sealed: sealed(3) }],
    });
    expect(laptop.body['results']).toEqual([
      { id, ok: false, current: { id, rev: 2, seq: 2, sealed: sealed(2) } },
    ]);
    // Two devices creating the same day offline: the second create conflicts too.
    const again = await device.json('POST', '/sync', {
      changes: [{ id, baseRev: 0, sealed: sealed(4) }],
    });
    expect((again.body['results'] as Body[])[0]?.['ok']).toBe(false);
  });

  it('keeps a deletion as a tombstone that other devices pull', async () => {
    const { device } = await setUp(env);
    const id = 'r_dddddddddddddddddddddd';
    await device.json('POST', '/sync', { changes: [{ id, baseRev: 0, sealed: sealed(1) }] });
    await device.json('POST', '/sync', { changes: [{ id, baseRev: 1, sealed: null }] });
    const pull = await device.json('GET', '/sync?since=1');
    expect(pull.body['changes']).toEqual([{ id, rev: 2, seq: 2, sealed: null }]);
  });

  it('pages a long history', async () => {
    const { device } = await setUp(env);
    for (let batch = 0; batch < 6; batch += 1) {
      await device.json('POST', '/sync', {
        changes: Array.from({ length: 100 }, (_, i) => ({
          id: `r_${String(batch * 100 + i).padStart(22, '0')}`,
          baseRev: 0,
          sealed: sealed(i % 255),
        })),
      });
    }
    const first = await device.json('GET', '/sync?since=0');
    expect((first.body['changes'] as Body[]).length).toBe(500);
    expect(first.body['more']).toBe(true);
    const second = await device.json('GET', `/sync?since=${first.body['cursor']}`);
    expect((second.body['changes'] as Body[]).length).toBe(100);
    expect(second.body['more']).toBe(false);
  });

  it('refuses malformed changes and is closed without a session', async () => {
    const { device } = await setUp(env);
    expect(
      (await device.json('POST', '/sync', { changes: [{ id: 'nope', baseRev: 0, sealed: 'x' }] }))
        .status,
    ).toBe(400);
    expect((await new Device(env).json('GET', '/sync?since=0')).status).toBe(401);
  });
});

describe('files', () => {
  it('stores, lists, returns and deletes a sealed file', async () => {
    const { device } = await setUp(env);
    const id = `b_${toBase64Url(crypto.getRandomValues(new Uint8Array(16)))}`;
    const bytes = crypto.getRandomValues(new Uint8Array(5000));
    expect((await device.call('PUT', `/blobs/${id}`, bytes)).status).toBe(201);

    const got = await device.call('GET', `/blobs/${id}`);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect(got.headers.get('cache-control')).toMatch(/private/);

    const list = await device.json('GET', '/blobs');
    expect(list.body).toEqual([{ id, size: 5000, createdAt: expect.any(Number) }]);

    expect((await device.call('DELETE', `/blobs/${id}`)).status).toBe(200);
    expect((await device.call('GET', `/blobs/${id}`)).status).toBe(404);
  });

  it('are closed without a session', async () => {
    await setUp(env);
    expect((await new Device(env).call('GET', '/blobs')).status).toBe(401);
  });
});

describe('every API answer', () => {
  it('is never cached', async () => {
    const response = await new Device(env).call('GET', '/state');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
