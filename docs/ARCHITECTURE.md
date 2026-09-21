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
weight budget (30 KiB for a plain page, 180 KiB for everything lazy, gzip).

```
mode.inline.js        the only inline script; sets html[data-mode] before first paint
  -> boot.ts          tiny, loaded by every page; acts only in universe mode
     -> universe-shell.ts   router, panel, watchdog, quality memory      (dynamic import)
        -> universe/api.ts  the engine, and the only door into it         (dynamic import)
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
so adding a project never moves an existing planet.

Astro is used thinly on purpose (PLAN §5.1): it pre-renders pages and owns the content layer, and
that is all. No islands, no `<ClientRouter/>`, no scoped styles, no per-page scripts. The client
code in `src/shell/` and the whole of `src/universe/` would survive a change of framework.

## 3. The layers of the engine

`src/universe/` is framework-free TypeScript on three.js r186. Imports point downwards only:

```
web layer (src/shell)  --->  api.ts                     the only door; owns the engine's LIFE
                              main.ts                    the composition root: what exists, in what order
                              lab/                       dev only: one asset on a turntable
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

Order in `main.ts` today: assets → input → ship → navigator → galaxy → ship lighting → camera
director → camera rig → bodies on screen → picker → sky → stars → dust → jobs → prompt → debug
overlays. The camera comes after everything it looks at (the ship AND the planets), so that it
sees this frame's world; whoever needs to know where things are ON SCREEN comes after the camera.

**The camera** (`camera/`) is one rig and several modes. A mode (`ChaseCam`, `OrbitCam`; map and
cinematic later) only fills in a `Pose`: what to look at, from how far, turned which way, through
which lens. `CameraRig` applies the pose of the mode in charge and BLENDS between modes in that
form, live: both modes keep following their subjects while a blend runs, turning back halfway
runs the same blend the other way, and a mode that comes back after a while away is told so
(`enter()`), so a chase camera starts from behind the ship instead of swooping in from where it
last saw it. A few lines in `main.ts` direct it: docked means the orbit view, anything else the
chase view; a ship that was PUT at a body (a deep link, a rebuild) is cut to, one that flew there
is eased to, and under reduced motion everything is a cut.

**The panel and the view.** The info panel covers part of the viewport. The shell measures how
much (`shell/panel-inset.ts`), tells the engine (`setPanelInset`) and mirrors it to the stylesheet
(`--panel-inset-right`, `--panel-inset-bottom` on `<html>`). The rig slides the WINDOW onto the
view with `camera.setViewOffset` so that the middle of the view is the middle of what is left:
same camera, same perspective, so a planet stays round (turning the camera instead would stretch
it into an egg near the edge of a wide lens). Modes that frame something are told how much is free
and stand back accordingly. `#universe-overlay` is inset the same way, so the dock prompt is never
under a bottom sheet.

## 5. Life of a visit

`api.ts` owns the engine's life, because an engine can die and be replaced while the page lives on.

- **Boot.** `createUniverse()` picks a quality tier (desktops HIGH, phones MEDIUM, small machines
  one lower, never above a tier remembered from an earlier demotion; `?q=` forces one) and calls
  `boot()` in `main.ts`. `ready` fires with the first frame, `firstinput` with the first steering.
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
  there is no jolt. Fresh steering always leaves. The navigator keeps the app state machine
  (`state/appMachine.ts`) in step and reports `statechange`, `soi`, `docked`, `undocked`.
- **Journeys** (`sim/autopilot.ts`). A destination out of reach is FLOWN to: `goTo(id)` becomes
  `navigator.travel(id)`, and the dock's phase is `cruise` until the ship is within reach, when
  the approach above takes over. So a journey is one more phase of the same dock: the same
  events, the same snapshot fields, and the same rule that fresh steering (or the brake) takes
  the ship back with exactly the velocity it has. It is three pure pieces, the same structure as
  a robot's autonomous routine:
  1. **Path** (`sim/path.ts`). Every body on the way is a keep-out disc, placed where the body
     WILL BE when the ship passes it. A visibility graph over ring corners round each disc, A*
     over that, then a centripetal Catmull-Rom curve through the corners, sampled every 4 u. A
     moving ship's path begins with a short run-up the way it is already going. Bodies that crowd
     each other give way in proportion so that no gap is ever planned shut, and only the first and
     last leg may cut a keep-out the ship starts or ends inside. Planning again every second costs
     nothing in steadiness: the planner remembers which side of each body it went (`walls`) and
     changes its mind only for a much shorter way.
  2. **Profile** (`sim/profile.ts`). A speed for every sample: a forward pass (what the drive can
     reach) and a backward pass (what the brake can still shed, knowing the brake is a drag),
     under a ceiling that is low inside and beside keep-outs and opens up with room.
  3. **Pursuit** (`cruiseInput`). The virtual pilot steers at a point a second ahead on the path,
     never at one it can only see ACROSS a keep-out, holds the throttle until the nose points
     the way the path runs, and flies the ordinary flight model with `tuning.cruise.flight`.
  Under reduced motion nothing flies: `goTo` is a cut (`navigator.place`).
- **Pointing at a planet goes there** (`ui/Picker.ts`). Once a frame `ui/BodiesOnScreen.ts`
  works out where every body is on screen and how big it looks (`sim/screen.ts`, pure: the
  camera is sixteen numbers there). A click, or a tap that neither moved nor lingered (so it was
  not the thumb stick), picks what is under it: a point ON a body beats a point merely near one,
  the one in front wins, a small body still has a target a finger can hit, and what is too small
  to see cannot be picked. A pick is the PILOT's doing, like the controls: `travel(id, 'pilot')`,
  so whatever page was open is left (`undocked` with `by: 'pilot'`) and the new body's page opens
  on arrival. The prompt says "Flying to FishAI" with a Stop on the way, for someone who got
  there by a tap and cannot know that steering takes the ship back.
- **The route and the ship follow each other** (`shell/follow.ts`). A page that belongs to a
  body (`shell/destinations.ts` reads that from the manifest: every body carries its `href`, and
  `alsoAt` lists pages that are shown FROM a body, such as the projects index from the first sun)
  means the ship goes there: `goTo(id)`. Any other page means `undock()`. The other way round,
  `docked` opens that body's page unless it is showing already, and `undocked` with `by: 'pilot'`
  leaves the page (`router.leave`: Back when Back is the open sky, otherwise a new step). Both
  sides are idempotent and neither waits for the other, so there is nothing to deadlock. A page
  asked for by a dock that the pilot has already left again is called off (`router.cancel`), and
  a route that went home only BECAUSE the pilot left does not call the ship back from wherever
  the pilot was going.
- **Where a visit starts** (`core/snapshot.ts: startingFrom`). The URL says where the ship is
  DOCKED: a page opened on a body boots in orbit round it (`start.at`), placed before the first
  step, so the state machine is never in `flight`, nothing flies and the camera cuts. The URL
  never says where a ship in open sky IS: the shell keeps the engine's snapshot in
  sessionStorage when the page goes away (`shell/pose-memory.ts`) and hands it to the next
  engine (`start.snapshot`), which checks every field before believing it. So a reload, or a
  navigation the router had to hand to the browser, carries on in the same world at the same
  time with the ship where it was. When the two disagree the URL wins.
- **What survives a rebuild** is exactly two things: the simulation step count (from which the
  position of every body follows) and the fields of `Snapshot` (`core/snapshot.ts`: the ship,
  and the dock it is headed for or carried by). Anything a visitor would miss after a rebuild
  must become a snapshot field.
- **Dispose.** Whoever creates a GPU resource disposes it. Systems track geometries, materials and
  textures in a `Scope` (`core/scope.ts`); in development the engine warns on dispose if
  three.js still counts any.

## 6. Conventions

| Thing | Convention |
| --- | --- |
| Space | Flight happens on the flat **XZ plane**, **Y is up**. 1 unit (`u`) is about a metre at toy scale: the rocket is 2 u long, planets 5 to 12 u in radius, systems about 1000 u apart. |
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
| Flight, journey, approach or docked, and at what | `state/Navigator.ts` (the app state machine) and `DockState` in the simulation; in the `Snapshot` on rebuild | one owner; the web layer hears events and asks through `api.ts` |
| Which page is showing, whether the panel is open | the URL, and `data-panel*` attributes on `<html>` | Back must mean what it looks like |
| Plain or universe | `html[data-mode]`, `localStorage.mode`, `sessionStorage.mode` | decided before first paint by `mode.inline.js` |
| A demoted quality tier | `localStorage.quality`, for a week | one probe per visit, not one per page |
| Design values | `design/tokens.ts`, `design/tuning.ts` | one place to look, one place to edit |

## 8. How it is tested

- **Pure code, headless** (Vitest, `*.test.ts` beside the source): flight reaches its terminal
  speed and a 10,000-step random pilot stays finite and outside every planet; the orbit assist
  captures within half a unit, lets go within 3 s of full thrust, and a kamikaze pilot at full
  boost never gets under a shell; identical end states at 30, 60 and 144 Hz; the governor's every
  decision; a galaxy layout that is a pure function of each entity's id; 200 seeded journeys
  through a galaxy with moons (from docks and from mid-flight, at any heading and speed) that all
  dock, touch nothing, keep their distance and never open the throttle with the nose off the path.
- **Shell code** runs against happy-dom: the mode script as shipped, the router's navigation and
  history rules, the panel, the swap contract.
- **The build output is a contract** (`scripts/verify-dist.mjs`, part of `npm run verify`): CSP
  hashes present, plain mode free of three.js, weight budgets, every internal link resolves, every
  page identical outside `<main>` and `[data-page-head]`, nothing dev-only (`/lab`, lil-gui) and
  no `TODO(copy)` in `dist/`.
- **`tests/`** holds the checks that are about the repo rather than a module: the lint boundaries
  still bite, the build scripts work, and no phone number or private address is in the repo.
- **Real browsers.** `npm run preview` serves `dist/` the way Cloudflare will (headers, CSP, 404).
  Looks and feel are judged there and on real phones; a number in a test cannot say whether
  flying is fun.

`npm run verify` runs all of it and is what CI runs. Run it before every commit.

## 9. Tools for looking inside

| Tool | How | What for |
| --- | --- | --- |
| Perf readout | `?perf` on any page, in every build | fps, frame time, draw calls, triangles, pixels, tier and resolution scale, position, speed, whose pull the ship is under, and the state (`autopilot system/code`) |
| Force a tier | `?q=low`, `?q=medium`, `?q=high` | judge a look on every tier; the probe is off |
| Tuning panel | `?universe&tweak`, development only | sliders for the live blocks of `tuning.ts`, "copy tuning as JSON", and a flight recorder that replays a run |
| **The lab** | `http://localhost:4321/lab/`, development only | one planet, moon, sun, rocket, station or satellite on a turntable, in front of the real sky, lit and post-processed as in the universe; sliders for `shading`, `planet`, `world`, `post`, `ship`; light direction; tier |
| Production preview | `npm run build`, then `npm run preview` | CSP, headers, 404, trailing slashes. Restart it after every build |

The lab and the tuning panel are imported behind `import.meta.env.DEV`. A production build drops
them and lil-gui with them, and `verify-dist` fails the build if either ever shows up.

## 10. Adding things

The recipes are in [AGENTS.md](../AGENTS.md#recipes): a token, a tuning constant, a material or
shader, a model, an engine system, a page, a project. The short version of all of them:

1. Pure maths goes in `sim/` with a test. Looks go in `design/`. A view connects the two.
2. Add the system in `main.ts`, in the place in the order where it belongs.
3. Track what you create in a `Scope`, and dispose it.
4. If a visitor would miss it after a rebuild, it is a snapshot field.
5. `npm run verify`.
