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
numbers are precise. The owner appears as "Allen"; the resume alone (on screen, on paper and as
a PDF) gives the full name.

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
| `color.surface` | `panel raised line` | `panel`: legend plates and the info panel; `raised`: a plate on a plate (the facts in the panel), the hint card, and anything lit under a mouse; `line`: hairlines, and the lit face of a raised key (one whose face is already `raised`, or one on a raised plate) |
| `color.system` | `coral butter mint sky lilac` × `base light shade` | one family per solar system (a sun of a binary may wear one of its own: Software sky, Hardware coral), worn by its sun, its planets and their moons: `base` fills, lines, stations and the lit side; `light` text on the family's tints, and highlights; `shade` a filled key's ledge and the tinted shadow side |
| `color.accent`, `color.focus` | | links and interactive text (sky); **butter, which means "here"**: the focus ring, the current page's bar, the name the ship is headed for |
| `color.star` | `white cool hot warm amber ember` | the stars' six temperatures (`hot`, `amber` and `ember` are engine only: "Deep light", below) |
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
| `ink.high` on `surface.line` | 9.8 | a raised key under a mouse (its face already `surface.raised`, or on a raised plate): the panel bar's Close and Expand, the hint card's "Got it" |
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
| a family's base on the page / `surface.panel` / the panel / `surface.raised` / the HUD plate | 6.3 / 5.6 / 5.1 / 5.0 / 4.2 | route lines, stations, glyphs, suns, the crumbs' dashes, the prose's heading rings, a plate's band, the panel's top band, the primary key's fill, the glyph before a body's name on its tag; lilac is the lowest |
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
  would not fit. On paper the full name leads instead, at a heading's size.

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
| Hover | A key lights (to `surface.raised`, or `surface.line` when its face or its plate is already raised) and its edge goes to `ink.mid`; a primary key goes to its family's light; a chip over the world lights to `surface.raised` with an `ink.low` edge; plain mode's chips (Launch the starfield, the resume's ways to reach Allen) take a sky edge; a nav word lights a chip behind it; a name's tag lights with a thin `ink.low` ring. **Only where hover exists** (`(hover: hover)`): after a tap on a phone a lit key would stay lit, and a lit key reads as "on". A text link's hover only changes its words' colour (to `ink.high`; sky for a card's title or a moon's name; the family's light for a system's name on the projects page) and needs no gate: pressing it opens another page | keys, chips, nav words, names, the resume's contact chips |
| Focus (`:focus-visible`) | A 3 px butter ring outside a 2 px `space.950` rim, so it reads on anything: a white peak, a pale ring, a butter key (butter meets navy, never butter). A key at rest carries the same three shadows with the rim at nothing, so a focus eases in the rim and nothing else | everything focusable, in both modes. The ring goes round a name's tag, not its 44 px box, round a nav word's 36 px chip (no rim: it sits on navy already), and round a card title's words. The heading the router focuses after a soft navigation, and `<main>` where the skip link lands, show none: they are not controls |
| Current page (`aria-current`) | The word in `ink.high` over a short butter bar, like a lane marking (20 by 3 px, low in the chip, clear of the descenders) | the main nav, both modes |
| Target (`data-state='target'`) | The one filled name tag: navy on butter, its family glyph turned navy, the station it stops at (every other tag shows the glyph in its family's base) | the body the ship is headed for |
| On | The cream face: `ink.high`, navy words, no edge. A toggle is named for what it does next ("Close map", "Shrink"), so the sheet's button carries no `aria-pressed` ("Shrink, toggle button, pressed" contradicted itself) | the Map button while the map is open (`data-state='open'`; its M cap turns navy), the sheet's Shrink (`html[data-panel-size='full']`), "About this site" while its text shows (`aria-expanded`) |
| Pressed | A key drops onto its ledge (`translate` by `--ledge`, the ledge gone), and so do the chips over the world that have one. The boost pad (`data-active`) fills coral, the flame's colour, with navy words, and gives a little (`scale: 0.94`, none when motion is reduced) | keys, the Map button, the dock prompt, the boost pad |
| Forced colours | The plates are the system's. Keys and chips keep a real border; the ring (an outline) is kept, and a focused name gets a `Highlight` outline. The current page is underlined. The glyphs, the suns, the route lines and their end bars, the resume's rail and the crumbs' dashes are drawn in `CanvasText`; a toy planet keeps its colours (it is a picture) inside rings of `Canvas` and `CanvasText`. The target's tag gets a `CanvasText` border, and every name's glyph is `CanvasText`, the pressed boost pad `Highlight`. The wordmark's three stations (gradients, which forced colours drop) are hidden rather than leave a gap | `@media (forced-colors: active)`, after the rules it overrides |
| More contrast | The HUD plate and the panel are opaque `surface.panel` (no blur), and the HUD's edge turns `ink.low` | `@media (prefers-contrast: more)` |

## The two modes

| | Plain | Universe |
| --- | --- | --- |
| What it is | the base stylesheet: a fast typographic site | the same page with the 3D world behind it |
| `<main>` is | the page | the info panel: a side panel on a wide screen (and, narrower, on a phone held sideways), a bottom sheet on a phone held upright |
| JavaScript | about 2 KB gzipped, no framework, no three.js | universe mode's JavaScript (about 176 KiB gzipped: the engine 169, the shell 7) loads on demand, of a 220 KiB budget |
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
- **A page's head.** The crumbs are a route (Projects ── Software ── Canadian Fish, on FishAI's
  page), their dashes in the family. The **route sign** says what kind of place this is: a
  tinted plate (10 %) with a hairline edge (50 %) and the family's glyph, in caps at the smallest
  size, quiet enough that the heading under it wins the first glance. A sign in two parts that has no room for one line gives each
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
  featured planet is in Projects); a list that mixes systems draws its line neutral, in `ink.low`, so
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
  planets and the stations go. The resume is one classic column headed by the full name and
  nothing else (the wordmark and the page's own title are the screen's; on screen the name opens
  the document under the title, `lg` and 600); its dates are plain words of about 9 pt, its heads
  are sized for paper, and it is dense: entries a block apart, each skill group on one line, so
  that it fills two Letter pages, not three. The PDF the page offers is this same print
  (`npm run resume-pdf`).
- **The colophon** closes every plain page: one line in `xs`, `ink.mid`, under the footer's
  chips. The universe has no foot to put it at, so it leaves it out; paper leaves it out too.
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
  in the cream face. A finger gets no key cap and a fixed width, and so does a mouse beside a
  phone-shaped sheet, where the row is short of room. Whatever shares its row keeps --space-3
  clear of it, at the width it has then (`--map-chip`: wider under `html[data-map]`, where a
  journey's "Name | Stop" beside it on a phone lets its name give way).
- **The names** over the bodies are real buttons: a 44 px target with the name on a small navy
  tag at the end nearest its body (the top below it, the bottom above it), like a label on a
  transit map, 13 px at every width and on the map. A sun or the
  home planet names a whole system, in spaced caps at 700; a moon is quieter (`ink.mid`, 500).
  The body the ship is headed for has the one butter tag. Whichever side of its body, a tag sits
  2 px off the disc. On the map the ship's marker is "you are here": no name's tag lies on it,
  or on the Plain version chip. A name the ship would be under glides a few pixels past it, away
  from its body, or goes above its body; so does one with no room below (the sheet, an edge, a
  control). Where the ship is going, and a name the keyboard is on, never hide for the ship: with
  no room past it they stay where they would have been, even on it. On the map, where the view
  holds still, a name with no room above or below goes BESIDE its body, like a station's name on
  a transit map (its tag in line with the body, towards the middle of the view first), and one
  at a screen edge slides along its body, away from the edge, as long as the body stays over its
  tag; names make way for each other where they can, and every system's name shows at the first
  view, on a phone too. No planet's or moon's name lies on a sun or the home planet: those are the
  landmarks the map is read by (a system's name may, as a last resort). In flight everything drifts, and a name that hopped round its body would
  only distract: one place, under it.
- **A profile elsewhere** (GitHub, LinkedIn, Devpost) is a relay on the Contact satellite's
  ring, drawn as an emblem world of its own (`design/worlds/home.ts`): a plinth, a mast with the
  network's mark, and an exit arrow flat on the plane that always points away from home (never
  butter or the cream face), each with a footprint of its own (GitHub's arrow forks, LinkedIn's
  ends in a bar, Devpost's plinth has two ears), so it never reads as the satellite beside it,
  which a visitor can dock at and a relay cannot. Its name is a real
  link, in a group of its own ("Elsewhere"), with an outward arrow after the name in the name's
  own ink (a clip-path, no icon font); the site it opens is heard, not shown ("GitHub, on
  github.com"). Pointing at the relay never leaves the site: its name comes forward, focused and
  lit with the focus ring (`data-beckon`), and leaving is a second press. On hover the arrow
  steps out a little, by `translate`.
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
| The three shading bands: where a surface passes between shade, middle and lit, and how lit the middle is | `tuning.shading` |
| What is round and what has edges ("Deep light", round and smooth): by what a thing is made with, said once | `sim/world/kit.ts` (the list at its top), `ROUND_FROM`, `CREASE_DEG` and `POLE_DEG` in `sim/meshBuilder.ts` |
| How finely a round thing is built: how far the middle of a side may stand inside the true circle, every day, up close and on the low tier, and the most sides anything gets | `tuning.world.round` |
| The colour of shadow | `tokens.color.shading.shadow` |
| Which token feeds which shader input | `design/materials.ts` |
| The shaders themselves (GLSL) | `design/shaders/`: `toonFlat.ts` (every lit surface), `glow.ts` (the flame, rings, a generated sun), `corona.ts` (the light round every sun), `sky.ts` (backdrop and stars), `dust.ts`, `post.ts` (bloom, vignette) |
| Bloom and vignette: how strong, how wide, how dark the corners | `tuning.post` |
| WHAT blooms, and how much (0 to 1 each) | `tuning.world.sunBloom`, `tuning.world.ringBloom`, `tuning.ship.flame.bloom` |
| Quality tiers: pixel caps, anti-aliasing samples, which tiers get post-processing, the 30 fps cap, when the engine lowers its own resolution | `tuning.quality` |
| The sky: horizon glow, and up to four huge soft glows of colour (family, direction, size, strength) | `tuning.backdrop` |
| Stars: how many (`count`: the faintest class, the rest in proportion), the six temperatures and their shares (`palette`), the five classes (`classes`, `hero`: brightness, core, halos, spikes), where the eight heroes and the three clusters are, twinkle, a hero's breath, drift | `tuning.starfield` (the drawing: `stars` in `shaders/sky.ts`; the list: `sim/starList.ts`) |
| Space dust: count, size, brightness, streak length, and how fast it may slide past (`maxFieldSpeed`: faster than that, the lens and the planets rushing by say how fast) | `tuning.dust` (the slide: `uField` in `shaders/dust.ts`) |
| How planets are shaped and painted: relief, continents, sea level, terraces, where the colour bands change | `tuning.planet` (colours: `tokens.color.biome`) |
| The world: mesh detail, planet spin, the ring of a ringed planet, orbit lines, how the ship is lit between systems and near a body | `tuning.world` |
| Every body's emblem world: its ground and parts (`bodies.ts` and the files it gathers: `home.ts`, `projects.ts`, `research.ts`, `hackathons.ts`, and `gears.ts`, the Hardware sun's ball of fourteen meshing gears, each a slab with a wall under every edge of its plate, which `tests/world-gears.test.ts` keeps from jamming and from being paper at the limb); a recipe may say `still` and `faces: 'prograde'` (Model Rocketry is a rocket whose nose follows its orbit round its sun), what it adds up close (`near.ts`), how its parts move (`motion.ts`), and how far its solid reaches (`reach.ts`, measured by `tests/world-reach.test.ts`) | `design/worlds/` |
| The planet ring; the station, the satellite and a relay as models, for a recipe in `design/worlds.ts` that asks for one, or a body of that kind with no rows | `design/models/docks.ts` |
| Where a visitor starts, and what they see first | `tuning.ship.spawn` |
| The rocket and its flame: shapes (rings, fins, window) and which token paints what | `design/models/rocket.ts`, `design/models/flame.ts` |
| Which model a name stands for (generated code now, a `.glb` later) | `design/assets.ts` |
| How the ship leans (never more than `bankRad`, however hard the autopilot turns it, eased at `bankOmega`), nods and bobs, and how the flame follows the throttle | `tuning.ship` (the lean: `sim/bank.ts`) |
| The chase camera: where it sits, how far it looks ahead (and never further than `lookAheadMax`: at the autopilot's speeds the view would lie flat along the plane), how loosely it follows, how fast it may swing round (`maxYawRate`: the autopilot turns at 7 rad/s, and the view follows at no more than about 195 degrees a second; under reduced motion no faster than the pilot turns, `flight.yawRateSlow`), how the lens widens with speed and how quickly it gets there (`fovOmega`: the autopilot changes speed in a tenth of a second), tall screens, and how it fits into the strip between a phone's solid bar and its sheet (`fitDegrees`, `maxFitWiden`: the home page's welcome text keeps the home planet and the ship both in view) | `tuning.chaseCam` |
| The orbit camera of a docked ship: lens, how far above, how far round from the light, how much air round the docking ring, how fast the view wanders | `tuning.orbitCam` |
| Changing between cameras and making room for the panel: seconds from chase view to orbit view, how quickly the view slides over | `tuning.cameraRig` |
| How the ship flies (not a look, but it decides how every look is seen) | `tuning.flight` |
| Orbit assist: how fast and how far out a ship that lets go is eased onto a ring, how early a ship flying at a planet is swung round it | `tuning.assist` |
| Bumping into things: how deep and how firm the cushion above a surface is, how much bounce is left | `tuning.cushion` |
| Docking: how close to the ring the ship is taken over, the pace an approach flies onto it (`approachSpeed`, never more than `approachMaxRate` round a small moon), how fast it then goes round, how quickly a capture settles (`settleOmega`, which also brings a journey's end onto the ring), how hard one must steer to leave | `tuning.dock` |
| The autopilot (a click on a planet or a nav link flies the ship there): how fast it cruises between systems (`far`) and inside one (`near`), how hard it speeds up and brakes, which journeys count as short (`shortLeg`) and long (`longLeg`), how slowly it passes close to a body (`keepOutSpeed`), how quickly that opens up with room (`openSpaceGain`) and how much of its speed counts when it only goes past (`passShare`), how wide it swings round bodies (`keepOut`, `path.clearance`), how far ahead it looks, the hardest it brakes for its plan (`comfortDecel`: braking for what lies on its own course is the reflex's, `sim/reflex.ts`, and not held to it), the shortest a journey may be (`minJourneySec`: a hop still reads as a journey), and how quickly a journey handed back at speed drops to the pilot's own top speed (`dropOutPerSec`; Stop, or a tap of the brake, then brakes the rest, and after a turn or the throttle the reflex keeps braking for whatever lies ahead until the ship is slow: `guardInput` in `sim/docking.ts`) | `tuning.cruise` |
| Pointing at a planet: how small a target may be for a mouse and for a finger, how small a body can look and still be picked, what still counts as a tap | `tuning.picking` (the cursor over a planet: `#universe-host canvas[data-pick]` in `src/styles/global.css`) |
| The names over the bodies: type, colour, the family glyph before each name (`data-theme`; none on a system's own tag on a star map narrower than 480 px, where the 13 px are needed for the names themselves) and the navy one on the tag the ship is headed for (`data-state='target'`), how systems, planets and moons differ (`data-kind`), how they fade in and out (`data-shown`) | `.body-label` in `src/styles/global.css` |
| The star map (`M`, the Map button, or scroll out): the lens, how long the way out takes, how far in it zooms (`spanMin`: far enough on a phone to part close neighbours' names) and whether it may zoom out past the view of everything (`zoomOutPastFit`, 1: not at all), how much air the first fit leaves (`fitMargin`, plus `fitPadPx` for the names at the edge), how quickly pans and zooms settle, wheel and key speeds, how far a wheel must turn to open it. (A finger that moves on a name drags the map: the slop is `tuning.picking.tapMaxPx`.) | `tuning.map` |
| The LOOK of the map: how flat the shading goes (`flatness`), how far the stars dim (`starOpacity`), the smallest size of each kind of body in px (`minRadiusPx`: sun 9, home 8, planet 6, moon 3.5, station and satellite 4, a relay 3.5; the size of ALL that is drawn of it, an emblem world's rays, rings and signs with its ball, so every sun is the same 9 px disc and its ball smaller in proportion: 5.3 px under Software's rays, 8.7 for Hardware; the same disc its name keeps off and the pointer finds), how much room a moon needs beside its planet before it is drawn (`clearPx`), the size of the ship's marker (`shipRadiusPx`) | `tuning.map` (what flat MEANS: `uFlatness` in `shaders/toonFlat.ts`) |
| The Map button: top right under the bar, `data-state='open'` while the map is up, the key cap hidden for fingers and beside a phone's sheet; and the cursor over the map (`canvas[data-map]`, `[data-dragging]`) | `.map-toggle` in `src/styles/global.css` |
| Where a name sits under its body, how far names keep from each other, from the edges and from the top bar, how many may show at once. On the map the ship's marker is "you are here" and no name's tag lies on it: a name the ship would be under glides a few pixels past it or goes above its body, as does one with no room below (`ui/Labels.ts`, `ship`); on the map a name also has places beside its body and slid along it, and the systems' names are placed together (`onMap`, `sim/declutter.ts`); there a name that has just appeared, hidden or moved holds still a while (`dwellSec`); names also keep off the footer chip in the corner (`foot`, measured by `src/shell/panel-inset.ts`) | `tuning.labels` |
| Where the systems sit: how far from home and from each other (`homeRoom`, `slotRoom`) and which way the cluster grows (`clusterAxisDeg`). Not a look: **changing any of the three moves every system** (a test pins them, and `galaxy.lock.json` will), so ask Allen first. The build refuses rooms too small for the tripwires (`maxSystemRadius`, `minSystemGap`). | `tuning.layout` |
| The first-visit hint card ("W A S D or the arrow keys to fly..."): where it sits for a mouse and for a finger, the key caps. It never covers the ship or the home planet: bottom left beside the ship on a wide screen, under the bar on a tablet or a phone held sideways, below the ship on a phone held upright (where it steps aside once the boost pad or the prompt appears). Its band is `ink.low`: a hint is news, not a family, and not "here" | `.flight-hint` in `src/styles/global.css` (the words: `src/layouts/Base.astro`) |
| The dock prompt ("Orbit FishAI", "Flying to FishAI" with its "Stop", "Leave orbit"): a real button, bottom centre above the corner chip (on a phone held upright, above the boost pad; held sideways, down on the bottom edge, below the ship); on a phone with the sheet up, in the Map button's row, so the docked body has the strip between that row and the sheet (`frameTop`, `src/shell/panel-inset.ts`); its offers out of sight while the map is open there, where they would sit on the galaxy (`quiet` in `ui/Prompt.ts`); a journey's Stop always shows, since there it is the only way to stop. Where room is short (that row, the narrowest sideways phone) "Flying to" steps aside, heard but not seen (`.dock-prompt__lead`) | `.dock-prompt` in `src/styles/global.css` |
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
`http://localhost:4321/lab/` puts a single body's emblem world (by its id: far, up close, moving
or still, or its star map variant), a planet (any biome, any seed, with or without rings,
everyday or close-up detail), moon, sun, the rocket, the station, the satellite or a relay on a
turntable in front of the real sky. Drag to look around, wheel to zoom, move the light, and use the sliders
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

## Deep light _(a preview: branch `claude/deep-space`, not on `main`)_

On 2026-10-01 Allen asked for "higher fidelity art styles across the board, instead of just
plain, muted glows", "more hifi and in depth", keeping "the feeling of that simplicity but with a
lot more details", and pointed at space photographs (the Carina cliffs, the Pillars, Jupiter,
Earthrise, deep fields). The answer that was chosen is **flat worlds, deep light**: matter
(planets, ships, signs) stays flat-coloured and token-exact, and what is around matter (gas,
stars, coronas, air) becomes light with structure. (It began as "matter stays faceted"; on
2026-10-02 Allen asked for everything round and smooth but what should have edges, and the
facets went: "As built: round and smooth", below.) It is built in steps on a preview branch that Allen
flies before any of it reaches `main`.

**DRAFT, NOT SIGNED: what this would change in the principles above.** These are Allen's to
accept, change or refuse once he has flown the preview; until then the principles stand as
written, and nothing on `main` follows the drafts.

- Principle 2 would read: **Flat colour, round form; light may be soft.** A surface keeps its
  flat colours and its two or three bands of light and never gets a gradient, but colour and
  light follow the FORM, not the mesh: a ball is lit as a ball and a coast is a line, whatever
  the facets under them, and an edge shows only where the thing has one (a box, a cog's tooth).
  Light and air (gas, halos, coronas, shells, spikes) may be soft, and are still cut into a few
  flat steps. (Redrafted on 2026-10-02, after Allen saw step 2: "everything should roughly look
  round and smooth", "the planets too", "except for just the stuff that should have edges (like
  the hardware cogs)". It was "Matter is flat, light may be soft", with matter faceted.)
- Principle 3 would add: **and the sky, never brighter than luminance 0.19** (where the butter
  focus ring still reads 3:1 over it), with a strip along the horizon left near today's navy,
  because that is where planets and orbit lines sit.
- The lesson "the sky uses glows, not noise clouds" (below, under the 3D world) would become
  **noise only baked, limited and lit**: never at run time, never without a ceiling, never
  without a light it faces.

**Eight rules a change to the look is checked against.** (1) Matter is flat in colour and round
in form (an edge only where the thing has one); light may be smooth.
(2) Every colour is a token; shaders receive colours as uniforms. (3) Light is added, never
replaced: the sky is today's navy plus added light, and a strength of 0 skips the pass. (4) Depth
is layering: flats at different distances, never volumetric noise at run time. (5) One lens for
every bright point: spikes on the hero stars, a four-point sparkle on a sun's limb. (6) Only what
already glows may bloom: nothing new joins the bloom guest list, so nothing depends on bloom and
the low tier loses nothing but seasoning. (7) Calm where the work is: the horizon strip stays
dark, the sky is halved while docked, and the whole sky has a ceiling. (8) The star map stays
flat.

**As built so far: the groundwork (step 0). Nothing looks different yet.**

- **36 tokens**, all engine only: three more star temperatures (`color.star.hot`, `amber`,
  `ember`), the gas (`color.nebula.<family>.{deep,mid,lit,rim}` for the five families and `band`
  for the Milky Way), the air of worlds (`color.air.<biome>`, every biome with a sea),
  `color.shading.dusk` and `night`, and `color.window`. `deep` and `mid` are the body of the gas
  and sit barely above space (under 1.4:1 and about 2:1); `lit` is where gas faces its light;
  `rim` is for hairlines and hot cores, never an area. They are **left out of the CSS mirror**
  (`ENGINE_ONLY` in `src/site/tokens-css.ts`): no stylesheet reads them, and plain pages do not
  carry them.
- **What the palette promises** (`src/site/look-colours.test.ts`): every `deep` under 1.4:1 on
  `space.900` and every `rim` at 6:1 or more; the families of gas told apart by their `lit` (the
  closest pair 7.1 CIEDE2000, sky and lilac under deuteranopia) and their `rim` (8.5), under
  normal vision and each simulated deficiency (`src/site/colour-vision.ts`); `deep` and `mid`
  carry shape, not identity, and are nearly one colour under deuteranopia on purpose; no star
  tint within 10 of butter ("here") or of coral.
- **The numbers** are `tuning.look` (the sky, the suns, air, traffic, the map's chart, lamps) and
  the star classes in `tuning.starfield`, with the shapes of their tables in
  `design/lookTypes.ts`. **Nothing reads `tuning.look` yet** but the stars, which take the
  Milky Way's great circle from it: each block is switched on by the step that builds its
  system. `tests/look.test.ts` keeps the tables honest meanwhile (a pool of gas sits at the
  bearing of its system from home, in its system's family; butter has no pool; air only on
  bodies that exist).
- **The seven views** the sky is judged from are `SKY_POSES` (`sim/skyDirections.ts`), and the
  lab's `sky` subject looks out from each of them.

**As built: the stars (step 1).** The first thing that looks different, over the old backdrop.

- **Five classes, six temperatures.** 5,249 stars with a mouse on the medium and high tiers
  (4,200 dust, 700 field, 110 bright, 26 mid, 205 in three clusters, 8 heroes); half of each but
  the heroes on a phone, half again on the low tier, which also has no mid class. The ordinary
  star is far fainter than the old points were (a dust star peaks at 0.10 to 0.34 of its tint,
  where every old point was 0.45 to 1) and a few are much brighter: the sky gets a range. Half
  the dust lies along the Milky Way (a Gaussian round the great circle the baked sky will
  share), so the band is there before its haze is. Tints by weight: white 30, cool 20, hot 17,
  warm 15, amber 12, ember 6 percent. No star wears a family colour.
- **How a star is drawn.** A Gaussian core; the bright, mid and hero classes add a wider, fainter
  halo (a hero two); a mid star has a small plus; a **hero has six diffraction spikes** (three
  lines 60 degrees apart, one upright) and a short faint line across. Along a spike the light
  falls as `(1 - t)^2.4 / (1 + 5t)`: a fast fall and a long thin tail, which is what reads as
  diffraction and not as a plus sign. This is the "one lens" of rule 5: a sun's glint is the
  same artefact, with arms so short that they fade evenly. Sizes are CSS px written for a view 1080 px high and scale with the view's
  height (0.6 to 1.2), so a hero's arm is 78 px there, 58 px at 800, and never dominates a phone.
- **Calm.** A fifth of the dust, field and bright stars twinkle as before; a hero breathes by 6
  percent over 5 to 9 seconds, each at its own pace. Under reduced motion neither happens. On
  the star map the stars dim to `map.starOpacity` as before and **lose their spikes** (rule 8).
- **Not on the bloom guest list** (rule 6): a star's glow is its own halo, drawn, so the low tier
  shows the same stars. Light is added in linear light; where the picture goes straight to the
  canvas (the low tier) the shader corrects for the canvas blending after encoding, or every
  star there would be fatter.
- **Still to judge in the lab** (the `stars` subject: a sheet of each class at 1:1, one tint or
  the mix, the heroes as a view of another height draws them, and the stars as the map shows
  them): whether two heroes should come down toward the horizon. Two of the eight are in the
  first frame at home; two (at azimuth 8 and 112) are above every view the chase camera takes.
  The star drift stays until the baked sky arrives (a painted sky cannot be drifted against),
  so until then the heroes wander slowly off the places the table gives.

**As built: round and smooth (steps 2b and 2c, 2026-10-02).** Allen saw step 2's Software sun,
a ball whose tones fell in sharp triangular facets, and said: "I want some more rounded texture
instead of sharp triangles. everything should roughly look round and smooth", and then "i meant
the planets too, make everything round and smooth, except for just the stuff that should have
edges (like the hardware cogs)". So the faceted look is gone from everything that is round, and
kept, crisp, on everything that has edges. This replaces the "matter stays faceted" of the look
as it was first drawn. The rule, as built:

- **What a thing is made with says whether it is round**, once, in the kit
  (`sim/world/kit.ts`), never body by body and never by guessing from angles:
  - **Round:** anything turned on a lathe with five sides or more (a tube, a cone, a dome, a
    wheel, a mast, a cup, a rocket's body and nose, the ship), a bead (a ball; it was an
    octahedron), the walls of a ring or an arc swept in two steps or more, and a tile of five
    sides or more (a disc). And every generated ground: a globe, the fish, the rounded cube of
    Days2Meet, the bus, the clay of planned work.
  - **Edged:** a box, a prism (a card, a phone, an arrow, a bracket, a glyph plate), a fin, a
    quad, a trapezoid (a cog's tooth, a clock's tick), pixel art and the pixel digits, a ring
    of one step (a stand of the stadium, a dash), and a lathe of three or four sides (a house's
    roof, a square post). The Hardware sun's gears are all of this kind: plates, teeth and
    walls stay sharp. (Their hubs, axles and paint rings are circles now: a gear's teeth have
    edges, its hub is turned.)
  - A round thing keeps the edges it really has: a tube's cap meets its side at an edge, a
    seam is a seam. Along a lathe's profile a turn of under **50 degrees** (`CREASE_DEG`) is a
    bend and a sharper one a fold; a profile that ends on its axis within 35 degrees of square
    (`POLE_DEG`) closes smoothly (a dome's top), a steeper one is a tip.
  - **A bend is built as a curve.** Where a lathe's profile only bends, light already falls on
    it as on one surface; its outline now agrees. The corner becomes an arc (`bent`,
    `sim/world/kit.ts`): from half of the shorter band before it to as far after it, always
    inside the corner the rows wrote (so no reach grows), in the pieces a circle of its radius
    would get. A corner already within half the allowed sag of its arc is left alone: the
    Devpost cup's bowl and Corgi's clay are curves every day, Model Rocketry's nose in the
    close-up.
- **Round in light.** A round thing's triangles carry the normals of the true surface, the
  shader carries the normal across each face and decides the three bands **at every pixel**
  (`design/shaders/toonFlat.ts`), a pixel soft: anti-aliased, never blurred. So a terminator is
  a clean curve on a ball, a straight line down a tube, and one flat band on a box's face. A
  lit place is still exactly its token. An edged thing is lit face by face, as it always was.
- **Round in outline.** The rows still sketch a wheel with eight sides. It is BUILT with as
  many as its size wants: the middle of a side may stand no further inside the true circle
  than `tuning.world.round` says, in radii of the body (0.006 every day, a third of a pixel on
  a body 55 px in radius; 0.0025 in the close-up, half a pixel at 200 px; twice that on the low
  tier; never more than 64 sides, never fewer than written). A wheel a third of its world
  across has 16 sides every day and 24 up close, a mast 7 and 10, a bead is a ball of 10 to
  15. A polygon of under five sides is never touched. A ring keeps its colours where they were
  painted (each step becomes a whole number of steps), and a wavy ring is built three times as
  fine. The ship is 24 sides with a nose of eight bands, and its window lies on the curve of
  its hull.
- **Round grounds.** A moon is 1280 facets (`world.detailMoon` 7; it was 320), and so is a
  planned moon; a planned planet is 1620 (`detailMaquettePlanet` 8, `detailMaquetteMoon` 7;
  they were 980 and 320, balls of straight sides against the sky). The terrains' relief is
  about a third of what it was (`terrain.continents` 0.018, `calm` 0.012, `isles` 0.014 of a
  radius): light no longer shows relief (it falls on the ball), so all the old relief did was
  put flat-topped lumps on the limb. **Clay keeps its lumps, as round ones**
  (`terrain.lumpy`: relief 0.045, it was 0.07; two octaves, it was three): planned work still
  looks unfinished, in soft blotches and a gently uneven outline, not in corners.
- **Colour is flat, and its outlines are lines.** A face is one colour edge to edge, as before.
  But a facet of a ground that a coast, a band of height or an edge of paint runs through
  carries **up to three colours and the lines between them** (`aSide`, `aOver`), found by
  walking its outline (`sim/planet.ts`), and the shader draws each line through the facet, a
  pixel soft. **A line is an arc, not a chord** (`aBend`): the generator looks across the
  line's middle for where the outline really is (the ground's own height, asked again halfway
  along each edge of the facet; or the paint) and the shader bends the line through that place.
  So a coast is a curve inside each facet too, an island is a blob and not a polygon, a cape
  that comes into a facet and leaves by the same edge is drawn, and a painted cap is a circle
  to a thirtieth of a degree. Where one facet holds more than two lines (four bands of height
  in seven degrees, or a coast, its shore and a cape) the sliver beyond the second takes its
  neighbour's colour: a small step in an outline, about one shared edge in forty on the
  islands of HackGT 13, one in two hundred on home.
- **No nudge.** `planet.colorJitter` is 0 (it was 0.03): the nudge made every flat area a mosaic
  of triangles, which is exactly what was asked away.
- **A terrain no finer than its facets.** An arc holds one bend a facet, so noise finer than
  a facet (4 to 7 degrees) cannot be drawn round: `terrain.isles` and `lumpy` are two octaves,
  not three. A terrain's finest octave (`frequency` times two for each further octave) should
  stay under about 5.
- **What it cost.** Triangles: the galaxy is about 40,400 every day (it was 32,500), the most
  in one body 2746 every day and 6176 up close; the budget's ceilings rose once, on purpose,
  to 2800 and 6600 (`tests/world-bodies.test.ts`). No draw call was added: round and edged
  parts ride in one buffer and one material. A frame costs what it did (0.2 ms on the desktop
  it was measured on, on every tier). Nothing reaches further: the reaches of
  `design/worlds/reach.ts` stand (three beads were trimmed by a hair for it, since a ball
  reaches its whole radius every way and an octahedron did not).
- **A blueprint follows.** A ghost's lines are the folds of its mesh, judged by the same
  normals: a round ghost shows its rims and not a line down every side.
- **Writing a part, from now on:** pick the op for what the thing IS. If it is round, use a
  lathe op with any sketch of sides from five up and let the build round it; if it should be
  a hexagon nut or a pyramid, make it of a prism or of four sides. Do not fit a decal or a
  part to a FACET of a round thing: there are none to count on (the roll number of Model
  Rocketry sits on the tube's true radius).
- **Still Allen's to judge:** whether the relief should go altogether; whether the three tones
  should stay hard-edged on a tube and a cone (a terminator is a straight line there, which
  can read as a side of a prism); and a third line a facet (one more attribute), which would take the last steps out
  of the outlines of small islands and was left out for the weight (the lazy budget).

**As built: the suns (steps 2 and 2b).** A sun is a place now, not a lit ball.

- **A living surface** on the three suns that are balls (Software, Research, Hackathons), and a
  sun is light, so all of it is round: the surface is DRAWN, pixel by pixel, by the sun's own
  shader (`toonFlat.ts`, SUN). **Four flat tones** of its family (shade, base, light, and
  `hot`, the light mixed 55 percent toward white) lie in **round cells** a fifth to a third of
  the ball across, cut from two layers of smooth noise by three thresholds so that about
  15 / 45 / 30 / 10 percent of the ball is each: **the middle of the ball is the base**, or the
  sun washes out to cream. An edge between two tones is soft by a hair (`granulation.soft`) and
  never thinner than a pixel. Toward the **limb** the tones step one down the ladder, then two:
  limb darkening in two round bands. **Three spots** sit at fixed places on the ball, a dark
  core in a ring, round and soft-rimmed. Still no gradient across a tone. Nothing on the
  surface moves. (Step 2 gave each FACET a tone; that was the ball of triangles.)
- **The noise** is the sky's (gradient noise on an integer lattice, `shaders/noise.ts`), which
  gives the same picture on every driver; its twin on the CPU (`sim/sunGrain.ts`, which
  nothing shipped imports) is what `sunGrain.test.ts` holds to the shares. Each sun is cut from
  its own place in the noise: its number rides in the flag its ball's facets carry, so two
  suns of one family would still differ. Cost: two noise look-ups a pixel of the ball.
- **The ball is 2000 facets** (`world.detailSun` 9; 1280 on the low tier). They no longer show:
  the outline's corners are a third of a pixel deep when docked beside it.
- **The corona** is one draw call for all suns, in two layers. The **light**, behind everything
  a sun wears, so that its brackets, its stopwatch and its light curve stay crisp: **four halo
  steps** of the family's base (flat rings, 0.40, 0.20, 0.09 and 0.04, out to 2.1 radii), a
  **soft glow** through the family's three tones out to 3.4, **ten rays** (thin beams, each
  its own length, width and lean; a beam is light, so since step 2b it has no edge: brightest
  along its middle, gone at the width its wedge had, and so with no corner at its tip) and
  **three prominences** (loops off the limb). The **lens**,
  in front of the ball: a hot hairline just inside the outline, and a **four-point glint** on
  the upper left, fixed on the screen. The parts are laid over each other as paint is, over the
  navy of the sky, and the shader corrects for how each tier blends, so the low tier shows the
  same corona.
- **The Hardware sun keeps its gears.** Its ball is its fourteen gears, so it gets the halo
  steps and the glow and nothing else: no tones, no rays, no loops, no hairline, no glint.
- **Only the ball blooms** (rule 6), as it always has. The corona is drawn light, never on the
  guest list: the halo that bloom used to fake is now there on the low tier too.
- **Calm.** A ray breathes by 12 percent of its length over 9 to 14 seconds, a loop by 10
  percent over 11 to 17, each at its own pace; nothing else moves, the glint least of all.
  Under reduced motion they hold the frame of time zero. The low tier keeps six of the rays and
  has no loops and no glint. On **the star map** a sun is a flat disc of exactly its token
  (every tone, the limb and the spots go back to the base) inside its halo steps, and nothing
  else of the corona is drawn (rule 8).
- **Still to judge in the lab** (the `sun` subject: a living sun of any family, and `as on the
  star map`; the `world` subject for a real sun with its signs): mint is the palest family, and
  with bloom on top its hottest tone is nearly white (`look.sun.hotMix` is the knob); whether
  the rays and the loops stay is decision D8.

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
