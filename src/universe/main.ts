import { Vector3 } from 'three';
import type { UniverseOptions } from './api';
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
import type { Snapshot } from './core/snapshot';
import { setBloomMask, setToonFlatness } from './design/materials';
import { tuning } from './design/tuning';
import { PostFX } from './fx/PostFX';
import { homeSystemOf, nearestNeighbourOf, readManifest } from './manifest';
import { ShipSystem } from './ship/ShipSystem';
import { Navigator, type NavigatorEvents } from './state/Navigator';
import { BodiesOnScreen } from './ui/BodiesOnScreen';
import { Labels } from './ui/Labels';
import { Picker } from './ui/Picker';
import { Prompt } from './ui/Prompt';
import { StarMap } from './ui/StarMap';
import { copyShipState, createShipState } from './sim/flight';
import { boundsOf } from './sim/mapView';
import { spawnPoint } from './sim/spawn';
import { createSurroundings, syncSurroundings } from './sim/surroundings';
import { Backdrop } from './world/Backdrop';
import { Galaxy } from './world/Galaxy';
import { SpaceDust } from './world/SpaceDust';
import { Starfield } from './world/Starfield';

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
  /** Open or close the star map. `cut`: be there at once (a rebuilt engine, picking up where it was). */
  setMapOpen(open: boolean, cut: boolean): void;
  /** Where everything is right now (core/snapshot.ts). */
  snapshot(): Snapshot;
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
  input.add(new KeyboardInput());
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
      emit: hooks.onNavigation,
    }),
  );
  // Docking needs to know where the bodies are NOW, and the first step has not placed them yet.
  if (start?.dock || at !== null) {
    syncSurroundings(surroundings, (start?.steps ?? 0) / tuning.loop.stepHz);
  }
  if (start?.dock) navigator.restore(start.dock);
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
  const chase = new ChaseCam(ship, { reducedMotion });
  const orbit = new OrbitCam({ reducedMotion });
  const rig = new CameraRig(engine.camera, chase, tuning.cameraRig);
  const starMap = engine.add(
    new StarMap({
      canvas: engine.canvas,
      overlay: options.overlay,
      bounds: boundsOf(manifest.systems),
      view: rig.shape,
      params: tuning.map,
      reducedMotion,
      onChange: (open, cut) => {
        input.setEnabled(!open);
        // Now, not with the next frame: a cut to the map is then a cut in every part of it.
        direct(cut);
        hooks.onMap(open);
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
      map: starMap,
    }),
  );
  const light = new Vector3();
  engine.add({
    frameUpdate: () => ship.setSun(galaxy.lightAt(ship.position, light)),
    dispose: () => undefined,
  });

  // The camera comes after everything it looks at, so that it sees this frame's ship and planets.
  // On the map, it looks down on the galaxy; flying, it chases the ship; docked, it frames the
  // body. A ship that was PUT somewhere (a page opened on a planet, a rebuild) is cut to; one that
  // flew there is eased to, unless the visitor asked for less motion: a camera sweeping round is a
  // flourish, not flying.
  let framed: string | null = null;
  let framing = false;
  function direct(cut = false): void {
    const { mode, target } = navigator.state;
    const docked = mode === 'docked' ? target : null;
    if (docked !== framed) {
      framed = docked;
      const subject = docked === null ? null : galaxy.subject(docked);
      if (subject) orbit.look(subject);
      framing = subject !== null;
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
  engine.add(
    new Picker({
      canvas: engine.canvas,
      screen: onScreen.map,
      params: tuning.picking,
      ignore: targetRow,
      onPick: flyToRow,
    }),
  );
  let labels: Labels | null = null;
  let prompt: Prompt | null = null;
  // On the map the ship is a marker big enough to find: at least shipRadiusPx, in units (the
  // ship is about two units long, so one unit is its "radius"), raised so that it lies on top of
  // whatever it is beside. Drawn so below; the names keep off it as drawn.
  const markerUnits = (): number => Math.max(1, tuning.map.shipRadiusPx * starMap.unitsPerPx);
  const markerLift = (units: number): number => starMap.weight * (galaxy.displayReach + units);
  const shipAt = { x: 0, y: 0 };
  const shipBox = { left: 0, top: 0, width: 0, height: 0 };
  if (options.overlay) {
    // A name under every body that has room for one: pressing it is pointing at the body.
    const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
    labels = engine.add(
      new Labels({
        overlay: options.overlay,
        screen: onScreen.map,
        bodies: surroundings.orbits.ids.map((id) => {
          const body = byId.get(id);
          return { title: body?.title ?? id, kind: body?.kind ?? 'moon' };
        }),
        params: tuning.labels,
        view: rig.shape,
        target: targetRow,
        // (On the map every body has its name, the one the ship is at included: "you are here".)
        docked: () => navigator.state.mode === 'docked' && !starMap.isOpen,
        onPick: flyToRow,
        // What else can be pressed out there. The prompt is only built further down (it is
        // updated last in a frame); by the time anyone asks, it is there.
        obstacles: [() => prompt?.box() ?? null, () => touch.padBox(), () => starMap.box()],
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
        // The map holds still: there a name may go above its body, out of the ship's way.
        eitherSide: () => starMap.isOpen,
      }),
    );
  }

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(new Starfield({ coarsePointer, reducedMotion }));
  const dust = engine.add(new SpaceDust({ viewer: ship, coarsePointer, reducedMotion }));
  engine.scene.add(backdrop.object, starfield.object, dust.object, galaxy.object, ship.object);
  // How the world LOOKS on the map, eased in as the camera pulls out to it: flat colour, a calm
  // sky, no dust, and the ship as a marker big enough to find, lying on top of what it is beside.
  engine.add({
    frameUpdate: () => {
      const { weight } = starMap;
      setToonFlatness(weight * tuning.map.flatness);
      starfield.setCalm(weight, tuning.map.starOpacity);
      dust.setPresence(1 - weight);
      const marker = markerUnits();
      ship.setMarker(Math.pow(marker, weight), markerLift(marker));
    },
    dispose: () => setToonFlatness(0),
  });
  engine.add(jobs);

  if (options.overlay) {
    const titles = new Map(manifest.bodies.map((body) => [body.id, body.title]));
    prompt = engine.add(
      new Prompt({
        overlay: options.overlay,
        navigator,
        titleOf: (id) => titles.get(id) ?? id,
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
      const state = target === null ? mode : `${mode} ${target}`;
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
      if (!engine.isDisposed) engine.add(new TweakPanel({ input, ship }));
    });
  }

  engine.start();
  return {
    engine,
    navigator,
    setInset(inset, cut) {
      rig.setInset({ top: inset.frameTop, right: inset.right, bottom: inset.bottom }, cut);
      labels?.setTop(inset.top ?? 0);
      labels?.setFoot(inset.foot ?? null);
      starMap.setTop(inset.top ?? 0);
    },
    setMapOpen: (open, cut) => starMap.setOpen(open, cut),
    snapshot: () => ({
      steps: engine.steps,
      ship: copyShipState(ship.state, createShipState()),
      dock: navigator.snapshot(),
    }),
  };
}
