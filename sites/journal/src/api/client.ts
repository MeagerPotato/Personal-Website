/**
 * The journal's server, as the app sees it: /api on the same origin (worker/index.ts). Everything
 * that goes up is already sealed, except the passkey ceremony itself.
 */
import type { SlotKind } from '../vault/aad';
import type { Argon2Params } from '../vault/keys';
import type { AuthenticationJSON, RegistrationJSON } from '../auth/webauthn';

/** The server answered, and said no. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The server could not be reached at all (offline, or a network hiccup). */
export class OfflineError extends Error {
  override name = 'OfflineError';
  constructor() {
    super('You are offline');
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
    });
  } catch {
    throw new OfflineError();
  }
  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error ?? response.statusText)
      .catch(() => response.statusText);
    throw new ApiError(response.status, message);
  }
  return response;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return (await response.json()) as T;
}

// --- Shapes the server speaks --------------------------------------------------------------------

export interface Slot {
  id: string;
  kind: SlotKind;
  credentialId: string | null;
  kdf: Argon2Params | null;
  akId: string;
  sealed: string;
  createdAt: number;
  verifiedAt: number | null;
}

/** A slot on its way up (the server stamps the dates). */
export interface SlotUpload {
  id: string;
  kind: SlotKind;
  credentialId?: string;
  kdf?: Argon2Params;
  akId: string;
  sealed: string;
  verified?: boolean;
}

export interface ServerState {
  account: boolean;
  session: { scope: 'full' | 'enroll'; credentialId: string | null } | null;
  rpId: string;
}

export interface Ceremony<Options> {
  challengeId: string;
  options: Options;
}

export interface Passkey {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  synced: boolean;
  aaguid: string | null;
  unlocks: boolean;
}

export interface RemoteRecord {
  id: string;
  rev: number;
  seq: number;
  sealed: string | null;
}

export interface Change {
  id: string;
  baseRev: number;
  sealed: string | null;
}

export type PushResult =
  | { id: string; ok: true; rev: number; seq: number }
  | { id: string; ok: false; current: RemoteRecord | null };

// --- Calls ---------------------------------------------------------------------------------------

type CreationOptions = PublicKeyCredentialCreationOptionsJSON;
type RequestOptions = PublicKeyCredentialRequestOptionsJSON;

export const api = {
  state: () => json<ServerState>('GET', '/state'),

  setupBegin: (token: string) =>
    json<Ceremony<CreationOptions> & { prfSalt: string }>('POST', '/setup/begin', { token }),
  setupFinish: (input: {
    token: string;
    challengeId: string;
    userHandle: string;
    response: RegistrationJSON;
    label: string;
    recovery: SlotUpload;
    recoveryAuth: string;
    passphrase?: SlotUpload;
  }) => json<{ credentialId: string; prfSalt: string }>('POST', '/setup/finish', input),

  loginBegin: () =>
    json<Ceremony<RequestOptions> & { prf: Record<string, string> }>('POST', '/login/begin'),
  loginFinish: (challengeId: string, response: AuthenticationJSON) =>
    json<{ credentialId: string; slots: Slot[] }>('POST', '/login/finish', {
      challengeId,
      response,
    }),
  recover: (recoveryAuth: string) => json<{ slots: Slot[] }>('POST', '/recover', { recoveryAuth }),
  logout: () => json<{ ok: true }>('POST', '/logout'),

  passkeyBegin: () =>
    json<Ceremony<CreationOptions> & { prfSalt: string }>('POST', '/credentials/begin'),
  passkeyFinish: (challengeId: string, response: RegistrationJSON, label: string) =>
    json<{ credentialId: string; prfSalt: string }>('POST', '/credentials/finish', {
      challengeId,
      response,
      label,
    }),
  passkeys: () => json<Passkey[]>('GET', '/credentials'),
  renamePasskey: (id: string, label: string) =>
    json<{ ok: true }>('PATCH', `/credentials/${encodeURIComponent(id)}`, { label }),
  removePasskey: (id: string) =>
    json<{ ok: true }>('DELETE', `/credentials/${encodeURIComponent(id)}`),

  slots: () => json<Slot[]>('GET', '/slots'),
  putSlot: (slot: SlotUpload) =>
    json<{ ok: true }>('PUT', `/slots/${encodeURIComponent(slot.id)}`, slot),
  removeSlot: (id: string) => json<{ ok: true }>('DELETE', `/slots/${encodeURIComponent(id)}`),
  replaceRecovery: (slot: SlotUpload, recoveryAuth: string) =>
    json<{ ok: true }>('POST', '/recovery/replace', { slot, recoveryAuth }),

  pull: (since: number) =>
    json<{ changes: RemoteRecord[]; cursor: number; more: boolean }>('GET', `/sync?since=${since}`),
  push: (changes: Change[]) => json<{ results: PushResult[] }>('POST', '/sync', { changes }),

  putFile: async (id: string, sealed: Uint8Array<ArrayBuffer>) =>
    (
      await send(`/blobs/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: sealed,
      })
    ).json() as Promise<{ ok: true }>,
  getFile: async (id: string) =>
    new Uint8Array(await (await send(`/blobs/${id}`, { method: 'GET' })).arrayBuffer()),
  removeFile: (id: string) => json<{ ok: true }>('DELETE', `/blobs/${id}`),
  files: () => json<{ id: string; size: number; createdAt: number }[]>('GET', '/blobs'),
};
