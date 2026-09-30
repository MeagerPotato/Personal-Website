# AGENTS.md

Shared rules for every coding agent in this repo (Claude Code, OpenAI Codex "Astra") and for humans.
`CLAUDE.md` imports this file. The full reasoning lives in [docs/PLAN.md](docs/PLAN.md), and how
the pieces fit (layers, the life of a frame, conventions) in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); this page is the short version you must not break.

## What this is

**allenkh.com**: Allen's personal site as a small universe you can fly through. Solar systems are
passions, planets are projects, moons are sub-projects. Look: Mini Motorways (muted pastels, flat
shading) on dark navy space. Tone: playful framing, technical substance. The owner appears as
"Allen"; only the resume page (and its print and PDF) gives the full name (`site.fullName`,
docs/PLAN.md decision 25).

Status: Phase 0 (foundations) is built; **Phase 2's web track** is under way: the content layer
and every v0.1 page exist (home, about, resume, contact, projects, systems) and read well in plain
mode. In universe mode the **router** keeps the canvas alive across pages (soft navigation) and
the page's content sits in a **panel** over the world (side panel on wide screens, bottom sheet on
narrow ones). **Phase 1 (flight) is built** (its gate: below): the engine runs on a fixed 60 Hz simulation
clock; a procedural rocket flies with keyboard or touch, followed by the chase camera; and the
**galaxy is built from the real `/universe.json`**: generated planets and moons, suns, the station
and the satellite, all moving on their orbits. Let go of the controls near a planet and the
**orbit assist** eases the ship onto a ring around it; planets cannot be crashed into, and space
has a soft edge. Three **quality tiers** (anti-aliasing everywhere, bloom and a vignette where the
device can afford them) and a lost WebGL context is survived. **Docking** works inside the world:
within reach of a body a quiet prompt offers to orbit it (`E`, or tap it), the ship is flown onto
the ring and then carried round it, and steering away leaves. **The route and the ship follow
each other**: a link flies the ship to that page's body with the **autopilot** (the page opens at
once), docking from inside the world opens the body's page, and a page opened directly boots in
orbit. Bodies carry **names** (real buttons), and pointing at a planet or its name flies there.
Allen's profiles elsewhere (GitHub, LinkedIn) circle home as **relays** nothing docks at: their
names are real links, and pointing at one only brings its link forward. A first-time visitor gets
a **hint card**. **The star map** (`M`, the Map button, scroll out) is
Phase 3's first step and is built: another way of LOOKING at the same world, which the navigator,
the URL and the panel know nothing about. **The systems sit close together** (the honeycomb
"cluster"), the autopilot docks every journey in today's galaxy (median 2.5 s, p90 3.3 s, the
slowest 5.02 s), and every way a journey is handed back at speed (Stop, a key, the web layer
letting go, a reload) brakes or guards the ship: docs/PLAN.md §5.5, "the cluster"; `npm run
journeys` is its gate. **The visual identity pass (A1) is done**: Claude did the packet at Allen's
request, in the "roadmap" direction (one face, Outfit; route lines and stations; docs/DESIGN.md holds every decision). Visits
are counted since 2026-09-29 (Cloudflare Web Analytics, `src/shell/analytics.ts`). What Phase 2
still lacks before launch: Allen's copy edit (docs/runbooks/copy-edit.md). Phase 1's exit gate, the playtest: Allen did
some of it on 2026-09-28 and accepted it ("everything is okay for now"); the feel gets its polish
later, and the real-device checks stay in docs/runbooks/launch-checklist.md §3. **Allen's tree of
solar systems** arrived on 2026-09-30 and is being built (docs/PLAN.md §9): **Projects is a binary
star**, two suns (Software and Hardware) circling one slot, with `/projects/` as its page and a
page for each sun; the old `/systems/code/` answers 301 to `/systems/software/`
(`public/_redirects`). Research and Hackathons come next.
Roadmap and "as built" notes: docs/PLAN.md §5.5 and §6.

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
7. **Only `src/shell/router.ts` may write `history`.** The engine emits intents. And the
   router's own rule: **a soft navigation is only an optimisation of a hard one.** Both must end
   in the same DOM, and on any doubt (failed fetch, non-HTML, a new deploy, a plain-only page)
   the router lets the browser load the page normally. Plain mode never loads the router.
8. **Colours live in `src/universe/design/tokens.ts` and nowhere else.** CSS reads them as custom
   properties (`color.ink.high` → `--color-ink-high`). The engine renders with no tone mapping, so
   a lit surface is exactly the token hex and 3D matches the DOM.
9. **Whoever creates a GPU resource disposes it.** Every engine system implements `dispose()`.
   In a dev build the engine counts what is left when it is disposed and warns in the console.
10. **Thin Astro.** Astro pre-renders pages and owns the content layer. `astro:*` imports only in
    `src/pages`, `src/layouts`, `src/components`. No `<ClientRouter/>`, islands, scoped `<style>`
    blocks, middleware, adapters, or MDX. `.astro` files are markup: anything with an `if` in it
    is a plain function in `src/site/` with a test beside it.
11. **The swap contract.** Outside `<main>` and the `<head>` nodes marked `data-page-head`, every
    page is byte-identical, and every page has exactly one `<h1>`. The router (Phase 2) swaps only
    those parts, so this is what makes a soft navigation end in the same DOM as a hard one. One
    documented exception: `aria-current` on the main nav, derived by `src/site/nav.ts` on both
    sides. The plain-only 404 is exempt. `verify-dist` enforces all of it.

Invariants 5, 6, 7 and 10 (its import rule) are lint rules (`eslint.config.js`); `tests/lint-boundaries.test.ts`
proves they still bite. **Flat-config gotcha:** a later block's rule _replaces_ an earlier block's
same rule for the same file. Options never merge. Edit the shared constants, not one block.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server. Does **not** apply `_headers`, so CSP bugs are invisible here. |
| `npm run build` | asset checks → `astro build` → `dist/_headers` with CSP hashes |
| `npm run preview` | `wrangler dev` serving `dist/` the way Cloudflare will (headers, 404, slashes). Build first; **restart it after every rebuild**, its manifest goes stale. |
| `npm run verify` | format check → lint → `astro check` → Vitest → build → `verify-dist`. **Run before every commit.** CI runs exactly this. |
| `npm run e2e` | build → Playwright (`tests/e2e`): Chromium, WebKit and a phone-sized Chromium against `wrangler dev` on its own port, over HTTPS. Needs `npx playwright install chromium webkit` once. **Not** part of `verify`: CI runs it as a second, non-required job. |
| `npm run journeys` | The journey-time harness (`scripts/journeys`): flies every pair of bodies headless through the real simulation, in the real galaxy and in grown ones of 4, 6 and 8 systems, and prints how long each takes to dock (median, p90, max), how close it came to anything, and the failures. It **fails on a breach of the gate** (`scripts/journeys/gate.ts`, each breach printed in words): the real galaxy no failures, p90 ≤ 4.2 s, the slowest ≤ 6.5 s, at most 1.5% over 5 s; the grown ones no failures; stress and Stop, when run, no failures. `JOURNEYS` (JSON or a file, e.g. `scripts/journeys/example.json`) compares variants of layout and tuning; `JOURNEYS_OUT` writes every journey. About 30 s (a minute with `"stop": true`). `"stress": true` also changes the visitor's mind at every moment of a sample of journeys (a new destination, Stop, a body within reach at speed, Stop then E, a tap of the controls instead of Stop, a double tap, the web layer letting go (`undock`, a page with no body), a body raced past and then back, a chain of names, the engine rebuilt from its snapshot, a page load; taps and letting go also in the first second of an orbit; `kinds` adds journeys within a system and from the spawn point): with every kind and Stop, 2 to 11 minutes a galaxy (run one per process), and 0 failures is the gate for a change to the autopilot, the approach, Stop, the guard or the snapshot: every way a journey is handed back (Stop, a tap, a double tap, the web layer, a page load) is in it. **Not** part of `verify`: run it after touching the autopilot, docking or the layout; CI runs it as a non-required job on pull requests that touch the content (or `src/site`, which reads it), the site config, the engine or the harness. |
| `npm run resume-pdf` | build → prints `/resume/` through the print stylesheet into `public/allen-hsieh-resume.pdf` (Playwright's Chromium) and records what it printed from in `config/resume-pdf.json`. `verify-dist` fails a build whose resume page or print stylesheet changed since, so run it after any resume change and commit both files. |
| `npm run format` | Prettier. Markdown and `src/content/**` are deliberately not formatted. |

Node 24 (`.node-version`), npm 11. npm scripts run in `cmd.exe` on Windows: Node scripts only, no
`VAR=x` prefixes, no shell globs.

**Debug flags** (universe mode, read once at boot, combine with `&`): `?perf` shows frame rate,
frame time, simulation steps per frame, draw calls, buffer size, the ship's speed and what the
orbit assist is doing, in **every** build, so it works on a phone against a preview URL.
`?q=low`, `?q=medium` or `?q=high` forces a quality tier (and switches the probe off). `?tweak`
opens the live tuning panel (sliders for the blocks of `design/tuning.ts` that are read every
frame, "copy tuning as JSON" to paste back into that file, and a flight recorder; its replays are
exact in open space and approximate near planets, which have moved on by then). The panel is
**dev server only**: `verify-dist` fails a build that contains it.

**The lab** (`http://localhost:4321/lab/`, dev server only) shows ONE thing on a turntable: a
planet of any biome (or planned work's maquette), a moon, a sun, the rocket with its flame, the
station, the satellite, a profile's relay, in front of the real sky and lit and post-processed as
in the universe, with sliders for the `shading`, `planet`, `world`, `post` and `ship` blocks, the
light's direction, and the tier.
Judge a model, a biome or a shading change here first, then in flight. Its page is
`src/pages/_lab.astro` (the underscore keeps it out of every build; `astro.config.ts` injects the
route for the dev server alone) and its scene is `src/universe/lab/LabScene.ts`. A new kind of
asset gets a subject there.

## Newer than your training data

Do not "fix" these back to what you remember. `npm run verify` is the arbiter.

- **Astro 7** on **Vite 8 (Rolldown)**: `build.rolldownOptions`, not `rollupOptions`. Rust compiler:
  invalid HTML is a build error. Content config is `src/content.config.ts` with `glob()` loaders;
  entries have `id` (no `slug`); `render(entry)` comes from `astro:content`; Zod 4 from `astro/zod`.
- **three r186**, pinned exactly. Types are the separate `@types/three`. three ALWAYS gives the
  canvas an alpha channel, whatever `alpha` you pass (that option only sets the clear alpha). Colour management is on by default; custom shaders end with
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
| `src/universe/design/**` | tokens, tuning, `materials.ts` (which token feeds which shader input), `shaders/` (GLSL), `models/` (procedural models), `assets.ts` (the asset manifest), `worlds.ts` (bodies with a look of their own) | **Astra**, Claude |
| `src/styles/**` | the one global stylesheet set | **Astra**, Claude |
| `public/models/**` | `.glb` models (from Phase 3) | **Astra**, Claude |
| `src/universe/**` (rest) | engine: `api.ts`, `main.ts`, `manifest.ts` (reads `/universe.json`), `core/`, `sim/`, `ship/`, `camera/`, `world/` … | Claude |
| `src/shell/**` | client code outside the engine: mode, boot, watchdog, router (`navigation.ts` rules, `swap.ts` DOM, `router.ts` history), `panel.ts` | Claude |
| `src/site/**`, `src/config/**` | framework-neutral build logic and site constants | Claude |
| `src/pages`, `src/layouts`, `src/components` | markup-only `.astro` | Claude |
| `src/content/**`, `src/content.config.ts` | Markdown copy with images beside it; the thin collections wrapper | Claude drafts, Allen edits |
| `src/universe/data/**` | pure build-time logic: validates content, lays out the galaxy | Claude |
| `scripts/**`, `config/**`, `tests/**`, `.github/**` | build, CSP template, dist contract tests, CI | Claude |
| `sites/**` | the subdomain sites (journal.allenkh.com, blog.allenkh.com) and their shared packages: **its own npm workspace with its own rules**, [sites/AGENTS.md](sites/AGENTS.md) | Claude |
| Cloudflare dashboard, DNS | | **Allen only** |
| GitHub repo settings, branch protection | set once by Claude in Phase 0 (docs/PLAN.md §6, step 7) | **Allen** from then on |

In the design surface, **values are free to change; keys are API.** Renaming or removing a key is
a logic change: ask for it instead. The subdomain sites read `tokens.ts` and `src/site/contrast.ts`
too (`sites/packages/design`), so their keys and exports are API there as well; `sites/`'s own
verify (CI's Sites workflow) runs whenever either changes.

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
`--<path-in-kebab-case>` on `:root`. Use it; never copy its value. The site's pictures read the
tokens too: `/favicon.svg` and `/apple-touch-icon.png` (`src/site/favicon.ts`) and the link-preview
card (`src/site/og.ts`) are drawn at build time, so a palette change repaints them. `public/`
holds no picture with colours of its own.

**Add a material or a shader.** GLSL goes in `design/shaders/<name>.ts` with its uniforms listed
in the header comment (uniform names are the contract with logic). A factory in
`design/materials.ts` binds tokens and tuning to those uniforms; logic asks for a material by what
it is for and tracks it in a `Scope`. Custom shaders end with `#include <colorspace_fragment>`.
**Alpha is the bloom guest list** (`shaders/post.ts`): an opaque shader writes
`1.0 - uBloomMask` there (or, if it glows, its bloom amount: see `shaders/glow.ts`), and a
see-through material goes through `keepBloomMask()` so that blending leaves alpha alone. A shader
that writes a plain 1.0 makes its whole surface bloom.
Anything that is part of the sky draws at the far plane (`clip.z = clip.w`) and ignores the
camera's position: see `shaders/sky.ts`.

**Add a model.** A function in `design/models/<name>.ts` that returns `ModelData`: a mesh built
with `MeshBuilder` (`sim/meshBuilder.ts`: lathe, plate, disc, cap; pure, so a test can measure the
model) plus named **sockets** for whatever attaches to it. Colours are tokens through
`hexToLinear`. Conventions: +Z forward, +Y up, 1 unit = 1 u. Register it in `design/assets.ts`;
logic gets it with `assets.acquire('<name>', material)` (`core/AssetStore.ts`), brings its own
material, and releases the handle in its scope. Asset names and socket names are API.

**Give a body a world of its own.** Every body is generated from its content (biome, size, rings)
and its seed; one that should look like no other gets a recipe in `design/worlds.ts`, keyed by its
manifest id (`project/<id>`, `system/<id>`, `page/<id>`): another biome, a changed `PlanetLook`, a
ring or none, or a registered model instead of the globe. `world/looks.ts` (`lookOf`) is the one
place that decides a look (recipe, then the planned maquette, then the generator), for the galaxy
and the lab alike, and `tests/worlds.test.ts` fails on a key that names no body. A new kind of
thing a recipe can say is a logic change.

**Where things are.** Nobody stores a world position. `sim/orbits.ts` gives the position (and
velocity) of every body as a pure function of time: the simulation asks for the time of its step,
a view for the exact time of its frame (`frame.simTime - (1 - frame.alpha) / stepHz`). Anything
that takes more than a millisecond to build (a planet mesh) is a generator run through
`core/jobs.ts`, a slice per frame.

**What the world does to the ship** is one pure function, `flyStep` in `sim/surroundings.ts`: the
orbit assist (`sim/assist.ts`) mixes a virtual pilot into the real pilot's input, the cushions and
the edge of the world (`sim/collide.ts`) push, `stepFlight` flies, and the shells put back
whatever got through. Far from everything, and at any speed the pilot's own drive can reach, it
is `stepFlight`, bit for bit. Anything new that steers or pushes the ship (docking, the autopilot,
Stop's brake) joins it there, where it can be tested headless.

**Add a tuning constant.** Add it to `design/tuning.ts` under the system that reads it, with a
unit in the name or comment (`driftRadPerSec`). Logic reads tuning; tuning never imports logic.

**Add an engine system.** A class implementing `System` from `core/Engine.ts` under
`src/universe/world/` (or a sibling folder); add it in `main.ts`, where order is explicit.
**Simulate in `fixedUpdate(dt)`** (always 1/60 s, so flight is identical on every display) and
**draw in `frameUpdate(frame)`**, interpolating between the last two simulation states by
`frame.alpha`; never advance the simulation from a frame. Track every geometry, material and
texture in a `Scope` (`core/scope.ts`) and dispose the scope in `dispose()`. Pure maths goes in
`sim/` with a `*.test.ts` beside it.

**State that must survive.** The engine can be thrown away and built again at any moment: when
the browser takes the WebGL context (a phone tab in the background), `api.ts` takes a `Snapshot`
(`core/snapshot.ts`), disposes the engine, canvas and all, and boots a new one from it. So state
lives in exactly one of two places: it follows from the simulation step count (where every planet
is), or it is a field of the snapshot (the ship, and the dock it is headed for or carried by).
Anything new that a visitor would miss after a rebuild becomes a snapshot field. A snapshot is
only believed in the galaxy it was taken in (`galaxyKey` in `manifest.ts`), so a new manifest
field that moves or sizes a body goes into that key too.

**Where the visitor is headed** has one owner, `state/Navigator.ts`: it turns requests
(`approach`, `place`, `release`) into simulation state (`sim/docking.ts`), keeps the app state
machine (`state/appMachine.ts`: flight, autopilot, approach, docked) in step with what the
simulation then does, and reports it as events, delivered with the frame. Both directions are
**idempotent** on purpose: the visitor may dock from inside the world and the web layer follows,
or the route may change and the ship follows, and telling either side what it already knows is
never an error. Interactive DOM made by the engine (the prompt, later the labels) goes into
`#universe-overlay`, never into `#universe-host`, which is hidden from assistive technology.

**Add an end-to-end test.** `tests/e2e/<area>.spec.ts`, importing `test` and `expect` from
`./support` (never from `@playwright/test`: the fixtures live there). Read state from the data
attributes on `<html>`, wait for outcomes and never for a number of seconds, and point at moving
things with `pointAt` (a planet's name never holds still for Playwright's own click).

**Add a page.** `src/pages/<slug>.astro` using `layouts/Base.astro` with `title` (through
`pageTitle()` from `src/site/seo.ts`) and `description`, then `components/PageHeader.astro` for
the one `<h1>`. Build internal links with `src/site/routes.ts`; they end with `/`. No `<script>`
or `<style>` in the page, and nothing per-page outside `<main>` (invariant 11). A page that
belongs in the main nav is one line in `src/config/site.ts`. For search engines and link
previews, pass `jsonLd` (nodes from `src/site/seo.ts`) and, if the page has a picture of its
own, `image`; otherwise it gets the site's card, `/og/default.png`, which
`src/site/og.ts` draws from the tokens. Any new per-page `<head>` node needs `data-page-head`.

**The panel's one rule.** In universe mode the panel's state is a function of the URL
(`src/shell/panel.ts`): every page except the home page is a destination, its panel is open, and
closing it means LEAVING (`router.leave()`: back if the visitor came from one of our pages, else
home). Only the home page's welcome text is a toggle. State lives on `<html>` as `data-panel`,
`data-panel-home`, `data-panel-size`; CSS does the showing. Never add a second way to hide a
destination's panel: Back would stop meaning what it looks like.

**Link to something the router must leave alone.** It already leaves alone other sites, files
(any path with an extension), downloads, `target`, modified clicks, and anchors on the page that is
showing. For anything else (the mode switches are the example), add `data-router-ignore` to the
link or to an ancestor.

**Style something new.** One stylesheet, `src/styles/global.css`, in the section its header
comment names. Colours only through tokens: a solar system's family arrives as `--theme-*` under
`[data-theme]` (its glyph too, `--theme-glyph`), a planet's palette as `--planet-*` under
`[data-biome]`. Butter means "here" and the cream face means "on" (docs/DESIGN.md): never give
either another job. The one exception: the home system's family is butter, which is why a
focused butter key keeps a navy rim. A hover that lights a key or a chip goes inside
`@media (hover: hover)`, and anything that moves on hover or press uses `translate`, never `transform` (the engine owns that).
Check 360 px wide, and check print if the resume could be affected.

**Edit the resume.** `src/content/resume.yaml`: one entry per section, items in the order they
should appear, dates as you would write them on paper ("Summer 2025"). `/resume/` and its print
stylesheet render it; a missing or empty section fails the build. Then `npm run resume-pdf`: the
page offers a PDF printed from itself, and `verify-dist` refuses one that no longer matches it.
The resume page is the one place that gives the name in full (`site.fullName`). No phone number,
no private email: `tests/privacy.test.ts` scans the whole repository for both.

**Add a project (a planet).** Create `src/content/projects/<id>/index.md`, with its cover image
beside it if it has one. The folder name is the id and the URL (`/projects/<id>/`), so lowercase kebab-case.
Frontmatter is validated by `src/site/schemas.ts` (unknown keys fail the build): `title`,
`summary` (≤ 160 chars), `system: <sun id>`, `date: "YYYY-MM"` in quotes, `status` (`shipped`;
`completed`, finished work that was never a product, like a team or a program; `in-progress`;
`archived`; `planned`, which may leave out the date and the role), `role`, `planet: { biome }`;
optional `cover: { src: ./cover.png, alt }` (without one the page shows its planet), `stack`,
`links` (https only), `gallery`, `related`, `flagship`, `draft`. Copy the shape of
`projects/days2meet/index.md`.
Images are served as AVIF with a WebP fallback at three widths (`components/Shot.astro`), so
commit one good source image, at least 1200 px wide, and let the build do the rest.

**Add a moon (a sub-project).** Exactly the same, with `parent: <project id>` instead of `system`.
Moons cannot have moons. Promoting a moon to a planet is swapping that one line; the URL stays.

**Add a solar system (a passion).** `src/content/systems/<id>.md` with `name`, `tagline`, `theme`
(a colour family from `tokens.color.system`) and the next unused `order`. **Never renumber
`order`:** it is the system's place in the galaxy.

**A binary star, and its suns.** Two suns circling one slot (`systems/projects.md`): the binary's
file has `name`, `theme`, `order` and `suns: [primary, secondary]`, no tagline and no text, and no
page of its own (its page is the projects index, shown in the universe from the primary). Each
sun is a file of its own with `name` and `tagline` and its text: no `order`, `theme` or
`position`, since it goes where its binary goes and wears its family; its page is
`/systems/<id>/`. Planets name a SUN (`system: software`), never the binary; the build says so
if one does. A binary is the one exception to "adding a project moves nothing": a planet under
one sun moves the other sun's orbit, the separation and the pair's period (docs/PLAN.md §5.4).
And `tests/families.test.ts` pins which families the autopilot goes round as one disc: if a
content change flips one, run `npm run journeys` before updating its list. `tests/ship-light.test.ts`
pins how far a ship on each ring near the gap is lit off its own sun (the other sun pulls there
too): if one moves, look at it in flight before updating that list.

**Retire a URL** (a renamed system, a moved page). One line in `public/_redirects`,
`/old/ /new/ 301`, and the same without the slash: exact paths only, never a wildcard. The
destination must be a page of the build and no page may link to the old path (`verify-dist`,
check 3b); `tests/e2e/tree.spec.ts` shows `wrangler dev` answering it.

**Add a profile (a network elsewhere: GitHub, LinkedIn, Devpost).** Give its https URL in
`site.socials` (`src/config/site.ts`), the one place the URLs live: the home page's "Elsewhere", the
contact page, the JSON-LD `sameAs` and a relay circling home (its name a real link) all follow, and
nothing that exists moves. Devpost is that one line. A new relay is a new body, so it changes the
galaxy's key (`galaxyKey`, `src/universe/manifest.ts`): each open tab's saved pose is dropped once
on that deploy, as for any new body, and the ship starts afresh. A network the site does not know
yet is an entry in `PROFILE` (`src/site/profiles.ts`): its label, its note for the home page, and
the next free `slot` (1 to 7), its place on the Contact satellite's ring in steps of 45 degrees.
**Never renumber a slot:** it is where the relay flies. The resume keeps its own two links, so a new
profile never changes its PDF. A relay is a body nothing docks at (`docks: false` in the manifest):
the autopilot, the assist and the journeys harness go round it.

**Unfinished copy.** Write `TODO(copy)` where words are missing and, on a project, set
`draft: true`. Drafts show in `npm run dev` and are left out of production. Pages (about, resume,
contact) have no draft flag: they must be finished before they are rendered, because `TODO(copy)`
anywhere in `dist/` fails the build.

**What checks content.** Schemas catch shape. `buildUniverse()` (`src/universe/data/build.ts`)
catches what a schema cannot: a missing `system`/`parent`/`related` target, a moon of a moon, a
published moon under a draft planet, two systems claiming one `order`, a system grown too large.
It lists every problem at once, and its output is the static `/universe.json` the engine reads.

**Add a log post.** The blog is its own site at `blog.allenkh.com` (`sites/blog`, planned in
sites/docs/PLAN.md), and posts are written in its studio in the browser, not in this repository;
nothing on this site hosts posts.

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
