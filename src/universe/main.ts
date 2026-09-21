import type { UniverseEvents, UniverseOptions } from './api';
import { CameraRig } from './camera/CameraRig';
import { ChaseCam } from './camera/ChaseCam';
import { AssetStore } from './core/AssetStore';
import { PerfHud } from './core/debug/PerfHud';
import { Engine } from './core/Engine';
import { EventBus } from './core/events';
import { InputSystem } from './core/input/InputSystem';
import { KeyboardInput } from './core/input/KeyboardInput';
import { ShipSystem } from './ship/ShipSystem';
import { Backdrop } from './world/Backdrop';
import { SpaceDust } from './world/SpaceDust';
import { Starfield } from './world/Starfield';

/**
 * Composition root: builds the engine and adds systems in an explicit order, because the order
 * is the data flow of a frame. Input is read before the ship flies by it; the ship is drawn
 * before the camera looks at it; the dust surrounds wherever the ship ended up. (Disposal runs
 * the other way, so the asset store, added first, outlives everything that borrowed from it.)
 */
export function boot(options: UniverseOptions): {
  engine: Engine;
  events: EventBus<UniverseEvents>;
} {
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

  const ship = engine.add(new ShipSystem({ pilot: input, assets, reducedMotion }));
  engine.add(new CameraRig(engine.camera, new ChaseCam(ship, { reducedMotion })));

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(new Starfield({ coarsePointer, reducedMotion }));
  const dust = engine.add(new SpaceDust({ viewer: ship, coarsePointer, reducedMotion }));
  engine.scene.add(backdrop.object, starfield.object, dust.object, ship.object);

  if (options.debug?.perf) engine.add(new PerfHud(options.mount, engine.renderer));
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
