/**
 * Setting up, unlocking and recovering the journal: the vault (keys.ts) and the passkey client
 * (webauthn.ts) put together with the server's ceremonies (sites/docs/journal-crypto.md).
 *
 * Every passkey prompt is split in two: `prepare…` fetches what the prompt needs (a server
 * challenge), and the step that shows the prompt is called straight from the person's tap, with
 * the prompt as its very first await. Safari refuses a passkey prompt that comes too long after
 * the tap that asked for it.
 */
import { ApiError, OfflineError, api, type Slot, type SlotUpload } from '../api/client';
import { PasskeyError, createPasskey, getPasskey, localRequestOptions } from '../auth/webauthn';
import { getMeta, setMeta, type OfflineUnlock } from '../store/db';
import { encodeUtf8, toBase64Url } from '../vault/bytes';
import {
  kekFromPassphrase,
  kekFromPrf,
  kekFromRecovery,
  newAccountKey,
  newArgon2Params,
  openAccountKey,
  openAccountKeyRaw,
  recoveryAuth,
  sealAccountKey,
  type AccountKeys,
  type SlotRef,
} from '../vault/keys';
import { newRecoveryPhrase, recoveryEntropy } from '../vault/recovery';

/** Something about this account stops the unlock (as opposed to a cancelled prompt). */
export class UnlockError extends Error {
  override name = 'UnlockError';
  constructor(
    readonly problem: 'no-slot' | 'not-set-up' | 'offline-first-time' | 'wrong-passphrase',
    message: string,
  ) {
    super(message);
  }
}

export interface Unlocked {
  readonly keys: AccountKeys;
  /** Whether the server knows it is us (a session cookie was set): sync can start at once. */
  readonly online: boolean;
}

const RECOVERY_SLOT = 's_recovery';
const PASSPHRASE_SLOT = 's_passphrase';

/** One slot per passkey, named after it (hashed, to fit the server's id rules). */
export async function passkeySlotId(credentialId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encodeUtf8(credentialId));
  return `s_${toBase64Url(new Uint8Array(digest)).slice(0, 32)}`;
}

const refOf = (slot: Pick<Slot, 'kind' | 'id' | 'akId'>): SlotRef => ({
  kind: slot.kind,
  slotId: slot.id,
  akId: slot.akId,
});

/** Remembers what unlocking needs, so that next time works without a connection. */
async function remember(slots: Slot[], passkeys: Record<string, string>): Promise<void> {
  const akId = slots.find((slot) => slot.kind === 'recovery')?.akId ?? slots[0]?.akId;
  if (!akId) return;
  const known = await getMeta<OfflineUnlock>('unlock');
  await setMeta('unlock', {
    rpId: location.hostname,
    akId,
    passkeys: { ...(known?.akId === akId ? known.passkeys : {}), ...passkeys },
    slots,
  } satisfies OfflineUnlock);
}

// --- Unlocking ---------------------------------------------------------------------------------

export type UnlockTicket =
  | {
      readonly mode: 'online';
      readonly challengeId: string;
      readonly options: PublicKeyCredentialRequestOptionsJSON;
      readonly salts: Record<string, string>;
    }
  | {
      readonly mode: 'offline';
      readonly options: PublicKeyCredentialRequestOptionsJSON;
      readonly salts: Record<string, string>;
      readonly cache: OfflineUnlock;
    };

/** Gets a sign-in challenge from the server, or, offline, gets ready to unlock locally. */
export async function prepareUnlock(): Promise<UnlockTicket> {
  try {
    const began = await api.loginBegin();
    return {
      mode: 'online',
      challengeId: began.challengeId,
      options: began.options,
      salts: began.prf,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new UnlockError('not-set-up', 'This journal has not been set up yet.');
    }
    if (!(error instanceof OfflineError)) throw error;
    const cache = await getMeta<OfflineUnlock>('unlock');
    if (!cache || Object.keys(cache.passkeys).length === 0) {
      throw new UnlockError(
        'offline-first-time',
        'You are offline, and this device has not unlocked the journal before.',
      );
    }
    return {
      mode: 'offline',
      options: localRequestOptions(cache.rpId, Object.keys(cache.passkeys)),
      salts: cache.passkeys,
      cache,
    };
  }
}

/** The tap: one passkey prompt signs in to the server (when online) and opens the journal. */
export async function unlockWithPasskey(ticket: UnlockTicket): Promise<Unlocked> {
  const used = await getPasskey(ticket.options, ticket.salts);
  const slots =
    ticket.mode === 'online'
      ? (await api.loginFinish(ticket.challengeId, used.response)).slots
      : ticket.cache.slots;
  if (!used.prf) {
    throw new PasskeyError(
      'no-prf',
      'This passkey signed in, but this browser did not let it unlock the journal.',
    );
  }
  const slot = slots.find(
    (candidate) => candidate.kind === 'passkey' && candidate.credentialId === used.credentialId,
  );
  if (!slot) {
    throw new UnlockError(
      'no-slot',
      'This passkey can sign in but cannot unlock the journal yet. Use your recovery phrase.',
    );
  }
  const keys = await openAccountKey(
    slot.sealed,
    await kekFromPrf(used.prf, used.credentialId),
    refOf(slot),
  );
  const salt = ticket.salts[used.credentialId];
  await remember(slots, salt ? { [used.credentialId]: salt } : {});
  return { keys, online: ticket.mode === 'online' };
}

/**
 * The passphrase, for a browser that can sign in with a passkey but not unlock with one. Needs a
 * signed-in session, or a slot remembered from an earlier unlock on this device.
 */
export async function unlockWithPassphrase(passphrase: string, online: boolean): Promise<Unlocked> {
  const slots = online
    ? await api.slots()
    : ((await getMeta<OfflineUnlock>('unlock'))?.slots ?? []);
  const slot = slots.find((candidate) => candidate.kind === 'passphrase');
  if (!slot?.kdf) throw new UnlockError('no-slot', 'No passphrase has been set.');
  try {
    const keys = await openAccountKey(
      slot.sealed,
      await kekFromPassphrase(passphrase, slot.kdf),
      refOf(slot),
    );
    if (online) await remember(slots, {});
    return { keys, online };
  } catch {
    throw new UnlockError('wrong-passphrase', 'That passphrase does not unlock this journal.');
  }
}

// --- Setting up --------------------------------------------------------------------------------

export interface SetupTicket {
  readonly token: string;
  readonly challengeId: string;
  readonly options: PublicKeyCredentialCreationOptionsJSON;
  readonly akId: string;
  /** The account key's bytes: sealed into the first slots, then dropped with the ticket. */
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly phrase: string;
}

/** Step 1: the setup code checks out; a new account key and recovery phrase are made here. */
export async function beginSetup(token: string): Promise<SetupTicket> {
  const began = await api.setupBegin(token);
  const { akId, raw } = newAccountKey();
  return {
    token,
    challengeId: began.challengeId,
    options: began.options,
    akId,
    raw,
    phrase: newRecoveryPhrase(),
  };
}

/** Step 2, the tap: the first passkey, with the recovery phrase's slot. */
export async function createFirstPasskey(ticket: SetupTicket, label: string): Promise<void> {
  const created = await createPasskey(ticket.options);
  const entropy = recoveryEntropy(ticket.phrase);
  const recovery: SlotUpload = {
    id: RECOVERY_SLOT,
    kind: 'recovery',
    akId: ticket.akId,
    sealed: await sealAccountKey(ticket.raw, await kekFromRecovery(entropy), {
      kind: 'recovery',
      slotId: RECOVERY_SLOT,
      akId: ticket.akId,
    }),
    verified: true,
  };
  await api.setupFinish({
    token: ticket.token,
    challengeId: ticket.challengeId,
    userHandle: ticket.options.user.id,
    response: created.response,
    label,
    recovery,
    recoveryAuth: await recoveryAuth(entropy),
  });
}

/**
 * The last step of setup and of recovery, the tap: the new passkey signs in once, and its PRF
 * output seals the account key into its slot. Sealing with an output from get(), the call every
 * later unlock makes, is what proves the passkey will unlock the journal.
 */
export async function sealPasskeySlot(
  ticket: Extract<UnlockTicket, { mode: 'online' }>,
  raw: Uint8Array<ArrayBuffer>,
  akId: string,
): Promise<Unlocked> {
  const used = await getPasskey(ticket.options, ticket.salts);
  const { slots } = await api.loginFinish(ticket.challengeId, used.response);
  if (!used.prf) {
    throw new PasskeyError('no-prf', 'This passkey cannot unlock the journal in this browser.');
  }
  const kek = await kekFromPrf(used.prf, used.credentialId);
  const slot: SlotUpload = {
    id: await passkeySlotId(used.credentialId),
    kind: 'passkey',
    credentialId: used.credentialId,
    akId,
    sealed: '',
    verified: true,
  };
  slot.sealed = await sealAccountKey(raw, kek, refOf(slot));
  await api.putSlot(slot);
  const keys = await openAccountKey(slot.sealed, kek, refOf(slot));
  const stored: Slot = {
    ...slot,
    credentialId: used.credentialId,
    kdf: null,
    createdAt: Date.now(),
    verifiedAt: Date.now(),
  };
  const salt = ticket.salts[used.credentialId];
  await remember(
    [...slots.filter((other) => other.id !== slot.id), stored],
    salt ? { [used.credentialId]: salt } : {},
  );
  return { keys, online: true };
}

/** A sign-in challenge for sealPasskeySlot; online only. */
export async function prepareOnlineUnlock(): Promise<Extract<UnlockTicket, { mode: 'online' }>> {
  const ticket = await prepareUnlock();
  if (ticket.mode !== 'online') throw new OfflineError();
  return ticket;
}

// --- Recovering --------------------------------------------------------------------------------

export interface RecoveryTicket {
  readonly akId: string;
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly challengeId: string;
  readonly options: PublicKeyCredentialCreationOptionsJSON;
}

/** Every passkey lost (or a new device): the phrase opens the key and allows one new passkey. */
export async function beginRecovery(phrase: string): Promise<RecoveryTicket> {
  const entropy = recoveryEntropy(phrase);
  const { slots } = await api.recover(await recoveryAuth(entropy));
  const slot = slots.find((candidate) => candidate.kind === 'recovery');
  if (!slot) throw new UnlockError('no-slot', 'This journal has no recovery phrase slot.');
  const raw = await openAccountKeyRaw(slot.sealed, await kekFromRecovery(entropy), refOf(slot));
  const began = await api.passkeyBegin();
  return { akId: slot.akId, raw, challengeId: began.challengeId, options: began.options };
}

/** The tap: this device's new passkey. Then sealPasskeySlot, as in setup. */
export async function createRecoveryPasskey(ticket: RecoveryTicket, label: string): Promise<void> {
  const created = await createPasskey(ticket.options);
  await api.passkeyFinish(ticket.challengeId, created.response, label);
}

// --- More unlock methods (Settings) ------------------------------------------------------------

/**
 * Proves it is still you (a fresh passkey prompt) and reads the account key's bytes, to seal a
 * new copy of it. The tap.
 */
export async function reopenRaw(
  ticket: Extract<UnlockTicket, { mode: 'online' }>,
): Promise<{ raw: Uint8Array<ArrayBuffer>; akId: string }> {
  const used = await getPasskey(ticket.options, ticket.salts);
  const { slots } = await api.loginFinish(ticket.challengeId, used.response);
  const slot = slots.find(
    (candidate) => candidate.kind === 'passkey' && candidate.credentialId === used.credentialId,
  );
  if (!used.prf || !slot) {
    throw new UnlockError('no-slot', 'Use a passkey that already unlocks the journal.');
  }
  const raw = await openAccountKeyRaw(
    slot.sealed,
    await kekFromPrf(used.prf, used.credentialId),
    refOf(slot),
  );
  return { raw, akId: slot.akId };
}

/** Sets (or changes) the passphrase: a slot sealed by Argon2id of it. */
export async function setPassphrase(
  raw: Uint8Array<ArrayBuffer>,
  akId: string,
  passphrase: string,
): Promise<void> {
  const kdf = newArgon2Params();
  const ref: SlotRef = { kind: 'passphrase', slotId: PASSPHRASE_SLOT, akId };
  await api.putSlot({
    id: PASSPHRASE_SLOT,
    kind: 'passphrase',
    kdf,
    akId,
    sealed: await sealAccountKey(raw, await kekFromPassphrase(passphrase, kdf), ref),
    verified: true,
  });
}

/**
 * A new recovery phrase (from newRecoveryPhrase(), shown and confirmed first) replaces the old
 * one, which stops working at once.
 */
export async function replaceRecoveryPhrase(
  raw: Uint8Array<ArrayBuffer>,
  akId: string,
  phrase: string,
): Promise<void> {
  const entropy = recoveryEntropy(phrase);
  const ref: SlotRef = { kind: 'recovery', slotId: RECOVERY_SLOT, akId };
  await api.replaceRecovery(
    {
      id: RECOVERY_SLOT,
      kind: 'recovery',
      akId,
      sealed: await sealAccountKey(raw, await kekFromRecovery(entropy), ref),
      verified: true,
    },
    await recoveryAuth(entropy),
  );
}

/** Overwrites key bytes that are no longer needed (best effort: JavaScript may hold copies). */
export function forget(raw: Uint8Array): void {
  raw.fill(0);
}

/**
 * Signs in again after the server session ran out (sync says "signed-out"): the journal stays
 * unlocked, so only the server needs convincing. The tap.
 */
export async function signInAgain(
  ticket: Extract<UnlockTicket, { mode: 'online' }>,
): Promise<void> {
  const used = await getPasskey(ticket.options, ticket.salts);
  await api.loginFinish(ticket.challengeId, used.response);
}
