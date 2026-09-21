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
 * the universe survives a lost WebGL context (api.ts).
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
  if (start?.dock) {
    syncSurroundings(surroundings, start.steps / tuning.loop.stepHz);
    navigator.restore(start.dock);
  }
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
    const { assist, orbits } = surroundings;
    const near = (): string =>
      assist.body < 0 ? '-' : `${orbits.ids[assist.body] ?? '?'} ${assist.weight.toFixed(2)}`;
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
