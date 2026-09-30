/**
 * The journal's D1 schema, applied by the Worker itself (db/migrate.ts) the first time an isolate
 * touches the database, so a deploy needs no database permissions of its own.
 *
 * APPEND ONLY. A migration that has shipped is never edited: add the next one. Each is a list of
 * statements run in one batch (a transaction), together with the bump of `schema.version`.
 *
 * What the server can see is exactly what is in these tables, and nothing here is readable
 * journal content: records and files are ciphertext, ids are random or keyed hashes, and the
 * few plaintext columns are what a server must know to do its job (sizes, versions, sequence
 * numbers, passkey public keys, the reminder time).
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  // 1: the first schema.
  [
    `CREATE TABLE IF NOT EXISTS account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_handle TEXT NOT NULL,
      recovery_auth_hash TEXT,
      created_at INTEGER NOT NULL
    )`,
    // Passkeys. rp.id is journal.allenkh.com; public keys only, as WebAuthn intends.
    `CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      aaguid TEXT,
      label TEXT NOT NULL DEFAULT '',
      prf_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )`,
    // The account key, sealed once per unlock method. The server cannot open any of them.
    `CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('passkey', 'passphrase', 'recovery')),
      credential_id TEXT REFERENCES credentials(id) ON DELETE CASCADE,
      kdf TEXT,
      ak_id TEXT NOT NULL,
      sealed TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      verified_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    // Only the SHA-256 of each session token is kept.
    `CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      credential_id TEXT,
      scope TEXT NOT NULL DEFAULT 'full',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    // Every record, as ciphertext. rev is the version the client wrote (compare-and-set), seq is
    // the server's change counter that devices pull from. sealed IS NULL means deleted.
    `CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      rev INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      sealed TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS records_seq ON records (seq)`,
    // Files in R2 (sealed photos). Which record owns a file is inside that record, not here.
    `CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    // The daily reminder, one row per device: where to push, and when on its own clock. The
    // pushes carry no content (worker/lib/push.ts), so no payload keys are kept.
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      remind_at TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      last_sent TEXT,
      created_at INTEGER NOT NULL
    )`,
    // The server's own few values: 'vapid' (the reminder's key pair) and 'written' (the last
    // date something was written, so the reminder can skip it).
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
];
