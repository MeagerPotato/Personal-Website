/**
 * The browser's half of passkeys: create() and get() with the PRF extension
 * (sites/docs/journal-crypto.md, "Passkeys").
 *
 * The server speaks WebAuthn's JSON forms (base64url strings) and the browser wants bytes, so
 * these helpers convert both ways. Each one asks the passkey for its PRF output, hands it to the
 * caller, and makes sure it never leaves the device: the JSON sent back to the server carries no
 * extension results at all (and the server refuses any request that does).
 *
 * Call them straight from a tap. Safari only lets a page start a passkey prompt while the user's
 * gesture is fresh, so fetch the options first and keep them ready (see account/*.ts).
 */
import { fromBase64Url, toBase64Url } from '../vault/bytes';

export type PasskeyProblem =
  /** The person closed the prompt, or it timed out. Not an error worth shouting about. */
  | 'cancelled'
  /** This authenticator already holds a passkey for the journal (create only). */
  | 'exists'
  /** The page is not on the journal's own address, so the browser refused. */
  | 'origin'
  /** No passkeys here, or no PRF: this browser cannot unlock the journal with a passkey. */
  | 'unsupported'
  /** The passkey answered, but without a PRF output. */
  | 'no-prf';

export class PasskeyError extends Error {
  override name = 'PasskeyError';
  constructor(
    readonly problem: PasskeyProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface RegistrationJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment?: string;
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
  clientExtensionResults: Record<string, never>;
}

export interface AuthenticationJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment?: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, never>;
}

export interface CreatedPasskey {
  readonly credentialId: string;
  /** For the server: everything it needs to verify the new passkey, and nothing more. */
  readonly response: RegistrationJSON;
  /** The PRF output, when the authenticator gives one at creation (not all do). */
  readonly prf: Uint8Array<ArrayBuffer> | null;
  /** Whether the authenticator supports PRF at all (null when it did not say). */
  readonly prfEnabled: boolean | null;
}

export interface UsedPasskey {
  readonly credentialId: string;
  readonly response: AuthenticationJSON;
  readonly prf: Uint8Array<ArrayBuffer> | null;
}

/** What this browser can do, to explain up front instead of failing halfway through setup. */
export async function passkeySupport(): Promise<{ platform: boolean; prf: boolean | null }> {
  if (typeof PublicKeyCredential === 'undefined') return { platform: false, prf: false };
  const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(
    () => false,
  );
  if (!('getClientCapabilities' in PublicKeyCredential)) return { platform, prf: null };
  const capabilities = await PublicKeyCredential.getClientCapabilities().catch(() => null);
  const prf = capabilities?.['extension:prf'];
  return { platform, prf: typeof prf === 'boolean' ? prf : null };
}

// --- JSON → bytes ----------------------------------------------------------------------------

const bytes = (text: string): Uint8Array<ArrayBuffer> => fromBase64Url(text);

function descriptors(
  list: PublicKeyCredentialDescriptorJSON[] | undefined,
): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((item) => ({
    id: bytes(item.id),
    type: 'public-key',
    transports: item.transports as AuthenticatorTransport[] | undefined,
  }));
}

function prfValues(
  values: AuthenticationExtensionsPRFValuesJSON,
): AuthenticationExtensionsPRFValues {
  return values.second === undefined
    ? { first: bytes(values.first) }
    : { first: bytes(values.first), second: bytes(values.second) };
}

function creationOptions(
  json: PublicKeyCredentialCreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
  const salt = json.extensions?.prf?.eval?.first;
  return {
    rp: json.rp,
    user: { id: bytes(json.user.id), name: json.user.name, displayName: json.user.displayName },
    challenge: bytes(json.challenge),
    pubKeyCredParams: json.pubKeyCredParams,
    timeout: json.timeout,
    excludeCredentials: descriptors(json.excludeCredentials),
    authenticatorSelection: json.authenticatorSelection,
    attestation: (json.attestation as AttestationConveyancePreference | undefined) ?? 'none',
    extensions: {
      credProps: true,
      ...(salt ? { prf: { eval: { first: bytes(salt) } } } : {}),
    },
  };
}

function requestOptions(
  json: PublicKeyCredentialRequestOptionsJSON,
  salts: Readonly<Record<string, string>>,
): PublicKeyCredentialRequestOptions {
  const evalByCredential = Object.fromEntries(
    Object.entries(salts).map(([credentialId, salt]) => [credentialId, prfValues({ first: salt })]),
  );
  return {
    challenge: bytes(json.challenge),
    timeout: json.timeout,
    rpId: json.rpId,
    allowCredentials: descriptors(json.allowCredentials),
    userVerification: 'required',
    extensions: { prf: { evalByCredential } },
  };
}

// --- bytes → JSON ----------------------------------------------------------------------------

const text = (buffer: ArrayBuffer): string => toBase64Url(new Uint8Array(buffer));

function prfOutput(credential: PublicKeyCredential): {
  prf: Uint8Array<ArrayBuffer> | null;
  enabled: boolean | null;
} {
  const outputs = credential.getClientExtensionResults().prf;
  const first = outputs?.results?.first;
  let prf: Uint8Array<ArrayBuffer> | null = null;
  if (first instanceof ArrayBuffer) prf = new Uint8Array(first.slice(0));
  else if (first && ArrayBuffer.isView(first)) {
    prf = new Uint8Array(first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength));
  }
  return { prf, enabled: outputs?.enabled ?? (prf ? true : null) };
}

function problem(error: unknown, creating: boolean): unknown {
  if (!(error instanceof DOMException)) return error;
  switch (error.name) {
    case 'NotAllowedError':
    case 'AbortError':
      return new PasskeyError('cancelled', 'The passkey prompt was closed before it finished.');
    case 'InvalidStateError':
      return creating
        ? new PasskeyError('exists', 'This device already has a passkey for your journal.')
        : error;
    case 'SecurityError':
      return new PasskeyError('origin', 'Passkeys only work on the journal’s own address.');
    case 'NotSupportedError':
      return new PasskeyError('unsupported', 'This browser cannot use a passkey here.');
    default:
      return error;
  }
}

/** Makes a new passkey on this device. `options` is the server's JSON, PRF salt included. */
export async function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
  signal?: AbortSignal,
): Promise<CreatedPasskey> {
  if (typeof PublicKeyCredential === 'undefined') {
    throw new PasskeyError('unsupported', 'This browser has no passkeys.');
  }
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.create({
      publicKey: creationOptions(options),
      signal,
    })) as PublicKeyCredential;
  } catch (error) {
    throw problem(error, true);
  }
  const response = credential.response as AuthenticatorAttestationResponse;
  const { prf, enabled } = prfOutput(credential);
  return {
    credentialId: credential.id,
    prf,
    prfEnabled: enabled,
    response: {
      id: credential.id,
      rawId: text(credential.rawId),
      type: 'public-key',
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: text(response.clientDataJSON),
        attestationObject: text(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
      clientExtensionResults: {},
    },
  };
}

/**
 * Signs in with a passkey and evaluates its PRF. `salts` maps each allowed credential id to its
 * salt: whichever passkey the person picks, the browser evaluates that one's salt.
 */
export async function getPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  salts: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<UsedPasskey> {
  if (typeof PublicKeyCredential === 'undefined') {
    throw new PasskeyError('unsupported', 'This browser has no passkeys.');
  }
  let credential: PublicKeyCredential;
  try {
    credential = (await navigator.credentials.get({
      publicKey: requestOptions(options, salts),
      signal,
    })) as PublicKeyCredential;
  } catch (error) {
    throw problem(error, false);
  }
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: credential.id,
    prf: prfOutput(credential).prf,
    response: {
      id: credential.id,
      rawId: text(credential.rawId),
      type: 'public-key',
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: text(response.clientDataJSON),
        authenticatorData: text(response.authenticatorData),
        signature: text(response.signature),
        ...(response.userHandle ? { userHandle: text(response.userHandle) } : {}),
      },
      clientExtensionResults: {},
    },
  };
}

/**
 * Options for unlocking without the server (offline): a local challenge, since nobody verifies
 * the signature; only the PRF output matters, and only this device's passkeys can produce it.
 */
export function localRequestOptions(
  rpId: string,
  credentialIds: readonly string[],
): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    rpId,
    timeout: 120_000,
    userVerification: 'required',
    allowCredentials: credentialIds.map((id) => ({ id, type: 'public-key' })),
  };
}
