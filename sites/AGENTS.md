# sites/AGENTS.md

Rules for every agent (and human) working in `sites/`: the sites on allenkh.com's subdomains and
the packages they share. `sites/CLAUDE.md` imports this file. The plan and its reasons are in
[docs/PLAN.md](docs/PLAN.md); the journal's security design, which the code cites by section, is
[docs/journal-crypto.md](docs/journal-crypto.md).

The repository's own [AGENTS.md](../AGENTS.md) is about allenkh.com. Its **Never** list and its
way of working (branches, PRs, commits, asking Allen) apply here too; its invariants about the
engine, the router and "thin Astro" do not.

## What this is

| Path | What |
| --- | --- |
| `packages/design` | `@allenkh/design`: tokens (the main site's palette plus paper), base and prose styles, icons, PWA helpers |
| `packages/editor` | `@allenkh/editor`: the Notion-style editor (Tiptap 3), its schema, and an HTML renderer that needs no browser |
| `journal/` | journal.allenkh.com: an end-to-end encrypted journal. Vite + React app (`src/`), Hono Worker (`worker/`), service worker (`sw/`) |
| `blog/` | blog.allenkh.com: planned (docs/PLAN.md, step B1) |
| `docs/` | the plan, the journal's crypto design, runbooks |

Status: the journal is built and waiting for its Cloudflare setup
([runbook](docs/runbooks/cloudflare-setup.md)); the blog is next.

## Invariants

1. **Its own workspace.** Run npm inside `sites/`; the repository root installs nothing from
   here. A package another package uses is a workspace package (`@allenkh/*`), never a relative
   import across apps.
2. **Colours live in `packages/design/src/tokens.ts`,** which imports the main site's palette
   (`src/universe/design/tokens.ts`) and adds only the paper surfaces. Stylesheets read custom
   properties (`--ink-high`, `--coral-tint`); a hex colour anywhere else is a bug.
   `contrast.test.ts` measures every pairing the stylesheets rely on: add yours there.
3. **The journal's promise:** nothing readable leaves Allen's devices. Every record and file is
   sealed by `journal/src/vault/` before it is stored or sent; ids say nothing; the server
   refuses any request carrying a passkey's PRF result. A change to what the server can see
   (a new plaintext column, a new request field) changes
   [journal-crypto.md](docs/journal-crypto.md) in the same PR, or it does not happen.
4. **Formats are forever.** The magic bytes and versions of sealed data, every associated-data
   and HKDF label (`allenkh-journal:v1:…`), and how ids are derived: changing one makes existing
   journals unreadable. A new format gets a new version, and readers keep the old one.
5. **Records are read defensively.** A decrypted document goes through `model/normalize.ts`
   (every field checked, unknown fields kept) and conflicting edits through `journal/merge.ts`
   (no writing is ever lost). A new field gets both.
6. **D1 migrations are append-only** (`journal/worker/db/migrations.ts`, applied by the Worker
   itself). A shipped migration is never edited: add the next one.
7. **The journal talks to no one else.** No analytics, fonts, CDNs or third-party scripts; the
   Content-Security-Policy in `journal/public/_headers` is the contract (no inline script, no
   `unsafe-inline`, `connect-src 'self'`). Logs never contain journal content.
8. **The editor's schema is shared and stored.** Both sites keep editor documents, so a node or
   mark that changes must still read every document written before; add, never rename.
9. **Accessible in both themes.** Every screen passes axe in day and night (the e2e sweep checks
   each one), has exactly one `<h1>`, and keeps targets at 24 px or more.

## Commands

Run from `sites/`.

| Command | What it does |
| --- | --- |
| `npm run verify` | format check → lint → typecheck → Vitest → build every app. **Run before every commit that touches `sites/`.** CI runs exactly this (`.github/workflows/sites.yml`). |
| `npm run dev --workspace=journal` | The journal on `http://localhost:5173`, its Worker in workerd with a local D1 and R2. Copy `journal/.dev.vars.example` to `.dev.vars` first. |
| `npm run e2e --workspace=journal` | build → Playwright: Chromium against `wrangler dev` over HTTPS, virtual passkeys with PRF, a fresh database each run. Needs `npx playwright install chromium` once. With the environment variable `E2E_SHOTS` set to a folder, it also saves a screenshot of every screen in both themes there. |
| `npm run cf-typegen --workspace=journal` | Regenerates `worker/worker-configuration.d.ts` after a change to `wrangler.jsonc`. |
| `npm run format` | Prettier (Markdown is left alone). |

Node 24 (`.node-version`), npm 11. Also run the root `npm run verify` before a commit: its privacy
test scans `sites/` too.

## Newer than your training data

Everything the root AGENTS.md lists (Vite 8 on Rolldown, TypeScript 6, ESLint 10 flat config,
Vitest 5, Zod 4, wrangler 4, npm 11 running no dependency install scripts), and:

- **React 19.3**, **Tiptap 3.31** (`@tiptap/react`, `@tiptap/static-renderer`,
  `@tiptap/extension-list`), **lucide-react 1.x**.
- **@cloudflare/vite-plugin 1.x**: `vite dev` runs the Worker in workerd; `vite build` writes
  `dist/client` and the Worker's own `dist/<name>/wrangler.json`, which `wrangler deploy` finds
  through `.wrangler/deploy/config.json`.
- **Hono 4.13**, **@simplewebauthn/server 14**, **idb 8**, **hash-wasm 4** (Argon2id),
  **@scure/bip39 2**.
- Worker tests get a real local D1 and R2 from `getPlatformProxy()` (wrangler), in memory.

## Never

- Deploy from a laptop (`wrangler deploy`, `wrangler versions upload`), or turn on preview
  builds for the journal. Deploys happen from `main` through Workers Builds.
- Touch the Cloudflare dashboard or DNS: those are Allen's, through the runbooks.
- Put a secret in the repository. The journal's one secret, `SETUP_TOKEN`, is set in the
  dashboard; `.dev.vars` is ignored by git.
- Store or send anything from the journal unsealed, or log what a device decrypted.
- Weaken the journal's CSP, add a third party to it, or add an inline script.

## Recipes

**Add a field to a journal record.** Add it to the type in `model/types.ts` and its default in
`model/records.ts`; read it in `model/normalize.ts` (checked, with a default for older records);
decide how two devices' edits merge (`journal/merge.ts` handles plain values, sets and objects;
rich text keeps both versions). Nothing changes on the server: it only ever sees the sealed
record.

**Add a kind of journal record.** As above, plus its id: keyed (`vault/ids.ts`, from a name
every device can compute, like `day:2026-09-29`) when two devices must meet in one record, random
otherwise. Kinds are never visible to the server; do not put one in an id.

**Change the server's schema.** Append a migration to `worker/db/migrations.ts`, statements
harmless the second time (`IF NOT EXISTS`). If it adds anything readable, update "What the
server knows" in journal-crypto.md.

**Add a screen to the journal.** A component in `src/screens/`, a route in `src/app/router.ts`
and `src/app/Screen.tsx`, and the screen in the e2e accessibility sweep
(`tests/e2e/journal.spec.ts`).

**Add a block to the editor.** The node goes in `packages/editor/src/schema.ts` (so the renderer
knows it too), its menu entry in `blocks.ts`, its styles in `styles/editor.css` and
`packages/design/styles/prose.css`, and a round-trip test through `render.ts`.

**Add a colour.** A key in `packages/design/src/tokens.ts` (in both themes), used as its custom
property, with its pairings in `contrast.test.ts`.
