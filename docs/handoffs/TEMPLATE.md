# Handoff NN: <title>

<!--
How to use this template (Claude fills it in; Allen pastes the finished file into Astra):
- Copy to docs/handoffs/NN-title.md. One packet = one Astra session = one PR from `astra/NN-title`.
- A packet must stand alone. Astra's usage is scarce: no exploring, no open questions.
- Before handing off, Claude confirms: main is green; every knob Astra needs already exists as a
  token or tuning key; baseline screenshots are committed; a /lab scene exists if 3D is involved.
- Delete this comment.
-->

You are **Astra**, the visual and UX designer on allenkh.com. Claude (engineering) wrote this
packet. Read `AGENTS.md` and `docs/DESIGN.md` first, then only the files listed below.

## Goal

<!-- One paragraph: what should be better when you are done, and how we will know. -->

## Non-goals

<!-- What to leave alone even if it looks wrong. Be specific. -->

## Where you may edit

Only these paths. Values are free to change; **keys are API** (do not rename or remove them).

- `src/universe/design/…`
- `src/styles/…`

## Read these first (5 files at most)

1. `docs/DESIGN.md`: the standing brief
2. …

## Baseline

Screenshots of `main` at commit `<sha>`, in `docs/handoffs/NN-assets/`:

| | Universe mode | Plain mode |
| --- | --- | --- |
| Desktop 1280×800 | `universe-desktop.png` | `plain-desktop.png` |
| Phone 360×740 | `universe-phone.png` | `plain-phone.png` |

Current tokens: see `src/universe/design/tokens.ts` (every key is also a CSS custom property:
`color.ink.high` → `--color-ink-high`).

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

`npm run dev` serves http://localhost:4321. Add `?plain` or `?universe` to any URL to switch modes.

## Acceptance checklist (copy into the PR description and tick)

- [ ] Text contrast is at least WCAG AA (4.5:1 body, 3:1 large text) on every surface it sits on
- [ ] Touch targets are at least 44×44 px
- [ ] No horizontal scroll at 360 px wide, in both modes
- [ ] With reduced motion requested, nothing animates and nothing is lost
- [ ] Keyboard focus is always visible (uses `--color-focus`)
- [ ] Plain mode still looks designed, not like a fallback
- [ ] No hex colours outside `tokens.ts`; no new dependencies; no renamed keys
- [ ] `npm run verify` is green
- [ ] <!-- packet-specific checks -->

## Rules

- Design directly in code. No mockups, no image files unless this packet asks for them.
- **No logic edits.** If you need something outside the allowed paths (a new token key wired into
  the engine, a markup change, a new knob), do not do it. Write one line in the PR description:
  `ASTRA-REQUEST: <what you need and why>`. Claude picks those up.
- Small lint or formatting failures outside your paths are Claude's to fix. Mention them; move on.

## Stop when

<!-- The explicit finish line. E.g. "the checklist is ticked and the four screenshots are retaken". -->

Open a PR from `astra/NN-title` to `main` titled `Astra NN: <title>`, with before/after
screenshots, the ticked checklist, and any `ASTRA-REQUEST:` lines.
