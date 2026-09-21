# Handoff 01: Visual identity (A1)

You are **Astra**, the visual and UX designer on allenkh.com. Claude (engineering) wrote this
packet. Read `AGENTS.md` and `docs/DESIGN.md` first, then only the files listed below.

## Goal

Give allenkh.com a visual identity that is unmistakably its own, in **both** modes: the palette
(dark navy space, muted pastel families), the typefaces and the type scale, spacing and radii, and
the look of every piece of DOM: the plain-mode pages, the info panel and its bottom sheet, the top
bar, the dock prompt, the names over the planets, the first-visit hint card, the touch controls.
Today's look is an engineer's careful first pass: consistent, legible, a little anonymous. When you
are done it should read as "Mini Motorways drawn in space" at a glance, a recruiter who only ever
sees plain mode should think it was designed on purpose, and everything in the acceptance
checklist below still holds.

This is the last thing between the site and its public launch.

## Non-goals

- **The 3D scene's art direction** (materials, shading bands, shaders, bloom, starfield, the look
  of a planet's ring, camera, flight feel). That is packet A2, and `design/tuning.ts`,
  `design/materials.ts` and `design/shaders/**` are off limits here. The PALETTE is yours, and the
  3D world reads it (see "The palette paints the world too"), so look at the world after changing
  it; but do not tune the world.
- **Copy.** Words are Allen's. If a line of microcopy hurts the layout, say so in the PR.
- **Markup, class names, `data-` attributes, behaviour.** They are API for the router, the panel
  and the engine. Restyle the selectors that exist; do not rename them.
- Motion choreography beyond the DOM tokens (packet A3).

## Where you may edit

Only these paths. Values are free to change; **keys are API** (do not rename or remove them).

- `src/universe/design/tokens.ts` (values; a NEW key only if the stylesheet alone reads it, see Rules)
- `src/styles/**`
- `docs/DESIGN.md` (to write down what you decided)

## Read these first (5 files at most)

1. `docs/DESIGN.md`: the standing brief. The sections marked _(open: A1)_ are yours to decide.
2. `src/universe/design/tokens.ts`: every colour, font stack, size, space, radius and duration.
   Each key is also a CSS custom property (`color.ink.high` → `--color-ink-high`).
3. `src/styles/global.css`: the one stylesheet. Its header comment is the map: 0 typefaces, 1 plain
   mode (1a frame, 1b type, 1c theme and biome colours, 1d components, 1e Markdown, 1f resume),
   2 universe mode (panel, sheet, prompt, names, hint card, touch controls), 3 notices, 4 print.
4. `src/layouts/Base.astro`: the markup every page shares (top bar, panel, hint card, footer).
5. The screenshots in `docs/handoffs/01-assets/` (below).

## Baseline

Screenshots of `main` as this packet was written (commit `d5226a5`, plus the staging of the
typefaces, which changes nothing you can see), in `docs/handoffs/01-assets/`:

| | Universe mode | Plain mode |
| --- | --- | --- |
| Desktop 1280×800 | `universe-desktop-sky.jpg` (open sky, names, hint card), `universe-desktop-panel.jpg` (a project in the side panel), `universe-desktop-index.jpg` (the projects index) | `plain-desktop-home.jpg`, `plain-desktop-project.jpg`, `plain-desktop-resume.jpg` |
| Phone 360×740 | `universe-phone-sky.jpg`, `universe-phone-panel.jpg` (the bottom sheet), `universe-phone-index.jpg` | `plain-phone-home.jpg`, `plain-phone-project.jpg`, `plain-phone-resume.jpg` |

### Typefaces are staged for you

Today every stack is a system stack, so nothing is downloaded and the site looks different on
every platform (SF Rounded on Apple, Segoe UI on Windows). `docs/DESIGN.md` lets A1 choose **at
most two** self-hosted faces plus, if you want it, a mono. Five candidates are already in
`public/fonts/` (variable, Latin subset, SIL Open Font License), each with an `@font-face` rule in
section 0 of the stylesheet:

| Family name | Character | File size |
| --- | --- | --- |
| `'Nunito'` (200 to 1000) | rounded terminals, friendly; closest to today's look on Apple devices | 39 KB |
| `'Rubik'` (300 to 900) | geometric with softened corners; sturdier, more technical | 35 KB |
| `'Outfit'` (100 to 900) | clean geometric; the closest to Mini Motorways' own lettering | 32 KB |
| `'Inter'` (100 to 900) | the neutral workhorse for body text | 48 KB |
| `'JetBrains Mono'` (100 to 800) | eyebrows, stats, code | 40 KB |

**To adopt a face, put its family name first in a stack in `tokens.ts`**: `font.display`
(headings and the wordmark), `font.body`, `font.mono`. A face that no stack names is never
downloaded, so leave the ones you do not choose alone: Claude deletes them afterwards. Every face
you adopt is a download for every visitor, plain mode included: two is the limit, one is better,
and "keep the system stacks" is a legitimate answer if nothing earns its weight.

### The palette paints the world too

`color.space.*` is the backdrop of the 3D sky, `color.system.*` colours each sun, its orbit lines
and its planets' rings, `color.biome.*` are the surfaces of the planets, `color.star.*` the stars.
The renderer uses no tone mapping, so a lit surface is exactly its token on screen. After changing
any of these, look at `http://localhost:4321/?universe` and at `http://localhost:4321/lab/` (one
planet, moon or sun on a turntable; development only).

## Commands

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm run verify
```

`npm run dev` serves http://localhost:4321. Add `?plain` or `?universe` to any URL to switch
modes. Pages worth checking: `/`, `/about/`, `/projects/`, `/projects/fishai/`,
`/projects/canadian-fish-demo/` (a moon), `/systems/code/`, `/resume/` (also in print preview),
`/contact/`, and `/nope/` (the 404, plain only). The hint card shows once per browser: run
`localStorage.removeItem('hints')` in the console to see it again.

Your PR also gets a second check, `e2e`: real browsers (Chromium, WebKit, a phone-sized Chromium)
measure several lines of the checklist below on the built site: nothing scrolls sideways at 360
and 320 px, every control is at least 44 px, axe finds no serious issue in either mode, keyboard
focus lands where it should. It is not required for merging, but a red `e2e` after a restyle
almost certainly means one of those broke: read its report (an artifact of the run). To run it
yourself: `npx playwright install chromium webkit` once, then `npm run e2e` (slow; optional).

## Acceptance checklist (copy into the PR description and tick)

- [ ] Text contrast is at least WCAG AA (4.5:1 body, 3:1 large text) on every surface it sits on,
      and the contrast numbers in `docs/DESIGN.md` are updated if a colour in a pairing changed
- [ ] Touch targets are at least 44×44 px
- [ ] No horizontal scroll at 360 px wide, in both modes (and none at 320 px either, where the nav
      may wrap to a second row with a wide font)
- [ ] With reduced motion requested, nothing animates and nothing is lost
- [ ] Keyboard focus is always visible (uses `--color-focus`), except on the page heading the
      router focuses, which deliberately shows no ring
- [ ] Plain mode still looks designed, not like a fallback
- [ ] No hex colours outside `tokens.ts`; no new dependencies; no renamed keys, classes or
      `data-` attributes
- [ ] `npm run verify` is green (it enforces a weight budget: a plain page may weigh 30 KiB
      gzipped, HTML + CSS + JS; today the heaviest is 12.4 KiB)
- [ ] The resume still prints cleanly on paper colours (section 4 of the stylesheet uses the
      keywords `black` and `white` on purpose)
- [ ] Over the 3D world, text stays readable on the brightest thing it can sit on (a sun, a
      planet's pale ring): the panel, the prompt, the names, the hint card
- [ ] Each solar system's colour family is recognisable in its page accents (`data-theme`), and
      the five families are distinguishable from each other for colour-blind visitors
- [ ] The states are all designed, not just the resting one: hover, `:focus-visible`,
      `[aria-current]`, the name the ship is headed for (`[data-state='target']`), the pressed
      boost pad (`[data-active]`), the sheet at half and at full height
- [ ] `docs/DESIGN.md` says what you decided: the _(open: A1)_ markers are gone

## Rules

- Design directly in code. No mockups, no image files.
- **No logic edits.** If you need something outside the allowed paths (a new token key wired into
  the engine, a markup change, a font preload, a new knob), do not do it. Write one line in the PR
  description: `ASTRA-REQUEST: <what you need and why>`. Claude picks those up. Adding a token KEY
  that only the stylesheet reads is fine; say so in the PR.
- Branch `astra/01-visual-identity`, one PR, the checklist above in its description.

## Stop

Stop when the checklist is ticked and `npm run verify` is green. Do not start on the 3D scene
(A2) or on motion (A3), however tempting: each has its own packet, and your usage is scarce.
