import { describe, expect, it } from 'vitest';
import { openBlob, sealBlob, newFileKey } from './blob';
import {
  VaultAuthError,
  VaultFormatError,
  decodeUtf8,
  encodeUtf8,
  fromBase64Url,
  randomBytes,
  toBase64Url,
} from './bytes';
import { openJson, openRecord, pad, sealJson, sealRecord, sealedBy, unpad } from './envelope';
import { dayId, randomId } from './ids';
import {
  accountKeysFromRaw,
  kekFromPassphrase,
  kekFromPrf,
  kekFromRecovery,
  newAccountKey,
  newArgon2Params,
  openAccountKey,
  openAccountKeyRaw,
  sealAccountKey,
  type SlotRef,
} from './keys';
import {
  isRecoveryPhrase,
  newRecoveryPhrase,
  normalizePhrase,
  phraseFromEntropy,
  recoveryEntropy,
} from './recovery';

// Argon2id at a test's cost; the stored params say what a real slot used.
const CHEAP = { m: 256, t: 1, p: 1 } as const;

async function freshAccount() {
  const ak = newAccountKey();
  return { ak, keys: await accountKeysFromRaw(ak.raw, ak.akId) };
}

/** Flips one bit of a base64url string's bytes, at a position counted from the end. */
function tamper(sealed: string, fromEnd: number): string {
  const bytes = fromBase64Url(sealed);
  const at = bytes.length - fromEnd;
  bytes[at] = (bytes[at] ?? 0) ^ 0x01;
  return toBase64Url(bytes);
}

describe('bytes', () => {
  it('round-trips base64url, including the empty string and every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(all))).toEqual(all);
    expect(fromBase64Url('')).toEqual(new Uint8Array(0));
    expect(toBase64Url(all)).not.toMatch(/[+/=]/);
  });

  it('rejects text that is not base64url', () => {
    expect(() => fromBase64Url('a+b/')).toThrow(VaultFormatError);
  });
});

describe('padding', () => {
  it('hides small differences in length', () => {
    expect(pad(new Uint8Array(10)).length).toBe(256);
    expect(pad(new Uint8Array(200)).length).toBe(256);
    expect(pad(new Uint8Array(255)).length).toBe(256);
    expect(pad(new Uint8Array(256)).length).toBe(512);
  });

  it('comes off exactly, even when the content ends in zero bytes', () => {
    const plain = Uint8Array.of(1, 2, 0, 0);
    expect(unpad(pad(plain))).toEqual(plain);
    expect(unpad(pad(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('refuses padding that is not there', () => {
    expect(() => unpad(new Uint8Array(256))).toThrow(VaultFormatError);
  });
});

describe('sealed records', () => {
  it('open to exactly what was sealed', async () => {
    const { keys } = await freshAccount();
    const ref = { id: randomId(), rev: 1 };
    const value = { mood: 4, text: 'Launched the two-stage rocket. 🚀', tags: ['rocketry'] };
    const sealed = await sealJson(keys, ref, value);
    expect(await openJson(keys, ref, sealed)).toEqual(value);
    expect(sealedBy(sealed)).toBe(keys.akId);
  });

  it('never repeat: the same content sealed twice looks unrelated', async () => {
    const { keys } = await freshAccount();
    const ref = { id: 'r_1', rev: 1 };
    const a = await sealRecord(keys, ref, encodeUtf8('same'));
    const b = await sealRecord(keys, ref, encodeUtf8('same'));
    expect(a).not.toBe(b);
  });

  it('cannot be moved to another record or another version', async () => {
    const { keys } = await freshAccount();
    const sealed = await sealRecord(keys, { id: 'r_1', rev: 3 }, encodeUtf8('secret'));
    await expect(openRecord(keys, { id: 'r_2', rev: 3 }, sealed)).rejects.toThrow(VaultAuthError);
    await expect(openRecord(keys, { id: 'r_1', rev: 2 }, sealed)).rejects.toThrow(VaultAuthError);
    expect(decodeUtf8(await openRecord(keys, { id: 'r_1', rev: 3 }, sealed))).toBe('secret');
  });

  it('do not open under another account', async () => {
    const mine = await freshAccount();
    const theirs = await freshAccount();
    const ref = { id: 'r_1', rev: 1 };
    const sealed = await sealRecord(mine.keys, ref, encodeUtf8('secret'));
    await expect(openRecord(theirs.keys, ref, sealed)).rejects.toThrow(VaultAuthError);
  });

  it('fail loudly when any byte is changed', async () => {
    const { keys } = await freshAccount();
    const ref = { id: 'r_1', rev: 1 };
    const sealed = await sealRecord(keys, ref, encodeUtf8('secret'));
    for (const fromEnd of [1, 20, 200, 300]) {
      await expect(openRecord(keys, ref, tamper(sealed, fromEnd))).rejects.toThrow();
    }
  });

  it('refuse to parse something that is not a sealed record', async () => {
    const { keys } = await freshAccount();
    await expect(
      openRecord(keys, { id: 'r', rev: 1 }, toBase64Url(randomBytes(400))),
    ).rejects.toThrow(VaultFormatError);
  });
});

describe('the account key in its slots', () => {
  it('opens from a passkey slot to the same working keys', async () => {
    const { ak, keys } = await freshAccount();
    const prf = randomBytes(32);
    const ref: SlotRef = { kind: 'passkey', slotId: 's_1', akId: ak.akId };
    const sealed = await sealAccountKey(ak.raw, await kekFromPrf(prf, 'cred-1'), ref);

    const opened = await openAccountKey(sealed, await kekFromPrf(prf, 'cred-1'), ref);
    expect(await dayId(opened, '2026-09-29')).toBe(await dayId(keys, '2026-09-29'));

    const record = await sealJson(keys, { id: 'r', rev: 1 }, { ok: true });
    expect(await openJson(opened, { id: 'r', rev: 1 }, record)).toEqual({ ok: true });
  });

  it('does not open with another passkey, another credential id, or in another slot', async () => {
    const { ak } = await freshAccount();
    const prf = randomBytes(32);
    const ref: SlotRef = { kind: 'passkey', slotId: 's_1', akId: ak.akId };
    const sealed = await sealAccountKey(ak.raw, await kekFromPrf(prf, 'cred-1'), ref);

    await expect(
      openAccountKey(sealed, await kekFromPrf(randomBytes(32), 'cred-1'), ref),
    ).rejects.toThrow(VaultAuthError);
    await expect(openAccountKey(sealed, await kekFromPrf(prf, 'cred-2'), ref)).rejects.toThrow(
      VaultAuthError,
    );
    await expect(
      openAccountKey(sealed, await kekFromPrf(prf, 'cred-1'), { ...ref, slotId: 's_2' }),
    ).rejects.toThrow(VaultAuthError);
    await expect(
      openAccountKey(sealed, await kekFromPrf(prf, 'cred-1'), { ...ref, kind: 'recovery' }),
    ).rejects.toThrow(VaultAuthError);
  });

  it('opens from a passphrase slot, and only with that passphrase', async () => {
    const { ak, keys } = await freshAccount();
    const params = newArgon2Params(CHEAP);
    const ref: SlotRef = { kind: 'passphrase', slotId: 's_p', akId: ak.akId };
    const sealed = await sealAccountKey(
      ak.raw,
      await kekFromPassphrase('orbit ladder velvet quiet mango harbor', params),
      ref,
    );

    const opened = await openAccountKey(
      sealed,
      await kekFromPassphrase('orbit ladder velvet quiet mango harbor', params),
      ref,
    );
    expect(await dayId(opened, '2030-01-01')).toBe(await dayId(keys, '2030-01-01'));
    await expect(
      openAccountKey(
        sealed,
        await kekFromPassphrase('orbit ladder velvet quiet mango harbour', params),
        ref,
      ),
    ).rejects.toThrow(VaultAuthError);
  });

  it('treats the same passphrase typed on different keyboards as the same (NFKC)', async () => {
    const { ak } = await freshAccount();
    const params = newArgon2Params(CHEAP);
    const ref: SlotRef = { kind: 'passphrase', slotId: 's_p', akId: ak.akId };
    const composed = 'café';
    const decomposed = 'café';
    const sealed = await sealAccountKey(ak.raw, await kekFromPassphrase(composed, params), ref);
    await expect(
      openAccountKey(sealed, await kekFromPassphrase(decomposed, params), ref),
    ).resolves.toBeDefined();
  });

  it('opens from the recovery phrase, and hands back the raw key to seal a new slot', async () => {
    const { ak } = await freshAccount();
    const phrase = newRecoveryPhrase();
    const ref: SlotRef = { kind: 'recovery', slotId: 's_r', akId: ak.akId };
    const sealed = await sealAccountKey(
      ak.raw,
      await kekFromRecovery(recoveryEntropy(phrase)),
      ref,
    );

    // Typed back with capitals and extra spaces: still the same phrase.
    const typed = `  ${phrase.toUpperCase().split(' ').join('   ')} `;
    const raw = await openAccountKeyRaw(sealed, await kekFromRecovery(recoveryEntropy(typed)), ref);
    expect(raw).toEqual(ak.raw);
  });

  it('rejects a slot of the wrong size before trying to decrypt it', async () => {
    const kek = await kekFromPrf(randomBytes(32), 'c');
    await expect(
      openAccountKey(toBase64Url(randomBytes(10)), kek, {
        kind: 'passkey',
        slotId: 's',
        akId: 'a',
      }),
    ).rejects.toThrow(VaultFormatError);
  });
});

describe('the recovery phrase', () => {
  it('is 24 words from the list, with a checksum', () => {
    const phrase = newRecoveryPhrase();
    expect(phrase.split(' ')).toHaveLength(24);
    expect(isRecoveryPhrase(phrase)).toBe(true);
    expect(recoveryEntropy(phrase)).toHaveLength(32);
  });

  it('catches a word that is not on the list', () => {
    const typo = newRecoveryPhrase().split(' ');
    typo[5] = 'zzzz';
    expect(isRecoveryPhrase(typo.join(' '))).toBe(false);
    expect(() => recoveryEntropy(typo.join(' '))).toThrow(RangeError);
  });

  it('catches a real word in the wrong place (the checksum)', () => {
    // All-zero entropy is "abandon" x 23 then "art"; changing the first word to another real one
    // keeps every word valid but breaks the checksum.
    const known = phraseFromEntropy(new Uint8Array(32)).split(' ');
    expect(known.at(-1)).toBe('art');
    expect(isRecoveryPhrase(known.join(' '))).toBe(true);
    known[0] = 'ability';
    expect(isRecoveryPhrase(known.join(' '))).toBe(false);
  });

  it('is short a word', () => {
    expect(isRecoveryPhrase(newRecoveryPhrase().split(' ').slice(1).join(' '))).toBe(false);
  });

  it('normalizes what people type', () => {
    expect(normalizePhrase(' Abandon,  ABILITY\nable. ')).toBe('abandon ability able');
  });
});

describe('ids', () => {
  it('give a day the same id on every device, and a different one on another day', async () => {
    const { ak } = await freshAccount();
    const deviceA = await accountKeysFromRaw(ak.raw, ak.akId);
    const deviceB = await accountKeysFromRaw(ak.raw, ak.akId);
    expect(await dayId(deviceA, '2026-09-29')).toBe(await dayId(deviceB, '2026-09-29'));
    expect(await dayId(deviceA, '2026-09-29')).not.toBe(await dayId(deviceA, '2026-09-30'));
  });

  it('say nothing about the date to someone without the key', async () => {
    const a = await freshAccount();
    const b = await freshAccount();
    expect(await dayId(a.keys, '2026-09-29')).not.toBe(await dayId(b.keys, '2026-09-29'));
    expect(await dayId(a.keys, '2026-09-29')).toMatch(/^k_[A-Za-z0-9_-]{22}$/);
  });

  it('refuse a malformed date', async () => {
    const { keys } = await freshAccount();
    await expect(dayId(keys, '2026-9-29')).rejects.toThrow(RangeError);
    await expect(dayId(keys, '2026-13-01')).rejects.toThrow(RangeError);
  });

  it('make random ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
  });
});

describe('sealed files', () => {
  const sizes = [0, 1, 5, 16, 17, 64, 100];

  it.each(sizes)('round-trip a %i-byte file in 16-byte chunks', async (size) => {
    const key = newFileKey();
    const data = randomBytes(size);
    const sealed = await sealBlob(key, 'b_1', data, 16);
    expect(await openBlob(key, 'b_1', sealed)).toEqual(data);
  });

  it('round-trip a 3 MiB photo in the default chunks', async () => {
    const key = newFileKey();
    const data = new Uint8Array(3 * 1024 * 1024 + 123);
    for (let i = 0; i < data.length; i += 65536)
      data.set(randomBytes(Math.min(65536, data.length - i)), i);
    expect(await openBlob(key, 'b_photo', await sealBlob(key, 'b_photo', data))).toEqual(data);
  });

  it('cannot be cut short, extended, reordered, or passed off as another file', async () => {
    const key = newFileKey();
    const data = randomBytes(64);
    const sealed = await sealBlob(key, 'b_1', data, 16);
    const chunk = 12 + 16 + 16;
    const header = sealed.subarray(0, 6);
    const chunks = Array.from({ length: 4 }, (_, i) =>
      sealed.subarray(6 + i * chunk, 6 + (i + 1) * chunk),
    );
    const join = (...parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    };
    const [c0, c1, c2, c3] = chunks as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

    await expect(openBlob(key, 'b_1', join(header, c0, c1, c2))).rejects.toThrow(VaultAuthError);
    await expect(openBlob(key, 'b_1', join(header, c0, c2, c1, c3))).rejects.toThrow(
      VaultAuthError,
    );
    await expect(openBlob(key, 'b_1', join(header, c0, c1, c2, c3, c3))).rejects.toThrow(
      VaultAuthError,
    );
    await expect(openBlob(key, 'b_2', sealed)).rejects.toThrow(VaultAuthError);
    await expect(openBlob(newFileKey(), 'b_1', sealed)).rejects.toThrow(VaultAuthError);
  });
});
