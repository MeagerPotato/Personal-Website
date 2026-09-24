# Design brief

The standing brief for anyone making a visual decision on allenkh.com. Handoff packets link here so
they can stay short. Engineering rules are in [AGENTS.md](../AGENTS.md); the full product plan is
[PLAN.md](PLAN.md) (§3 experience, §5.6 design surface).

Status: **the visual identity (A1) is decided and built.** Claude (Opus 5.5) carried out the A1
packet ([handoffs/01-visual-identity.md](handoffs/01-visual-identity.md)) at Allen's request on
2026-09-23, instead of Astra. Four directions were built and judged by four reviewers; "roadmap"
won, and three rounds of five reviewers finished it. This page says what was decided. A2 and A3
remain Astra's: sections or lines marked _(open: A2)_ or _(open: A3)_ are for the scene
art-direction pass and the motion pass.

## The idea

A personal site you can fly through. Solar systems are passions, planets are projects, moons are
sub-projects. It should feel like **Mini Motorways drawn in space**: muted pastels, flat shading,
tidy geometry, small legible shapes, minimal UI, with the cozy piloting feel of
[Tiny Skies](https://tinyskies.vercel.app/), a little more detailed. Dark navy space, pastel worlds.

Voice: **playful framing, technical substance.** Jokes live in headings and microcopy. Claims and
numbers are precise. The owner appears as "Allen".

**The look (A1): "roadmap".** Mini Motorways taken literally. The UI is road signage and a transit
map's legend on flat navy, set in one face. The route line with its stations is the only
ornament: a list of projects is a transit line, a moon branches off on a dotted spur, a career is
a line of stops. Each solar system is a colour family and a glyph. Over the 3D world every control
is a chip on a navy plate that reads on the brightest thing behind it.

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
| `color.space` | `950 900 800 700 600` | backdrop ramp, deepest to lightest; page background is `900`, the map grid's dots `700`; `950` is the focus ring's rim and a key's ledge |
| `color.ink` | `high mid low` | text: `high` leads (headings, values, every chip over the world), `mid` is running text, `low` draws edges and marks and is never text on a chip over the world. Every pairing: the contrast table below |
| `color.surface` | `panel raised line` | `panel`: legend plates and the info panel; `raised`: a plate on a plate (the facts in the panel), the hint card, and anything lit under a mouse; `line`: hairlines, and the lit face of a key on a raised plate |
| `color.system` | `coral butter mint sky lilac` × `base light shade` | one family per solar system: `base` fills, lines, stations and the lit side; `light` text on the family's tints, and highlights; `shade` a filled key's ledge and the tinted shadow side |
| `color.accent`, `color.focus` | | links and interactive text (sky); **butter, which means "here"**: the focus ring, the current page's bar, the name the ship is headed for |
| `color.star` | `warm cool white` | starfield tints |
| `color.shading` | `shadow` | **multiplies** a surface's colour on the side facing away from its sun: cool and tinted, never black (white would mean no shading) |

Rules: body text at least 4.5:1, large text 3:1, edges and marks 3:1, re-measure whenever either
side of a pairing changes: `src/site/contrast.test.ts` measures every pairing the stylesheet relies
on (the translucent plates composited over white, the brightest thing in the world), so
`npm run verify` fails when a colour change breaks one. Each system owns one family: a planet's
route line and station, its lane colour and its panel's band come from its system's family (its
name over the world is a navy tag like every name; only the target's is butter), and a project
card wears its own system's family on any page (`data-theme` on the card).

**The families.** The five family bases are spread in lightness as well as hue (butter and mint
light, sky and coral in the middle, lilac deepest), so that no two collapse for a colour-blind
visitor (closest pair under any dichromacy about 10 CIEDE2000 apart; sky and lilac had been 1.1
apart under deuteranopia). The home system is butter, and a page with no family of its own is in
it. Every family also has a **glyph**, a second cue that is not colour: butter a circle, sky a
diamond, mint a triangle, coral a square, lilac a four-point spark (`--theme-glyph`, drawn with
`clip-path` on the route sign's marker and the sun on the projects page; no font or image
cost). The spark and the triangle cover less of their box than a circle or a square, so they are
drawn a touch larger (`--theme-glyph-scale`, 1.12 and 1.06): at 11 px all five read as the same
size, and the spark stays a star, not a thin plus. Five families are enough for now; a sixth
needs a sixth glyph. Every family's numbers are in the contrast tables below.

Three words of the vocabulary never change meaning:

- **Butter means "here":** the current page (a short bar under its name in the nav), the
  keyboard's focus (the ring), the body the ship is headed for (the one filled name tag), and what
  acts on the body at hand (the E key cap of "Orbit FishAI", "Stop"). The home system is butter
  too, so a focused butter key keeps a navy rim between its fill and the ring.
- **The cream face (`ink.high` fill) means "on":** only toggles that are switched on wear it (the
  Map button while the map is open, the sheet's Shrink, the welcome button while its text shows).
  The small key caps that NAME a key (W, Shift, M in the hint card and on the Map button) are
  drawn as the white keys they are; they are not a control's face.
- **One solid family fill per view:** the primary action. Route signs above the headings and a
  project's tags are tinted, with a hairline edge; secondary keys are outlined in `ink.low`.

### Contrast

Computed from `tokens.ts` with the site's own maths (`src/site/contrast.ts`, WCAG 2), to one
decimal, on 2026-09-23. The grounds: **the page** is `space.900`; **the panel** is `surface.panel`
at 96 % over white, and **the HUD plate** (`--hud`, under every chip over the world) is
`surface.panel` at 90 % over white. Over the 3D world a plate is measured on the brightest thing
it can sit on (a sun, a white peak, a pale ring), so its contrast never depends on what happens to
be behind it. Every text pairing below is small text somewhere, so 4.5:1 is the bar for all of
them. `src/site/contrast.test.ts` holds every pairing the stylesheet relies on to its bar and reads
the two plates' shares from the stylesheet, so `npm run verify` fails before a colour change can
break one; recompute these numbers whenever a colour in a pairing changes.

| Text (4.5:1) | Ratio | Where it is used |
| --- | --- | --- |
| `ink.high` on the page / the panel | 17.2 / 14.0 | headings, the lede, card titles, the wordmark, a key's label, a fact's value, the current page in the nav |
| `ink.high` on `surface.panel` / `surface.raised` | 15.5 / 13.7 | `surface.panel`: the facts' values in plain mode, a key in the panel, a notice's key, "Got it" on the hint card, the Launch the starfield chip; `surface.raised`: the facts' values in the panel, the panel bar's keys, anything lit under a mouse (a nav word, a key, a chip, a name's tag) |
| `ink.high` on `surface.line` | 9.8 | a key on a raised plate under a mouse: the panel bar's Close and Expand, the hint card's "Got it" |
| `ink.high` on the HUD plate | 11.6 | every chip over the world: the wordmark, the nav tray's current page, "About this site", Map, the dock prompt, a name, the boost pad, the Plain version chip |
| `ink.mid` on the page / the panel | 10.6 / 8.6 | running text, the nav, the crumbs, a card's summary and status chip, the resume's dates, bullets and skills, a caption, the footer |
| `ink.mid` on `surface.panel` / `surface.raised` | 9.6 / 8.5 | a notice's words; the hint card's words and inline `code` |
| `ink.mid` on the HUD plate | 7.2 | the nav tray's other links, a moon's name |
| `accent` (sky) on the page / the panel | 9.9 / 8.0 | links in running text, the legend's links (Elsewhere, Contact), the resume's ways to reach Allen, a card's title under a mouse |
| butter on the HUD plate | 9.3 | "Stop" in the dock prompt |
| `space.900` on cream (`ink.high`) | 17.2 | a toggle that is on (Close map, Shrink, the welcome button), the key caps W A S D, Shift and M; cream on navy, the M cap of the open Map button |
| `space.900` / `space.950` on butter | 13.9 / 14.5 | the target's name tag and the E cap of "Orbit" / the skip link |
| `space.900` on coral | 8.4 | the pressed boost pad |
| `space.900` on a family's base / light | 6.3 / 11.5 | the primary key and its hover; lilac is the lowest (every family below) |
| a family's light on its route sign, page / panel | 10.2 / 8.1 | the route sign above a heading (a 10 % tint); lilac is the lowest |
| a family's light on its tags, `surface.panel` / `surface.raised` | 8.7 / 7.7 | a project's "Built with" tags (a 12 % tint on the facts plate, plain / panel); lilac is the lowest |
| a family's light on `surface.panel` / `surface.raised` | 10.4 / 9.2 | the facts' labels (Status, When, Role), plain / panel; a system's name under a mouse, on the bare page, is higher still |
| `ink.low` on the page / `surface.panel` / the panel / `surface.raised` | 6.7 / 6.0 / 5.4 / 5.3 | no text today, only edges and marks (below); the test still holds it to 4.5, so it may carry small print on these grounds |
| `ink.low` on the HUD plate | 4.49 | **never**: it falls short, and a test fails any rule that sets a chip's text over the world in it |
| black on white | 21.0 | every page on paper (print keeps to the keywords `black` and `white`) |

| Non-text (3:1) | Ratio | Where it is used |
| --- | --- | --- |
| butter ring on its navy rim (`space.950`) | 14.5 | the focus ring, on everything: the rim is what it meets, whatever lies under the control (a butter key, a pale planet) |
| butter on the page / the panel / the HUD plate | 13.9 / 11.3 / 9.3 | the ring where it meets the ground outside it; the current page's bar under its word (plain / universe) |
| `ink.low` edge on the page | 6.7 | a secondary key (its face is the page too), a mixed list's route line, the Launch the starfield chip (its face is `surface.panel`, 6.0 inside) |
| `ink.low` edge on `surface.panel` / the panel / `surface.raised` | 6.0 / 5.4 / 5.3 | a key in the panel (face `surface.panel` on the panel), the panel bar's keys (face `surface.raised`), "Got it" on the hint card, a notice's ring and key, a mixed list in the panel |
| a family's base on the page / `surface.panel` / the panel / `surface.raised` | 6.3 / 5.6 / 5.1 / 5.0 | route lines, stations, glyphs, suns, the crumbs' dashes, the prose's heading rings, a plate's band, the panel's top band, the primary key's fill; lilac is the lowest |
| `ink.high` edge of the HUD (`--hud-edge`, 14 %) on the HUD plate | 1.5 | decoration, not a boundary: a chip is found by its words, as a text button is. Under `prefers-contrast: more` and forced colours it becomes `ink.low` on an opaque plate (6.0) |
| `surface.line` hairline on the page / the panel | 1.7 / 1.4 | decoration, not a boundary: the rules between legend rows, a status or date chip's outline, the resume's rail. Nothing is found by them alone |

Every family (the rows above give the lowest, lilac):

| Family | Glyph | Navy on base / light | Light on its route sign, page / panel | Light on its tags, plain / panel | Light as a fact's label, plain / panel | Base as a mark: page / `surface.panel` / panel / `surface.raised` |
| --- | --- | --- | --- | --- | --- | --- |
| coral | square | 8.4 / 12.8 | 11.2 / 8.8 | 9.4 / 8.3 | 11.5 / 10.2 | 8.4 / 7.6 / 6.8 / 6.7 |
| butter | circle | 13.9 / 16.3 | 13.4 / 10.4 | 11.0 / 9.6 | 14.6 / 12.9 | 13.9 / 12.5 / 11.3 / 11.0 |
| mint | triangle | 14.2 / 16.4 | 13.4 / 10.3 | 11.0 / 9.6 | 14.7 / 13.0 | 14.2 / 12.7 / 11.5 / 11.2 |
| sky | diamond | 9.9 / 14.0 | 11.8 / 9.2 | 9.9 / 8.6 | 12.6 / 11.1 | 9.9 / 8.9 / 8.0 / 7.9 |
| lilac | four-point spark | 6.3 / 11.5 | 10.2 / 8.1 | 8.7 / 7.7 | 10.4 / 9.2 | 6.3 / 5.6 / 5.1 / 5.0 |

Under `prefers-contrast: more` the plates are opaque `surface.panel`: `ink.high` 15.5, `ink.mid`
9.6, butter 12.5, and the HUD's edge is `ink.low` at 6.0. In forced colours the system's own
colours take over (States, below).

## Typography

**One face, Outfit**, for everything a visitor reads (variable 100 to 900, Latin subset, 32 KB,
SIL Open Font License, `public/fonts/`): the clean geometric sans closest to Mini Motorways' own
lettering, the way every sign on a transit map is set in one face. Headings, body, labels, chips
and the HUD all speak it; `font.body` and `font.display` name the same face. Code alone uses the
device's own mono stack (`font.mono`), which costs nothing. The other four staged candidates
(Nunito, Rubik, Inter, JetBrains Mono) are deleted, with their licences.

- **Loading.** One file, `font-display: swap`, cached for a year like everything under `/fonts/`
  (so a font file never changes under the same name). `verify-dist` budgets the fonts a page
  preloads on a line of their own: 40 KiB, of which Outfit is 31.5. Every page preloads the file
  (`src/components/Head.astro`), and the stacks name `'Outfit Fallback'` next: local Arial (or
  the metric-identical Liberation Sans or Arimo) with `size-adjust` and ascent, descent and
  line-gap overrides **measured** from the real Outfit file (section 0 of the stylesheet says
  how). In Chromium a heading, the nav, a paragraph and a button set in the fallback take the
  same height as in Outfit and within 1 to 2% of its width, so the swap moves very little: a
  single line stays put, but a paragraph that sits right at a line break can gain or lose a line
  (measured: the home lede at 1280 px goes from three lines to two). The preload makes a fallback
  paint rare.
- **Weights.** Body text 430 with a hair of tracking (Outfit is light and narrow at 400), labels
  and nav 600, headings 700. Running text keeps to `--measure` (31 em: about 70 characters a
  line, measured on the rendered lines, where 33 em had run to 77 to 82).
- **Scale** (`text.*`, fluid from 360 px; at 1280 px / on a phone): display (the h1)
  60 / 40, `xl` (h2 and section heads) 30 / 24, `lg` (the lede, card titles) 25 / 21,
  `base` 18 / 17, `sm` 16 / 15, `xs` (caps labels) 13 / 12. Most sizes stop growing at 1200 to
  1300 px; `base` goes on to 19 px, reached near 1680 px. The panel pins the scale to
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
  In any one column every line of text starts on the same edge (the resume's `--rail`). How each
  is drawn: Plain mode, below.
- **Movement on hover or press uses the CSS `translate` (or `scale`) property, never
  `transform`**: the engine writes `transform` on the names and the touch controls every
  frame. There is no hover lift; if one is added, gate it with `(hover: hover)` and switch it off
  when motion is reduced.
- DOM motion tokens: `motion.fast base slow` with `easeOut` and `easeInOut`. Things ease out when
  they arrive and ease in-out when they move. Nothing bounces more than once.
- **Reduced motion:** no twinkle, no drift, no camera flights (cuts instead), no parallax. The
  static frame must still look composed.
- Engine timings (camera blends, flight feel) are in `design/tuning.ts`, in seconds. _(open: A3)_

## States

Every state is designed, not only the resting one, and each has a shape as well as a colour.

| State | How it looks | Where |
| --- | --- | --- |
| Hover | A key lights (to `surface.raised`, or `surface.line` on a raised plate) and its edge goes to `ink.mid`; a primary key goes to its family's light; a chip over the world lights to `surface.raised` with an `ink.low` edge; plain mode's chips (Launch the starfield, the resume's ways to reach Allen) take a sky edge; a nav word lights a chip behind it; a name's tag lights with a thin `ink.low` ring. **Only where hover exists** (`(hover: hover)`): after a tap on a phone a lit key would stay lit, and a lit key reads as "on". A text link's hover only changes its words' colour (to `ink.high`; sky for a card's title or a moon's name; the family's light for a system's name on the projects page) and needs no gate: pressing it opens another page | keys, chips, nav words, names, the resume's contact chips |
| Focus (`:focus-visible`) | A 3 px butter ring outside a 2 px `space.950` rim, so it reads on anything: a white peak, a pale ring, a butter key (butter meets navy, never butter). A key at rest carries the same three shadows with the rim at nothing, so a focus eases in the rim and nothing else | everything focusable, in both modes. The ring goes round a name's tag, not its 44 px box, round a nav word's 36 px chip (no rim: it sits on navy already), and round a card title's words. The heading the router focuses after a soft navigation, and `<main>` where the skip link lands, show none: they are not controls |
| Current page (`aria-current`) | The word in `ink.high` over a short butter bar, like a lane marking (20 by 3 px, low in the chip, clear of the descenders) | the main nav, both modes |
| Target (`data-state='target'`) | The one filled name tag: navy on butter, with a navy station dot before the name (the tag grows to the left to hold it, out of the flow: the engine measured the name without it) | the body the ship is headed for |
| On | The cream face: `ink.high`, navy words, no edge. A toggle is named for what it does next ("Close map", "Shrink"), so the sheet's button carries no `aria-pressed` ("Shrink, toggle button, pressed" contradicted itself) | the Map button while the map is open (`data-state='open'`; its M cap turns navy), the sheet's Shrink (`html[data-panel-size='full']`), "About this site" while its text shows (`aria-expanded`) |
| Pressed | A key drops onto its ledge (`translate` by `--ledge`, the ledge gone), and so do the chips over the world that have one. The boost pad (`data-active`) fills coral, the flame's colour, with navy words, and gives a little (`scale: 0.94`, none when motion is reduced) | keys, the Map button, the dock prompt, the boost pad |
| Forced colours | The plates are the system's. Keys and chips keep a real border; the ring (an outline) is kept, and a focused name gets a `Highlight` outline. The current page is underlined. The glyphs, the suns, the route lines and their end bars, the resume's rail and the crumbs' dashes are drawn in `CanvasText`; a toy planet keeps its colours (it is a picture) inside rings of `Canvas` and `CanvasText`. The target's tag gets a `CanvasText` border and dot, the pressed boost pad `Highlight`. The wordmark's three stations (gradients, which forced colours drop) are hidden rather than leave a gap | `@media (forced-colors: active)`, after the rules it overrides |
| More contrast | The HUD plate and the panel are opaque `surface.panel` (no blur), and the HUD's edge turns `ink.low` | `@media (prefers-contrast: more)` |

## The two modes

| | Plain | Universe |
| --- | --- | --- |
| What it is | the base stylesheet: a fast typographic site | the same page with the 3D world behind it |
| `<main>` is | the page | the info panel: a side panel on a wide screen (and, narrower, on a phone held sideways), a bottom sheet on a phone held upright |
| JavaScript | about 2 KB gzipped, no framework, no three.js | engine (about 170 KiB gzipped, of a 220 KiB budget) loads on demand |
| Must work | without JS, in print, at 360 px | on a mid-range phone at 30+ fps |

Both are styled from `src/styles/global.css`: base rules are plain mode,
`html[data-mode='universe']` rules layer the universe look on top.

## Plain mode

The base stylesheet, and what a recruiter may only ever see: a fast typographic site drawn as a
transit map.

- **The ground** is flat `space.900` with a faint map grid (a `space.700` dot every 24 px). The
  column is 45rem wide at most.
- **The top.** The wordmark is "Allen", then a little transit line of three stations (coral,
  butter, mint on an `ink.low` line). The nav is a row of words in `ink.mid`; a mouse lights a
  36 px chip behind one, and the current page has its butter bar. The last word ends on the
  column's edge, as the wordmark starts on the other. On a phone the nav takes a row of its own,
  spread across, each word lined up with the column's edges.
- **A page's head.** The crumbs are a route (Projects ── Code), their dashes in the family. The
  **route sign** says what kind of place this is: a tinted plate (10 %) with a hairline edge
  (50 %) and the family's glyph, in caps at the smallest size, quiet enough that the heading
  under it wins the first glance. A sign in two parts that has no room for one line gives each
  part a line of its own. Then the h1, and the lede in `ink.high`.
- **Keys.** The primary action is the one solid family fill in a view; the others are outlined in
  `ink.low`. All are pills on a hard ledge.
- **A list of projects is a transit line.** Every planet is a station on one route line that ends
  in an end-of-line bar: its toy planet (flat-shaded like the 3D ones, in its biome's colours) is
  cut out of the line by a ring of the ground and held by a ring of the line's colour. A planet's
  status is a chip. Moons branch off on a dotted spur that leaves from the route line. On a phone
  the line runs in a slim lane down the left, a small station on it tied to the planet beside its
  name, and the words take the card's full width.
- **A list's route line takes its stations' colour**, as on a transit map. A list of one system
  wears that system (the home page's "Start here" is a sky line on a butter page while every
  featured planet is in Code); a list that mixes systems draws its line neutral, in `ink.low`, so
  that each station is the only thing in its family's colour. A card names its own family
  (`data-theme`, from `projectTheme()` in `src/site/view-models.ts`), so a planet wears its own
  colour on every page.
- **The projects page:** each solar system is a line whose first station, the terminus, is its
  sun, with the family's glyph cut out of it like a line's bullet on a transit map. The tagline is
  the sun's caption.
- **A project's page:** the facts are a legend plate (`surface.panel`, a 4 px band in the family,
  a ledge), their labels in the family's light, in caps; what it is built with is a row of tags
  tinted in the family (12 %) with a hairline edge; the cover sits in a hairline frame.
- **Running text** (`.prose`) keeps to the measure. A heading is a stop, with a station ring in
  the page's family before it; bullets, a quote's line and the rule under a table's head are in
  the family; inline code sits on `surface.raised` in the mono stack, and a code block in a
  hairline frame on the page's ground; a rule is dotted.
- **Legends** (Elsewhere, Contact): the name, a dotted leader, what it is, with hairlines between
  the rows.
- **The resume is a line of stops.** Each role is a station on a thin rail down the left, its
  dates a timetable chip (the small size, not the smallest: they are what a reader scans first).
  Every section's text starts on one edge (`--rail`), entries, skills and awards alike. On a wide
  screen (72rem and up) each section's name hangs in a 10.5rem column in the margin, so the
  entries keep the full measure. In a narrow column (a phone, the panel) the dates always go under
  the title, so that a reader scanning down the rail does not see them zig-zag. The ways to reach
  Allen are outlined chips, and on a phone 44 px rows between hairlines, like the Contact page.
- **On paper** every page is the plain layout in black on white. The route ornaments, the toy
  planets and the stations go. The resume is one classic column headed by the name (the wordmark
  at a heading's size, the page's title a small label under it); its dates are plain words of
  about 9 pt, and its heads are sized for paper.
- **Notices** (this is the plain version, and why) are a legend plate of their own: the band in
  `ink.low` (a notice is news, not a family), a station ring before the words, and the way back to
  the starfield as a real 44 px key.
- **The skip link** is a butter pill (butter is "here"), off screen until focused. **The footer**
  holds the way into the other mode, a chip with a sky station marker. **The 404** is plain only
  and uses the site's keys.

## The universe's controls

The DOM over the 3D world. Every control is a **chip on the HUD plate** (`--hud`: `surface.panel`
at 90 %, with a faint `--hud-edge`), opaque enough that its words pass AA over the brightest thing
behind it. Where the engine makes a control (the names, the prompt, the Map button, the touch
controls), the stylesheet only says how it looks. Where each one sits, and what it keeps clear
of, is in the table under The 3D world.

- **The top bar.** The wordmark becomes a chip, and the nav becomes **one tray** on the plate, not
  a chip per link: calmer over the world, and one shape to find. On a wide screen a soft navy fade
  lies behind the bar. On a phone held upright the bar is two rows (the wordmark, and "About this
  site" on the home page; then the tray across the full width), tight and with no fade: every
  pixel of bar is a pixel less of world. A short view (a phone held sideways) keeps one row down to
  568 px with tighter chips; at 400 % zoom (320 by 256) it takes the phone's two rows.
- **"About this site"** (the home page only): the welcome text waits behind it, and it wears the
  cream face while the text shows.
- **The Map button**, top right under the bar: "Map" with its M key cap; on the map, "Close map"
  in the cream face. A finger gets no key cap and a fixed width.
- **The names** over the bodies are real buttons: a 44 px target with the name on a small navy
  tag at the end nearest its body (the top below it, the bottom above it), like a label on a
  transit map, 13 px at every width and on the map. A sun or the
  home planet names a whole system, in spaced caps at 700; a moon is quieter (`ink.mid`, 500).
  The body the ship is headed for has the one butter tag. Either side of its body a tag sits
  2 px off the disc. On the map the ship's marker is "you are here": no name's tag lies on it,
  or on the Plain version chip. A name the ship would be under glides a few pixels past it, away
  from its body, or goes above its body; so does one with no room below (the sheet, an edge, a
  control). Where the ship is going, and a name the keyboard is on, never make way for the ship.
- **The dock prompt** ("Orbit FishAI", "Flying to FishAI" with its "Stop", "Leave orbit") is one
  chip. Its E key cap is butter, the one key cap that is not white, because it is the prompt's
  action and not a key being named; "Stop" is set apart by a hairline, in butter.
- **The first-visit hint card** is an opaque legend card (`surface.raised`: nothing of the world
  ghosts through the words), its band in `ink.low` (a hint is news, not a family, and butter keeps
  its one meaning), with white key caps on a ledge and "Got it" as a key with an `ink.low` edge.
  It never covers the ship or the home planet. It is compact on touch and in narrow windows, and
  hidden on the map, where the same keys move the map.
- **The panel** is a legend plate over the world (`surface.panel` at 96 %, with a blur), with a
  5 px band across the top in the page's family (butter for the home system's pages). Its bar
  holds Close (and, on a phone, Expand), keys with an `ink.low` edge, over a hairline that makes
  the scrolling text an edge, not a cut; the text starts about 24 px under it on every page (the
  route sign's plate 24, the crumbs' words 22). The panel
  pins the type scale to its narrow end. On a wide screen it is a side panel on the HUD's grid: its
  right edge flush with the nav tray, its bottom level with the Plain version chip.
- **The bottom sheet** (a phone held upright) has rounded top corners. At rest it leaves at least
  20rem above it: the bar, the Map button's row and a strip of world for the docked body. The home
  page's welcome text rests lower (at most 45 % of the height), because the chase camera needs a
  taller strip than a docked body does. Expand takes it up to the bar's links. A phone held
  sideways keeps a narrower side panel instead (at most 62 % of the width), and at 400 % zoom an
  open panel takes the whole width while the engine's controls wait.
- **The touch controls** are white rings and a white knob, like the round tools of Mini
  Motorways; the boost pad is a ring on the HUD plate that fills coral while it is pressed. It is
  out in free flight only: boost multiplies the pilot's own thrust, and docked or on a journey
  the stick is what takes the controls back, so there the pad would light up and do nothing.
- **The Plain version chip** sits bottom left, a HUD chip with a sky station ring. Focused, it
  comes up above any panel.

## Icons and the link-preview card

Drawn from the tokens like everything else, so a palette change repaints them too:

- **`/favicon.svg`** (`src/site/favicon.ts`, pure and tested: token colours only, no text): a
  ringed planet on a navy tile, the sky family's base over its shade with a butter ring. It is
  drawn on a 32 px grid and checked at 16 px: where the ring crosses in front of the planet a
  band of navy cuts it free, as a station cuts a route line, and the ring and the navy either side
  of it are each at least a pixel wide at 16 px.
- **`/apple-touch-icon.png`**: the same drawing at 180 px, its corners filled with the tile's navy
  (iOS rounds them itself).
- **`/og/default.png`**, the link-preview card (`src/site/og.ts`): a small solar system with no
  text, signed with the wordmark's three stations. Its sun is drawn as the site draws one: a disc,
  a gap of the ground, a ring.
- The browser's `theme-color` is `space.900`.

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
| Where a name sits under its body, how far names keep from each other, from the edges and from the top bar, how many may show at once. On the map the ship's marker is "you are here" and no name's tag lies on it: a name the ship would be under glides a few pixels past it or goes above its body, as does one with no room below (`ui/Labels.ts`, `ship`, `eitherSide`); names also keep off the footer chip in the corner (`foot`, measured by `src/shell/panel-inset.ts`) | `tuning.labels` |
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
