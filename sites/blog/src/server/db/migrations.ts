/**
 * The blog's D1 schema, applied by the Worker itself (db/migrate.ts) the first time an isolate
 * touches the database, so a deploy needs no database step of its own.
 *
 * APPEND ONLY. A migration that has shipped is never edited: add the next one. Each is a list of
 * statements run in one batch (a transaction), together with the bump of `schema.version`.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  // 1: the first schema.
  [
    // A post has two lives: the DRAFT the studio saves as Allen writes (JSON, `draft_rev` counts
    // saves, so two open tabs cannot overwrite each other), and the LIVE version readers see,
    // copied from a draft when it is published and rendered to HTML once, then. `published_rev`
    // is the draft that is live; a draft saved since is "changes not yet published".
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      draft TEXT NOT NULL,
      draft_rev INTEGER NOT NULL DEFAULT 1,
      draft_saved_at INTEGER NOT NULL,
      slug TEXT UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      words INTEGER NOT NULL DEFAULT 0,
      toc TEXT NOT NULL DEFAULT '[]',
      style_hashes TEXT NOT NULL DEFAULT '[]',
      cover TEXT,
      series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
      series_part INTEGER,
      published_rev INTEGER,
      published_at INTEGER,
      updated_at INTEGER,
      notified_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS posts_live ON posts (status, published_at)`,
    `CREATE INDEX IF NOT EXISTS posts_series ON posts (series_id, series_part)`,
    // A published post's earlier addresses, so an old link still arrives (301).
    `CREATE TABLE IF NOT EXISTS slug_history (
      slug TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    // Tags wear one of the five colour families, like Notion's select options.
    `CREATE TABLE IF NOT EXISTS tags (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      family TEXT NOT NULL CHECK (family IN ('coral', 'butter', 'mint', 'sky', 'lilac')),
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    // The LIVE version's tags (a draft's are in its JSON until it is published).
    `CREATE TABLE IF NOT EXISTS post_tags (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag TEXT NOT NULL REFERENCES tags(slug) ON DELETE CASCADE ON UPDATE CASCADE,
      PRIMARY KEY (post_id, tag)
    )`,
    `CREATE INDEX IF NOT EXISTS post_tags_tag ON post_tags (tag)`,
    // An uploaded image: stored in R2 as media/<id>/<width>.<ext>, one file per width the studio
    // made on the device (EXIF, and with it any location, gone in the re-encoding).
    `CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('image/webp', 'image/jpeg', 'image/png')),
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      widths TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    // Readers' comments wait as 'pending' until Allen approves them. No address, no email:
    // a name and the words. `author` marks Allen's own replies, written in the studio.
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'spam')),
      author INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      approved_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS comments_status ON comments (status, created_at)`,
    // Email subscribers, double opt-in: 'pending' until the link in the confirmation is used.
    // Only the SHA-256 of that link's token is kept; the unsubscribe token goes in every email.
    `CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed')),
      confirm_hash TEXT,
      confirm_sent_at INTEGER,
      unsubscribe_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      unsubscribed_at INTEGER
    )`,
    // Mail waiting to go out (server/mail.ts): sent by the cron in batches, retried on failure.
    // One (kind, ref, address) is sent once: a post is never announced twice to anyone.
    `CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL DEFAULT '',
      to_addr TEXT NOT NULL,
      subject TEXT NOT NULL,
      html TEXT NOT NULL,
      text TEXT NOT NULL,
      headers TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      send_after INTEGER NOT NULL,
      sent_at INTEGER
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS outbox_once ON outbox (kind, ref, to_addr)`,
    `CREATE INDEX IF NOT EXISTS outbox_queue ON outbox (status, send_after)`,
    // The studio's passkeys. rp.id is blog.allenkh.com; public keys only.
    `CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      aaguid TEXT,
      label TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
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
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    // The server's own few values: 'form_key' (signs the readers' forms' timestamps).
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
];
