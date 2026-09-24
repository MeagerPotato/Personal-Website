# Design brief

The standing brief for anyone making a visual decision on allenkh.com. Handoff packets link here so
they can stay short. Engineering rules are in [AGENTS.md](../AGENTS.md); the full product plan is
[PLAN.md](PLAN.md) (§3 experience, §5.6 design surface).

Status: **the visual identity (A1) is decided** (2026-09-23): the "roadmap" direction, chosen from
four built candidates by four judges, then finished by Claude at Allen's request. Sections marked
_(open: A2)_ or _(open: A3)_ are for the scene art-direction pass and the motion pass.

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
| `color.ink` | `high mid low` | text. On `space.900`: 17.2, 10.6, 6.7 to 1. Worst pairing in use (`low` on `surface.raised`) is 5.3 to 1. `low` is never text on the HUD plate (4.49 over white) |
| `color.surface` | `panel raised line` | panels, cards, hairlines |
| `color.system` | `coral butter mint sky lilac` × `base light shade` | one family per solar system: lit side, highlight, tinted shadow side |
| `color.accent`, `color.focus` | | links and interactive text (sky); **butter, which means "here"**: the focus ring, the current page's bar, the name the ship is headed for |
| `color.star` | `warm cool white` | starfield tints |
| `color.shading` | `shadow` | **multiplies** a surface's colour on the side facing away from its sun: cool and tinted, never black (white would mean no shading) |

Rules: body text at least 4.5:1, large text 3:1, edges and marks 3:1, re-measure whenever either
side of a pairing changes: `src/site/contrast.test.ts` measures every pairing the stylesheet relies
on (the translucent plates composited over white, the brightest thing in the world), so
`npm run verify` fails when a colour change breaks one. Each system owns one family; a planet's
label, lane colour and panel accent all come from its system's family, and a project card wears its
own system's family on any page (`data-theme` on the card).

**Decided in A1.** The five family bases are spread in lightness as well as hue, so that no two
collapse for a colour-blind visitor (closest pair under any dichromacy about 10 CIEDE2000 apart),
and every family also has a **glyph**, a second cue that is not colour: butter a circle, sky a
diamond, mint a triangle, coral a square, lilac a four-point spark (`--theme-glyph`, drawn with
`clip-path` on the route sign's marker and the sun on the projects page; no font or image
cost). The spark and the triangle cover less of their box than a circle or a square, so they are
drawn a touch larger (`--theme-glyph-scale`, 1.12 and 1.06): at 11 px all five read as the same
size, and the spark stays a star, not a thin plus. Five families are enough for now; a sixth needs a sixth glyph. Three words of the
vocabulary never change meaning:

- **Butter means "here":** the current page (a short bar under its name in the nav), the
  keyboard's focus (the ring), the body the ship is headed for (the one filled name tag). The home
  system is butter too, so a focused butter key keeps a navy rim between its fill and the ring.
- **The cream face (`ink.high` fill) means "on":** only toggles that are switched on wear it (the
  Map button while the map is open, the sheet's Shrink, the welcome button while its text shows).
  The small key caps that NAME a key (W, Shift, M in the hint card and on the Map button) are
  drawn as the white keys they are; they are not a control's face.
- **One solid family fill per view:** the primary action. Route signs above the headings and a
  project's tags are tinted, with a hairline edge; secondary keys are outlined in `ink.low`.

Measured pairings (WCAG 2, to 1):

| Pairing | Contrast |
| --- | --- |
| `ink.low` on `space.900` / `surface.panel` / `surface.raised` / the panel over white | 6.7 / 6.0 / 5.3 / 5.4 |
| `ink.high` / `ink.mid` on the HUD plate over white | 11.6 / 7.2 |
| butter ("Stop" in the dock prompt) on the HUD plate over white | 9.4 |
| `ink.mid` on the hint card (`surface.raised`) / a notice (`surface.panel`) | 8.5 / 9.6 |
| navy on cream (a toggle that is on) / on butter (target tag, skip link) | 17.2 / 13.9 |
| a family's light on its route sign (10% tint on the page), lowest is lilac | 10.2 |
| a family's light on its tags (12% tint on a plate), lowest is lilac in the panel | 7.7 |
| navy on a family base (primary button), lowest is lilac | 6.3 |
| `ink.low` edge of a secondary key on the page / in the panel (non-text, 3:1 needed) | 6.7 / 6.0 |
| butter ring on its navy rim (non-text) | 14.5 |

## Typography

**One face, Outfit**, for everything a visitor reads (variable 100 to 900, Latin subset, 32 KB,
SIL Open Font License, `public/fonts/`): the clean geometric sans closest to Mini Motorways' own
lettering, the way every sign on a transit map is set in one face. Code alone uses the system's
mono stack (`font.mono`), which costs nothing. The other staged candidates are gone.

- **Loading.** Every page preloads the file (`src/components/Head.astro`), and the stacks name
  `'Outfit Fallback'` next: local Arial (or the metric-identical Liberation Sans or Arimo) with
  `size-adjust` and ascent, descent and line-gap overrides **measured** from the real Outfit
  file (section 0 of the stylesheet says how). In Chromium a heading, the nav, a paragraph and a
  button set in the fallback take the same height as in Outfit and within 1 to 2% of its width,
  so the swap moves very little: a single line stays put, but a paragraph that sits right at a
  line break can gain or lose a line (measured: the home lede at 1280 px goes from three lines to
  two). The preload makes a fallback paint rare.
- **Weights.** Body text 430 with a hair of tracking (Outfit is light and narrow at 400), labels
  and nav 600, headings 700. Running text keeps to `--measure` (31 em: about 70 characters a
  line, measured on the rendered lines, where 33 em had run to 77 to 82).
- **Scale** (`text.*`, fluid from 360 px to about 1200 px; laptop / phone): display (the h1)
  60 / 40, `xl` (h2 and section heads) 30 / 24, `lg` (the lede, card titles) 25 / 21,
  `base` 18 / 17, `sm` 16 / 15, `xs` (caps labels) 13 / 12. The panel pins the scale to
  its narrow end. Names over the bodies are 13 px at every width and on the map (the engine
  measures them once). Nothing a visitor reads is under 12 px.
- **The one exception: the resume's section heads are `lg`, not `xl`.** A resume is a document
  of many short sections, where the heads are labels that sort the page and the entries must
  lead; on a wide screen they hang in a 10.5rem column in the margin, where "Experience" at `xl`
  would not fit. On paper the name leads instead (the wordmark at a heading's size).

## Space, shape, motion

- Spacing scale `space.1 … space.24` (4 px base). Radii `radius.sm md lg pill`; panels use `lg`.
- **Shapes.** Controls are pills; keys and tiles cast a flat hard ledge (`--ledge`, 3 px) and
  drop onto it when pressed; plates are `surface.panel` with a 4 px band across the top; the
  only ornament is the route line (3 px) with its stations. A list of projects is a transit line
  (on a phone, in a slim lane down the left, the planet beside its name); the resume is a line of
  stops, its section names hung in the margin on a wide screen, one column on a phone and on paper.
  In any one column every line of text starts on the same edge (the resume's `--rail`).
- **A list's route line takes its stations' colour**, as on a transit map. A list of one system
  wears that system (the home page's "Start here" is a sky line on a butter page while every
  featured planet is in Code); a list that mixes systems draws its line neutral, in `ink.low`, so
  that each station is the only thing in its family's colour.
- **Focus** is a 3 px butter ring outside a 2 px navy rim, on every focusable thing in both modes,
  except the heading the router focuses after a soft navigation. Forced colours keep the ring (an
  outline) and underline the current page.
- **Movement on hover or press uses the CSS `translate` (or `scale`) property, never
  `transform`**: the engine writes `transform` on the names and the touch controls every
  frame. There is no hover lift; if one is added, gate it with `(hover: hover)` and switch it off
  when motion is reduced. **Every hover state is gated with `(hover: hover)`**, colours too:
  after a tap on a phone a lit key would stay lit, and a lit key reads as "on".
- DOM motion tokens: `motion.fast base slow` with `easeOut` and `easeInOut`. Things ease out when
  they arrive and ease in-out when they move. Nothing bounces more than once.
- **Reduced motion:** no twinkle, no drift, no camera flights (cuts instead), no parallax. The
  static frame must still look composed.
- Engine timings (camera blends, flight feel) are in `design/tuning.ts`, in seconds. _(open: A3)_

## The two modes

| | Plain | Universe |
| --- | --- | --- |
| What it is | the base stylesheet: a fast typographic site | the same page with the 3D world behind it |
| `<main>` is | the page | the info panel: a side panel on a wide screen (and, narrower, on a phone held sideways), a bottom sheet on a phone held upright |
| JavaScript | about 2 KB gzipped, no framework, no three.js | engine (~130 KB gzipped) loads on demand |
| Must work | without JS, in print, at 360 px | on a mid-range phone at 30+ fps |

Both are styled from `src/styles/global.css`: base rules are plain mode,
`html[data-mode='universe']` rules layer the universe look on top.

## The 3D world _(open: A2)_

Decided so far: no three.js lights (one custom flat-toon shader with a per-system sun direction),
sRGB output with no tone mapping, bloom only on emissive things, labels are real DOM buttons, the
map view is the same perspective camera at a very narrow field of view (so nothing pops), planets
flatten to discs in map mode, motorway lanes are rounded and colour-coded by system. **The map
exists** (first pass): shading goes flat, stars dim and hold still, every body is drawn at least a
few pixels big and a moon only once there is room beside its planet, the ship is a marker. How it
should LOOK (the flatness, the sizes, what fills the empty navy, a sun that still reads as a sun
on a tier with no bloom) is A2's.
A2 decides: shading band positions and softness, biome colour bands, starfield density and size,
backdrop treatment, post-processing amounts, the look of map mode and of the lanes.

**Where each knob lives (first pass, all free to change):**

| What | Where |
| --- | --- |
| The three shading bands: where a facet flips between shade, middle and lit, and how lit the middle is | `tuning.shading` |
| The colour of shadow | `tokens.color.shading.shadow` |
| Which token feeds which shader input | `design/materials.ts` |
| The shaders themselves (GLSL) | `design/shaders/`: `toonFlat.ts` (every lit surface), `glow.ts` (suns, the flame, rings), `sky.ts` (backdrop and stars), `dust.ts`, `post.ts` (bloom, vignette) |
| Bloom and vignette: how strong, how wide, how dark the corners | `tuning.post` |
| WHAT blooms, and how much (0 to 1 each) | `tuning.world.sunBloom`, `tuning.world.ringBloom`, `tuning.ship.flame.bloom` |
| Quality tiers: pixel caps, anti-aliasing samples, which tiers get post-processing, the 30 fps cap, when the engine lowers its own resolution | `tuning.quality` |
| The sky: horizon glow, and up to four huge soft glows of colour (family, direction, size, strength) | `tuning.backdrop` |
| Stars: count, sizes, tints, twinkle, drift | `tuning.starfield` |
| Space dust: count, size, brightness, streak length | `tuning.dust` |
| How planets are shaped and painted: relief, continents, sea level, terraces, where the colour bands change | `tuning.planet` (colours: `tokens.color.biome`) |
| The world: mesh detail, planet spin, the ring of a ringed planet, orbit lines, how the ship is lit between systems | `tuning.world` |
| The station, the satellite, the planet ring | `design/models/docks.ts` |
| Where a visitor starts, and what they see first | `tuning.ship.spawn` |
| The rocket and its flame: shapes (rings, fins, window) and which token paints what | `design/models/rocket.ts`, `design/models/flame.ts` |
| Which model a name stands for (generated code now, a `.glb` later) | `design/assets.ts` |
| How the ship leans, nods and bobs, and how the flame follows the throttle | `tuning.ship` |
| The chase camera: where it sits, how far it looks ahead, how loosely it follows, how the lens widens with speed, tall screens, and how it fits into the strip between a phone's solid bar and its sheet (`fitDegrees`, `maxFitWiden`: the home page's welcome text keeps the home planet and the ship both in view) | `tuning.chaseCam` |
| The orbit camera of a docked ship: lens, how far above, how far round from the light, how much air round the docking ring, how fast the view wanders | `tuning.orbitCam` |
| Changing between cameras and making room for the panel: seconds from chase view to orbit view, how quickly the view slides over | `tuning.cameraRig` |
| How the ship flies (not a look, but it decides how every look is seen) | `tuning.flight` |
| Orbit assist: how fast and how far out a ship that lets go is eased onto a ring, how early a ship flying at a planet is swung round it | `tuning.assist` |
| Bumping into things: how deep and how firm the cushion above a surface is, how much bounce is left | `tuning.cushion` |
| Docking: how close to the ring the ship is taken over, how fast it then goes round, how quickly a capture settles, how hard one must steer to leave | `tuning.dock` |
| The autopilot (a click on a planet or a nav link flies the ship there): how fast it cruises between systems (`far`) and inside one (`near`), how hard it speeds up and brakes, how slowly it passes close to a body (`keepOutSpeed`) and how quickly that opens up with room (`openSpaceGain`), how wide it swings round bodies (`keepOut`, `path.clearance`), how far ahead it looks | `tuning.cruise` |
| Pointing at a planet: how small a target may be for a mouse and for a finger, how small a body can look and still be picked, what still counts as a tap | `tuning.picking` (the cursor over a planet: `#universe-host canvas[data-pick]` in `src/styles/global.css`) |
| The names over the bodies: type, colour, the dot on the one the ship is headed for (`data-state='target'`), how systems, planets and moons differ (`data-kind`), how they fade in and out (`data-shown`) | `.body-label` in `src/styles/global.css` |
| The star map (`M`, the Map button, or scroll out): the lens, how long the way out takes, how far in and out it zooms and how much air the first fit leaves, how quickly pans and zooms settle, wheel and key speeds, how far a wheel must turn to open it | `tuning.map` |
| The LOOK of the map: how flat the shading goes (`flatness`), how far the stars dim (`starOpacity`), the smallest size of each kind of body in px (`minRadiusPx`), how much room a moon needs beside its planet before it is drawn (`clearPx`), the size of the ship's marker (`shipRadiusPx`) | `tuning.map` (what flat MEANS: `uFlatness` in `shaders/toonFlat.ts`) |
| The Map button: top right under the bar, `data-state='open'` while the map is up, the key cap hidden for fingers; and the cursor over the map (`canvas[data-map]`, `[data-dragging]`) | `.map-toggle` in `src/styles/global.css` |
| Where a name sits under its body, how far names keep from each other, from the edges and from the top bar, how many may show at once. On the map the ship's marker is "you are here" and no name lies on it: a name the ship would be under moves above its body (`ui/Labels.ts`, `ship`); names also keep off the footer chip in the corner (`foot`, measured by `src/shell/panel-inset.ts`) | `tuning.labels` |
| The first-visit hint card ("W A S D or the arrow keys to fly..."): where it sits for a mouse and for a finger, the key caps. It never covers the ship or the home planet: bottom left beside the ship on a wide screen, under the bar on a tablet or a phone held sideways, below the ship on a phone held upright (where it steps aside once the boost pad or the prompt appears). Its band is `ink.low`: a hint is news, not a family, and not "here" | `.flight-hint` in `src/styles/global.css` (the words: `src/layouts/Base.astro`) |
| The dock prompt ("Orbit FishAI", "Flying to FishAI" with its "Stop", "Leave orbit"): a real button, bottom centre above the corner chip (on a phone held upright, above the boost pad; held sideways, down on the bottom edge, below the ship); on a phone with the sheet up, in the Map button's row, so the docked body has the strip between that row and the sheet (`frameTop`, `src/shell/panel-inset.ts`); hidden while the map is open there. Where room is short (that row, the narrowest sideways phone) "Flying to" steps aside, heard but not seen (`.dock-prompt__lead`) | `.dock-prompt` in `src/styles/global.css` |
| Where space ends, and how hard it pulls a ship back | `tuning.edge` |
| Touch controls: the look of the stick and the boost pad | `src/styles/global.css` (`.touch-stick`, `.touch-boost`) |
| Touch controls: the stick's travel, dead zone, how sharply it steers, the brake cone | `tuning.input` |

**Tuning by hand:** run `npm run dev` and open `/?universe&tweak`. Every value of `tuning.flight`,
`tuning.assist`, `tuning.cushion`, `tuning.dock`, `tuning.cruise`, `tuning.chaseCam`, `tuning.orbitCam`, `tuning.cameraRig`, `tuning.map`, `tuning.ship` and `tuning.shading` is a slider that acts at once; "copy tuning as
JSON" gives the values to paste back into `design/tuning.ts`. Add `&perf` for a frame-rate readout.

**The horizon is where the planets are.** Everything flies on one plane, so every planet sits on
the horizon line of the chase camera, and `tuning.chaseCam.up` with `lookAheadBase` decide where
that line is on screen. It belongs about a third of the way down: higher and the planets hide under
the top bar, with three quarters of the screen empty below them.

**Judge one thing at a time in the lab.** With `npm run dev` running,
`http://localhost:4321/lab/` puts a single planet (any biome, any seed, with or without rings,
everyday or close-up detail), moon, sun, the rocket, the station or the satellite on a turntable
in front of the real sky. Drag to look around, wheel to zoom, move the light, and use the sliders
for `shading`, `planet`, `world`, `post` and `ship`; "copy tuning as JSON" gives you what to paste
back into `tuning.ts`. Token colours are not sliders: edit `tokens.ts` and the page reloads.

**Judge a look on every tier.** `/?universe&q=low`, `&q=medium` and `&q=high` show the three
side by side in three tabs. LOW has no bloom and no vignette, so nothing may DEPEND on them: they
are seasoning. Only things that ask for it bloom (the knobs above), so the pastel world stays crisp
however strong the bloom is.

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

One-key shortcuts (W A S D, E, M, and `+` `-` on the map) never act inside the panel or a form
field, never do anything that cannot be undone at once, and plain mode (a link on every page) is
the same site with none at all: the "conforming alternate version" that WCAG 2.1.4 accepts. A new
one-key shortcut must keep all three true.

## How to work in the design surface

Astra edits `src/universe/design/**`, `src/styles/**` and `public/models/**`. **Values are free to
change; keys are API.** Need a new knob, a markup change, or anything outside those paths? Write
`ASTRA-REQUEST: …` in the PR and Claude wires it up. Models (from Phase 3): `.glb` only, meshopt
compressed, at most 5 MiB, kebab-case names, +Z forward, +Y up, 1 unit = 1 u, one shared palette
texture.
