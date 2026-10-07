import { Vector3 } from 'three';
import type { Deck, UniverseOptions } from './api';
import { CameraRig } from './camera/CameraRig';
import { MapCam } from './camera/MapCam';
import { OrbitCam } from './camera/OrbitCam';
import { ChaseCam } from './camera/ChaseCam';
import { AssetStore } from './core/AssetStore';
import { PerfHud } from './core/debug/PerfHud';
import { Engine } from './core/Engine';
import { InputSystem } from './core/input/InputSystem';
import { KeyboardInput } from './core/input/KeyboardInput';
import { PointerSteer } from './core/input/PointerSteer';
import { TouchControls } from './core/input/TouchControls';
import { JobQueue } from './core/jobs';
import { lowerTier, type QualityTier } from './core/quality/tiers';
import type { Snapshot, StampedSnapshot } from './core/snapshot';
import { setBloomMask, setToonFlatness } from './design/materials';
import type { ThemeKey } from './design/tokens';
import { tuning } from './design/tuning';
import { LANDMARKS } from './design/worlds/landmarks';
import { PostFX } from './fx/PostFX';
import { familiesOf, galaxyKey, homeSystemOf, nearestNeighbourOf, readManifest } from './manifest';
import { ShipSystem } from './ship/ShipSystem';
import { Navigator, type NavigatorEvents } from './state/Navigator';
import { BodiesOnScreen } from './ui/BodiesOnScreen';
import { FlightDeck } from './ui/FlightDeck';
import { HyperOffer } from './ui/HyperOffer';
import { Labels } from './ui/Labels';
import { Leaders } from './ui/Leaders';
import { MiniMap } from './ui/MiniMap';
import { Picker } from './ui/Picker';
import { Prompt } from './ui/Prompt';
import { StarMap } from './ui/StarMap';
import { copyShipState, createShipState } from './sim/flight';
import { starCalm } from './sim/hyper';
import { systemAt } from './sim/instruments';
import { landmarkOf, type Landmark } from './sim/landmarks';
import { boundsOf } from './sim/mapView';
import { angleOf } from './sim/math';
import { spawnPoint } from './sim/spawn';
import { sunSeed } from './sim/sunSurface';
import { createSurroundings, syncSurroundings } from './sim/surroundings';
import { AirShells } from './world/AirShells';
import { Backdrop } from './world/Backdrop';
import { Chart } from './world/Chart';
import { Galaxy } from './world/Galaxy';
import { Hyperspace } from './world/Hyperspace';
import { livingSun, lookOf } from './world/looks';
import { SkyBake, type SkyState } from './world/SkyBake';
import { SpaceDust } from './world/SpaceDust';
import { Starfield } from './world/Starfield';
import { SunCorona } from './world/SunCorona';
import { Traffic } from './world/Traffic';

/**
 * Composition root: builds the engine and adds systems in an explicit order, because the order
 * is the data flow of a frame. Input is read before the ship flies by it; the ship is drawn
 * before the camera looks at it; the world and the dust arrange themselves around wherever the
 * ship ended up; and generating meshes gets whatever time is left. (Disposal runs the other way,
 * so the asset store, added first, outlives everything that borrowed from it.)
 *
 * THE STAR MAP (ui/StarMap.ts) is one more way of looking at all of this, not another state of
 * it: the ship flies on, docks and undocks as before, with the flight controls switched off
 * because the same keys and fingers move the map. Pointing at a body means the same on the map
 * as in flight, "go there", and doing so puts the map away.
 *
 * With a `start` snapshot the world comes up exactly where that snapshot was taken: this is how
 * the universe survives a lost WebGL context (api.ts), a reload, and a full page load. With `at`,
 * the ship is in orbit round that body before the first frame: a page opened on a planet starts
 * THERE, without flying and without ever having been in flight.
 */
export interface BootHooks {
  onFirstFrame(): void;
  onFirstInput(): void;
  onContextLost(): void;
  /** The first seconds showed that the tier is too much for this device. */
  onDemote(): void;
  /** Where the visitor is headed or docked (state/Navigator.ts). */
  onNavigation<K extends keyof NavigatorEvents>(event: K, payload: NavigatorEvents[K]): void;
  /** The star map opened or closed, whoever did it. */
  onMap(open: boolean): void;
  /** The baked sky is on its way, there, or not to be had (world/SkyBake.ts). */
  onSky(state: SkyState): void;
}

export interface BootQuality {
  tier: QualityTier;
  /** Chosen by a person (`?q=`), so the engine must not second-guess it. */
  forced: boolean;
}

/** How much of the viewport the page's own chrome covers, in CSS px (api.ts, `setPanelInset`). */
export interface ViewInset {
  /** How far down the top bar's links reach: the names keep below them, and so does the map. */
  top?: number;
  right?: number;
  bottom?: number;
  /** From the left edge: content that stands on both sides of what matters. */
  left?: number;
  /** How much of the top the camera leaves out when it frames what matters (none if left out). */
  frameTop?: number;
  /** The page's footer chip over the bottom-left corner: from the left edge to right, top down. */
  foot?: { right: number; top: number };
}

export interface Booted {
  engine: Engine;
  navigator: Navigator;
  /** The panel moved, or the top bar grew: frame the world in what is left, keep names off it. */
  setInset(inset: ViewInset, cut: boolean): void;
  /**
   * The page's content stands round the docked body as cards, or (null) it does not (api.ts,
   * `setDeck`). While a deck is set the wheel is the page's, every card has a leader to the body
   * (ui/Leaders.ts), and the orbit camera turns to the landmark of the card that is open (`cut`:
   * at once).
   */
  setDeck(deck: Deck | null, cut: boolean): void;
  /** Open or close the star map. `cut`: be there at once (a rebuilt engine, picking up where it was). */
  setMapOpen(open: boolean, cut: boolean): void;
  /** Where everything is right now, and in which galaxy (core/snapshot.ts). */
  snapshot(): StampedSnapshot;
}

export function boot(
  options: UniverseOptions,
  hooks: BootHooks,
  quality: BootQuality,
  start: Snapshot | null,
  at: string | null = null,
): Booted {
  // Before anything is created: a manifest we cannot read must not leave a canvas behind.
  const manifest = readManifest(options.manifest);
  // Every snapshot says which galaxy it was taken in (core/snapshot.ts, startingFrom).
  const stamp = galaxyKey(manifest);
  const reducedMotion = options.reducedMotion ?? false;

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const tier = tuning.quality.tiers[quality.tier];
  setBloomMask(tier.post);

  const engine = new Engine({
    mount: options.mount,
    startSteps: start?.steps ?? 0,
    quality: tier,
    pipeline: (renderer, samples) => new PostFX(renderer, samples),
    coarsePointer,
    canDemote: !quality.forced && lowerTier(quality.tier) !== null,
    onFirstFrame: hooks.onFirstFrame,
    onDemote: hooks.onDemote,
    onContextLost: hooks.onContextLost,
  });

  const assets = engine.add(new AssetStore());

  const input = engine.add(new InputSystem(hooks.onFirstInput));
  // (The keyboard joins them further down: it asks the navigator what Shift means.)
  const touch = new TouchControls(engine.canvas, options.mount);
  input.add(touch);
  input.add(new PointerSteer(engine.canvas));

  const home = homeSystemOf(manifest);
  const spawn = spawnPoint(
    home.position,
    nearestNeighbourOf(manifest, home)?.position ?? null,
    tuning.ship.spawn,
  );
  // The world as the SIMULATION sees it: where the bodies are, how big, and where space ends.
  const surroundings = createSurroundings(
    { systems: manifest.systems, bodies: manifest.bodies, home: home.position },
    tuning.edge.margin,
  );
  const ship = engine.add(
    new ShipSystem({ spawn, pilot: input, surroundings, assets, reducedMotion }),
  );
  if (start) ship.restore(start.ship);
  // After the ship, so that it sees what each step did to the dock in that same step.
  const navigator = engine.add(
    new Navigator({
      surroundings,
      ship,
      pilot: input,
      params: tuning,
      reducedMotion,
      emit: hooks.onNavigation,
    }),
  );
  // Docking needs to know where the bodies are NOW, and the first step has not placed them yet.
  if (start?.dock || at !== null) {
    syncSurroundings(surroundings, (start?.steps ?? 0) / tuning.loop.stepHz);
  }
  if (start) navigator.restore(start.dock, reducedMotion, start);
  // The keyboard. On a journey Shift is hyperspace's (ui/HyperOffer.ts), not boost; and the Shift
  // that took a jump is not boost when the controls take the journey back, at the autopilot's
  // speed, however long it stays down: only a fresh press is (core/input/keys.ts).
  input.add(
    new KeyboardInput(window, () => {
      const { mode } = navigator.state;
      return mode === 'autopilot' || mode === 'approach';
    }),
  );
  // Boost only multiplies the pilot's own thrust: outside free flight a finger's boost pad would
  // light up and do nothing, so it is put away (the stick stays: it is how the pilot leaves).
  engine.add({
    frameUpdate: () => touch.setFlying(navigator.state.mode === 'flight'),
    dispose: () => undefined,
  });
  // An unknown id (a page whose body is a draft, a manifest from another deploy) is no error: the
  // page is in the panel all the same, and the ship simply starts in open sky.
  // (A dock restored just above is already there, and `place` then changes nothing.)
  if (at !== null) navigator.place(at);

  // The cameras are MADE here, because the map needs to know the shape of the view, and the world
  // needs to know about the map; the rig takes its turn in the frame further down.
  // (Hyperspace is built further down, after the galaxy it reads; the chase camera's lens
  // follows whatever it shows, from here.)
  let hyperspace: Hyperspace | null = null;
  const chase = new ChaseCam(ship, { reducedMotion, surge: () => hyperspace?.look.surge ?? 0 });
  const orbit = new OrbitCam({ reducedMotion });
  const rig = new CameraRig(engine.camera, chase, tuning.cameraRig);
  // What the web layer last said of the page's cards (`setDeck`, below). Not the engine's state:
  // it follows from the URL and the page, and api.ts tells a rebuilt engine again. (The page's
  // DECK of cards, that is: the instruments at the bottom of the view are `flightDeck`.)
  let deck: Deck | null = null;
  // Everything there is to see: what the star map opens on, and the minimap at its widest.
  const bounds = boundsOf(manifest.systems);
  const starMap = engine.add(
    new StarMap({
      canvas: engine.canvas,
      overlay: options.overlay,
      bounds,
      ship: () => ship.state,
      view: rig.shape,
      params: tuning.map,
      reducedMotion,
      // Among cards the wheel goes from one to the next: scrolling out is not asking for the map.
      wheelOpens: () => deck === null,
      tapMaxPx: tuning.picking.tapMaxPx,
      onChange: (open, cut) => {
        input.setEnabled(!open);
        // Now, not with the next frame: a cut to the map is then a cut in every part of it.
        direct(cut);
        hooks.onMap(open);
        // The names may be set in another size on the map: measure them in the one they now have.
        labels?.remeasure();
      },
    }),
  );
  const mapCam = new MapCam(starMap);

  const jobs = new JobQueue(tuning.world.jobBudget);
  // ...and as the visitor sees it. Both follow the same orbits.
  const galaxy = engine.add(
    new Galaxy({
      manifest,
      orbits: surroundings.orbits,
      assets,
      jobs,
      viewer: ship,
      reducedMotion,
      // The tier is fixed for the life of an engine: a demotion boots a new one (api.ts).
      low: quality.tier === 'low',
      map: starMap,
    }),
  );
  const light = new Vector3();
  engine.add({
    frameUpdate: () => ship.setSun(galaxy.lightAt(ship.position, light)),
    dispose: () => undefined,
  });

  // HYPERSPACE (world/Hyperspace.ts): how a journey's fast stretch looks. Nothing of it flies
  // the ship. Before the rig, whose lens follows it. (It asks which body the ship is headed for,
  // for its family's colours, and never where that body is: the tunnel is round the course.) A
  // visitor who asked for less motion has none of it.
  const headed: { id: string; theme: ThemeKey | undefined } = { id: '', theme: undefined };
  if (!reducedMotion) {
    hyperspace = engine.add(
      new Hyperspace({
        dock: surroundings.dock,
        ship,
        target: () => {
          const row = targetRow();
          const id = surroundings.orbits.ids[row];
          if (id === undefined) return null;
          headed.id = id;
          headed.theme = families.get(id);
          return headed;
        },
        mapWeight: () => starMap.weight,
        camera: engine.camera,
        // The tier is fixed for the life of an engine, as for the galaxy.
        dashes: tuning.hyper.dashes[quality.tier],
        ribs: quality.tier !== 'low',
      }),
    );
  }

  // The camera comes after everything it looks at, so that it sees this frame's ship and planets.
  // On the map, it looks down on the galaxy; flying, it chases the ship; docked, it frames the
  // body. A ship that was PUT somewhere (a page opened on a planet, a rebuild) is cut to; one that
  // flew there is eased to, unless the visitor asked for less motion: a camera sweeping round is a
  // flourish, not flying.
  let framed: string | null = null;
  let framing = false;
  // The card that is open points at a LANDMARK of the body its page belongs to (sim/landmarks.ts),
  // and while the ship is docked at that body the orbit camera faces it. `facing` is what the
  // camera was last told, so that a deck told again (a card's box moved by a pixel) does not
  // start the turn afresh. `faced` is that card's landmark, kept for the card's leader, which
  // ends on it and asks where it is every frame.
  const mark = new Vector3();
  let facing = '';
  let faced: { body: string; key: string; landmark: Landmark } | null = null;
  function aim(cut: boolean): void {
    const body = deck?.body ?? null;
    const cards = deck?.cards ?? [];
    const index =
      body !== null && body === framed ? cards.findIndex((c) => c.key === deck?.open) : -1;
    const card = cards[index];
    const middle = card && body !== null ? galaxy.subject(body)?.position : undefined;
    const next = card && middle ? `${body}#${card.key}:${card.side}` : '';
    if (next === facing) return;
    facing = next;
    if (!card || !middle || body === null) {
      faced = null;
      orbit.face(null, cut);
      return;
    }
    const landmark = landmarkOf(LANDMARKS, body, card.key, index, cards.length, tuning.deck);
    faced = { body, key: card.key, landmark };
    orbit.face(
      {
        side: card.side,
        // Where it is round the body NOW: on a turning world it goes round with the ground.
        azimuth: () =>
          galaxy.landmark(body, landmark, mark) ? angleOf(mark.x - middle.x, mark.z - middle.z) : 0,
      },
      cut,
    );
  }
  function direct(cut = false): void {
    const { mode, target } = navigator.state;
    const docked = mode === 'docked' ? target : null;
    if (docked !== framed) {
      framed = docked;
      const subject = docked === null ? null : galaxy.subject(docked);
      if (subject) orbit.look(subject);
      framing = subject !== null;
      // An arrival ends facing what the page's open card points at; a ship that leaves lets the
      // view ease out of it, since the picture is still the orbit camera's when the blend begins.
      aim(docked !== null);
    }
    const want = starMap.isOpen ? mapCam : framing ? orbit : chase;
    if (want === rig.active) return;
    const viaMap = want === mapCam || rig.active === mapCam;
    const arrivedByCut = want === orbit && navigator.lastArrival === 'cut';
    const blendSec = viaMap ? tuning.map.blendSec : tuning.cameraRig.dockBlendSec;
    rig.use(want, cut || reducedMotion || (arrivedByCut && !viaMap) ? 0 : blendSec);
  }
  engine.add({ frameUpdate: () => direct(), dispose: () => undefined });
  engine.add(rig);

  // Pointing at a planet goes there. After the rig and the galaxy: it needs this frame's picture.
  // It is the visitor's own doing, like the controls, so whatever page was open is left behind
  // (`by: 'pilot'`) and the page of the new place opens on arrival (shell/follow.ts). Whoever
  // asked for less motion is put there instead of being flown across the galaxy, as with a link.
  const onScreen = engine.add(
    new BodiesOnScreen({
      camera: engine.camera,
      positions: galaxy.positions,
      radii: surroundings.field.radius,
      // A body is measured as it is drawn: bigger on the map, or not at all.
      scales: galaxy.displayScale,
      count: surroundings.orbits.count,
    }),
  );
  const targetRow = (): number => {
    const { target } = navigator.state;
    return target === null ? -1 : surroundings.orbits.indexOf(target);
  };
  const flyToRow = (row: number): void => {
    const id = surroundings.orbits.ids[row];
    if (id === undefined) return;
    if (!reducedMotion) navigator.travel(id, 'pilot');
    else if (!navigator.approach(id, 'pilot')) navigator.place(id, 0, 1, 'pilot');
    // The map was for choosing where to go. Now for going there.
    starMap.setOpen(false);
  };
  // A body nothing docks at (a link: GitHub, circling home) is not somewhere to go, and a hand on
  // the sky, busy steering, must never be carried off the site by one either: pointing at it
  // brings its name forward instead (ui/Labels.ts, beckon), and the name is the link.
  const pickRow = (row: number): void => {
    if (surroundings.field.docks[row] === 0) labels?.beckon(row);
    else flyToRow(row);
  };
  engine.add(
    new Picker({
      canvas: engine.canvas,
      screen: onScreen.map,
      params: tuning.picking,
      ignore: targetRow,
      onPick: pickRow,
    }),
  );
  let labels: Labels | null = null;
  let prompt: Prompt | null = null;
  let offer: HyperOffer | null = null;
  let flightDeck: FlightDeck | null = null;
  let minimap: MiniMap | null = null;
  // Every body as the names and the minimap know it, by row of the orbit table.
  const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
  const families = familiesOf(manifest);
  const rows = surroundings.orbits.ids.map((id, row) => {
    const body = byId.get(id);
    return {
      id,
      title: body?.title ?? id,
      kind: body?.kind ?? 'moon',
      planned: body?.planned === true,
      href: body?.docks === false ? body.href : undefined,
      theme: families.get(id),
      system: manifest.systems.findIndex((system) => system.id === body?.system),
      // What it circles, as a row of this table (-1: nothing).
      parent: surroundings.orbits.parent[row] ?? -1,
    };
  });
  // On the map the ship is a marker big enough to find: at least shipRadiusPx, in units (the
  // ship is about two units long, so one unit is its "radius"), raised so that it lies on top of
  // whatever it is beside. Drawn so below; the names keep off it as drawn.
  const markerUnits = (): number => Math.max(1, tuning.map.shipRadiusPx * starMap.unitsPerPx);
  const markerLift = (units: number): number => starMap.weight * (galaxy.displayReach + units);
  const shipAt = { x: 0, y: 0 };
  const shipBox = { left: 0, top: 0, width: 0, height: 0 };
  if (options.overlay) {
    // A name under every body that has room for one: pressing it is pointing at the body, and
    // for a link (which nothing docks at) following the link.
    labels = engine.add(
      new Labels({
        overlay: options.overlay,
        screen: onScreen.map,
        bodies: rows,
        params: tuning.labels,
        view: rig.shape,
        target: targetRow,
        // (On the map every body has its name, the one the ship is at included: "you are here".)
        docked: () => navigator.state.mode === 'docked' && !starMap.isOpen,
        onPick: flyToRow,
        // What else is out there to keep off: what can be pressed, the flight deck and the
        // minimap. The prompt, the offer of hyperspace and those two are only built further down
        // (they are updated last in a frame); by the time anyone asks, they are there.
        obstacles: [
          () => prompt?.box() ?? null,
          () => offer?.box() ?? null,
          () => touch.padBox(),
          () => starMap.box(),
          () => flightDeck?.box() ?? null,
          () => minimap?.box() ?? null,
        ],
        // On the map the ship is the marker that says "you are here": no name lies on it.
        ship: () => {
          if (!starMap.isOpen) return null;
          const units = markerUnits();
          const { x, z } = ship.position;
          if (!onScreen.pointAt(x, z, shipAt, markerLift(units))) return null;
          // As big as it is drawn: the marker, or the ship itself once that is bigger.
          const half = units / starMap.unitsPerPx;
          shipBox.left = shipAt.x - half;
          shipBox.top = shipAt.y - half;
          shipBox.width = 2 * half;
          shipBox.height = 2 * half;
          return shipBox;
        },
        // The map holds still: there a name has other places than under its body (ui/Labels.ts),
        // from the moment the camera has pulled all the way out to it.
        onMap: () => starMap.arrived,
      }),
    );
  }

  // A line from each card of the page's deck to the body the cards stand round, while that body
  // is framed and nothing is in the way: the orbit view, arrived, and no star map.
  engine.add(
    new Leaders({
      mount: options.mount,
      deck: () => deck,
      framed: (body, out) =>
        body === framed &&
        rig.active === orbit &&
        rig.settled &&
        !(starMap.weight > 0) &&
        // Out to the edge of its GROUND, as that is drawn: the map of the screen has a world
        // out to its rings and signs, and planned work's maquette is smaller than its body.
        onScreen.disc(surroundings.orbits.indexOf(body), galaxy.ground(body), out),
      landmark: (body, index, out) => {
        const count = deck?.cards.length ?? 0;
        const key = deck?.cards[index]?.key ?? '';
        // The one the camera faces, which is this card's while its leader closes in on it (a
        // card with no landmark of its own would have one made for it every frame).
        const at =
          faced !== null && faced.body === body && faced.key === key
            ? faced.landmark
            : landmarkOf(LANDMARKS, body, key, index, count, tuning.deck);
        return galaxy.landmark(body, at, mark) && onScreen.pointAt(mark.x, mark.z, out, mark.y);
      },
      focus: () => orbit.focus,
      themeOf: (body) => families.get(body),
      params: tuning.deck,
      reducedMotion,
    }),
  );

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(
    new Starfield({ coarsePointer, reducedMotion, low: quality.tier === 'low' }),
  );
  const dust = engine.add(new SpaceDust({ viewer: ship, coarsePointer, reducedMotion }));
  // The light round every sun. After the galaxy: it reads where the suns are this frame.
  const sunFamilies = familiesOf(manifest);
  const coronas = engine.add(
    new SunCorona({
      suns: manifest.bodies.flatMap((body) => {
        const family = sunFamilies.get(body.id);
        if (body.kind !== 'sun' || family === undefined) return [];
        return {
          row: surroundings.orbits.indexOf(body.id),
          family,
          radius: body.radius,
          seed: sunSeed(body.id),
          living: livingSun(lookOf(body, family)),
        };
      }),
      positions: galaxy.positions,
      scales: galaxy.displayScale,
      low: quality.tier === 'low',
      reducedMotion,
    }),
  );
  // The air of the worlds that have it. After the galaxy too. Which of them wear clouds is the
  // tier's to say: none on low, home alone on medium (where phones start), every one on high.
  const cloudy = tuning.look.air.cloudTiers[quality.tier];
  const homeId = manifest.bodies.find((body) => body.kind === 'home')?.id;
  const air = engine.add(
    new AirShells({
      worlds: galaxy.airWorlds.map((world) => {
        const clouds = cloudy === 'all' || (cloudy === 'home' && world.id === homeId);
        return clouds ? world : { ...world, cloud: undefined };
      }),
      positions: galaxy.positions,
      scales: galaxy.displayScale,
      low: quality.tier === 'low',
      reducedMotion,
    }),
  );
  // The dots that go round the orbit lines, in each line's family. After the galaxy, as the
  // coronas are. A relay's orbit has none: nothing docks there, so nothing goes there.
  const traffic = engine.add(
    new Traffic({
      orbits: surroundings.orbits,
      families: surroundings.orbits.ids.map((id, row) =>
        surroundings.field.docks[row] === 0 ? undefined : sunFamilies.get(id),
      ),
      positions: galaxy.positions,
      scales: galaxy.displayScale,
      reducedMotion,
    }),
  );
  // The star map's ground: a district for each system. After the map, whose scale it reads.
  const chart = engine.add(
    new Chart({
      districts: manifest.systems.map(({ position: [x, z], radius, theme }) => ({
        x,
        z,
        radius,
        family: theme,
      })),
      map: starMap,
    }),
  );
  engine.scene.add(
    backdrop.object,
    chart.object,
    starfield.object,
    dust.object,
    galaxy.object,
    coronas.object,
    air.object,
    traffic.object,
    ship.object,
  );
  if (hyperspace) engine.scene.add(hyperspace.object);
  // How the world LOOKS on the map, eased in as the camera pulls out to it: flat colour, a calm
  // sky, no dust, and the ship as a marker big enough to find, lying on top of what it is beside.
  // A jump (world/Hyperspace.ts) dims the stars too, by its own share, and the baked sky's light
  // with them: its dashes are the stars then. And the flame burns longer in the tunnel.
  const stars = { calm: 0, opacity: 1 };
  engine.add({
    frameUpdate: () => {
      const { weight } = starMap;
      setToonFlatness(weight * tuning.map.flatness);
      const jump = hyperspace?.look;
      starCalm(weight, tuning.map.starOpacity, jump?.calm ?? 0, tuning.hyper.starOpacity, stars);
      starfield.setCalm(stars.calm, stars.opacity);
      coronas.setCalm(weight);
      air.setCalm(weight);
      ship.setSurge(jump?.surge ?? 0);
      dust.setPresence(1 - weight);
      const marker = markerUnits();
      ship.setMarker(Math.pow(marker, weight), markerLift(marker));
      sky.setView(navigator.state.mode === 'docked', weight);
      sky.setJump(jump?.calm ?? 0, tuning.hyper.starOpacity);
    },
    dispose: () => setToonFlatness(0),
  });
  // The baked sky (the Milky Way's haze, far galaxies), painted once after the first frame, a
  // band a frame; those frames say nothing about the device, so the governor is not fed them.
  // After the block above: it shows this frame's view. A snapshot only says whether the visitor
  // has seen it.
  const sky = engine.add(
    new SkyBake({
      renderer: engine.renderer,
      tier: tuning.look.sky.tiers[quality.tier],
      seen: start?.skyRevealed === true,
      reducedMotion,
      onState: hooks.onSky,
      onBand: () => engine.excuseFrame(),
    }),
  );
  engine.add(jobs);

  if (options.overlay) {
    const titles = new Map(manifest.bodies.map((body) => [body.id, body.title]));
    const planned = new Set(manifest.bodies.filter((body) => body.planned).map((body) => body.id));
    prompt = engine.add(
      new Prompt({
        overlay: options.overlay,
        navigator,
        titleOf: (id) => titles.get(id) ?? id,
        isPlanned: (id) => planned.has(id),
        // The map on a narrow screen with a page open is the strip above the sheet: the prompt's
        // offers would sit on the galaxy. They are back when the map closes; a journey's Stop
        // shows all along.
        quiet: () => starMap.isOpen && rig.shape.freeHeight < 0.99,
      }),
    );
    // The offer of hyperspace (ui/HyperOffer.ts): right after the prompt in the overlay, so that
    // Tab goes Stop, then Hyperspace, and the deck and the minimap stay last. It shows only while
    // the world has the whole screen: no page beside or under it, and the star map closed. (Asked
    // of the rig as the page WANTS the view, not as far as it has slid: a link opens its page and
    // sets the ship out in the same moment, and the offer comes with the journey's first step.)
    offer = engine.add(
      new HyperOffer({
        overlay: options.overlay,
        navigator,
        room: () => !starMap.isOpen && rig.whole,
      }),
    );

    // WHICH SYSTEM THE SHIP IS IN, or none (-1): the deck's horizon wears its family, and the
    // minimap is fitted to it. It follows from where the ship is, so it is asked once a frame and
    // kept nowhere else: a rebuilt engine finds it again with its first frame.
    let whereabouts = -1;
    engine.add({
      frameUpdate: () => {
        const { x, z } = ship.position;
        whereabouts = systemAt(whereabouts, x, z, manifest.systems, tuning.instruments);
      },
      dispose: () => undefined,
    });
    // The flight deck: it reads all of the above and asks for nothing (ui/FlightDeck.ts). After
    // the prompt: it and the minimap are the last things in the overlay.
    const homeBody = manifest.bodies.find((body) => body.kind === 'home');
    const cluster = (flightDeck = engine.add(
      new FlightDeck({
        overlay: options.overlay,
        ship,
        navigator,
        assistWeight: () => surroundings.assist.weight,
        positions: galaxy.positions,
        rowOf: (id) => surroundings.orbits.indexOf(id),
        home: homeBody ? surroundings.orbits.indexOf(homeBody.id) : -1,
        theme: () => manifest.systems[whereabouts]?.theme ?? null,
        mapOpen: () => starMap.isOpen,
        params: tuning.instruments,
        reducedMotion,
      }),
    ));
    // The minimap (ui/MiniMap.ts): the star map at another size, there wherever the deck has its
    // full size. A press on a mark is pointing at that body, exactly as on the canvas; a press
    // where nothing is opens the map it is the preview of. A journey it reads straight from the
    // autopilot: the path that is left and the seconds it takes, once the first step has planned.
    const { dock, cruise } = surroundings;
    minimap = engine.add(
      new MiniMap({
        overlay: options.overlay,
        systems: manifest.systems,
        bodies: rows,
        orbits: surroundings.orbits,
        radii: surroundings.field.radius,
        docks: surroundings.field.docks,
        positions: galaxy.positions,
        bounds,
        ship,
        at: () => whereabouts,
        target: targetRow,
        journey: () => (dock.phase === 'cruise' && !cruise.fresh ? cruise : null),
        room: () => cluster.full,
        mapOpen: () => starMap.isOpen,
        onPick: pickRow,
        onMap: () => starMap.setOpen(true),
        params: tuning.minimap,
        picking: tuning.picking,
        reducedMotion,
      }),
    );
  }

  if (options.debug?.perf) {
    const { assist, dock, orbits } = surroundings;
    // Whose pull the ship is under. A carried ship's is its dock's (the assist is not asked while
    // it is carried, so what it remembers is old news), and a journey is under nobody's.
    const near = (): string => {
      const body = dock.phase === 'free' ? assist.body : dock.phase === 'cruise' ? -1 : dock.body;
      return body < 0 ? '-' : `${orbits.ids[body] ?? '?'} ${assist.weight.toFixed(2)}`;
    };
    const doing = (): string => {
      const { mode, target } = navigator.state;
      const going = target === null ? mode : `${mode} ${target}`;
      // Hyperspace too, so that a phone on a preview can show where a jump is.
      const state = navigator.hyper === 'off' ? going : `${going} hyper ${navigator.hyper}`;
      return starMap.isOpen ? `${state} (map)` : state;
    };
    engine.add(
      new PerfHud(options.mount, engine.renderer, () => [
        `tier  ${quality.tier} x${engine.resolutionScale.toFixed(2)}`,
        `at    ${ship.position.x.toFixed(0)}, ${ship.position.z.toFixed(0)}`,
        `speed ${ship.speed.toFixed(1)} u/s`,
        `near  ${near()}`,
        `state ${doing()}`,
      ]),
    );
  }
  // The condition is a build-time constant, so a production build drops the import, and lil-gui
  // with it (scripts/verify-dist.mjs checks).
  if (import.meta.env.DEV && options.debug?.tweak) {
    void import('./core/debug/TweakPanel').then(({ TweakPanel }) => {
      if (!engine.isDisposed) engine.add(new TweakPanel({ input, ship, sky }));
    });
  }

  engine.start();
  return {
    engine,
    navigator,
    setInset(inset, cut) {
      rig.setInset(
        { top: inset.frameTop, right: inset.right, bottom: inset.bottom, left: inset.left },
        cut,
      );
      labels?.setTop(inset.top ?? 0);
      labels?.setFoot(inset.foot ?? null);
      starMap.setTop(inset.top ?? 0);
      flightDeck?.setRoom(inset.right ?? 0, inset.bottom ?? 0, inset.left ?? 0);
    },
    setDeck(next, cut) {
      deck = next;
      aim(cut);
    },
    setMapOpen: (open, cut) => starMap.setOpen(open, cut),
    snapshot: () => ({
      steps: engine.steps,
      ship: copyShipState(ship.state, createShipState()),
      dock: navigator.snapshot(),
      halting: navigator.halting,
      guarding: navigator.guarding,
      skyRevealed: sky.seen,
      galaxy: stamp,
    }),
  };
}
