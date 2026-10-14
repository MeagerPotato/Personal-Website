# Skills for Claude Code

Claude Code loads each folder here as a skill. They come from other people's repositories, with
their licences, and are kept as their authors wrote them except where noted below, so they can be
compared with upstream later. Lint, Prettier and `astro check` leave this folder alone.

## The house set

Claude may reach for these on its own when a task matches.

| Skill | What it is for | Source (commit) | Licence |
| --- | --- | --- | --- |
| `frontend-design` | a design lens: one bold choice, no templated defaults, critique from screenshots | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` (dbd4588) | Apache 2.0 |
| `review-animations` | a strict review of motion code; run it by name (`/review-animations`) | [emilkowalski/skill](https://github.com/emilkowalski/skill) `skills/review-animations` (2d22863) | MIT |
| `animation-performance` | why an animation drops frames, which properties are cheap | [emilkowalski/skill](https://github.com/emilkowalski/skill) `skills/animation-performance` (2d22863) | MIT |

They were picked from fourteen skill repositories after a read-through of every file (none of
these three has scripts, hooks or network calls) and trials on this site. Where a skill's advice
conflicts with AGENTS.md or docs/DESIGN.md, the repo wins: CLAUDE.md lists the known clashes.

## The exploration set

Other ways of looking at design, for Allen to try by hand. Each one runs only when its name is
typed (`/prototype`, `/design-taste-frontend`): `disable-model-invocation: true` is set in every
one, so Claude never picks one of them up by itself and none of them competes with the house set.
Several have strong opinions of their own (fonts, palettes, layouts); trying one is a way to see
another direction, not a decision to take it.

| Skill | What it is for | Source (commit) |
| --- | --- | --- |
| `design-taste-frontend` | taste-skill v2: art direction from a library of 247 gallery sites, with a critique pass | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` (a60a36d) |
| `redesign-existing-projects` | audits a site for generic AI patterns and upgrades it without breaking it | same, `skills/redesign-skill` |
| `high-end-visual-design` | the "soft" agency look: fonts, spacing, shadows, motion | same, `skills/soft-skill` |
| `minimalist-ui` | warm monochrome editorial interfaces | same, `skills/minimalist-skill` |
| `industrial-brutalist-ui` | Swiss print meets terminal: rigid grids, extreme type contrast | same, `skills/brutalist-skill` |
| `ui-ux-pro-max` | a searchable database of styles, palettes, font pairings and UX rules | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) `.claude/skills/ui-ux-pro-max` (7246805) |
| `design-dna` | pulls a design system and style out of reference screenshots, then applies it | [zanwei/design-dna](https://github.com/zanwei/design-dna) (593e39b) |
| `motion-design` | motion direction: archetypes, Disney's principles, duration tables | [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) `skills/motion-design` (f9a8a04) |
| `emil-design-eng` | Emil Kowalski's philosophy of UI polish and the invisible details | [emilkowalski/skill](https://github.com/emilkowalski/skill) `skills/emil-design-eng` (2d22863) |
| `apple-design` | Apple's fluid, physical motion and materials, for the web | same, `skills/apple-design` |
| `prototype` | builds several different versions of one piece behind a picker to flip through | same, `skills/prototype` |
| `break-ui` | feeds a piece of UI worst-case data and reports what breaks | same, `skills/break-ui` |
| `mobile-native` | the small fixes that make a site feel native on a phone | same, `skills/mobile-native` |
| `animate` | builds one animation, deciding purpose, property, curve and exit in order | same, `skills/animate` |
| `find-animation-opportunities` | finds places that should move, and rejects the ones that should not | same, `skills/find-animation-opportunities` |
| `animation-vocabulary` | turns "the bouncy thing when it opens" into the name of the effect | same, `skills/animation-vocabulary` |

All are MIT.

Some of them carry scripts, which Claude Code asks before running:
`design-taste-frontend/scripts` downloads stock photos and drives a headless Chrome to screenshot
a page; `ui-ux-pro-max/scripts` is Python that searches its CSV files; `design-dna/scripts` needs
`npm install` in that folder (it pulls `sharp`) to measure colours. Nothing here installs hooks.

Changes from upstream: `disable-model-invocation: true` added to each one's frontmatter; sample
email addresses and a sample phone number in `break-ui` and `redesign-existing-projects` rewritten
to `example.com` and a non-North-American number, and `design-taste-frontend/evals/` (sample
briefs with real-looking addresses) left out, so that `tests/privacy.test.ts` still passes.

Left out on purpose: older copies of the same skills (taste-skill v1 and v2-experimental,
gpt-tasteskill, genjutsu's copies of ui-ux-pro-max and of motion principles, Emil's
improve-animations next to review-animations); skills for other platforms or tools (Swift, Expo,
Compose, React libraries, Google Stitch, image generation, shadcn and Tailwind); genjutsu's
pipelines, which rewrite a whole site and its CLAUDE.md; the three.js skills, whose advice is out
of date for three r186; and GSAP's, since the site does not use GSAP.
