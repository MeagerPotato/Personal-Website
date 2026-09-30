# The subdomain sites: plan

`sites/` holds the sites that live on subdomains of allenkh.com, and what they share:

- **journal.allenkh.com**: a private journal, end-to-end encrypted, installable on every device.
- **blog.allenkh.com**: Allen's blog, written in the browser, read like a Notion page.

This page is the source of truth for both, as `docs/PLAN.md` is for allenkh.com itself. The
short rules for agents are in [sites/AGENTS.md](../AGENTS.md); the journal's security design is
[journal-crypto.md](journal-crypto.md); putting a site on Cloudflare is
[runbooks/cloudflare-setup.md](runbooks/cloudflare-setup.md).

## Context

On 2026-09-29 Allen asked for two things. A blog at blog.allenkh.com, "relatively simple and
clean", in the manner of Notion. And a journal at journal.allenkh.com, to "securely journal and
record events" in his life: DailyBean is the model he likes, but it has too little room to write
and too much behind a paywall, so this one is his own and private, with DailyBean's monthly
overview that can be posted. Both are built first as complete, working sites; the time after
that goes into the details. Later, every site on his subdomains should look like one family.

## 1. Decisions

Answered by Allen on 2026-09-29 unless marked otherwise.

| # | Decision |
| --- | --- |
| 1 | **One workspace, `sites/`,** with its own `package.json` and lockfile. The main site at the repository root installs none of it, and its rules (Astro used thinly, the engine, the budgets) do not apply here. Shared code is a package: `@allenkh/design`, `@allenkh/editor`. |
| 2 | **One look: "Notion, in allenkh.com's colours."** Notion's calm layout, gray interface and generous page, set in the main site's typeface (Outfit), with its five pastel families for tags, callouts and moods. Two themes: **day** (warm paper, navy ink; the default) and **night** (allenkh.com's own navy space). Every colour the main site already has is imported from `src/universe/design/tokens.ts`, never copied; `packages/design/src/tokens.ts` adds only the paper surfaces. |
| 3 | **One editor for both sites:** a Notion-style block editor, built into each site, on **Tiptap 3** (ProseMirror): slash menu, block handles, headings, lists, to-dos, quotes, callouts in the families, toggles, code, dividers, highlights and links. It lives in `@allenkh/editor`, with a renderer that turns a document into HTML without a browser. Fallback, if Tiptap ever disappoints on the iPhone: BlockNote (also ProseMirror, more opinionated), which reads the same kind of document. |
| 4 | **The journal is end-to-end encrypted.** Everything is sealed on the device; the server stores ciphertext. Unlocking is a passkey (WebAuthn's PRF extension), with a printed 24-word recovery phrase as the one way back, and an optional passphrase for a browser that cannot unlock with a passkey. Whole design: [journal-crypto.md](journal-crypto.md). |
| 5 | **The journal is an installable app that works offline**, on an iPhone, a Windows laptop, an iPad and a Mac: a web app (PWA), local-first, with every device holding the whole (sealed) journal and syncing through the server. No app store. |
| 6 | **A day in the journal** holds a mood with activities (DailyBean's beans and icons), free writing in the editor, photos, the song of the day, and life events that also stand on a timeline. |
| 7 | **The journal's extras:** stats and patterns (a year in pixels, mood over time, what goes with good days), a daily reminder, people and places, and prompts and templates. |
| 8 | **The monthly post** is a month review: a page that is "just for me", and a **shareable image** of it (post, story or square) drawn on the device. The journal never publishes anything; sharing the picture is Allen's own act. |
| 9 | **The blog is written in the browser,** in a studio at `blog.allenkh.com/studio` that only Allen can open (passkey). Posts live in the blog's database, not in the repository, so writing one needs no commit and no build. |
| 10 | **The blog has tags and series, math and code, comments, and email subscriptions.** Comments are held until Allen approves them; subscribing is double opt-in (a confirmation email first). |
| 11 | **Hosting is Cloudflare, like the main site:** each site is its own Worker with static assets and a Custom Domain, with D1 for records and R2 for files. Deploys happen only from `main`, through Workers Builds. The journal has no preview builds (a branch's code would run against the real journal). |
| 12 | **The blog is built on Astro 7,** rendering on the Worker (`@astrojs/cloudflare`), because its pages come from a database: Astro gives the pages, styles and scripts their build pipeline, and the studio is one React island. Its API is a Hono app, as the journal's is, so both are tested the same way. The journal is a Vite + React app with a Hono Worker (decided by Claude 2026-09-29: an app behind a lock screen gains nothing from server rendering). |
| 13 | **No third parties in the journal,** of any kind: no analytics, fonts, CDNs or error trackers; a strict Content-Security-Policy says so. The blog allows exactly what a feature needs and names it in its policy (Cloudflare Turnstile on the comment form, when it is set up). |
| 14 | **Privacy of the owner:** as on the main site, the sites say "Allen"; no phone number or private email address anywhere in the repository (the main site's privacy test scans `sites/` too). The public address is `allen@allenkh.com`. |

## 2. Who does what

As on the main site (docs/PLAN.md §2): Claude writes the code, the tests and the docs; Allen owns
the Cloudflare dashboard and DNS, and does what the runbooks say. Allen edits the copy and
decides the details; Claude asks in chat, with choices.

## 3. Architecture

```
sites/
  package.json          the workspace: verify = format, lint, typecheck, Vitest, build
  packages/design/      tokens (from the main site's), base and prose styles, icons, PWA helpers
  packages/editor/      Tiptap schema, React editor, slash menu, HTML renderer, plain text
  journal/              journal.allenkh.com: Vite + React app (src/), Hono Worker (worker/)
  blog/                 blog.allenkh.com: Astro 7 on the Worker, the studio, Hono API
  docs/                 this plan, the journal's crypto design, runbooks
```

**Design package.** `tokens.ts` imports the main site's palette and adds the paper surfaces;
`css.ts` turns the tokens into custom properties (a Vite plugin serves them as
`virtual:allenkh/tokens.css`, so there is no generated file to go stale); `base.css` and
`prose.css` are the shared page and text styles. `contrast.test.ts` measures every pairing the
stylesheets use against WCAG, with the main site's own contrast maths.

**Editor package.** One schema (`schema.ts`) that both the editor and the renderer use, so what is
written is exactly what is shown; the editor (`Editor.tsx`, `Toolbar.tsx`, `slash.tsx`); the
renderer (`render.ts`, no DOM needed); and `text.ts`, a document's plain text (search, word
counts, excerpts).

**The journal** (built). A local-first app: records are sealed and kept in IndexedDB, synced
with compare-and-set writes and merged on the device (the server cannot read what it would
merge). Screens: today and any day, the calendar, the month review and its snapshot, the
timeline of events, people and places, stats, search, settings, and the lock, setup and recovery
screens. The Worker (`worker/`) does sign-in, sync, sealed files in R2, and the daily reminder
(empty Web Push, from a cron every five minutes). Offline, the app opens and unlocks from the
device's own copy, and its service worker keeps the code.

**The blog** (next). Pages rendered by the Worker from D1: the front page, a post, a tag, a
series, the archive, the feeds (RSS and Atom), the sitemap. A post's HTML (with its code
highlighted and its math typeset) is made once when it is published, by the editor package's
renderer, and stored beside its document, so a reader's request only reads it. Images go to R2
and are served by the Worker with long cache lives. The studio is a React app (the post list,
the editor with a cover, tags and series, publishing, the comment queue, the subscribers),
signed in with a passkey and a `__Host-` session cookie, as the journal is but without
encryption: a blog is public. Comments and subscriptions are plain HTML forms that work without
JavaScript.

## 4. Roadmap

| Step | Ships | State |
| --- | --- | --- |
| **S0** | The workspace, the design and editor packages, CI (`.github/workflows/sites.yml`) | Done (commit 0abd946) |
| **J1** | The journal: encryption, sync, offline app, every screen of decisions 6 to 8 | Done (commit 0abd946) |
| **J2** | The daily reminder (Web Push), the crypto design written down, the runbook | Done |
| **J3** | Launch: Allen follows the runbook; the journal goes live | Waiting on Allen |
| **B1** | The blog: reading pages, the studio, tags and series, math and code, images, feeds | Next |
| **B2** | Comments, held for approval | With B1 |
| **B3** | Email subscriptions, double opt-in, and a new post by email | With B1; needs a sending service (§7) |
| **B4** | Launch: the blog's runbook; the main site's Log station links there (docs/PLAN.md Phase 5) | After B1 |
| **D** | The details: Allen's pass over both sites, and the list below | Ongoing |

**Known details for D** (noticed while building; none blocks a launch):

- The editor's placeholder text is faint; check it against the contrast bar in daylight.
- On the day page, the activity chips take more room than the writing; try them folded.
- The story-sized snapshot leaves room at the bottom; give it to the photos.
- Passkeys are labelled by device type ("iPhone"); let Allen rename them.
- The mood picker is a radio group: arrow keys should move between moods.
- After a route change, focus should move to the new screen's heading.
- The Worker bundle carries all of SimpleWebAuthn; trim it if cold starts show.
- The journal's rollback check (a manifest signed with the `manifest` key, so a device can tell
  that the server is hiding recent changes) is designed but not built (journal-crypto.md,
  "Limits").

## 5. Verification

- `npm run verify` in `sites/` (format, lint, typecheck, Vitest, build), before every commit
  that touches `sites/`, and in CI.
- `npm run e2e --workspace=journal`: Playwright against the real build served by `wrangler dev`
  over HTTPS, with virtual passkeys (PRF included): setup, lock and unlock, offline, a second
  device, recovery, the month snapshot, keyboard use, and axe in both themes on every screen. It
  also reads every byte the server was sent and finds none of the journal's words.
- The main site's `npm run verify` still passes (its privacy test covers `sites/`).
- Screenshots of every screen changed, at phone and laptop sizes, in both themes.

## 6. Risks

- **The code comes from the server** (journal-crypto.md, "Limits"): a bad deploy could read the
  journal. Mitigated by review and by deploying only from `main`.
- **A lost recovery phrase and lost passkeys lose the journal.** Setup makes the phrase
  impossible to skip, and Settings can make a new one.
- **iPhone limits:** push needs the Home Screen app; storage can be evicted from a Safari tab
  (the installed app is kept); PRF needs iOS 18 or later. The journal asks the browser to keep
  its storage (`navigator.storage.persist()`) each time it is unlocked, and everything synced is
  on the server too.
- **Free-plan limits:** 10 ms of CPU per request. Both sites are built to fit; Workers Paid ($5
  a month) is the fix if they do not, and it is needed anyway for email to readers (§7).

## 7. Open items for Allen

- **J3:** the journal's Cloudflare setup (runbook), whenever convenient.
- **The blog's email** (B3). Cloudflare's own Email Service sends from a Worker with no API key,
  but sending to readers needs Workers Paid ($5 a month, 3,000 emails included). The other road
  is a separate service (Resend, Postmark, Amazon SES) with an API key. Either way the sending
  domain needs DNS records, which are Allen's to add.
- **Turnstile** for the comment form (a free Cloudflare widget, made in the dashboard): until it
  exists, comments rely on a honeypot, rate limits and approval.
- **The first post,** once the blog is up.
