# Architecture

How allenkh.com is put together, and why. Read this once before changing the engine; after that
[AGENTS.md](../AGENTS.md) is the working reference (rules, commands, copy-paste recipes),
[DESIGN.md](DESIGN.md) says which knob changes which look, and [PLAN.md](PLAN.md) holds the
reasoning behind the decisions and the roadmap.

## 1. One URL, two ways to see it

Every route is a real, pre-rendered HTML page with the full content in it. That page can be shown
two ways:

- **Plain mode** is the page as it is. The base CSS _is_ the plain layout, so a browser with no
  JavaScript at all gets a complete, fast site. Plain mode never downloads three.js.
- **Universe mode** boots a 3D world behind the page. The page's `<main>` becomes the info panel.

The content is written once, the URL is the same, and search engines, link previews, screen
readers and recruiters in a hurry all get the plain truth. `scripts/verify-dist.mjs` fails the
build if three.js ever becomes reachable without a dynamic `import()`, or if a page outgrows its
weight budget (30 KiB for a plain page, 220 KiB for everything lazy, gzip, the close-up chunk
included, which has its own 4.5 KiB as well).

```
mode.inline.js        the only inline script; sets html[data-mode] before first paint
  -> boot.ts          tiny, loaded by every page; acts only in universe mode
     -> universe-shell.ts   router, panel, watchdog, quality memory      (dynamic import)
        -> universe/api.ts  the engine, and the only door into it         (dynamic import)
           -> design/worlds/closeup.ts  the emblem worlds' close-up rows and motions,
                              when a world is first seen up close, or at idle   (dynamic import)
```

Mode is chosen in this order: a plain-only page (the 404) → no WebGL2 → `?plain` (sticky for the
session) → `?universe` → a saved choice → `prefers-reduced-motion` (plain, with an invitation) →
universe. If the engine throws, or shows no first frame within 8 s of frame time, the shell flips
the attributes back to plain. Nothing reloads: the content was in the DOM all along.

## 2. From Markdown to pixels

```
src/content/**  (Markdown + resume.yaml)
   |  Astro content collections, schemas from src/site/schemas.ts (plain Zod)
   v
src/pages/*.astro --------------------------> dist/**/index.html      the content, for both modes
   |
   |  src/universe/data/build.ts    buildUniverse(): checks references, moons, lanes   (pure)
   |  src/universe/data/layout.ts   where every system and orbit goes                  (pure)
   v
src/pages/universe.json.ts -----------------> dist/universe.json      the galaxy, no prose
```

`/universe.json` is fetched only in universe mode. The engine reads it through
`src/universe/manifest.ts` and never imports anything from Astro. Layout is seeded per entity id,
so adding a project never moves an existing planet. Systems sit on a honeycomb of slots round home
(`slotPosition`): where slot k is follows from its `order` and three keys alone
(`tuning.layout.homeRoom`, `slotRoom`, `clusterAxisDeg`), never from the size of a body or a
ring, so a new system moves no other, and nothing but those keys can move one (a test pins orders
1 to 8 until `galaxy.lock.json` does). The build refuses rooms that no longer fit the tripwires
(a system no wider than `maxSystemRadius`, and `minSystemGap` between two).

The site's pictures are built the same way, from the design tokens: `/favicon.svg`,
`/apple-touch-icon.png` and `/og/default.png` are endpoints in `src/pages/` that render pure
drawings from `src/site/favicon.ts` and `src/site/og.ts` (rasterised with `sharp`), so a palette
change repaints them. Nothing in `public/` carries a colour of its own.

Astro is used thinly on purpose (PLAN §5.1): it pre-renders pages and owns the content layer, and
that is all. No islands, no `<ClientRouter/>`, no scoped styles, no per-page scripts. The client
code in `src/shell/` and the whole of `src/universe/` would survive a change of framework.

## 3. The layers of the engine

`src/universe/` is framework-free TypeScript on three.js r186. Imports point downwards only:

```
web layer (src/shell)  --->  api.ts                     the only door; owns the engine's LIFE
                              main.ts                    the composition root: what exists, in what order
                              lab/                       dev only: one asset on a turntable
        state/  ui/                                      where the visitor is headed; what can be pressed out there
        camera/  ship/  world/  fx/                      views: they draw what the simulation says
        core/                                            the loop, the canvas, input, jobs, quality, debug
        sim/   data/                                     pure maths. No three.js, no DOM, no clock, no Math.random
        design/                                          tokens, tuning, materials, shaders, models, asset manifest
```

- **`sim/` and `data/` are pure.** They run headless in Vitest, which is where the flight model,
  the orbit assist, collisions, orbits, the planet generator and the galaxy layout are tested.
  ESLint bans three.js, the DOM, `Date.now` and `Math.random` there (`sim/rng.ts` is the seeded
  generator).
- **Views never decide anything.** `world/`, `ship/` and `camera/` step the simulation and copy
  results into three.js objects. If a rule matters (can the ship pass through a planet?), it
  lives in `sim/` with a test beside it.
- **Logic owns shapes, design owns values.** A system declares its parameters as an interface
  (`FlightParams`, `AssistParams`, `PostParams`); `design/tuning.ts` fills them in and ends each
  block with `satisfies <Params>`. A design edit that breaks a contract is a type error.
- **The engine never touches `history`** and knows nothing about pages. It emits events; the
  router in `src/shell/router.ts` is the only code that writes history.

These boundaries are lint rules (`eslint.config.js`), and `tests/lint-boundaries.test.ts` proves
that each of them still bites.

## 4. Life of a frame

`core/Engine.ts` owns the canvas, the renderer and the loop. It knows nothing about what is drawn:
everything else is a **system** (`fixedUpdate?`, `frameUpdate?`, `resize?`, `dispose`) added in
`main.ts`, where the order is explicit and is the order of the calls.

Each display frame:

1. **How long was the last frame?** A tier with a frame cap (LOW on phones: 30 fps) sits out
   frames that arrive too soon.
2. **`FixedClock.advance`** (`core/loop.ts`) turns that duration into whole simulation steps of
   exactly 1/60 s plus a remainder. A frame counts for at most 0.1 s and runs at most 5 steps: a
   machine that cannot keep up sees the world run slow instead of spiralling.
3. **SIMULATE.** For each step, every system's `fixedUpdate(dt, simTime)` runs. `simTime` is the
   time the state will have _after_ the step. The ship's step is one pure function, `flyStep`
   (`sim/surroundings.ts`): place the bodies at `simTime` → orbit assist mixes a virtual pilot
   into the real pilot's input → cushions and the edge of the world push → `stepFlight` integrates
   → hard shells put back whatever got through. On a journey (below) the virtual pilot is the
   autopilot and the drive is the autopilot's; everything after that is the same step.
4. **DRAW.** Every system's `frameUpdate(frame)` runs once. `frame.alpha` says how far this frame
   sits between the previous simulation state (0) and the current one (1), and views interpolate:
   that is why flight looks equally smooth at 30, 60 and 144 Hz and why a recorded run replays to
   the same end state. Bodies are placed at the exact time of the frame,
   `frame.simTime - (1 - frame.alpha) / stepHz`.
   The job queue (`core/jobs.ts`) is one of these systems, deliberately near the end: it spends a
   share of the frame on work that was cut into slices, such as generating a planet's mesh. Work
   arrives a little later; frames arrive on time.
5. **Render.** Straight to the canvas on LOW; through `fx/PostFX.ts` on MEDIUM and HIGH (scene →
   multisampled target → bloom of the things that asked for it → composite with vignette and
   dither).
6. **The governor** (`core/quality/governor.ts`) is told how long the frame took and may lower the
   render resolution, give some back, or (once, early) ask for a lower tier.

Order in `main.ts` today: assets → input → ship → navigator → the boost pad (out in free flight
only) → star map → galaxy → ship lighting → camera director → camera rig → bodies on screen →
picker → labels → sky → stars → dust → the map's look → the sky's bake → jobs → prompt → debug
overlays. The
camera comes after everything it looks at (the ship AND the planets), so that it sees this
frame's world; whoever needs to know where things are ON SCREEN comes after the camera. The
star map comes BEFORE the galaxy, which draws every body at the size the map asks for.

**The camera** (`camera/`) is one rig and several modes. A mode (`ChaseCam`, `OrbitCam`,
`MapCam`; cinematic later) only fills in a `Pose`: what to look at, from how far, turned which
way, through which lens. `CameraRig` applies the pose of the mode in charge and BLENDS between
modes in that form, live: both modes keep following their subjects while a blend runs, turning
back halfway runs the same blend the other way, and a mode that comes back after a while away is
told so (`enter()`), so a chase camera starts from behind the ship instead of swooping in from
where it last saw it. A few lines in `main.ts` direct it: the map view while the map is open,
else the orbit view while docked, else the chase view; a ship that was PUT at a body (a deep
link, a rebuild) is cut to, one that flew there is eased to, and under reduced motion everything
is a cut.

The mix itself (`mixPose`) is made for the long way out to the map. **Distance mixes by ratio:**
from 20 u behind the ship to 6,000 u above the galaxy, halfway is 350 u, so pulling out is one
steady zoom and not a leap followed by a crawl. **What is looked at moves over in step with the
distance actually covered,** so the ship stays in the picture all the way out. **The turn mixes as
a tripod turns,** so much round and so much down: every view here is level, halfway between two
level views must be level too, and the shortest turn between them (a slerp) is not. So the camera
never rolls, in any blend. Two views that face nearly opposite ways can be turned into each other
either way round; a blend makes up its mind once (`Turn`) and stays with it, or a ship that turns
during the blend could flip the picture over in one frame. **The depth range follows the camera
out** (`tuning.cameraRig.nearShare`, `farShare`): the range that suits a chase camera would leave
the depth buffer a few units coarse from map height.

**The panel and the view.** The info panel covers part of the viewport. The shell measures how
much (`shell/panel-inset.ts`), tells the engine (`setPanelInset`) and mirrors it to the stylesheet
(`--panel-inset-top`, `--panel-inset-right`, `--panel-inset-bottom` on `<html>`). The rig slides
the WINDOW onto the view with `camera.setViewOffset` so that the middle of the view is the middle
of what is left: same camera, same perspective, so a planet stays round (turning the camera
instead would stretch it into an egg near the edge of a wide lens). Modes that frame something are
told how much is free and stand back accordingly. `#universe-overlay` is inset the same way, so
the dock prompt is never under a bottom sheet. Which layout is which is one media query, written
twice (the stylesheet's sheet block, and `NARROW` in `panel-inset.ts`): narrow AND more than 30rem
tall is a phone held upright and gets the bottom sheet; a phone held sideways has no height to
share and keeps the side panel. The inset has a fourth number, `frameTop`: on that upright phone
with the sheet up, the top bar is solid, so the shell reports the band down to the bottom of the
Map button's row, and a camera mode that frames something (`CameraMode.avoidsTop`: the orbit
camera, and the chase camera) leaves that band out as well, so the docked body sits in the strip
between the row and the sheet. The chase camera also widens its lens there, as far as
`tuning.chaseCam.fitDegrees` and `maxFitWiden` allow, to fit the ship and what is ahead into the
strip. The map ignores the band. (Why, and the measurements: "As built, A1" in PLAN.md §6.)

## 5. Life of a visit

`api.ts` owns the engine's life, because an engine can die and be replaced while the page lives on.

- **Boot.** `createUniverse()` picks a quality tier (desktops HIGH, phones MEDIUM, small machines
  one lower, never above a tier remembered from an earlier demotion; `?q=` forces one) and calls
  `boot()` in `main.ts`. `ready` fires with the first frame, `firstinput` with the first touch of
  a flight control (thrust, a turn or the brake: a lone Shift is none, since it is also half of
  Shift+Tab; `touchesControls` in `core/input/intents.ts`).
- **Demotion.** After a warm-up, two seconds of frames decide whether the tier is too heavy.
  Whether a canvas is anti-aliased is fixed when its WebGL context is created, so a new tier means
  a new engine: snapshot → dispose (canvas and all) → boot one tier down. The shell remembers the
  result for a week (`shell/quality-memory.ts`). Nothing ever promotes during a visit.
- **Context loss.** A phone that backgrounds the tab may take the WebGL context away. Same path:
  snapshot → dispose → boot from the snapshot once the tab is visible. More than three times in a
  minute means the GPU is not going to get better: `fatal`, and the shell goes plain.
- **Docking.** Within reach of a body the prompt (`ui/Prompt.ts`, a real button in
  `#universe-overlay`) offers to orbit it. `state/Navigator.ts` is the one owner of where the
  visitor is headed: it asks the simulation (`sim/docking.ts`) for an approach, in which the
  orbit assist's virtual pilot flies the ship onto the ring by itself, and once there the ship is
  no longer flown but CARRIED round the body, so nothing drifts however long someone reads.
  The leftovers of a capture settle on springs that start with the ship's own velocities, so
  there is no jolt, and an approach is taken only once it goes round no faster than 2.5 times its
  own pace (`CAPTURE_PACE`): a ship skimming the ring faster flies on and brakes first. An
  approach gives way to every other body inside its ring (`GIVE_WAY` in `sim/assist.ts`): a moon
  between the ship and its planet is gone round, not skimmed. Fresh steering always leaves. The navigator keeps the app state machine
  (`state/appMachine.ts`) in step and reports `statechange`, `soi`, `docked`, `undocked`.
- **Journeys** (`sim/autopilot.ts`). A destination out of reach is FLOWN to: `goTo(id)` becomes
  `navigator.travel(id)`, and the dock's phase is `cruise` until the ship arrives beside the
  ring, travelling along it, when it is taken into orbit right there (`arrive`: the springs of
  the dock bring it onto the ring). A body that is within reach already is approached instead,
  held for as long as the shortest journey (`cruise.minJourneySec`), which no journey undercuts:
  a hop still reads as a journey. The hold is `DockState.holdSec`, and what is left of it is a
  snapshot field, so a rebuilt engine does not start it over. So a journey is one more phase of
  the same dock: the same events, the same snapshot fields, and the same rule that fresh steering
  (or the brake) takes the ship back with exactly the velocity it has; what the pilot's own drive
  could never make then drains away at `cruise.dropOutPerSec` (`dropOutOfWarp` in `flyStep`), so
  a ship let go of at 700 u/s is back to its own top speed within some 160 u. **Stop** (the
  prompt's button, `navigator.stop`) lets go the same way and then holds the brake for the pilot
  until the ship is at rest, in space or beside the body nearest to it, whose cushion may be
  carrying it along (`haltDock`, `haltingInput` in `sim/docking.ts`): stopped anywhere, in a
  bend or a step before it arrives, it comes to rest within 155 u and meets nothing. A tap
  of the brake mid-journey is a Stop too (`pilotLeaves`). A turn or the throttle is the pilot
  flying again, but the pilot's own top speed (81 u/s) is still more than a cushion stops, and a
  journey ends among its target's moons: so the reflex (below) stays on for them, with the
  pilot's own brake, until there is nothing left to guard: the ship is slow enough for the
  cushions (25 u/s), or they open the throttle afresh at a speed their own drive gives (with
  boost, if they boost), and either way the ship would
  coast to rest short of everything on its course (`guardInput`, `DockState.guarding`: a second
  tap of W while the speed is still the autopilot's is not that, nor is 25 u/s straight at a
  world a few units off, which the cushion stops only half way down); steering out of a Stop while
  still fast does the same. The web layer letting go of a journey (`undock`: the route moved to a
  page with no body) is a Stop too (`Navigator.release` on the way somewhere), and so is a page
  load that does not take the journey up (`startingFrom`, below). An orbit a journey has only
  just arrived in, still carried round faster than the cushions stop, counts as the journey
  (`onJourney`): let go of, it is a Stop, and steered off, it is guarded. Nowhere near anything,
  that is the pilot's input exactly. `halting` and `guarding` are snapshot fields, and
  `undocked` says whether the ship now brakes to rest (`halting`). It is three pure pieces, the same structure as a robot's autonomous routine:
  1. **Path** (`sim/path.ts`). Every body on the way is a keep-out disc, placed where the body
     WILL BE when the ship passes it. A visibility graph over ring corners round each disc, A*
     over that, then a centripetal Catmull-Rom curve through the corners, sampled every 4 u. A
     ship on its way keeps to the next half second of its last plan (`keepStretch`: a new plan
     that began straight ahead would straighten every bend the ship is halfway round); one that
     is not on a plan yet gets a short run-up the way it is going. Bodies that crowd each other
     give way in proportion so that no gap is ever planned shut, and only the first and last leg
     may cut a keep-out the ship starts or ends inside. Planning again twice a second costs
     nothing in steadiness: the planner remembers which side of each body it went (`walls`) and
     changes its mind only for a much shorter way.
  2. **Profile** (`sim/profile.ts`). A speed for every sample: a forward pass (what the drive can
     reach) and a backward pass (what the brake can still shed, knowing the brake is a drag),
     under a ceiling that is low where the path closes on a keep-out and opens up with room
     (`passingLimit`: going PAST one, only the speed toward it counts; going away, none does),
     counting on the drive turning faster when it is slow (`bendSpeed`).
  3. **Pursuit** (`cruiseInput`). The virtual pilot steers at a point half a second ahead on the path,
     never at one it can only see ACROSS a keep-out, holds the throttle until the nose points
     the way the path runs, and flies the ordinary flight model with `tuning.cruise.flight`. It
     brakes for the plan no harder than `cruise.comfortDecel` (a replan that finds a bend close
     ahead used to brake for it in one step, a jolt of 2,200 u/s²).
  A plan for a moving ship starts from what the ship does ALONG it (`alongPath`: a new
  destination behind the ship starts the profile at rest, not at the ship's full speed), and a
  ship faster than its plan brakes to be down to it where the plan will be. Under all three sits
  **the reflex** (`sim/reflex.ts`): whatever the plan says, the ship may go no faster on its own
  COURSE (the way it is going, and the way its nose points) than `openSpaceGain` times the way
  left before it would pass 3 u above a body it is not going to. On a plan being flown it asks
  for nothing; it is what brakes a ship that is off its plan (a new destination chosen at speed,
  a bend taken wide), as hard as the brake goes, whichever way the nose points (a ship sliding
  backward at a body brakes too). The approach, which has no plan, uses it too,
  with a berth that widens with speed (`REFLEX_LEAD_SEC`): a body within reach asked for while
  the autopilot races past it is approached from cruise speed, braking off what it does not want
  at up to 1,000 u/s² (`FAR_DECEL` in `sim/assist.ts`). The approach also counts the body it is
  for, with the plain 3 u berth and the full brake past it (`ownLimits`): its ring is 6 u or more
  above the surface, so the way onto the ring is never braked, and a ship already diving at the
  body is. `npm run journeys` with `"stress": true`
  (`scripts/journeys/stress.ts`) is what checks all of it: redirects every 0.1 s, Stop every
  0.25 s and just before arrival, a body within reach at speed, Stop then E, a tap of the brake,
  an arrow or the throttle instead of Stop, a double tap (the throttle twice, an arrow then the
  throttle, a thumb lifted off the stick and put back), the web layer letting go, a body raced
  past and then back, chains of 4 to 8 names in a row, and the engine rebuilt from its snapshot
  mid-journey.
  Under reduced motion nothing flies: `goTo` is a cut (`navigator.place`), or the short approach
  within reach, and a journey picked up from a snapshot (`navigator.restore`) is taken up the same
  way. The camera follows at any speed: the chase camera looks ahead no further than
  `chaseCam.lookAheadMax`, swings round no faster than `chaseCam.maxYawRate` (about 195 degrees a
  second while the autopilot snaps round at 7 rad/s; under reduced motion no faster than the
  pilot's own turn, which is what an approach or an E press shows them), and the dust slides past
  no faster than `dust.maxFieldSpeed` (its box moves with the ship; `sim/dustField.ts` and the
  `uField` uniform), so the view neither spins, nor lies flat, nor strobes at 700 u/s.
- **Pointing at a planet goes there** (`ui/Picker.ts`). Once a frame `ui/BodiesOnScreen.ts`
  works out where every body is on screen and how big it looks (`sim/screen.ts`, pure: the
  camera is sixteen numbers there). A click, or a tap that neither moved nor lingered (so it was
  not the thumb stick), picks what is under it: a point ON a body beats a point merely near one,
  the one in front wins, a small body still has a target a finger can hit, and what is too small
  to see cannot be picked. A pick is the PILOT's doing, like the controls: `travel(id, 'pilot')`,
  so whatever page was open is left (`undocked` with `by: 'pilot'`) and the new body's page opens
  on arrival. The prompt says "Flying to FishAI" with a Stop on the way, for someone who got
  there by a tap and cannot know that steering takes the ship back.
- **Names over the bodies** (`ui/Labels.ts`): one real `<button>` per body in
  `#universe-overlay`, so a name can be tapped, tabbed to and read out, and pressing it is
  pointing at the body. A link (a profile elsewhere, `docks: false` in the manifest: GitHub on
  the satellite's ring) is the exception: its name is a real `<a rel="me noopener">` in a second
  group, "Elsewhere", because a link that leaves the site is not a way to fly. Nothing docks at
  a link: its pull is 0 (`BodyField.docks`, `sim/assist.ts`), so the assist never takes a ship
  onto its ring and it is never offered, while the cushions and the planner still go round it,
  and the Navigator refuses every request for it. Pointing at its body (main.ts, `pickRow`)
  never leaves the site either: it beckons the name (`Labels.beckon`: shown, focused and lit
  with the next frame), and leaving is a second, explicit press. They read the same map of the screen as the picker. Which names may show
  is `sim/declutter.ts` (pure): where the ship is going first, then systems, planets, moons, the
  nearer first; never touching, never under the panel or the top bar, and steady: a name that
  shows stays until it is really in the way, and a hidden one waits for real room, so names do
  not blink while bodies drift past each other. The name of the body the ship is docked at is on the page
  already, so it is not shown, and no other name lies on its face. Names also keep off whatever
  else can be pressed out there: the dock prompt, the boost pad and the Map button are
  `obstacles`, room that is taken before the first name is placed (on a phone with the sheet up,
  the name of where the ship is going used to lie on the prompt that says so), and so is the
  page's footer chip in the bottom-left corner, which the shell measures (`foot` of the inset).
  On the star map the ship is a marker that says "you are here", and no name's tag may cover
  it either (`ship`, projected at the height the marker is drawn at). It is not taken room like
  the obstacles, because it is most often right beside the very body whose name it is: a name it
  would lie under glides just past it, away from its body (`glidePast` in `sim/declutter.ts`), or
  goes ABOVE its body, with the same patience as declutter, so a name does not hop about while
  the ship circles its body. Only on the map (`onMap`, which holds still) does a name have more
  than one PLACE: below its body or above it (one with no room below, the sheet, an edge, a
  control, goes above too), BESIDE it like a station's name on a transit map (the side towards
  the middle of the view first), or slid along it, away from a screen edge it would cross, as
  long as its body stays over its tag. Declutter tries a name's places in turn, keeps it where
  it was while it may, brings it back to its first place once that has room to spare, and moves
  ONE name already placed to another of its places if that alone makes room for one more; the
  systems' names are placed TOGETHER, every way tried before one of them is left out (the
  target's and the keyboard's come first and are never moved). Among names of one rank the map
  prefers one that shows already (a name that waits takes only the room that is left), then the
  nearest the middle of the view: every body is as far from a camera straight above. And on the
  map a name that has just appeared, hidden or moved makes no other change of its own accord for
  `labels.dwellSec` (1 s: `young` in `sim/declutter.ts`); while it is young it keeps its slot in
  `labels.max`, and no name that waits to show, however important, takes its room. A place a name
  is not at must have room to spare from the edges of the view before it takes it, so nothing
  hops back and forth (a name with no such place takes one without, unless its body is on its way
  out). A planet's or a moon's tag never lies on a sun or the home planet, the landmarks the map
  is read by; a system's only as a last resort (`covers`: what a place lies on, `liesOn`), and
  where one lies on another system's sun the systems' search tries every way of placing them all
  for one that leaves fewer there (right on a disc counts far worse than a gap off it). The
  map's places start in the frame the camera has ARRIVED (`StarMap.arrived`): on the way up a
  name keeps its one place under its body, as in flight. What no rule holds off is a change a
  name MUST make: its place went past the edge of the view, or something more important that
  shows needs the room (`tests/map-names/` watches every frame: samples in `npm test`, whole
  turns of every look in `npm run map-names`). Any other name glides a few
  pixels at most and then makes way; the target's and the focused one never do, so the ship
  alone never hides the name of where it is, or takes the keyboard's focus away.
  Whichever side, it is the name's visible tag that sits `offsetPx` off the disc and keeps a gap
  from the ship (its height, and how far the target's tag reaches left for its dot, are read
  from the stylesheet when the names are measured); the rest of the 44 px box, a clear touch
  target, lies beyond the tag, away from the body (`data-side` tells CSS where the body is:
  `above` draws the tag at the bottom of the box, `left` and `right` in its middle). Each name's
  `transform` moves it to its body and from there to its place, so the page says where every
  named body is (the end-to-end tests read it: `bodyOf`).
  The top bar is the web layer's, so the web layer measures it: `shell/panel-inset.ts` reports
  how far down its links reach as `top` of `setPanelInset`, which the names respect (the bar is
  two rows tall on a phone); the camera goes by `frameTop` instead (above). Per frame that is a
  little arithmetic, one `transform` per visible name, and one look at where the few obstacles
  are, taken before anything is written, while layout is still clean.
- **The star map** (`ui/StarMap.ts`, `camera/MapCam.ts`, `sim/mapView.ts`) is another way of
  LOOKING, not another place to be. The navigator does not know about it: a journey, an approach
  or a docked ship carries on underneath, and the URL and the panel do not change. `M`, the Map
  button (a real button in `#universe-overlay`) or scrolling out opens it; `M`, the button or
  `Esc` closes it, and the map hears `Esc` before the panel does. The map camera is the SAME
  perspective camera, straight down through a 12° lens from far away, north up (+Z up the
  screen), so nothing pops on the way out, and the picker, the names and the panel's view offset
  work unchanged. What it shows is a `MapView` (a centre and a span; fitting, clamping, panning
  by pixels and zooming about a point are pure maths in `sim/mapView.ts`), eased on springs and
  fitted into what the panel, the top bar and the Map button leave free. It opens on everything
  (the galaxy, and the ship if it is out beyond it), snugly, with room in pixels for the names at
  the edge, zooms out no further than that, and never lets the galaxy be dragged off (zoomed in,
  the view stays on it; further out, all of it stays in view): past it there is only empty space,
  and names too small to matter. While it is open the
  flight controls are OFF (`InputSystem.setEnabled`): keys pan and zoom, a drag pans, the wheel
  and two fingers zoom about where they are, and the thumb stick and the boost pad are put away.
  The names lie over the map and on a phone cover much of it, so to a finger they are the map
  too: one that goes down on a name and moves further than a tap (`picking.tapMaxPx`) drags, one
  that comes down while another is on the map pinches, and only a tap presses the name. The
  names are measured again when the map opens and closes (their size may differ there).
  Pointing at a body or its name goes there and closes the map; a nav link leaves it open, so
  that journey is watched from above. **Sizes on the map** are `displayScales` (pure): every
  body is drawn at least a few pixels big, by kind, and a body whose disc would touch its
  parent's is not drawn at all (nor its orbit line, nor anything that orbits IT) until zooming in
  makes room. The galaxy scales its meshes by those numbers and `BodiesOnScreen` measures with
  the same ones, so what is drawn, what is named and what can be picked always agree. **The
  look** follows one number, the map's `weight` (0 flying, 1 map, in step with the camera's
  blend): toon shading flattens (`uFlatness`), stars dim and hold still, dust goes, and the ship
  becomes a marker big enough to find. The web layer hears the `map` event and sets
  `html[data-map]`, which is all the stylesheet needs.
- **The route and the ship follow each other** (`shell/follow.ts`). A page that belongs to a
  body (`shell/destinations.ts` reads that from the manifest: every body carries its `href`, and
  `alsoAt` lists pages that are shown FROM a body, such as the projects index from the first
  system's sun: for the Projects binary, its primary, Software)
  means the ship goes there: `goTo(id)`. Any other page means `undock()` (on the way somewhere,
  a Stop: the ship brakes to rest rather than coast on at speed). The other way round,
  `docked` opens that body's page unless it is showing already, and `undocked` with `by: 'pilot'`
  leaves the page (`router.leave`: Back when Back is the open sky, otherwise a new step). Both
  sides are idempotent and neither waits for the other, so there is nothing to deadlock. A page
  asked for by a dock that the pilot has already left again is called off (`router.cancel`), and
  a route that went home only BECAUSE the pilot left does not call the ship back from wherever
  the pilot was going.
- **How to fly, said once** (`shell/hints.ts`). A first-time visitor in open sky gets a small
  card (markup in `layouts/Base.astro`, shipped `hidden`; the stylesheet picks keys or thumbs by
  pointer and hides it while the panel is open). It goes for good once they have steered
  (`firstinput`), set out for somewhere from the open sky, or pressed "Got it"; a journey that
  began with a link does not count, because that visitor was reading.
- **What the ship does, said aloud** (`shell/announcer.ts`). One polite `role="status"` region,
  in the layout from the start and empty, because a screen reader listens to the regions it found
  when the page loaded. It says "Flying to FishAI.", then "Docked at FishAI.", "Stopped." or,
  when an arrow or the throttle took the journey back and the ship flies on, "Flying by hand."
  (`undocked`'s `halting`), and that the star map opened or closed. It says nothing about a ship that was PUT somewhere (a deep
  link, a cut under reduced motion), nor about leaving: there a page opens or closes, the focus
  moves, and the heading says it better.
- **Where a visit starts** (`core/snapshot.ts: startingFrom`). The URL says where the ship is
  DOCKED: a page opened on a body boots in orbit round it (`start.at`), placed before the first
  step, so the state machine is never in `flight`, nothing flies and the camera cuts. The URL
  never says where a ship in open sky IS: the shell keeps the engine's snapshot in
  sessionStorage when the page goes away (`shell/pose-memory.ts`) and hands it to the next
  engine (`start.snapshot`), which checks every field before believing it. So a reload, or a
  navigation the router had to hand to the browser, carries on in the same world at the same
  time with the ship where it was. When the two disagree the URL wins, and a journey it does not
  take up is a Stop: one pointed at in the world flies with the URL on the sky, and reloaded
  there the ship would otherwise coast on at the pilot's top speed. A journey to a body the
  manifest no longer has is a Stop as well (`Navigator.restore`), and so is an orbit round one.
  And a snapshot is only believed in the galaxy it was taken in: the engine stamps each one with
  `galaxyKey` (`manifest.ts`: where every system and body is and how big, never a title or an
  href), and one taken before a deploy moved things (a new system, a family grown) is dropped
  whole, so the visit starts as if nothing were remembered. So is one with no stamp at all: no
  engine has written one since stamps arrived, and the galaxy has moved since (the slots made
  room for a binary star, 2026-09-30), so an unstamped snapshot can only come from an older
  galaxy.
- **What survives a rebuild** is exactly two things: the simulation step count (from which the
  position of every body follows) and the fields of `Snapshot` (`core/snapshot.ts`: the ship,
  and the dock it is headed for or carried by). Anything a visitor would miss after a rebuild
  must become a snapshot field. (What the web layer last ASKED for is not the engine's state:
  `api.ts` keeps the panel's inset, the pause and whether the map is open, and tells the new
  engine, with a cut. And what the old navigator had queued for its next frame, a Stop pressed
  since the last one say, is delivered before the snapshot is taken: the new engine only reports
  what it does itself.)
- **Dispose.** Whoever creates a GPU resource disposes it. Systems track geometries, materials and
  textures in a `Scope` (`core/scope.ts`); in development the engine warns on dispose if
  three.js still counts any.

## 6. Conventions

| Thing | Convention |
| --- | --- |
| Space | Flight happens on the flat **XZ plane**, **Y is up**. 1 unit (`u`) is about a metre at toy scale: the rocket is 2 u long, planets 5 to 12 u in radius, neighbouring systems some 600 u apart (centre to centre). |
| Angles | Radians, **counter-clockwise seen from above, 0 along +Z**. The unit vector of angle `a` is `(sin a, cos a)`. This is exactly three's `rotation.y`, so a heading goes straight onto a mesh. Headings are never wrapped, so interpolation is a plain lerp. `angleDelta(from, to)` is positive counter-clockwise. |
| Turning | `turn > 0` steers to the pilot's **left** (counter-clockwise). `yawRate > 0` likewise. |
| Orbits | The tangent for counter-clockwise travel around a body is `(r.z, -r.x)` for the unit radius vector `r`. |
| Models | +Z forward, +Y up, 1 unit = 1 u, named sockets for attachments. `.glb` only, from Phase 3. |
| Time | The simulation's only clock is its step count: `simTime = steps / 60`. Nothing in `sim/` reads a wall clock. `frame.dt` is for per-frame easing only; never advance the simulation from a frame. |
| Names carry units | `...Sec`, `...PerSec`, `...Deg`, `...Rad`, `...Radii` (multiples of a body's radius), `...Px`, `...Ms`. A bare number in `tuning.ts` has its unit in the comment. |
| Colour | Every colour is a token (`design/tokens.ts`), mirrored to CSS as `--color-...`. three.js works in linear light: `new Color(hex)` and `hexToLinear(hex)` convert on the way in, shaders end with `#include <colorspace_fragment>` on the way out, and there is **no tone mapping**, so a fully lit surface is exactly its token on screen and 3D matches the DOM. |
| Alpha | In the engine's picture, alpha is not transparency: it is **the bloom guest list** (`shaders/post.ts`). Opaque shaders write `1.0 - uBloomMask`, glowing ones their bloom amount, see-through materials go through `keepBloomMask()`. |
| Randomness | `createRng(seed)` from `sim/rng.ts`, seeded with a string that names the thing (`` `${body.seed}/ring` ``). The same galaxy appears on every visit and in every screenshot. |

## 7. Where state lives

| State | Lives in | Why |
| --- | --- | --- |
| Where every planet and moon is | nowhere: `sim/orbits.ts` computes it from the step count | nothing to synchronise, nothing to go stale |
| The ship | `ShipState` (plain numbers) inside `ShipSystem`; copied into a `Snapshot` on rebuild | a copy is a snapshot |
| Flight, journey, approach or docked, and at what (and whether a Stop is still braking, or a ship taken back at speed is still guarded) | `state/Navigator.ts` (the app state machine) and `DockState` in the simulation; in the `Snapshot` on rebuild (`dock`, `halting`, `guarding`) | one owner; the web layer hears events and asks through `api.ts` |
| Which page is showing, whether the panel is open | the URL, and `data-panel*` attributes on `<html>` | Back must mean what it looks like |
| Whether the star map is open, and what it shows | `ui/StarMap.ts`; "open" is remembered by `api.ts` across a rebuild and mirrored to `html[data-map]` | a way of looking: not in the URL, not in the snapshot, not the navigator's business |
| Plain or universe | `html[data-mode]`, `localStorage.mode`, `sessionStorage.mode` | decided before first paint by `mode.inline.js` |
| Whether the baked sky is there | `world/SkyBake.ts`; mirrored to `html[data-sky]` (`baking`, `ready`, `off`); that it has been SEEN is the snapshot field `skyRevealed` | the panorama follows from the tuning and the tier; only "do not fade twice" has to survive a rebuild |
| A demoted quality tier | `localStorage.quality`, for a week | one probe per visit, not one per page |
| Design values | `design/tokens.ts`, `design/tuning.ts` | one place to look, one place to edit |

## 8. How it is tested

- **Pure code, headless** (Vitest, `*.test.ts` beside the source): flight reaches its terminal
  speed and a 10,000-step random pilot stays finite and outside every planet; the orbit assist
  captures within half a unit, lets go within 3 s of full thrust, and a kamikaze pilot at full
  boost never gets under a shell; identical end states at 30, 60 and 144 Hz; the governor's every
  decision; a galaxy layout that is a pure function of each entity's id, with the systems pinned
  where they are; 200 seeded journeys through a galaxy with moons (from docks and from mid-flight,
  at any heading and speed) that all dock, touch nothing, keep their distance and never open the
  throttle with the nose off the path, and 200 more swept step by step against every shell (at
  700 u/s a step is 12 u: no step may pass through one); Stop pressed at a journey's top
  speed, every quarter second and just before it arrives, after which the ship brakes to rest
  within 160 u, and into nothing; a new destination every tenth of a second of a journey, and a
  body within reach asked for at cruise speed, each docked without passing closer than half a
  cushion to anything; a tap of the brake, an arrow or the throttle at any moment of a journey
  in the live galaxy (frozen as it was on 2026-09-23), after which the ship meets nothing (the
  journey harness's `stress` mode does all of this in bigger galaxies); an approach begun diving
  at its own body, which meets the shell only from nearer than the brake could stop in; a chase
  camera that never swings faster than its limit, nor under reduced motion than a pilot turns;
  a map that zooms about the pointer and never leaves the galaxy, on which a body only ever grows
  and a crowded one only ever fades; a camera blend that stays level however far round it turns.
- **Shell code** runs against happy-dom: the mode script as shipped, the router's navigation and
  history rules, the panel, the swap contract, the hint card, the announcer.
- **The build output is a contract** (`scripts/verify-dist.mjs`, part of `npm run verify`): CSP
  hashes present, plain mode free of three.js, weight budgets, every internal link resolves, every
  page identical outside `<main>` and `[data-page-head]`, nothing dev-only (`/lab`, lil-gui) and
  no `TODO(copy)` in `dist/`; and every old URL in `_redirects` (`/systems/code/`) is one exact
  path, 301, to a page of the build that no page links past (`scripts/lib/redirects.mjs`).
- **`tests/`** holds the checks that are about the repo rather than a module: the lint boundaries
  still bite, the build scripts work, and no phone number or private address is in the repo.
- **Real browsers, by machine** (`npm run e2e`, Playwright, `tests/e2e`): Chromium, WebKit and a
  phone-sized Chromium drive the real build behind `wrangler dev`, so the headers and the CSP are
  under test too (over HTTPS: the CSP says `upgrade-insecure-requests`, and WebKit honours that
  even on a loopback address). What they hold: a soft navigation ends in the page a fresh load
  builds, for every page; Back, Forward, Close and Escape; scroll restored per entry; focus on
  the heading, also with reduced motion; the canvas and its GL context after fifty navigations;
  a newer deploy or a dead network means a normal page load; plain mode asks for one script and
  never for the galaxy; no JavaScript, reduced motion, a GPU that gives no context, the 404; a WebGL
  context taken away mid-visit (the engine rebuilds in place: same page, same dock, the map still
  open); pointing at a planet and at its name, Stop, the cut under reduced motion, the hint card;
  the star map by button, key, wheel, drag and pinch (real touches, through the browser's own input
  pipeline), none of which flies the ship or changes the URL; axe with no serious issue on any page
  in either mode, nor on the map; nothing scrolls sideways at 360 and 320 px, and every control is
  44 px. They fly for real, on whatever renders (a CI runner has no GPU and draws on its CPU), so
  they wait for outcomes, never for seconds.
- **Real browsers, by hand.** `npm run preview` serves `dist/` the way Cloudflare will (headers,
  CSP, 404). Looks and feel are judged there and on real phones; a number in a test cannot say
  whether flying is fun.

`npm run verify` runs everything but the browsers and is the required check. Run it before every
commit. The browsers run in a second CI job that is allowed to be slow and is not required: a red
run there is a reason to look, not a locked door.

## 9. Tools for looking inside

| Tool | How | What for |
| --- | --- | --- |
| Perf readout | `?perf` on any page, in every build | fps, frame time, draw calls, triangles, pixels, tier and resolution scale, position, speed, whose pull the ship is under, and the state (`autopilot system/software`, with `(map)` while the map is open) |
| Force a tier | `?q=low`, `?q=medium`, `?q=high` | judge a look on every tier; the probe is off |
| Tuning panel | `?universe&tweak`, development only | sliders for the live blocks of `tuning.ts`, "copy tuning as JSON", and a flight recorder that replays a run |
| **The lab** | `http://localhost:4321/lab/`, development only | one planet (built or planned), moon, sun, rocket, station, satellite or relay on a turntable, in front of the real sky, lit and post-processed as in the universe; sliders for `shading`, `planet`, `world`, `post`, `ship`; light direction; tier. The `sky` subject turns the camera round: it stands in the middle and looks OUT, from one of the seven views the sky is judged from (`sim/skyDirections.ts`) or wherever a drag leaves it, with the baked sky on it: the plain numbers of `look.sky` as sliders (its tables of clumps and galaxies are edited in `tuning.ts`), `rebake sky`, `copy look.sky as JSON`, what the view measures (`html[data-sky-y]`), and with `parity=1` the GPU against the CPU oracle. The `stars` subject looks out the same way at the stars: the sky's own, or a sheet of one class (`starKind`) in one tint or the mix, drawn as a view of another height would draw them (`starRows`), or as the star map shows them (`starMap`). The address says what to show (`/lab/?subject=sky&pose=first&q=high`; any key of the table's state, and `turn`, `still=1`, `ui=0`), so a view can be linked to |
| The look's pictures | `node scripts/look/capture.mjs --out <dir> --site <origin> --lab <origin>` (its header says how to start what it looks at) | the same views every time, on a desktop and a phone: the first frame at home on each tier and under reduced motion, in flight, docked at home, a planet, an emblem world and each sun, the star map; and the lab's sky from the seven views, and its stars (a sheet of each class, the heroes at two view heights and on the low tier, the stars as the map shows them), and its suns (a living sun of each family, on the low tier and as the map shows it, and the Hardware sun). `--perf` reads `?perf` on each tier instead. Before-and-after pictures of one view are how a change to the look is judged (docs/DESIGN.md, "Deep light") |
| Production preview | `npm run build`, then `npm run preview` | CSP, headers, 404, trailing slashes. Restart it after every build |

The lab and the tuning panel are imported behind `import.meta.env.DEV`. A production build drops
them and lil-gui with them, and `verify-dist` fails the build if either ever shows up.

**Shaders ship squeezed.** The GLSL in `design/shaders/*.ts` is written to be read (a header of
uniforms, a comment on every trick), and a minifier leaves a template literal alone, so all of
it used to ship. A Vite plugin (`scripts/vite-glsl-squeeze.mjs`, in `astro.config.ts`) takes the
comments and the needless whitespace out of every literal tagged `/* glsl */` in that folder, at
build time only: the dev server and the lab keep the shaders as written, so a compile error
there names a line a person can find. It is the same program, token for token
(`scripts/lib/glsl-squeeze.mjs` is pure, and `tests/build-scripts.test.ts` runs it over every
real shader). Three rules follow for whoever writes one: tag the literal `/* glsl */`; no
backslash (a line continuation would not survive, and the squeeze refuses it); and a `${...}`
that brings in a block of GLSL stands alone on its line, which it then keeps.

**three ships on a diet.** three's shader library (its `ShaderChunk`: lights, shadows, PBR,
morph targets, fog) is strings a tree-shaker cannot drop, about 18 KiB gzipped that this engine
never runs: every material here is a `ShaderMaterial` of our own, or one of two built-in ones
(`MeshBasicMaterial`, `LineBasicMaterial`). A second build-time Vite plugin
(`scripts/vite-three-diet.mjs`; `scripts/lib/three-diet.mjs` is pure) blanks every chunk that
neither those two programs, the renderer itself nor our shaders' `#include`s reach, and turns
each dropped PROGRAM into one `#error` line that names the plugin, so a material nobody listed
fails loudly at its first compile and not as a wrong picture. **Using another built-in three
material (or `scene.background`, shadows, an `#include` of another chunk) means adding it to
the lists at the top of `scripts/lib/three-diet.mjs`**; `tests/build-scripts.test.ts` reads the
engine's source and fails on one that is missing. The dev server and the lab run three whole.

**The mesh is facets, the picture is round.** Four things make it so. (1) NORMALS, said once by
what a thing is made with: a mesh hands the toon shader a normal a vertex. A generated ground's
are the ball's or the shape's (`sim/planet.ts`, `shapeNormal`). A LATHE of five sides or more
(`MeshBuilder.lathe`, and the kit's `lathe`, `cyl`, `cone`, `dome` and bead on top of it) gives
every corner the normal of the true surface: round about the axis; along the profile shared
between two bands where it only bends, kept apart where it folds by more than `CREASE_DEG` (a
cap, a rim); one normal along the axis where a gentle profile ends on it (`POLE_DEG`: the top
of a dome), one a side at a tip. The rows' `lathe` is also built round ALONG its profile: a
bend becomes an arc inside its corner (`bent`, `sim/world/kit.ts`), as fine as its size wants.
A `ring` swept in two steps or more does the same for its
walls. Everything else (a box, a prism, a fin, a quad, pixel art, a ring of one step, a lathe
of three or four sides) carries no normals, and `pack` gives each face its own
(`sim/world/glue.ts`). A triangle's normals ride in `Tri.n` through every placement (`xf`
takes them through the inverse of a scale, then the turn; a mover's are turned into its
pivot's frame), and a ghost's wire reads them, so a round ghost is outlined by its rims.
There is no pass that guesses what is round from the angles between faces any more. (2) SIDES:
the rows sketch a round thing with a handful of sides, and the interpreter builds it with as
many as its size wants (`sim/world/rows.ts`, `refine`; `sim/world/kit.ts`, `sidesFor`: the
middle of a side within `tuning.world.round`'s sag of the true circle, in radii of the body,
for the size the part ends at after the placements that scale it): more in the close-up than
every day, fewer on the low tier (`fineOf`), never fewer than written, a polygon of under
five sides never changed. A ring's steps become a whole number of steps each, so its colours
stay where they were painted. (3) LIGHT PER PIXEL: the shader carries the NORMAL across a
face, asks at each pixel how far it faces its sun, and cuts the three bands there, a pixel
soft (`fwidth`); the colour stays `flat`. (The facing itself was interpolated until step 2c:
across a long facet of a cone that is not a straight run, and a band's edge showed corners.)
(4) LINES THROUGH FACETS: the planet
generator walks each facet's outline, finds where the colour changes (a coast, a band, an edge
of paint) and gives the facet up to three colours and two lines (`Facet.side`,
`Facet.over`: a colour and, per corner, where it stands on the line; `MeshData.sides`, eight
numbers a vertex), which ride through `Tri.s` and `Packed.sides` into two attributes every
geometry carries (`aSide`, `aOver`: zeros, a byte each, where a face has one colour). A
neighbour walks the shared edge through the same places, so the lines join. And each line is
an ARC: a ground's height inside a facet is the one smooth sheet through its three corners
and the ground's own height halfway along each edge (the same from either side of an edge),
the generator finds where the outline crosses the line's perpendicular through its middle
(`bent`), and the shader adds `bend * t * (1 - t)` to the line (`Side.t`, `Side.bend`;
`MeshData.bends`, four numbers a vertex; `Tri.b`, `Packed.bends`, the attribute `aBend`). A
line both of whose ends are on ONE edge (a cape) is that edge moved half a step off the facet,
with the same arc drawn from further along it, so no pixel on the edge has to say which side
it is on. A change to a
generator that makes its own triangles keeps to this: give a curved surface its normals (a
triangle without them is a flat face), and never colour a boundary by the facet.

**A sun is drawn on its ball, and a corona.** A sun's ball is generated like any ground
(`sim/world/ground.ts`): a smooth ball in its family's base, every facet flagged as the SURFACE
in the lighting flag every vertex already has: `aUnlit` is 6 plus the sun's own number
(`sim/sunSurface.ts`, `sunFlag`; under 16), which every reader of the flag still sees as
"glows" (above one and a half). Only the toon shader's SUN variant (a material a sun family,
`Galaxy.sunSurfaceOf`) asks "above four?", and there draws the surface per pixel: two layers
of gradient noise on the ball (`design/shaders/noise.ts`, a chunk the worlds' clouds share) at
the place the sun's number says, cut by three thresholds into the four tones of a ladder of
six, stepped down toward the limb, with three spots laid over, every edge soft and never
thinner than a pixel; `uFlatness` takes it to the base. `sim/sunGrain.ts` is the same
arithmetic on the CPU, for the tests. No new attribute for it, and a plain glow (a lamp, a gear
of the Hardware sun, whose painted frame ball is no living surface) is left alone. The light round the
suns is `world/SunCorona.ts`: one instanced draw (`design/shaders/corona.ts`), two quads a
living sun (its light behind what it wears, its lens in front of its ball) and one a plain sun,
placed each frame from the galaxy's positions and display scales, so it is added after the
galaxy. It is its sun's seed, the tokens, the tuning and the simulation time, so nothing of it
is a snapshot field.

**A world with air is a variant of the toon shader, and two instanced draws.** Which worlds
have air is `world/looks.ts` (`airOf`: the table `tuning.look.air.worlds`, else a generated
globe's biome). The galaxy gives such a world its own material, the toon shader's AIR variant
(`createToonMaterial({ air: { key, center } })`, `center` being the body's own position vector,
read live): per pixel it finds the direction from the world's centre, so the dusk and night
bands, the stepped tint on the limb and how far above the air a place stands all follow the
BALL and never a facet; `sim/air.ts` is the same arithmetic on the CPU, for the tests. A body's
moving parts get their material from the same factory (`BodyMesh`'s `another`). Home's lit
windows are a part the galaxy adds to its close-up (`sim/windows.ts`: pure, ranked by a seeded
noise; flag 3 in `aUnlit`, which only the AIR variant reads, and which it discards by day and
on the map). Round the worlds, `world/AirShells.ts` (added after the coronas, in `main.ts`):
one instanced draw of quads for the shells and hairlines and one of unit balls for the clouds
(`design/shaders/air.ts`; the clouds' twin is `sim/clouds.ts`), placed each frame from the
galaxy's positions and display scales and each world's light. Which worlds wear clouds is the
tier's (`look.air.cloudTiers`). Air is the world's id, the tokens, the tuning and the simulation
time: nothing of it is a snapshot field.

**Traffic and the chart** are two more systems added after the galaxy in `main.ts`.
`world/Traffic.ts` is one instanced draw of quads (`design/shaders/traffic.ts`): two dots on
every orbit that has a family to wear (a relay's has none). Which dots there are and where each
is at a time is `sim/traffic.ts`, pure: a dot is its orbit's id, `tuning.look.traffic` and the
simulation time of the frame, laid on the galaxy's positions of that same frame, so a rebuilt
engine draws the same dots and reduced motion is simply time zero. A dot's size rides in its
place's `y` (the flight plane is `y = 0`), which is also how an orbit the star map does not
draw loses its dots (`displayScale` of its body: size 0). `world/Chart.ts` is the star map's
ground, a little under the flight plane (`design/shaders/chart.ts`), visible only while the
star map's weight is above 0.01, drawn after the backdrop and before the stars; it reads the
map's weight and scale each frame. With post-processing it is one plane and one program, which
lays every part over the next itself and has as many districts as the manifest has systems (a
`#define`). Straight to the canvas (the low tier) the canvas's own blending lays the paint, so
it is three draws, each only where its part is: the dots on the plane, every district's discs
on a polygon round them and every ring on a strip along it (`sim/chartMesh.ts` makes those
meshes). That is for a renderer with no GPU, which works out every pixel a draw covers: in
Chromium's software renderer, which is what CI draws with, the one program took 24 ms of every
frame of the map, and the three parts take 4. Neither is state, neither is picked, and neither
is on the bloom guest list.

**The sky is baked once, on the GPU, after the first frame** (`world/SkyBake.ts`). What the sky
adds to the navy (the Milky Way's haze and fifteen far galaxies; no gas and no clouds: Allen's
decision of 2026-10-03, docs/DESIGN.md, "Deep light") is
one fragment shader, `design/shaders/skyBake.ts`, whose constants and tables are printed into it
from `tuning.look.sky` by `design/skyRecipe.ts` (pure). It is the same program on every tier,
with no noise and no levels in it: every term is a Gaussian or a sine of where the texel is.
Its colours (the haze's three tones, the six star tints) and the lengths of its two tables are
uniforms: with constant counts Direct3D's compiler unrolls the loops and takes longer over it.
The haze is only ever mixed up its own ramp: its dark lane is not painted (it is the fourth
number, below), and its bulge is a swell of the same tones.
It is drawn into a panorama (an equal-area cylinder: u is the
azimuth, v the sine of the elevation; sRGB, 8 bits, 2048 x 1024, or 1536 x 768 on the low
tier: a tier is only a size) whose alpha says how much of a star shows there (less in the
Milky Way's dark lane). The steps, each of which must not
hold a frame up:

1. `paint()` is called once the first frame is out: the event `sky: baking` goes to the shell
   (`html[data-sky]`), and the program is compiled with `renderer.compileAsync` (the render
   target bound first, or the program would be compiled for the canvas and again for the
   target).
2. Then **a band of rows a frame** (`bandRows`, a scissor), in an order and at a pace that
   `sim/skySchedule.ts` decides (pure, tested): after a frame of `bandSlowMs` or longer only
   every second frame paints one. A frame that painted a band is not fed to the governor
   (`Engine.excuseFrame()`): the bake is the engine's own doing, not the device being slow.
3. When the last band is in: `sky: ready`, and the panorama's light comes in over `revealSec`.
   Until then the sky is the navy and the stars (all of them: the river of stars is there in
   the first frame). `setSky()` in `design/materials.ts` hands the panorama, the reveal and the
   exposure to the backdrop AND the stars, which share those three uniforms (the backdrop reads
   the panorama and `uExposure`, which already carries the reveal; the stars the panorama and
   `uReveal`). The exposure follows `setView(docked, calm)`: the navigator's mode and the
   star map's calm, eased.
4. If anything fails (no render target, a compile error) the sky is `off`:
   it stays navy and stars, and nothing else notices. `intensity` 0 is the same path.

Nothing of it is state but one bit: **`skyRevealed` is a snapshot field**, so an engine rebuilt
in the same tab (a lost context, a demoted tier) paints the same panorama again and shows it
with a cut, not a second fade. `parseSnapshot` drops it, so a page load fades again. The
panorama itself follows from the tuning and the tier, like every planet's mesh.

**The sky's twin on the CPU** is `sim/skyOracle.ts`: the same program, expression for
expression, which nothing shipped imports. The Milky Way's shape (its frame, its two banks and
how its stars are shared between them, its clumps, its lane, its bulge) is `sim/milkyWay.ts`,
pure, which the oracle AND the star list read: the haze and the river of stars are laid from
the same functions, so they cannot drift apart. `tests/sky-gates.test.ts` holds the oracle
still (a table of its own values: a regression pin, which a change to the oracle or the recipe
has to move on purpose; it is no second opinion) and holds the sky to its gates from the seven
views of `sim/skyDirections.ts`, each as a wide screen shows it and as a phone held upright
does: the horizon strip, the percentiles, the ceiling, how much of the sky stays empty, that
the haze is faint and yet there, that it is blue everywhere and never darkened, that none of
it lies behind a cluster, and that it has no edge (no step from one texel to the next: what a
level cut into it would be). What checks the oracle against something other than itself is
the GPU: the lab's `sky` subject reads the GPU's own panorama
back and prints the same numbers (`html[data-sky-y]`), and with `?parity=1` the difference
between the two (`html[data-sky-parity]`: a seventh of a code value on average, the dither's own,
and 1.1 code values at worst, on every tier). A change to the recipe changes the shader and
the oracle together, or that number says so.

**The stars are a list, then one draw.** `sim/starList.ts` (pure, seeded) turns the star
classes of `tuning.starfield` into parallel arrays: a direction, a class, a tint, a brightness,
a phase. It is handed the Milky Way too (`tuning.look.sky.band`): a class's `bandShare` of its
stars is laid along the river by trying places until one is kept, in proportion to the haze's
own clumps there and thinned in its dark lane (`sim/milkyWay.ts`), the rest anywhere; then the
Milky Way's bulge (more dust, field and bright stars in an oval on the river, in warm tints:
the bulge is these stars), the clusters (three of them at the systems' bearings from home;
each a few bright stars, then field stars, then dust), the double stars, and the heroes
last, at the places the table gives. How many depends on the pointer and the tier, which are known before the renderer
exists, so the list is built once in the constructor of `world/Starfield.ts` and nothing about
it is state: a rebuilt engine makes the same sky. It is drawn as one draw of quads, a quad a
star (`stars` in `design/shaders/sky.ts`): the vertex shader puts the quad at the star's direction
on the far plane and sizes it in CSS px by class; the fragment shader sums a core, halos and
spikes. Every quad has four vertices of its own and none is an instance: a software renderer
(CI has no GPU) runs each instance as a draw of its own, and thousands of them were the most
expensive thing in its frame (`starGeometry` in `world/Starfield.ts` has the numbers).
`createStarMaterial` lays the classes out as the shader's tables, a row a class. Points
could not do it: a point's size is capped by the GPU and a point has no angle. A star also
reads the panorama's alpha at its own direction, in the vertex shader, and dims in the Milky
Way's dark lane. `sim/skyDirections.ts` projects a direction into each of the seven views
(`pointOf`), which is how `tests/look.test.ts` holds a hero in every view, clear of the bars.

**Tokens only the engine paints with** (the Milky Way's haze and the star map's districts,
air, the extra star temperatures, dusk
and night, a lit window) are left out of the CSS mirror: `ENGINE_ONLY` in
`src/site/tokens-css.ts`, passed by `Head.astro`. The engine reads `tokens` itself, never the
CSS, so a plain page does not carry custom properties that no stylesheet reads. A new token that
the DOM never uses joins that list; one the DOM does use must not.

## 10. Adding things

The recipes are in [AGENTS.md](../AGENTS.md#recipes): a token, a tuning constant, a material or
shader, a model, an engine system, a page, a project. The short version of all of them:

1. Pure maths goes in `sim/` with a test. Looks go in `design/`. A view connects the two.
2. Add the system in `main.ts`, in the place in the order where it belongs.
3. Track what you create in a `Scope`, and dispose it.
4. If a visitor would miss it after a rebuild, it is a snapshot field.
5. `npm run verify`.
