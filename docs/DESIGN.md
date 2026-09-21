# Design brief

The standing brief for anyone making a visual decision on allenkh.com. Handoff packets link here so
they can stay short. Engineering rules are in [AGENTS.md](../AGENTS.md); the full product plan is
[PLAN.md](PLAN.md) (§3 experience, §5.6 design surface).

Status: **first-pass baseline by Claude.** Sections marked _(open: A1)_ or _(open: A2)_ are for
Astra's visual identity pass and scene art-direction pass to decide.

## The idea

A personal site you can fly through. Solar systems are passions, planets are projects, moons are
sub-projects. It should feel like **Mini Motorways drawn in space**: muted pastels, flat shading,
tidy geometry, small legible shapes, minimal UI, with the cozy piloting feel of
[Tiny Skies](https://tinyskies.vercel.app/), a little more detailed. Dark navy space, pastel worlds.

Voice: **playful framing, technical substance.** Jokes live in headings and microcopy. Claims and
numbers are precise. The owner appears as "Allen".

## Principles

1. **Calm first.** Nothing flashes, nothing fights for attention. The universe is a place, not an ad.
2. **Flat, not flat-looking.** Two or three shading bands, tinted shadows (never black), no
   gradients on surfaces, no gloss. Depth comes from overlap, scale, and light direction.
3. **Pastel on navy.** Space is navy, never pure black. Pastels are slightly desaturated. Only
   suns, engine flames, and beacons are allowed to glow.
4. **One palette everywhere.** The 3D world and the DOM read the same tokens, and the renderer uses
   no tone mapping, so a lit surface is exactly its token colour. If a colour looks wrong, change
   the token, not the material.
5. **Plain mode is a design, not a fallback.** Recruiters may only ever see it. It gets the same
   care: strong typography, generous space, the same palette.
6. **Small screens are first-class.** Design at 360 px wide first, then let it breathe.
7. **Recruiter in ten seconds.** Resume and projects are one obvious click away in both modes.

## Colour

Source of truth: `src/universe/design/tokens.ts`, mirrored to CSS custom properties
(`color.ink.high` → `--color-ink-high`). Never write a hex value anywhere else.

| Group | Keys | Use |
| --- | --- | --- |
| `color.space` | `950 900 800 700 600` | backdrop ramp, deepest to lightest; page background is `900` |
| `color.ink` | `high mid low` | text. On `space.900`: 17.2, 10.6, 6.0 to 1. Worst pairing in use (`low` on `surface.raised`) is 4.8 to 1 |
| `color.surface` | `panel raised line` | panels, cards, hairlines |
| `color.system` | `coral butter mint sky lilac` × `base light shade` | one family per solar system: lit side, highlight, tinted shadow side |
| `color.accent`, `color.focus` | | links and interactive text; the keyboard focus ring |
| `color.star` | `warm cool white` | starfield tints |
| `color.shading` | `shadow` | **multiplies** a surface's colour on the side facing away from its sun: cool and tinted, never black (white would mean no shading) |

Rules: body text at least 4.5:1, large text 3:1, re-measure whenever either side of a pairing
changes. Each system owns one family; a planet's label, lane colour and panel accent all come from
its system's family. _(open: A1)_ final hues, a sixth family if the galaxy needs one, light-on-dark
states for buttons and chips.

## Typography _(open: A1)_

Today: a system rounded stack (`font.body`) and a system mono stack (`font.mono`), zero font
downloads. The fluid scale is `text.xs … text.display` (min at 360 px, max near 1200 px). A1 chooses
at most two self-hosted faces (woff2, subset, `font-display: swap`), a rounded or geometric sans
for display and a workhorse for body, and revisits the scale. Mono is for eyebrows, stats and code.

## Space, shape, motion

- Spacing scale `space.1 … space.24` (4 px base). Radii `radius.sm md lg pill`; panels use `lg`.
- DOM motion tokens: `motion.fast base slow` with `easeOut` and `easeInOut`. Things ease out when
  they arrive and ease in-out when they move. Nothing bounces more than once.
- **Reduced motion:** no twinkle, no drift, no camera flights (cuts instead), no parallax. The
  static frame must still look composed.
- Engine timings (camera blends, flight feel) are in `design/tuning.ts`, in seconds. _(open: A3)_

## The two modes

| | Plain | Universe |
| --- | --- | --- |
| What it is | the base stylesheet: a fast typographic site | the same page with the 3D world behind it |
| `<main>` is | the page | the info panel (side panel on desktop, bottom sheet on phones, from Phase 2) |
| JavaScript | about 2 KB gzipped, no framework, no three.js | engine (~130 KB gzipped) loads on demand |
| Must work | without JS, in print, at 360 px | on a mid-range phone at 30+ fps |

Both are styled from `src/styles/global.css`: base rules are plain mode,
`html[data-mode='universe']` rules layer the universe look on top.

## The 3D world _(open: A2)_

Decided so far: no three.js lights (one custom flat-toon shader with a per-system sun direction),
sRGB output with no tone mapping, bloom only on emissive things, labels are real DOM buttons, the
map view is the same perspective camera at a very narrow field of view (so nothing pops), planets
flatten to discs in map mode, motorway lanes are rounded and colour-coded by system.
A2 decides: shading band positions and softness, biome colour bands, starfield density and size,
backdrop treatment, post-processing amounts, the look of map mode and of the lanes.

**Where each knob lives (first pass, all free to change):**

| What | Where |
| --- | --- |
| The three shading bands: where a facet flips between shade, middle and lit, and how lit the middle is | `tuning.shading` |
| The colour of shadow | `tokens.color.shading.shadow` |
| Which token feeds which shader input | `design/materials.ts` |
| The shaders themselves (GLSL) | `design/shaders/`: `toonFlat.ts` (every lit surface), `sky.ts` (backdrop and stars), `dust.ts` |
| The sky: horizon glow, and up to four huge soft glows of colour (family, direction, size, strength) | `tuning.backdrop` |
| Stars: count, sizes, tints, twinkle, drift | `tuning.starfield` |
| Space dust: count, size, brightness, streak length | `tuning.dust` |
| The rocket and its flame: shapes (rings, fins, window) and which token paints what | `design/models/rocket.ts`, `design/models/flame.ts` |
| Which model a name stands for (generated code now, a `.glb` later) | `design/assets.ts` |
| How the ship leans, nods and bobs, and how the flame follows the throttle | `tuning.ship` |
| The chase camera: where it sits, how far it looks ahead, how loosely it follows, how the lens widens with speed, tall screens | `tuning.chaseCam` |
| How the ship flies (not a look, but it decides how every look is seen) | `tuning.flight` |

**Tuning by hand:** run `npm run dev` and open `/?universe&tweak`. Every value of `tuning.flight`,
`tuning.chaseCam`, `tuning.ship` and `tuning.shading` is a slider that acts at once; "copy tuning as
JSON" gives the values to paste back into `design/tuning.ts`. Add `&perf` for a frame-rate readout.

Three things learned the hard way. **The sky uses glows, not noise clouds:** on a calm dark sky,
procedural noise reads as mud and the eye finds its lattice at once. **Dark gradients band in 8
bits**, so the backdrop adds half a code value of noise after the conversion to sRGB; keep that
line if you rewrite the shader. **A big warm glow on navy reads as brown:** the chase camera looks
down, so the sky BELOW the horizon is what a visitor mostly sees; keep that part cool, and warm
colours small and high.

## Accessibility bar (non-negotiable)

Contrast AA. Touch targets 44×44 px. Works at 360 px with no horizontal scroll. Visible focus ring
(`--color-focus`) on everything focusable. Reduced motion honoured. Colour is never the only
signal. All content reachable by keyboard and readable with JavaScript off.

## How to work in the design surface

Astra edits `src/universe/design/**`, `src/styles/**` and `public/models/**`. **Values are free to
change; keys are API.** Need a new knob, a markup change, or anything outside those paths? Write
`ASTRA-REQUEST: …` in the PR and Claude wires it up. Models (from Phase 3): `.glb` only, meshopt
compressed, at most 5 MiB, kebab-case names, +Z forward, +Y up, 1 unit = 1 u, one shared palette
texture.
