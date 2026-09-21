import { Vector3 } from 'three';
import type { UniverseOptions } from './api';
import { CameraRig } from './camera/CameraRig';
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
import { setBloomMask } from './design/materials';
import { tuning } from './design/tuning';
import { PostFX } from './fx/PostFX';
import { homeSystemOf, nearestNeighbourOf, readManifest } from './manifest';
import { ShipSystem } from './ship/ShipSystem';
import { Navigator, type NavigatorEvents } from './state/Navigator';
import { BodiesOnScreen } from './ui/BodiesOnScreen';
import { Picker } from './ui/Picker';
import { Prompt } from './ui/Prompt';
import { copyShipState, createShipState } from './sim/flight';
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
}

export interface BootQuality {
  tier: QualityTier;
  /** Chosen by a person (`?q=`), so the engine must not second-guess it. */
  forced: boolean;
}

export interface Booted {
  engine: Engine;
  navigator: Navigator;
  rig: CameraRig;
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
  input.add(new TouchControls(engine.canvas, options.mount));
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
  // An unknown id (a page whose body is a draft, a manifest from another deploy) is no error: the
  // page is in the panel all the same, and the ship simply starts in open sky.
  // (A dock restored just above is already there, and `place` then changes nothing.)
  if (at !== null) navigator.place(at);
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
    }),
  );
  const light = new Vector3();
  engine.add({
    frameUpdate: () => ship.setSun(galaxy.lightAt(ship.position, light)),
    dispose: () => undefined,
  });

  // The camera comes after everything it looks at, so that it sees this frame's ship and planets.
  // Flying, it chases the ship; docked, it frames the body. A ship that was PUT somewhere (a page
  // opened on a planet, a rebuild) is cut to; one that flew there is eased to, unless the visitor
  // asked for less motion: a camera sweeping round is a flourish, not flying.
  const chase = new ChaseCam(ship, { reducedMotion });
  const orbit = new OrbitCam({ reducedMotion });
  const rig = new CameraRig(engine.camera, chase, tuning.cameraRig);
  let framed: string | null = null;
  engine.add({
    frameUpdate: () => {
      const { mode, target } = navigator.state;
      const docked = mode === 'docked' ? target : null;
      if (docked === framed) return;
      framed = docked;
      const blendSec = reducedMotion ? 0 : tuning.cameraRig.dockBlendSec;
      const subject = docked === null ? null : galaxy.subject(docked);
      if (subject) {
        orbit.look(subject);
        rig.use(orbit, navigator.lastArrival === 'cut' ? 0 : blendSec);
      } else {
        rig.use(chase, blendSec);
      }
    },
    dispose: () => undefined,
  });
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
      count: surroundings.orbits.count,
    }),
  );
  engine.add(
    new Picker({
      canvas: engine.canvas,
      screen: onScreen.map,
      params: tuning.picking,
      ignore: () => {
        const { target } = navigator.state;
        return target === null ? -1 : surroundings.orbits.indexOf(target);
      },
      onPick: (row) => {
        const id = surroundings.orbits.ids[row];
        if (id === undefined) return;
        if (!reducedMotion) navigator.travel(id, 'pilot');
        else if (!navigator.approach(id, 'pilot')) navigator.place(id, 0, 1, 'pilot');
      },
    }),
  );

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(new Starfield({ coarsePointer, reducedMotion }));
  const dust = engine.add(new SpaceDust({ viewer: ship, coarsePointer, reducedMotion }));
  engine.scene.add(backdrop.object, starfield.object, dust.object, galaxy.object, ship.object);
  engine.add(jobs);

  if (options.overlay) {
    const titles = new Map(manifest.bodies.map((body) => [body.id, body.title]));
    engine.add(
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
      return target === null ? mode : `${mode} ${target}`;
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
    rig,
    snapshot: () => ({
      steps: engine.steps,
      ship: copyShipState(ship.state, createShipState()),
      dock: navigator.snapshot(),
    }),
  };
}
