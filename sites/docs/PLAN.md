# The subdomain sites: plan

`sites/` holds the sites that live on subdomains of allenkh.com, and what they share:

- **journal.allenkh.com**: a private journal, end-to-end encrypted, installable on every device.
- **blog.allenkh.com**: Allen's blog, written in the browser, read like a Notion page.

This page is the source of truth for both, as `docs/PLAN.md` is for allenkh.com itself. The
short rules for agents are in [sites/AGENTS.md](../AGENTS.md); the journal's security design is
[journal-crypto.md](journal-crypto.md); putting a site on Cloudflare is
[runbooks/cloudflare-setup.md](runbooks/cloudflare-setup.md) for the journal and
[runbooks/blog-setup.md](runbooks/blog-setup.md) for the blog.

## Context

On 2026-09-29 Allen asked for two things. A blog at blog.allenkh.com, "relatively simple and
clean", in the manner of Notion. And a journal at journal.allenkh.com, to "securely journal and
record events" in Allen's life: DailyBean is the model, but it has too little room to write and
too much behind a paywall, so this one is Allen's own and private, with DailyBean's monthly
overview that can be posted. Both are built first as complete, working sites; the time after
that goes into the details. Later, every site on Allen's subdomains should look like one family.

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
| 12 | **The blog is built on Astro 7,** rendering on the Worker (`@astrojs/cloudflare`), because its pages come from a database: Astro gives the pages, styles and scripts their build pipeline, and the studio is a React app started by its page's bundled script (not an island: no inline script, so the Content-Security-Policy needs no exception). Its API is a Hono app, as the journal's is, so both are tested the same way. The journal is a Vite + React app with a Hono Worker (decided by Claude 2026-09-29: an app behind a lock screen gains nothing from server rendering). |
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
counts, excerpts). A document's headings sit one level below the page's own title: "Heading 1"
is stored as level 1 and drawn as an `<h2>`, in the editor as on the page, so every screen keeps
exactly one `<h1>`.

**Shared app frame.** `packages/design/styles/app.css` is the frame both apps are built from (the
sidebar, the phone tab bar, sheets and dialogs) and their common parts (chips, property lists,
swatches, segmented controls, record lists, settings sections, the sign-in gate). Each app's own
sheet adds only what is its alone. Two behaviours go with it, framework-free, so both apps work
alike: when the screen changes (a link, Back, a gate's next step), the new screen's title takes
the focus (`focus.ts`, through each app's `<Title>`), so a screen reader says where it now is;
and a radio group drawn as buttons (the moods, swatches, segmented controls) is one stop in the
tab order, walked with the arrow keys (`radiogroup.ts`), as the browser's own radios are.

**The journal** (built). A local-first app: records are sealed and kept in IndexedDB, synced
with compare-and-set writes and merged on the device (the server cannot read what it would
merge). Screens: today and any day, the calendar, the month review and its snapshot, the
timeline of events, people and places, stats, search, settings, and the lock, setup and recovery
screens. A day's activities fold to its own and the usual ones (the most used in the 60 days
before it), every activity one click away, so the writing comes first. Sync never goes back: a
server restored to an earlier time gets back what the devices still have. And each device
publishes a sealed manifest of the versions it has, so another device can tell when the server
keeps a change from it (journal-crypto.md, "Sync"). The Worker (`worker/`) does
sign-in, sync, sealed files in R2, and the daily reminder (empty Web Push, from a cron every five
minutes). Offline, the app opens and unlocks from the device's own copy, and its service worker
keeps the code.

**The blog** (built). Pages rendered by the Worker from D1: the front page, a post, the tags and
each tag, the series and each series, the RSS feed, the sitemap, and the subscription pages. A
post's HTML (code highlighted by lowlight, math typeset by Temml into MathML) is made once when
it is published, by the editor package's renderer, and stored beside its document, so a
reader's request only reads it; its few math style attributes are allowed by hash in that page's
policy. Math is drawn with the reader's own math font (Cambria Math on Windows, STIX Two Math on
Apple devices). Images are sized on the device, go to R2, and are served by the Worker with long
cache lives. Reader pages carry no script: comments and subscriptions are plain HTML forms.

The studio (`/studio/`) is a React app signed in with a passkey and a `__Host-` session cookie,
as the journal is but without encryption: a blog is public. Screens: the posts (drafts, then what
is live), a post (the editor with images, math and code, and its properties: summary, address,
date, tags, series and part, cover), preview, publish, update, take down, delete, and emailing a
post to subscribers once; the comment queue (approve, reply, spam); the subscribers; tags and
series (Organize); and the passkeys (Settings). A draft saves as it is written, in order, each
save over the version it started from, so two tabs on one post ask which version to keep
instead of losing either. Until the server has it, the writing is also kept on the device
(`studio/screens/post/backup.ts`), so a tab that dies first (offline, a crash) loses nothing:
the post opened there again brings it back, or asks which version to keep if the server's draft
has moved on since. Signing out saves first (what cannot be saved yet goes at the next sign-in),
and counts only once the blog has ended the session: offline, the studio says it is still
signed in. Mail (a subscription's confirmation, a new post) goes through an outbox in D1 that a
cron drains and retries.

## 4. Roadmap

| Step | Ships | State |
| --- | --- | --- |
| **S0** | The workspace, the design and editor packages, CI (`.github/workflows/sites.yml`) | Done (commit 0abd946) |
| **J1** | The journal: encryption, sync, offline app, every screen of decisions 6 to 8 | Done (commit 0abd946) |
| **J2** | The daily reminder (Web Push), the crypto design written down, the runbook | Done |
| **J3** | Launch: Allen follows the runbook; the journal goes live | Done 2026-10-01 |
| **B1** | The blog: reading pages, the studio, tags and series, math and code, images, feeds | Done |
| **B2** | Comments, held for approval | Done |
| **B3** | Email subscriptions, double opt-in, and a new post by email | Built; sending waits on Allen's choice (§7) |
| **B4** | Launch: Allen follows [the blog's runbook](runbooks/blog-setup.md); then the main site's Log station links there (docs/PLAN.md Phase 5) | Waiting on Allen |
| **D** | The details: Allen's pass over both sites, and the list below | Ongoing |

**Known details for D** (noticed while building; none blocks a launch):

- Both Workers carry all of SimpleWebAuthn; trim it if cold starts show. The baseline, measured
  locally on 2026-09-30 with `npx wrangler check startup` in each app (a dry-run build and a
  local profile: nothing is deployed): the journal's Worker is 864 KiB and starts in about 15 ms
  of CPU, the blog's is 3.0 MB and starts in about 46 ms. Cloudflare's limit is 1 s.
- The blog's name ("Captain's Log", the main site's working name) and its one-line description
  are placeholders for Allen's words.
- Android has no math font of its own: if readers there matter, ship one (a subset of STIX Two
  Math) with the blog.
- The studio could tell Allen about a new comment by email, once email is set up.

## 5. Verification

- `npm run verify` in `sites/` (format, lint, typecheck, Vitest, build), before every commit
  that touches `sites/`, and in CI.
- `npm run e2e --workspace=journal`: Playwright against the real build served by `wrangler dev`
  over HTTPS, with virtual passkeys (PRF included): setup, lock and unlock, offline, a second
  device, recovery, the month snapshot, keyboard use, and axe in both themes on every screen. It
  also reads every byte the server was sent and finds none of the journal's words.
- `npm run e2e --workspace=blog`: the same, for the blog: the studio set up with its code, a post
  written with every kind of block (math, code, an image) and published, read without scripts,
  a comment held and answered, a preview, two tabs saving one post, a series, signing out and in,
  and axe in both themes on every reader page and studio screen (and at a phone's width), with
  no console error or CSP violation anywhere.
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

- **B4:** the blog's Cloudflare setup ([runbook](runbooks/blog-setup.md)).
- **The blog's email** (B3). Built for Cloudflare's own Email Service, which sends from a Worker
  with no API key but needs Workers Paid ($5 a month, 3,000 emails included) to reach readers;
  the runbook's §7 sets it up. The other road is a separate service (Resend, Postmark, Amazon
  SES) with an API key, a small change in `blog/src/server/mail.ts`. Either way the sending
  domain needs DNS records, which are Allen's to add.
- **Turnstile** for the comment form (a free Cloudflare widget, the runbook's §8): until it
  exists, comments rely on a honeypot, a minimum time to fill the form, rate limits and approval.
- **The blog's name and description,** and **the first post,** once the blog is up.
