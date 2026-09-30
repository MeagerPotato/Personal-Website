/**
 * A software passkey for tests: makes real WebAuthn registration and assertion responses (ES256,
 * "none" attestation, user present and verified), so the server's verification runs unchanged.
 * It can also answer the PRF extension, to check that the server refuses to receive its output.
 */

type Json = Record<string, unknown>;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromB64url = (text: string): Uint8Array<ArrayBuffer> => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
};

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const sha256 = async (data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data));

// --- Just enough CBOR for an attestation object and a COSE key ---------------------------------

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 256) return Uint8Array.of((major << 5) | 24, length);
  return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
}

function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  const parts: Uint8Array[] = [head(5, value.size)];
  for (const [key, item] of value) parts.push(cbor(key), cbor(item));
  return concat(...parts);
}

/** WebCrypto signs ECDSA as r‖s; WebAuthn wants ASN.1 DER. */
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    let trimmed = bytes.subarray(start);
    if ((trimmed[0] ?? 0) & 0x80) trimmed = concat(Uint8Array.of(0), trimmed);
    return concat(Uint8Array.of(0x02, trimmed.length), trimmed);
  };
  const body = concat(integer(raw.subarray(0, 32)), integer(raw.subarray(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

export class SoftAuthenticator {
  readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  private keys!: CryptoKeyPair;
  private counter = 0;
  private readonly prfSecret = crypto.getRandomValues(new Uint8Array(32));

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  private async authData(
    flags: number,
    extra: Uint8Array = new Uint8Array(0),
  ): Promise<Uint8Array> {
    this.counter += 1;
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, this.counter);
    const rpId = new Uint8Array(new TextEncoder().encode(this.rpId));
    return concat(await sha256(rpId), Uint8Array.of(flags), count, extra);
  }

  private clientData(
    type: string,
    challenge: string,
    origin = this.origin,
  ): Uint8Array<ArrayBuffer> {
    return new Uint8Array(
      new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })),
    );
  }

  /** Answers navigator.credentials.create() for the given options (the server's JSON). */
  async register(options: Json, { origin = this.origin } = {}): Promise<Json> {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey;
    const coseKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64url(jwk.x ?? '')],
        [-3, fromB64url(jwk.y ?? '')],
      ]),
    );
    const idLength = Uint8Array.of(0, this.credentialId.length);
    const attested = concat(new Uint8Array(16), idLength, this.credentialId, coseKey);
    // UP | UV | AT, plus BE and BS (a synced passkey)
    const authData = await this.authData(0x01 | 0x04 | 0x40 | 0x08 | 0x10, attested);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(
          this.clientData('webauthn.create', String(options['challenge']), origin),
        ),
        attestationObject: b64url(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
    };
  }

  /** Answers navigator.credentials.get(). `leakPrf` puts a PRF result where a careless client would. */
  async assert(options: Json, { origin = this.origin, leakPrf = false } = {}): Promise<Json> {
    const authData = await this.authData(0x01 | 0x04 | 0x08 | 0x10);
    const clientData = this.clientData('webauthn.get', String(options['challenge']), origin);
    const signed = concat(authData, await sha256(clientData));
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(derSignature(raw)),
        userHandle: null,
      },
      clientExtensionResults: leakPrf
        ? { prf: { results: { first: b64url(this.prfSecret) } } }
        : {},
    };
  }
}
