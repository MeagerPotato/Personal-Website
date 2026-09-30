/**
 * The journal API end to end, against a real (local) D1 and R2 from Miniflare, with a software
 * passkey signing real WebAuthn responses: setup, sign-in, recovery, sync conflicts, files, and
 * the rules that keep secrets on the device.
 */
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { sendReminders } from './lib/push';
import { fromBase64Url } from './lib/tokens';
import { SoftAuthenticator } from '@allenkh/testing/passkey';

const ORIGIN = 'http://localhost:5173';
const RP_ID = 'localhost';
const SETUP_TOKEN = 'orbit-ladder-velvet';

// Local D1 and R2 exactly as `wrangler dev` gets them, from wrangler.jsonc, in memory only.
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

describe('passkeys', () => {
  it('removes one, and signs out at once every device it signed in', async () => {
    const { device: phone, credentialId: phoneKey } = await setUp(env);
    // A second passkey, a laptop's, added from the phone and then signed in with.
    const begin = await phone.json('POST', '/credentials/begin');
    const laptopPasskey = new SoftAuthenticator(RP_ID, ORIGIN);
    const added = await phone.json('POST', '/credentials/finish', {
      challengeId: begin.body['challengeId'],
      response: await laptopPasskey.register(begin.body['options'] as Body),
      label: 'Mac',
    });
    expect(added.status).toBe(200);
    const { device: laptop } = await signIn(env, laptopPasskey);
    expect((await laptop.json('GET', '/sync?since=0')).status).toBe(200);

    // Not the passkey this device signed in with...
    expect((await phone.json('DELETE', `/credentials/${phoneKey}`)).status).toBe(409);
    // ...but the laptop's (the laptop was lost): its session ends with it, and it signs in no more.
    const laptopKey = added.body['credentialId'] as string;
    expect((await phone.json('DELETE', `/credentials/${laptopKey}`)).status).toBe(200);
    expect((await laptop.json('GET', '/sync?since=0')).status).toBe(401);
    expect((await signIn(env, laptopPasskey)).finish.status).toBe(401);
    expect((await phone.json('GET', '/sync?since=0')).status).toBe(200);
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
      { id: 'k_aaaaaaaaaaaaaaaaaaaaaa', ok: true, rev: 1, seq: expect.any(Number) },
      { id: 'r_bbbbbbbbbbbbbbbbbbbbbb', ok: true, rev: 1, seq: expect.any(Number) },
    ]);
    const [first, second] = (push.body['results'] as Body[]).map((result) => result['seq']);
    expect(second).toBeGreaterThan(first as number);
    const pull = await device.json('GET', '/sync?since=0');
    expect(pull.body['cursor']).toBe(second);
    expect((pull.body['changes'] as Body[]).map((change) => change['id'])).toEqual([
      'k_aaaaaaaaaaaaaaaaaaaaaa',
      'r_bbbbbbbbbbbbbbbbbbbbbb',
    ]);
    const nothingNew = await device.json('GET', `/sync?since=${second}`);
    expect(nothingNew.body).toMatchObject({ changes: [], cursor: second, more: false });
  });

  it('numbers on from the clock, so a restored database numbers past every cursor', async () => {
    const { device } = await setUp(env);
    const write = async (id: string): Promise<number> => {
      const push = await device.json('POST', '/sync', {
        changes: [{ id, baseRev: 0, sealed: sealed(1) }],
      });
      return (push.body['results'] as Body[])[0]?.['seq'] as number;
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = Date.now();
      expect(await write('r_aaaaaaaaaaaaaaaaaaaaaa')).toBe(start * 1000);
      const lost = await write('r_bbbbbbbbbbbbbbbbbbbbbb');
      expect(lost).toBe(start * 1000 + 1); // the same millisecond: one past the last
      // Minutes later the database is restored to before that write (D1 Time Travel), after a
      // device had pulled it: its cursor is `lost`.
      await env.DB.prepare('DELETE FROM records WHERE id = ?1')
        .bind('r_bbbbbbbbbbbbbbbbbbbbbb')
        .run();
      vi.setSystemTime(start + 5 * 60_000);
      // The next write numbers past that cursor all the same, so the device pulls it.
      expect(await write('r_cccccccccccccccccccccc')).toBeGreaterThan(lost);
      const pull = await device.json('GET', `/sync?since=${lost}`);
      expect((pull.body['changes'] as Body[]).map((change) => change['id'])).toEqual([
        'r_cccccccccccccccccccccc',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a stale write into a conflict that carries what is there now', async () => {
    const { device } = await setUp(env);
    const id = 'k_cccccccccccccccccccccc';
    await device.json('POST', '/sync', { changes: [{ id, baseRev: 0, sealed: sealed(1) }] });
    const phone = await device.json('POST', '/sync', {
      changes: [{ id, baseRev: 1, sealed: sealed(2) }],
    });
    expect(phone.body['results']).toEqual([{ id, ok: true, rev: 2, seq: expect.any(Number) }]);
    const seq = (phone.body['results'] as Body[])[0]?.['seq'];

    // The laptop still thinks the record is at rev 1; the new one in the same push lands.
    const other = 'r_eeeeeeeeeeeeeeeeeeeeee';
    const laptop = await device.json('POST', '/sync', {
      changes: [
        { id, baseRev: 1, sealed: sealed(3) },
        { id: other, baseRev: 0, sealed: sealed(5) },
      ],
    });
    expect(laptop.body['results']).toEqual([
      { id, ok: false, current: { id, rev: 2, seq, sealed: sealed(2) } },
      { id: other, ok: true, rev: 1, seq: expect.any(Number) },
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
    const made = await device.json('POST', '/sync', {
      changes: [{ id, baseRev: 0, sealed: sealed(1) }],
    });
    await device.json('POST', '/sync', { changes: [{ id, baseRev: 1, sealed: null }] });
    const since = (made.body['results'] as Body[])[0]?.['seq'] as number;
    const pull = await device.json('GET', `/sync?since=${since}`);
    expect(pull.body['changes']).toEqual([{ id, rev: 2, seq: expect.any(Number), sealed: null }]);
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

describe('the daily reminder', () => {
  const ENDPOINT = 'https://push.example.test/send/device-1';
  // Far from the day the tests run: turning a reminder on looks at the real clock.
  const EVENING = new Date('2031-03-10T21:00:00Z');
  const later = (minutes: number) => new Date(EVENING.getTime() + minutes * 60_000);

  /** A push service that records what it is sent and answers with `status`. */
  function pushService(status = 201) {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(null, { status });
    }) as typeof fetch;
    return { sent, fetcher };
  }

  async function withReminder(remindAt = '21:00', timeZone = 'UTC') {
    const { device } = await setUp(env);
    const put = await device.json('PUT', '/push', { endpoint: ENDPOINT, remindAt, timeZone });
    expect(put.status).toBe(200);
    return device;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('is closed without a session', async () => {
    await setUp(env);
    const stranger = new Device(env);
    expect((await stranger.call('GET', '/push')).status).toBe(401);
    const put = { endpoint: ENDPOINT, remindAt: '21:00', timeZone: 'UTC' };
    expect((await stranger.call('PUT', '/push', put)).status).toBe(401);
  });

  it('hands out one VAPID key, and keeps each device’s time', async () => {
    const device = await withReminder('21:30', 'America/Los_Angeles');
    const first = await device.json('GET', '/push');
    const key = fromBase64Url(first.body['publicKey'] as string);
    expect(key.length).toBe(65); // an uncompressed P-256 point
    expect(key[0]).toBe(4);
    expect(first.body['devices']).toEqual([
      { endpoint: ENDPOINT, remindAt: '21:30', timeZone: 'America/Los_Angeles' },
    ]);
    expect((await device.json('GET', '/push')).body['publicKey']).toBe(first.body['publicKey']);
  });

  it('refuses what is not a push address, a time or a time zone', async () => {
    const { device } = await setUp(env);
    const good = { endpoint: ENDPOINT, remindAt: '21:00', timeZone: 'UTC' };
    for (const bad of [
      { ...good, endpoint: 'http://push.example.test/insecure' },
      { ...good, endpoint: 'not a url' },
      { ...good, remindAt: '24:00' },
      { ...good, remindAt: '9pm' },
      { ...good, timeZone: 'Mars/Olympus_Mons' },
      { ...good, extra: true },
    ]) {
      expect((await device.call('PUT', '/push', bad)).status).toBe(400);
    }
  });

  it('sends one empty push, signed for its push service, when the time comes', async () => {
    await withReminder();
    const service = pushService();
    await sendReminders(env.DB, ORIGIN, later(-1), service.fetcher);
    expect(service.sent).toHaveLength(0);

    await sendReminders(env.DB, ORIGIN, EVENING, service.fetcher);
    expect(service.sent).toHaveLength(1);
    const [{ url, init } = { url: '', init: {} }] = service.sent;
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get('content-length')).toBe('0');
    expect(headers.get('topic')).toBe('daily-reminder');
    expect(Number(headers.get('ttl'))).toBeGreaterThan(0);

    // The VAPID token: for this push service's origin, from this site, and truly signed.
    const [, token = '', publicKey = ''] =
      /^vapid t=([^,]+), k=(.+)$/.exec(headers.get('authorization') ?? '') ?? [];
    const [header = '', claims = '', signature = ''] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toMatchObject({
      aud: 'https://push.example.test',
      sub: ORIGIN,
    });
    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signed = new TextEncoder().encode(`${header}.${claims}`);
    const verify = { name: 'ECDSA', hash: 'SHA-256' };
    expect(await crypto.subtle.verify(verify, key, fromBase64Url(signature), signed)).toBe(true);

    // Once a day.
    await sendReminders(env.DB, ORIGIN, later(5), service.fetcher);
    expect(service.sent).toHaveLength(1);
  });

  it('keeps to each device’s own clock', async () => {
    await withReminder('21:00', 'America/Los_Angeles');
    const service = pushService();
    // 21:00 in California is 04:00 UTC the next morning (daylight time since March 9th).
    await sendReminders(env.DB, ORIGIN, new Date('2031-03-11T03:59:00Z'), service.fetcher);
    expect(service.sent).toHaveLength(0);
    await sendReminders(env.DB, ORIGIN, new Date('2031-03-11T04:00:00Z'), service.fetcher);
    expect(service.sent).toHaveLength(1);
  });

  it('skips a day that is already written, on every device', async () => {
    const device = await withReminder();
    expect((await device.call('POST', '/push/written', { date: '2031-03-10' })).status).toBe(200);
    const service = pushService();
    await sendReminders(env.DB, ORIGIN, EVENING, service.fetcher);
    expect(service.sent).toHaveLength(0);
    await sendReminders(env.DB, ORIGIN, later(24 * 60), service.fetcher);
    expect(service.sent).toHaveLength(1);
  });

  it('tries again after a failure, and forgets a device that is gone', async () => {
    const device = await withReminder();
    await sendReminders(env.DB, ORIGIN, EVENING, pushService(503).fetcher);
    const retry = pushService(410);
    await sendReminders(env.DB, ORIGIN, later(5), retry.fetcher);
    expect(retry.sent).toHaveLength(1);
    expect((await device.json('GET', '/push')).body['devices']).toEqual([]);
  });

  it('sends a test to a device that has a reminder, and turns it off', async () => {
    const device = await withReminder();
    const service = pushService();
    vi.stubGlobal('fetch', service.fetcher);
    const test = await device.json('POST', '/push/test', { endpoint: ENDPOINT });
    expect(test.body).toEqual({ result: 'sent' });
    expect(service.sent).toHaveLength(1);
    const other = { endpoint: 'https://push.example.test/send/unknown' };
    expect((await device.call('POST', '/push/test', other)).status).toBe(404);

    expect((await device.call('DELETE', '/push', { endpoint: ENDPOINT })).status).toBe(200);
    expect((await device.json('GET', '/push')).body['devices']).toEqual([]);
  });
});

describe('every API answer', () => {
  it('is never cached', async () => {
    const response = await new Device(env).call('GET', '/state');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
