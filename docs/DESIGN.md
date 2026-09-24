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

Today: a system rounded stack (`font.body`, and `font.display` for headings and the wordmark,
which is the same stack until A1 decides otherwise) and a system mono stack (`font.mono`), zero
font downloads. Five candidates are staged in `public/fonts/` with an `@font-face` each (Nunito,
Rubik, Outfit, Inter, JetBrains Mono: variable, Latin subset, SIL Open Font License); a face is
adopted by putting its family name first in a stack, a face that no stack names is never
downloaded, and whatever A1 does not choose is deleted afterwards. The fluid scale is `text.xs … text.display` (min at 360 px, max near 1200 px). A1 chooses
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
| Space dust: count, size, brightness, streak length, and how fast it may slide past (`maxFieldSpeed`: faster than that, the lens and the planets rushing by say how fast) | `tuning.dust` (the slide: `uField` in `shaders/dust.ts`) |
| How planets are shaped and painted: relief, continents, sea level, terraces, where the colour bands change | `tuning.planet` (colours: `tokens.color.biome`) |
| The world: mesh detail, planet spin, the ring of a ringed planet, orbit lines, how the ship is lit between systems | `tuning.world` |
| The station, the satellite, the planet ring | `design/models/docks.ts` |
| Where a visitor starts, and what they see first | `tuning.ship.spawn` |
| The rocket and its flame: shapes (rings, fins, window) and which token paints what | `design/models/rocket.ts`, `design/models/flame.ts` |
| Which model a name stands for (generated code now, a `.glb` later) | `design/assets.ts` |
| How the ship leans (never more than `bankRad`, however hard the autopilot turns it, eased at `bankOmega`), nods and bobs, and how the flame follows the throttle | `tuning.ship` (the lean: `sim/bank.ts`) |
| The chase camera: where it sits, how far it looks ahead (and never further than `lookAheadMax`: at the autopilot's speeds the view would lie flat along the plane), how loosely it follows, how the lens widens with speed and how quickly it gets there (`fovOmega`: the autopilot changes speed in a tenth of a second), tall screens | `tuning.chaseCam` |
| The orbit camera of a docked ship: lens, how far above, how far round from the light, how much air round the docking ring, how fast the view wanders | `tuning.orbitCam` |
| Changing between cameras and making room for the panel: seconds from chase view to orbit view, how quickly the view slides over | `tuning.cameraRig` |
| How the ship flies (not a look, but it decides how every look is seen) | `tuning.flight` |
| Orbit assist: how fast and how far out a ship that lets go is eased onto a ring, how early a ship flying at a planet is swung round it | `tuning.assist` |
| Bumping into things: how deep and how firm the cushion above a surface is, how much bounce is left | `tuning.cushion` |
| Docking: how close to the ring the ship is taken over, the pace an approach flies onto it (`approachSpeed`, never more than `approachMaxRate` round a small moon), how fast it then goes round, how quickly a capture settles (`settleOmega`, which also brings a journey's end onto the ring), how hard one must steer to leave | `tuning.dock` |
| The autopilot (a click on a planet or a nav link flies the ship there): how fast it cruises between systems (`far`) and inside one (`near`), how hard it speeds up and brakes, which journeys count as short (`shortLeg`) and long (`longLeg`), how slowly it passes close to a body (`keepOutSpeed`), how quickly that opens up with room (`openSpaceGain`) and how much of its speed counts when it only goes past (`passShare`), how wide it swings round bodies (`keepOut`, `path.clearance`), how far ahead it looks, the hardest it brakes for its plan (`comfortDecel`: braking for what lies on its own course is the reflex's, `sim/reflex.ts`, and not held to it), the shortest a journey may be (`minJourneySec`: a hop still reads as a journey), and how quickly a journey handed back at speed drops to the pilot's own top speed (`dropOutPerSec`; Stop then brakes the rest) | `tuning.cruise` |
| Pointing at a planet: how small a target may be for a mouse and for a finger, how small a body can look and still be picked, what still counts as a tap | `tuning.picking` (the cursor over a planet: `#universe-host canvas[data-pick]` in `src/styles/global.css`) |
| The names over the bodies: type, colour, the dot on the one the ship is headed for (`data-state='target'`), how systems, planets and moons differ (`data-kind`), how they fade in and out (`data-shown`) | `.body-label` in `src/styles/global.css` |
| The star map (`M`, the Map button, or scroll out): the lens, how long the way out takes, how far in it zooms (`spanMin`) and whether it may zoom out past the view of everything (`zoomOutPastFit`, 1: not at all), how much air the first fit leaves (`fitMargin`, plus `fitPadPx` for the names at the edge), how quickly pans and zooms settle, wheel and key speeds, how far a wheel must turn to open it. (A finger that moves on a name drags the map: the slop is `tuning.picking.tapMaxPx`.) | `tuning.map` |
| The LOOK of the map: how flat the shading goes (`flatness`), how far the stars dim (`starOpacity`), the smallest size of each kind of body in px (`minRadiusPx`), how much room a moon needs beside its planet before it is drawn (`clearPx`), the size of the ship's marker (`shipRadiusPx`) | `tuning.map` (what flat MEANS: `uFlatness` in `shaders/toonFlat.ts`) |
| The Map button: top right under the bar, `data-state='open'` while the map is up, the key cap hidden for fingers; and the cursor over the map (`canvas[data-map]`, `[data-dragging]`) | `.map-toggle` in `src/styles/global.css` |
| Where a name sits under its body, how far names keep from each other, from the edges and from the top bar, how many may show at once | `tuning.labels` |
| Where the systems sit: how far from home and from each other (`homeRoom`, `slotRoom`) and which way the cluster grows (`clusterAxisDeg`). Not a look: **changing any of the three moves every system** (a test pins them, and `galaxy.lock.json` will), so ask Allen first. The build refuses rooms too small for the tripwires (`maxSystemRadius`, `minSystemGap`). | `tuning.layout` |
| The first-visit hint card ("W A S D or the arrow keys to fly..."): where it sits for a mouse and for a finger, the key caps | `.flight-hint` in `src/styles/global.css` (the words: `src/layouts/Base.astro`) |
| The dock prompt ("Orbit FishAI", "Flying to FishAI" with its "Stop", "Leave orbit"): a real button, bottom centre (out of sight while the star map is open in the strip above a phone's page sheet, where it would sit on the galaxy: `quiet` in `ui/Prompt.ts`) | `.dock-prompt` in `src/styles/global.css` |
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
