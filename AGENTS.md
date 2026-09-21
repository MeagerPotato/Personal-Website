# AGENTS.md

Shared rules for every coding agent in this repo (Claude Code, OpenAI Codex "Astra") and for humans.
`CLAUDE.md` imports this file. The full reasoning lives in [docs/PLAN.md](docs/PLAN.md); this page
is the short version you must not break.

## What this is

**allenkh.com**: Allen's personal site as a small universe you can fly through. Solar systems are
passions, planets are projects, moons are sub-projects. Look: Mini Motorways (muted pastels, flat
shading) on dark navy space. Tone: playful framing, technical substance. The owner appears as
"Allen", nothing more.

Status: Phase 0 (foundations) is built; **Phase 2's web track** is under way: the content layer
exists (collections, schemas, the galaxy builder, `/universe.json`), the real pages come next.
Phase 1 (flight) has not started, and Phase 2's 3D half waits for it. Roadmap: docs/PLAN.md §6.

## Invariants

1. **One URL, two modes.** Every route is a real pre-rendered HTML page holding the full content.
   _Plain mode_ is the base CSS with no attribute set. _Universe mode_ boots the 3D engine on top
   and the page's `<main>` becomes the info panel. Content is written once.
2. **Plain mode never downloads three.js and ships no framework JavaScript.** The engine is only
   reachable through a dynamic `import()`. `scripts/verify-dist.mjs` fails the build otherwise, and
   enforces gzip weight budgets for both modes.
3. **Load chain:** `src/shell/mode.inline.js` (sets `html[data-mode]` before first paint) →
   `src/shell/boot.ts` → `import('./universe-shell')` → `import('../universe/api')`.
4. **Exactly one inline script**, `mode.inline.js`: ES5, shipped verbatim, its hash written into
   the CSP by `scripts/postbuild.mjs`. No other inline scripts and no per-page scripts, ever.
5. **The engine (`src/universe/**`) is framework-free.** The web layer talks to it only through
   `src/universe/api.ts`. The engine never imports from the web layer.
6. **`src/universe/sim/**` and `src/universe/data/**` are pure:** no three.js, no DOM, no clock, no
   `Math.random` (use `sim/rng.ts`). They run headless in Vitest.
7. **Only `src/shell/router.ts` (Phase 2) may write `history`.** The engine emits intents.
8. **Colours live in `src/universe/design/tokens.ts` and nowhere else.** CSS reads them as custom
   properties (`color.ink.high` → `--color-ink-high`). The engine renders with no tone mapping, so
   a lit surface is exactly the token hex and 3D matches the DOM.
9. **Whoever creates a GPU resource disposes it.** Every engine system implements `dispose()`.
10. **Thin Astro.** Astro pre-renders pages and owns the content layer. `astro:*` imports only in
    `src/pages`, `src/layouts`, `src/components`. No `<ClientRouter/>`, islands, scoped `<style>`
    blocks, middleware, adapters, or MDX.

Invariants 5, 6, 7 and 10 are lint rules (`eslint.config.js`); `tests/lint-boundaries.test.ts`
proves they still bite. **Flat-config gotcha:** a later block's rule _replaces_ an earlier block's
same rule for the same file. Options never merge. Edit the shared constants, not one block.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server. Does **not** apply `_headers`, so CSP bugs are invisible here. |
| `npm run build` | asset checks → `astro build` → `dist/_headers` with CSP hashes |
| `npm run preview` | `wrangler dev` serving `dist/` the way Cloudflare will (headers, 404, slashes). Build first; **restart it after every rebuild**, its manifest goes stale. |
| `npm run verify` | format check → lint → `astro check` → Vitest → build → `verify-dist`. **Run before every commit.** CI runs exactly this. |
| `npm run format` | Prettier. Markdown and `src/content/**` are deliberately not formatted. |

Node 24 (`.node-version`), npm 11. npm scripts run in `cmd.exe` on Windows: Node scripts only, no
`VAR=x` prefixes, no shell globs.

## Newer than your training data

Do not "fix" these back to what you remember. `npm run verify` is the arbiter.

- **Astro 7** on **Vite 8 (Rolldown)**: `build.rolldownOptions`, not `rollupOptions`. Rust compiler:
  invalid HTML is a build error. Content config is `src/content.config.ts` with `glob()` loaders;
  entries have `id` (no `slug`); `render(entry)` comes from `astro:content`; Zod 4 from `astro/zod`.
- **three r186**, pinned (`postprocessing` peers `three <0.187`). Types are the separate
  `@types/three`. Colour management is on by default; custom shaders end with
  `#include <colorspace_fragment>`.
- **TypeScript 6.0**, not 7 (unsupported by `@astrojs/check` and typescript-eslint).
- **ESLint 10**, flat config only, `defineConfig`/`globalIgnores` from `eslint/config`.
- **Vitest 5**, **Prettier 3.9**, **wrangler 4** (`wrangler.jsonc`, Workers static assets, not Pages).
- **Zod 4:** `z.strictObject`, `z.url()`, and an object with `.default({})` skips inner defaults.
- **npm 11 does not run dependency install scripts.** Nothing here needs them.
- GitHub Actions: `actions/checkout@v7`, `actions/setup-node@v7`.

## Repo map and ownership

| Path | What | Who edits |
| --- | --- | --- |
| `src/universe/design/**` | tokens, tuning, (later) materials, shaders, asset manifest | **Astra**, Claude |
| `src/styles/**` | the one global stylesheet set | **Astra**, Claude |
| `public/models/**` | `.glb` models (from Phase 3) | **Astra**, Claude |
| `src/universe/**` (rest) | engine: `api.ts`, `main.ts`, `core/`, `sim/`, `world/` … | Claude |
| `src/shell/**` | client code outside the engine: mode, boot, watchdog, later router and panel | Claude |
| `src/site/**`, `src/config/**` | framework-neutral build logic and site constants | Claude |
| `src/pages`, `src/layouts`, `src/components` | markup-only `.astro` | Claude |
| `src/content/**`, `src/content.config.ts` | Markdown copy with images beside it; the thin collections wrapper | Claude drafts, Allen edits |
| `src/universe/data/**` | pure build-time logic: validates content, lays out the galaxy | Claude |
| `scripts/**`, `config/**`, `tests/**`, `.github/**` | build, CSP template, dist contract tests, CI | Claude |
| Cloudflare dashboard, DNS | | **Allen only** |
| GitHub repo settings, branch protection | set once by Claude in Phase 0 (docs/PLAN.md §6, step 7) | **Allen** from then on |

In the design surface, **values are free to change; keys are API.** Renaming or removing a key is
a logic change: ask for it instead.

## Never

- Touch DNS, Cloudflare zone settings, or anything that could affect the project sites already
  living on this domain: **`days2meet.allenkh.com`** and **`fishai.allenkh.com`** (both on
  Vercel), and any subdomain added later. No wildcard routes. No `includeSubDomains` on HSTS.
- Run `wrangler deploy` locally. Deploys happen from `main` through Workers Builds.
- Write a phone number, a private email address, or a secret anywhere in the repo.
- Add an inline script, a per-page script, or `unsafe-inline` for scripts in the CSP.
- Write a hex colour outside `tokens.ts` (print CSS uses the keywords `black` and `white`).
- Call `history.pushState`/`replaceState` outside the router, or `Math.random`/`Date.now` in
  `sim/` or `data/`.
- Commit `.gltf`, any file over 5 MiB, names that are not lowercase kebab-case, or Git LFS
  pointers (`scripts/check-assets.mjs` rejects them).
- Add a dependency without naming it and the reason in the PR description.
- Ship placeholder copy. `TODO(copy)` may sit in drafts and in source that is not rendered yet;
  if it reaches `dist/`, `verify-dist` fails the build.
- Commit with `--no-verify`, force-push `main`, or weaken a lint rule or budget to get green.

## Recipes

**Add a design token.** Add the key to `tokens.ts`. It is now also the CSS custom property
`--<path-in-kebab-case>` on `:root`. Use it; never copy its value.

**Add a tuning constant.** Add it to `design/tuning.ts` under the system that reads it, with a
unit in the name or comment (`driftRadPerSec`). Logic reads tuning; tuning never imports logic.

**Add an engine system.** A class implementing `System` from `core/Engine.ts` under
`src/universe/world/` (or a sibling folder); add it in `main.ts`, where order is explicit; dispose
everything you create. Pure maths goes in `sim/` with a `*.test.ts` beside it.

**Add a page.** `src/pages/<slug>.astro` using `layouts/Base.astro` with `title` and
`description`. Internal links end with `/`. No `<script>` or `<style>` in the page.

**Add a project (a planet).** Create `src/content/projects/<id>/index.md` plus a cover image
beside it. The folder name is the id and the URL (`/projects/<id>/`), so lowercase kebab-case.
Frontmatter is validated by `src/site/schemas.ts` (unknown keys fail the build): `title`,
`summary` (≤ 160 chars), `system: <system id>`, `date: "YYYY-MM"` in quotes, `status`, `role`,
`cover: { src: ./cover.png, alt }`, `planet: { biome }`; optional `stack`, `links` (https only),
`gallery`, `related`, `flagship`, `draft`. Copy the shape of `projects/days2meet/index.md`.

**Add a moon (a sub-project).** Exactly the same, with `parent: <project id>` instead of `system`.
Moons cannot have moons. Promoting a moon to a planet is swapping that one line; the URL stays.

**Add a solar system (a passion).** `src/content/systems/<id>.md` with `name`, `tagline`, `theme`
(a colour family from `tokens.color.system`) and the next unused `order`. **Never renumber
`order`:** it is the system's place in the galaxy.

**Unfinished copy.** Write `TODO(copy)` where words are missing and, on a project, set
`draft: true`. Drafts show in `npm run dev` and are left out of production. Pages (about, resume,
contact) have no draft flag: they must be finished before they are rendered, because `TODO(copy)`
anywhere in `dist/` fails the build.

**What checks content.** Schemas catch shape. `buildUniverse()` (`src/universe/data/build.ts`)
catches what a schema cannot: a missing `system`/`parent`/`related` target, a moon of a moon, a
published moon under a draft planet, two systems claiming one `order`, a system grown too large.
It lists every problem at once, and its output is the static `/universe.json` the engine reads.

**Add a log post.** Arrives with the blog (Phase 5).

## Working together

`main` is always deployable and protected (required check `verify`, linear history, squash merges).
Branches: `claude/…`, `astra/NN-…`, `allen/…`, at most 40 lowercase characters (the branch name
becomes a preview hostname). One PR = one step of the plan. Commits: imperative subject, a body
that says why.

### Astra protocol

1. A packet is one file, `docs/handoffs/NN-title.md` (template: `docs/handoffs/TEMPLATE.md`).
   One packet = one session = one PR from branch `astra/NN-title`.
2. Read the packet, then `docs/DESIGN.md`, then only the files the packet lists.
3. Edit only the packet's allow-list (always inside the design surface). Design directly in code:
   no mockups, no new dependencies, no renamed keys.
4. Anything needed outside the allow-list: do not do it. Add a line `ASTRA-REQUEST: …` to the PR
   description and Claude picks it up.
5. Finish with `npm run verify` green and the packet's acceptance checklist ticked in the PR.
