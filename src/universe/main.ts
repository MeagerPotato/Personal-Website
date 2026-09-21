import { Vector3 } from 'three';
import type { UniverseEvents, UniverseOptions } from './api';
import { CameraRig } from './camera/CameraRig';
import { ChaseCam } from './camera/ChaseCam';
import { AssetStore } from './core/AssetStore';
import { PerfHud } from './core/debug/PerfHud';
import { Engine } from './core/Engine';
import { EventBus } from './core/events';
import { InputSystem } from './core/input/InputSystem';
import { KeyboardInput } from './core/input/KeyboardInput';
import { PointerSteer } from './core/input/PointerSteer';
import { TouchControls } from './core/input/TouchControls';
import { JobQueue } from './core/jobs';
import { tuning } from './design/tuning';
import { homeSystemOf, nearestNeighbourOf, readManifest } from './manifest';
import { ShipSystem } from './ship/ShipSystem';
import { spawnPoint } from './sim/spawn';
import { createSurroundings } from './sim/surroundings';
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
 */
export function boot(options: UniverseOptions): {
  engine: Engine;
  events: EventBus<UniverseEvents>;
} {
  // Before anything is created: a manifest we cannot read must not leave a canvas behind.
  const manifest = readManifest(options.manifest);
  const events = new EventBus<UniverseEvents>();
  const reducedMotion = options.reducedMotion ?? false;

  const engine = new Engine({
    mount: options.mount,
    onFirstFrame: () => events.emit('ready', undefined),
    // Phase 1 step 12 replaces this with "rebuild the engine on a fresh canvas from a snapshot".
    onContextLost: () => events.emit('fatal', { reason: 'WebGL context lost' }),
  });

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const assets = engine.add(new AssetStore());

  const input = engine.add(new InputSystem(() => events.emit('firstinput', undefined)));
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
  engine.add(new CameraRig(engine.camera, new ChaseCam(ship, { reducedMotion })));

  const jobs = new JobQueue(tuning.world.jobBudgetMs);
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

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(new Starfield({ coarsePointer, reducedMotion }));
  const dust = engine.add(new SpaceDust({ viewer: ship, coarsePointer, reducedMotion }));
  engine.scene.add(backdrop.object, starfield.object, dust.object, galaxy.object, ship.object);
  engine.add(jobs);

  if (options.debug?.perf) {
    const { assist, orbits } = surroundings;
    const near = (): string =>
      assist.body < 0 ? '-' : `${orbits.ids[assist.body] ?? '?'} ${assist.weight.toFixed(2)}`;
    engine.add(
      new PerfHud(options.mount, engine.renderer, () => [
        `speed ${ship.speed.toFixed(1)} u/s`,
        `near  ${near()}`,
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
  return { engine, events };
}
