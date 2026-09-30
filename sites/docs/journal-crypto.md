# The journal's encryption

journal.allenkh.com keeps a private journal on a server Allen does not have to trust. This page
is the whole design: what is promised, how each part keeps the promise, and where it stops. The
code cites it by section; when the code and this page disagree, one of them has a bug.

Code: `sites/journal/src/vault/` (keys, records, files, ids), `src/account/account.ts` (the
unlock flows), `src/auth/webauthn.ts` (passkeys), `worker/` (the server).

## The promise

Everything written in the journal (days, moods, notes, photos, people, places, events, settings,
even the names of activities) is encrypted on Allen's own devices before it leaves them, with a
key that never leaves them unencrypted. The server, and anyone who gets into it (a Cloudflare
employee, a leaked database, a subpoena), holds ciphertext it cannot open.

**The one rule:** the secret that unlocks the journal on a device (a passkey's PRF output, a
passphrase, the recovery phrase) never goes to the server, not even hashed with the key the
journal is encrypted with. The server refuses any request that carries a PRF result
(`refusePrfResults` in `worker/routes/auth.ts`), because the only way one gets there is a client
that forgot to strip it.

## Who can see what

| Who | Sees |
| --- | --- |
| The server (Cloudflare D1 and R2) | Ciphertext. How many records there are and roughly how big each is (padded, see below), when each was written, how big each photo is, which passkeys exist (their public keys, as WebAuthn intends), and the few plaintext values listed under "What the server knows". No words, no moods, no dates of entries, no names. |
| The network | Nothing: HTTPS everywhere, HSTS, `upgrade-insecure-requests`. |
| A thief with a locked device, or a copy of the browser profile | The same ciphertext as the server (the device's copy is sealed exactly as the server's is), and the sealed key slots. Nothing opens without a passkey, the passphrase or the recovery phrase. |
| Web Push services (Apple, Google, Mozilla) | That the journal's server woke a device, once a day at most. The push is empty. |
| Someone with the recovery phrase | Everything. Keep it offline, like a spare house key. |

## Keys

**The account key (AK)** is 32 random bytes, made once on the first device. Everything is
encrypted under keys derived from it:

- `recordWrap` (AES-256-GCM, by HKDF-SHA-256): wraps each record's own random key.
- `ids` (HMAC-SHA-256): turns a name like `day:2026-09-29` into an id the server cannot read.
- `manifest` (HMAC-SHA-256): reserved. The rollback check ("Sync") needs no key of its own: a
  manifest is sealed like any record, which already shows it came from one of Allen's devices.

HKDF labels and the salt are fixed strings in `vault/aad.ts`; they are part of the storage format.

On unlock the AK is unwrapped straight into a non-extractable WebCrypto key, so page script never
holds its bytes. The one exception is adding an unlock method (a new passkey, a passphrase, a
new recovery phrase), which needs the raw bytes to seal a new copy: that happens only right after
a fresh passkey prompt, and the bytes are dropped at once.

**Unlock methods.** Each one produces a key-encryption key (KEK) that seals a copy of the AK. A
sealed copy is a **slot**; the server stores the slots and cannot open any of them.

| Method | KEK | Notes |
| --- | --- | --- |
| Passkey | HKDF(PRF output), label names the credential | Face ID, Touch ID, Windows Hello. WebAuthn's PRF extension evaluates a per-passkey salt (32 random bytes, made by the server when the passkey is registered) inside the authenticator, with user verification required. Two passkeys never share a KEK. |
| Passphrase (optional) | HKDF(Argon2id(passphrase)) | For a browser that can sign in with a passkey but not unlock with one (no PRF). Argon2id at 64 MiB, 3 passes, 1 lane (RFC 9106's second recommendation), about a second on a recent iPhone. The cost is stored with the slot, so it can be raised later. |
| Recovery phrase (required) | HKDF(its 256 bits of entropy) | 24 English BIP39 words with a checksum, printed at setup. The one method that depends on no device and no passkey provider. |

Each slot is AES-256-GCM with associated data naming its kind, its id and the AK's id, so the
server cannot move a slot to where another belongs.

**Losing everything.** If every passkey, the passphrase and the recovery phrase are gone, the
journal is gone. That is the price of the promise: nobody, including Allen and the server, has a
back door.

## Records

Every record (a day, a month review, an event, a person, a place, a template, the settings, the
activity list) is sealed as one envelope (`vault/envelope.ts`):

- a fresh random AES-256 key for this record and this version, wrapped by `recordWrap`;
- the content, JSON, padded to a multiple of 256 bytes (ISO/IEC 7816-4), encrypted under that
  key with AES-256-GCM;
- both bound by associated data to the record's id and version: a record sealed as version 7 of
  record X opens only as version 7 of record X. The server can neither swap two records nor pass
  an old version off as a new one.

The padding keeps the length of a short entry from saying how much was written; a long entry
still shows roughly how long it is.

**Ids say nothing.** The server sees every id, so an id carries no time, no kind and no date:

- `k_…` keyed: the first 128 bits of an HMAC of a name (`day:2026-09-29`, `month:2026-09`,
  `singleton:settings`) under the `ids` key. Every device computes the same id on its own, so two
  devices writing the same day offline meet in one record instead of making two.
- `r_…` random, 128 bits: anything made once (an event, a person, a place, a template).
- `b_…` random, 128 bits: a sealed file in R2.

## Files

A photo (and its thumbnail) is sealed on the device before upload (`vault/blob.ts`), under its
own random file key, which lives only inside the sealed record that shows the photo. The bucket
alone holds nothing readable, and deleting that record makes the file unrecoverable.

A file is cut into 1 MiB chunks, each sealed with a fresh IV and associated data naming the file,
the chunk's position, and whether it is the last one: the server can neither reorder chunks, mix
them with another file's, nor cut a file short. Photos are re-encoded on the device first, which
also drops their EXIF data (location included).

## Sync

The server keeps an append-only log of ciphertext (`worker/routes/sync.ts`). A device pulls every
record changed since its cursor and pushes its own changes as compare-and-set writes: each names
the version it was based on, and lands only if the record is still at that version. Otherwise
the server answers with what is there now, and the device, which can read both, merges them
(`src/journal/merge.ts`, field by field, three-way) and tries again. The server never merges: it
cannot read what it would be merging.

**A device never goes back** (`src/journal/replica.ts`). Each version of a record has one number
(its rev) and one place in the log (its seq), for good: no row is ever removed, and a deletion is
a version too. So a device shown an older version than the one it has, another version under the
same number, or nothing where it had a record, is looking at a server that has gone back:
restored from a backup, or keeping changes from it. It keeps its own version rather than merge
its changes into the older one, and puts it back (below). The log's numbers count on from the
clock, in microseconds, so a database restored to an earlier time never gives a new write a
number a device has already passed: every device still pulls it.

**Putting back what the server lost** (`repair` in `replica.ts`). A device that finds the server
has gone back reads the whole log once, then sends its own version of every record the server
has an older version of, another version in place of, or none at all. It numbers each one past
both (a write may name its number, if that is higher than the next), so every device takes it. A
version the server took after going back holds another device's writing: the device first
merges the two, like two devices writing apart, but with no version both started from, so
everything written is kept (though something deleted on one side may come back). Until it is
done (offline, say), Settings says the server is missing changes.

**The rollback check** (`src/journal/manifest.ts`). The server could also keep a change from a
device without showing it anything older: by never sending it. So each device publishes a
manifest, a record of its own, sealed like the rest, that lists the version of every record the
server has confirmed to it, the other devices' manifests included. A version reaches the server
before a manifest can list it, and a pull comes in the log's order, so a device that has pulled
past another device's manifest has been sent every version it lists, or a later one. Whatever it
lacks, the server kept from it, and it says so. A device publishes its manifest at the first sync
of each session, then at most every ten minutes while what it has changes. To the server a
manifest is one more record, written when a device syncs, which it sees anyway.

## Signing in

A session only lets a device talk to the server; it opens nothing, because the keys never leave
the device. Unlocking and signing in are one passkey prompt.

- **Passkeys** are scoped to exactly `journal.allenkh.com` (never the parent domain, which also
  hosts other sites) with user verification required. The server verifies every response with
  SimpleWebAuthn against that origin and relying party.
- **Sessions** are a random 256-bit token in a `__Host-` cookie (Secure, HttpOnly,
  SameSite=Strict, this host only). The database keeps only its SHA-256, so a copy of the
  database signs nobody in. A session ends after an hour unused, or a day at most, and at once
  when its passkey is removed: a lost device, its passkey removed from another, stops talking to
  the server there and then.
- **Writes** must come from the journal's own origin: the server checks the Origin header on
  every request that is not a GET, because SameSite does not separate subdomains of one site.
- **Setup** needs a setup code (the `SETUP_TOKEN` secret), so nobody who finds the address before
  Allen does can claim it. After setup it is unused.
- **Recovery.** The recovery phrase also yields a second value, `recoveryAuth` (HKDF, its own
  label, useless for decryption); the server keeps its SHA-256. Presenting it grants a
  15-minute session that can do exactly one thing: register a new passkey. The new passkey's slot
  is sealed on the device from the AK the phrase unlocked.
- **Rate limits.** The sign-in endpoints are rate-limited per address (a speed bump; the real
  protection is that passkeys cannot be guessed).

## On the device

The device's copy lives in IndexedDB, sealed exactly as on the server, including edits not yet
synced and cached photos. The only plain values are bookkeeping: the sync cursor, the id of this
device's manifest, which passkeys work on this device with their PRF salts, and the sealed
slots, so the journal unlocks offline.
None of it is secret.

While unlocked, the working keys are non-extractable WebCrypto keys, and decrypted records sit
in the page's memory. The journal locks itself after five minutes in the background (Settings,
1 to 60), after twelve hours at most, and on every reload; locking drops the keys with the page's
state.

## The page itself

The app is served with one strict Content-Security-Policy (`public/_headers`): its own scripts
only, no inline script, no third parties of any kind (no analytics, no fonts from elsewhere, no
CDN), `connect-src 'self'`, `frame-ancestors 'none'`. `wasm-unsafe-eval` is there for Argon2's
WebAssembly, nothing else. The installed app's code is cached by its service worker.

## The daily reminder

A push with no content, sent by the server's cron (`worker/lib/push.ts`); the service worker
shows its one fixed text, "How was today?". For each device the server knows a push address, a
time of day and a time zone; for the account, the last date something was written, so no device
is reminded to write a day that is written. That last fact adds nothing: the server sees every
sync anyway.

The VAPID key that signs the pushes is made on first use and kept in D1 beside the subscriptions.
Whoever held it could send the same empty pushes to the same devices and nothing else.

## What the server knows

Beyond ciphertext and its sizes and times: the passkeys' public keys, counters, labels ("iPhone",
chosen on the device), creation and last-use times and PRF salts; the Argon2 parameters of the
passphrase slot, if there is one; the SHA-256 of `recoveryAuth`; session hashes; and the
reminder rows above.

## Limits

What this design does not protect against, said plainly:

- **The code comes from the server.** A web app runs whatever its server sends. A malicious
  deploy could ship code that reads the journal the next time it is unlocked. The defence is
  procedural: deploys happen only from `main`, through Workers Builds, after review; nobody
  deploys from a laptop. The installed app keeps its cached code until a new version is deployed.
- **An unlocked device.** Whoever holds an unlocked device reads the journal. Auto-lock narrows
  the window; it does not close it.
- **Malware on a device** can read what the journal shows, like anything else on that device.
- **Withholding.** The server cannot forge or alter records, and a device notices when it goes
  back on a version the device has had, or keeps back one that another device's manifest lists
  ("Sync"). What no device can notice on its own: a server that shows it a consistent older
  journal, with every manifest held back as well, as if the other devices had been quiet since.
  A device can only be as sure as the newest manifest it is shown. What the server loses, a
  device that still has it puts back; what no device kept is gone with it.
- **Traffic analysis.** Sizes (padded), times and counts are visible to the server.

## Formats

Everything sealed starts with a magic byte and a version (`J` 1 for records, `B` 1 for files), and
every associated-data and HKDF string starts with `allenkh-journal:v1:`. Changing any of them
makes existing data unreadable: a new format gets a new version, and readers keep the old one.
Each record names the id of the AK that sealed it, so the AK can one day be rotated.

## What tests it

- `src/vault/vault.test.ts`: every seal round-trips; tampering, swapping, truncating and
  replaying ciphertext all fail; ids and padding hide what they should.
- `worker/api.test.ts`: the server's half with a software passkey (setup, sign-in, recovery,
  sync conflicts, a restored database, files, the reminder), including the refusal of PRF results
  and of other origins.
- `src/journal/replica.test.ts` and `manifest.test.ts`: a server that goes back (an older
  version, another under the same number, a lost record) and one that keeps a record back; a
  restored server getting back what the devices have, merged with what was written on it since.
- `tests/e2e/journal.spec.ts`: two real browsers with virtual passkeys. The test writes a day with
  words, a to-do, a person and a photo, then searches every byte the server was sent for them and
  for a JPEG, and finds nothing. Later the laptop's pulls leave out a change the phone made, and
  the laptop says so.
